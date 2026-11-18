import type { OrderPackage, PackageBody, PackageRow } from './orderPackages.ts';
import { randomUUID } from './uuid.ts';

export type PendingPackage = { method: 'POST' | 'PUT' | 'DELETE'; path: string; body?: PackageBody; key: string; target?: OrderPackage; draftRevision?: string; files?: { id: string; file: File }[] };
export interface PackageDraftRecord {
  accountId: string; tabId: string; editing: OrderPackage | 'new' | null;
  name: string; items: PackageRow[]; original: string; member: string;
  baseline: string; creationKey: string; pending: PendingPackage | null;
  revision?: string;
  resumedUpload?: boolean;
  sourceRevision?: string;
}
type StoredFile = { blob: Blob; name: string; lastModified: number };
type StoredDraft = Omit<PackageDraftRecord, 'items' | 'pending'> & {
  version: 1; items: (Omit<PackageRow, 'file'> & { file?: StoredFile })[];
  pending: (Omit<PendingPackage, 'files'> & { files?: { id: string; file: StoredFile }[] }) | null;
};
let database: Promise<IDBDatabase> | undefined;
export class PackageDraftConflict extends Error {
  readonly tabId: string;

  constructor(tabId: string) {
    super('套餐暂存已在其他标签页更新，请保留当前输入并回到原标签页处理。');
    this.tabId = tabId;
  }
}
export const packageCreationSlot = 'new-package';
export const packageDraftStorageMessage = (error: unknown, fallback: string) => error instanceof PackageDraftConflict ? error.message : fallback;
function open() {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('wuhou-package-drafts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: ['accountId', 'tabId'] });
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); database = undefined; };
      resolve(request.result);
    };
    request.onerror = () => { database = undefined; reject(request.error); };
    request.onblocked = () => { database = undefined; reject(new Error('请关闭其他套餐页面后重试本机存储。')); };
  });
  return database;
}
export function packageDraftTab() {
  const key = 'wuhou-package-draft-tab';
  let value = sessionStorage.getItem(key);
  if (!value) { value = randomUUID(); sessionStorage.setItem(key, value); }
  return value;
}
const storeFile = (file: File): StoredFile => ({ blob: file, name: file.name, lastModified: file.lastModified });
const restoreFile = (file: StoredFile): File => {
  if (!(file.blob instanceof Blob) || typeof file.name !== 'string' || !Number.isFinite(file.lastModified)) throw new Error('套餐图片暂存内容无效，请保留当前页面并重试。');
  return new File([file.blob], file.name, { type: file.blob.type, lastModified: file.lastModified });
};
export function encodePackageDraft(record: PackageDraftRecord): StoredDraft {
  return { ...record, version: 1, items: record.items.map(row => ({ ...row, file: row.file ? storeFile(row.file) : undefined })),
    pending: record.pending ? { ...record.pending, files: record.pending.files?.map(row => ({ ...row, file: storeFile(row.file) })) } : null };
}
export function decodePackageDraft(value: unknown, accountId: string, tabId: string): PackageDraftRecord | null {
  if (value == null) return null;
  const row = value as StoredDraft;
  if (row.version !== 1 || row.accountId !== accountId || row.tabId !== tabId || !Array.isArray(row.items)
      || row.revision !== undefined && typeof row.revision !== 'string'
      || row.resumedUpload !== undefined && typeof row.resumedUpload !== 'boolean'
      || row.sourceRevision !== undefined && typeof row.sourceRevision !== 'string'
      || ![row.name, row.original, row.member, row.baseline, row.creationKey].every(item => typeof item === 'string')
      || row.editing !== null && row.editing !== 'new' && (typeof row.editing !== 'object' || typeof row.editing.id !== 'string')
      || row.items.some(item => !item || ![item.itemId, item.name, item.specification, item.quantity, item.unitPrice, item.memberPrice].every(value => typeof value === 'string')))
    throw new Error('套餐暂存内容无法读取，请保留当前页面并重试。');
  if (row.pending && (!['POST', 'PUT', 'DELETE'].includes(row.pending.method) || typeof row.pending.key !== 'string'
      || !/^\/order-packages(?:\/[a-f\d-]+(?:\?expectedVersion=\d+)?)?$/.test(row.pending.path)))
    throw new Error('待核对的套餐记录无效，请保留当前页面并重试。');
  return { ...row, items: row.items.map(item => ({ ...item, file: item.file ? restoreFile(item.file) : undefined })),
    pending: row.pending ? { ...row.pending, files: row.pending.files?.map(item => ({ ...item, file: restoreFile(item.file) })) } : null };
}
type DraftVersion = { tabId: string; revision: string | null };

async function write(accountId: string, changes: (DraftVersion & { value: StoredDraft | null })[]) {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('drafts', 'readwrite');
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('套餐暂存未完成。'));
    try {
      const store = tx.objectStore('drafts');
      for (const { tabId, revision, value } of changes) {
        const key = [accountId, tabId];
        const request = store.get(key);
        request.onsuccess = () => {
          if ((request.result?.revision ?? null) !== revision) { tx.abort(); reject(new PackageDraftConflict(tabId)); return; }
          try { if (value) store.put(value); else store.delete(key); }
          catch (error) { tx.abort(); reject(error); }
        };
      }
    } catch (error) { tx.abort(); reject(error); }
  });
}
export async function readPackageDraft(accountId: string, tabId: string) {
  const db = await open();
  return new Promise<PackageDraftRecord | null>((resolve, reject) => {
    const request = db.transaction('drafts', 'readonly').objectStore('drafts').get([accountId, tabId]);
    request.onsuccess = () => { try { resolve(decodePackageDraft(request.result, accountId, tabId)); } catch (failure) { reject(failure); } };
    request.onerror = () => reject(request.error);
  });
}
export async function savePackageDraft(record: PackageDraftRecord, expectedRevision: string | null, previous?: DraftVersion) {
  const revision = randomUUID(), value = encodePackageDraft({ ...record, revision });
  const changes: (DraftVersion & { value: StoredDraft | null })[] = [{ tabId: record.tabId, revision: expectedRevision, value }];
  if (previous) changes.push({ ...previous, value: null });
  await write(record.accountId, changes); return revision;
}
export async function removePackageDraft(accountId: string, tabId: string, expectedRevision: string | null) {
  await write(accountId, [{ tabId, revision: expectedRevision, value: null }]);
}
