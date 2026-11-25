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

export async function updateCreationDraft<T>(key: string, update: (current: SavedCreationDraft<T> | null) => SavedCreationDraft<T> | null) {
  const db = await open();
  return new Promise<SavedCreationDraft<T> | null>((resolve, reject) => {
    const tx = db.transaction('drafts', 'readwrite');
    let result: SavedCreationDraft<T> | null = null;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error ?? new Error('草稿保存未完成。'));
    const store = tx.objectStore('drafts');
    const read = store.get(key);
    read.onsuccess = () => {
      try {
        const current = read.result ?? null;
        result = update(current);
        if (result === current) return;
        if (result) store.put(result, key);
        else store.delete(key);
      } catch (failure) { reject(failure); tx.abort(); }
    };
  });
}

async function write<T>(key: string, expected: string | null, value: SavedCreationDraft<T> | null) {
  await updateCreationDraft<T>(key, current => {
    if ((current?.revision ?? null) !== expected) throw new CreationDraftConflict();
    return value;
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
