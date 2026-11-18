import { randomUUID } from './uuid';

interface Record<T> {
  schema: 1;
  revision: string;
  value: T;
  expiresAt?: number;
}

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

function checkRecord<T>(value: unknown): Record<T> | undefined {
  if (value === undefined) return undefined;
  const row = value as Partial<Record<T>> | null;
  if (!row || row.schema !== 1 || typeof row.revision !== 'string' || !row.value || typeof row.value !== 'object')
    throw new Error('Invalid edit draft');
  return row as Record<T>;
}

async function transaction<T>(key: string, update?: (row?: Record<T>) => Record<T> | undefined, beforeCommit?: () => boolean): Promise<Record<T> | undefined> {
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
          const current = checkRecord<T>(read.result);
          result = update ? update(current) : current;
          if (update) {
            const write = result ? store.put(result, key) : store.delete(key);
            if (beforeCommit) write.onsuccess = () => { if (!beforeCommit()) tx.abort(); };
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

  read(): Promise<T | undefined> {
    const read = this.queue.then(async () => {
      const record = await transaction<T>(this.key);
      this.revision = record?.revision;
      return record?.expiresAt !== undefined && record.expiresAt <= Date.now() ? undefined : record?.value;
    });
    this.queue = read.catch(() => {});
    return read;
  }

  write(value?: T, expiresAt?: number, beforeCommit?: () => boolean): Promise<DraftWriteResult> {
    const next = this.queue.then(async (): Promise<DraftWriteResult> => {
      try {
        const record = await transaction<T>(this.key, current => {
          if (current?.revision !== this.revision) throw new DraftConflict();
          return value === undefined ? undefined : { schema: 1, revision: randomUUID(), value, expiresAt };
        }, beforeCommit);
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
      const cursor = tx.objectStore('drafts').openCursor(IDBKeyRange.bound(prefix, prefix + '\uffff'));
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (!entry) return;
        if (typeof entry.value?.expiresAt === 'number' && entry.value.expiresAt <= Date.now()) entry.delete();
        entry.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
