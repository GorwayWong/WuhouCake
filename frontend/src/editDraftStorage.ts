import { randomUUID } from './uuid';

interface Record<T> {
  schema: 1 | 2;
  revision: string;
  value: T;
  expiresAt?: number;
  draftExpiresAt?: number;
  fileIds?: string[];
}

export const publicDraftPrefix = 'public-submission:';
const draftDeadline = (row?: Record<unknown>) => row?.schema === 2 ? row.draftExpiresAt : row?.expiresAt;

const fileKey = (key: IDBValidKey, id: string) => `draft-attachment:${key}:${id}`;
type DraftFile = { blob: Blob; name: string; lastModified: number };

type EditKind = 'item' | 'amount' | 'information';
export type DraftAccess = readonly [customer: boolean, amounts: boolean, phone: boolean, ordering: boolean];

export function editDraftKey(accountId: string, orderId: string, kind: EditKind, itemId: string | undefined, access: DraftAccess) {
  return JSON.stringify([accountId, orderId, kind, itemId, ...access]);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('wuhou-order-edits', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    let blocked = false;
    request.onblocked = () => { blocked = true; reject(new Error('Edit draft database blocked')); };
    request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
    request.onerror = () => reject(request.error);
  });
}

export async function listLockedDraftKeys(accountId: string, orderId: string, access: DraftAccess) {
  const prefix = JSON.stringify([accountId, orderId]).slice(0, -1) + ',';
  const db = await openDatabase();
  try {
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const tx = db.transaction('drafts', 'readonly');
      const request = tx.objectStore('drafts').getAllKeys(IDBKeyRange.bound(prefix, prefix + '\uffff'));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error);
    });
    return keys.flatMap(key => {
      if (typeof key !== 'string') return [];
      try {
        const [, , kind, itemId] = JSON.parse(key);
        if ((kind !== 'amount' && kind !== 'item' && kind !== 'information') || (itemId !== null && typeof itemId !== 'string')) return [];
        if (key !== editDraftKey(accountId, orderId, kind, itemId ?? undefined, access)) return [];
        return [{ key, kind: kind as EditKind, itemId: itemId as string | null }];
      } catch { return []; }
    });
  } finally {
    db.close();
  }
}

function checkRecord<T>(value: unknown, key: string): Record<T> | undefined {
  if (value === undefined) return undefined;
  const row = value as Partial<Record<T>> | null;
  if (!row || (row.schema !== 1 && !(row.schema === 2 && key.startsWith(publicDraftPrefix)))
      || typeof row.revision !== 'string' || !row.value || typeof row.value !== 'object')
    throw new Error('Invalid edit draft');
  return row as Record<T>;
}

async function transaction<T>(key: string, update?: (row?: Record<T>) => Record<T> | undefined,
  beforeCommit?: () => boolean, files?: ReadonlyMap<string, File>, readFiles?: Map<string, File>): Promise<Record<T> | undefined> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', update ? 'readwrite' : 'readonly');
      const store = tx.objectStore('drafts');
      const read = store.get(key);
      let result: Record<T> | undefined;
      let failure: unknown;
      read.onsuccess = () => {
        try {
          const current = checkRecord<T>(read.result, key);
          const deadline = draftDeadline(current);
          result = update ? update(current) : current;
          if (update) {
            const previousIds = new Set(current?.fileIds);
            const nextIds = new Set(result?.fileIds);
            for (const id of previousIds) if (!nextIds.has(id)) store.delete(fileKey(key, id));
            for (const [id, file] of files ?? []) if (!previousIds.has(id) && nextIds.has(id)) {
              const attachment: DraftFile = { blob: file, name: file.name, lastModified: file.lastModified };
              store.put(attachment, fileKey(key, id));
            }
            const write = result ? store.put(result, key) : store.delete(key);
            if (beforeCommit) write.onsuccess = () => { if (!beforeCommit()) tx.abort(); };
          } else if (readFiles && (deadline === undefined || deadline > Date.now())) {
            for (const id of current?.fileIds ?? []) {
              const attachment = store.get(fileKey(key, id));
              attachment.onsuccess = () => {
                const file = attachment.result as DraftFile | undefined;
                if (file?.blob instanceof Blob && typeof file.name === 'string') {
                  readFiles.set(id, new File([file.blob], file.name, { type: file.blob.type, lastModified: file.lastModified }));
                }
              };
            }
          }
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure ?? tx.error);
    });
  } finally {
    db.close();
  }
}

class DraftConflict extends Error {}

export type DraftWriteResult = 'saved' | 'conflict' | 'unavailable';

export class EditDraftSlot<T> {
  private revision?: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly key: string) {}

  read(files?: Map<string, File>): Promise<T | undefined> {
    const read = this.queue.then(async () => {
      const record = await transaction<T>(this.key, undefined, undefined, undefined, files);
      this.revision = record?.revision;
      const deadline = draftDeadline(record);
      return deadline !== undefined && deadline <= Date.now() ? undefined : record?.value;
    });
    this.queue = read.catch(() => {});
    return read;
  }

  write(value?: T, expiresAt?: number, beforeCommit?: () => boolean,
    allowCurrent?: (current?: T) => boolean, files?: ReadonlyMap<string, File>): Promise<DraftWriteResult> {
    const next = this.queue.then(async (): Promise<DraftWriteResult> => {
      try {
        const record = await transaction<T>(this.key, current => {
          if (current?.revision !== this.revision) throw new DraftConflict();
          const deadline = draftDeadline(current);
          const active = deadline !== undefined && deadline <= Date.now() ? undefined : current?.value;
          if (allowCurrent && !allowCurrent(active)) throw new DraftConflict();
          if (value === undefined) return undefined;
          const fileIds = files ? [...files.keys()] : current?.fileIds;
          const protectedDraft = this.key.startsWith(publicDraftPrefix) && (current?.schema === 2 || Boolean(fileIds?.length));
          // Older clients only sweep the top-level expiresAt. The new reader removes both the draft and its blobs.
          const version = protectedDraft ? { schema: 2 as const, draftExpiresAt: expiresAt } : { schema: 1 as const, expiresAt };
          return { ...version, revision: randomUUID(), value, fileIds };
        }, beforeCommit, files);
        this.revision = record?.revision;
        return 'saved';
      } catch (error) {
        return error instanceof DraftConflict ? 'conflict' : 'unavailable';
      }
    });
    this.queue = next;
    return next;
  }
}

export async function pruneExpiredDrafts(prefix: string) {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite');
      const store = tx.objectStore('drafts');
      const cursor = store.openCursor(IDBKeyRange.bound(prefix, prefix + '\uffff'));
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (!entry) return;
        const deadline = draftDeadline(entry.value);
        if (typeof deadline === 'number' && deadline <= Date.now()) {
          for (const id of entry.value.fileIds ?? []) store.delete(fileKey(entry.key, id));
          entry.delete();
        }
        entry.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
