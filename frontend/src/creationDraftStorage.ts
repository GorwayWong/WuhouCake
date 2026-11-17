import { randomUUID } from './uuid.ts';

export type SavedCreationDraft<T> = { revision: string; value: T };
export class CreationDraftConflict extends Error {}

let database: Promise<IDBDatabase> | undefined;
function open() {
  if (database) return database;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('wuhou-create-drafts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => {
      const db = request.result;
      if (database !== opening) { db.close(); return; }
      db.onversionchange = () => { db.close(); if (database === opening) database = undefined; };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('草稿存储暂不可用。'));
  });
  database = opening;
  void opening.catch(() => { if (database === opening) database = undefined; });
  return opening;
}

export async function readCreationDraft<T>(key: string): Promise<SavedCreationDraft<T> | null> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction('drafts').objectStore('drafts').get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function write(key: string, expected: string | null, value: SavedCreationDraft<unknown> | null) {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('drafts', 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('草稿保存未完成。'));
    const store = tx.objectStore('drafts');
    const read = store.get(key);
    read.onsuccess = () => {
      if ((read.result?.revision ?? null) !== expected) {
        reject(new CreationDraftConflict());
        tx.abort();
        return;
      }
      try {
        if (value) store.put(value, key);
        else store.delete(key);
      } catch (failure) { reject(failure); tx.abort(); }
    };
  });
}

export async function saveCreationDraft<T>(key: string, expected: string | null, value: T) {
  const revision = randomUUID();
  await write(key, expected, { revision, value });
}

export async function removeCreationDraft(key: string, revision: string) {
  try { await write(key, revision, null); }
  catch (failure) { if (!(failure instanceof CreationDraftConflict)) throw failure; }
}
