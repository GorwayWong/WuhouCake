import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { randomUUID } from './uuid';

interface Record<T> {
  schema: 1;
  revision: string;
  value: T;
}

export interface EditDraftWriter<T> {
  save(value: T): Promise<boolean>;
  clear(): Promise<boolean>;
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
    request.onsuccess = () => resolve(request.result);
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
        if ((kind !== 'amount' && kind !== 'item') || (itemId !== null && typeof itemId !== 'string')) return [];
        if (key !== editDraftKey(accountId, orderId, kind, itemId ?? undefined, access)) return [];
        return [{ key, kind: kind as 'amount' | 'item', itemId: itemId as string | null }];
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

async function transaction<T>(key: string, update?: (row?: Record<T>) => Record<T> | undefined): Promise<Record<T> | undefined> {
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
            if (result) store.put(result, key);
            else store.delete(key);
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

export function EditDraftRecovery<T>({ scope, children, onClose, openStored = false }: {
  scope: string;
  children: (restored: T | undefined, writer: EditDraftWriter<T>) => ReactNode;
  onClose: () => void;
  openStored?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const [candidate, setCandidate] = useState<T>();
  const [restored, setRestored] = useState<T>();
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error' | 'conflict'>('idle');
  const [discarding, setDiscarding] = useState(false);
  const revision = useRef<string | undefined>(undefined);
  const latestWrite = useRef(0);
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));
  useEffect(() => {
    let active = true;
    void transaction<T>(scope).then(row => {
      if (!active) return;
      revision.current = row?.revision;
      if (openStored) setRestored(row?.value);
      else setCandidate(row?.value);
    }).catch(() => { if (active) setStatus('error'); }).finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [openStored, scope]);

  function write(value?: T) {
    const writeId = ++latestWrite.current;
    setStatus('saving');
    const operation = queue.current.then(async () => {
      try {
        const row = await transaction<T>(scope, current => {
          if (current?.revision !== revision.current) throw new DraftConflict();
          return value === undefined ? undefined : { schema: 1, revision: randomUUID(), value };
        });
        revision.current = row?.revision;
        if (writeId === latestWrite.current) setStatus(row ? 'saved' : 'idle');
        return true;
      } catch (error) {
        if (writeId === latestWrite.current) setStatus(error instanceof DraftConflict ? 'conflict' : 'error');
        return false;
      }
    });
    queue.current = operation;
    return operation;
  }

  if (!loaded) return <p role="status">正在读取本机草稿…</p>;
  const notice = status === 'conflict' ? '另一个标签页已更新草稿。当前输入仍在本页，本页无法覆盖其草稿。'
    : status === 'error' ? '无法读写本机草稿，请保留当前页面。'
    : status === 'saving' ? '正在保存本机草稿…'
    : status === 'saved' ? '草稿已保存在本机。' : '';
  return <>
    {notice && <p className="form-help" role="status">{notice}</p>}
    {candidate ? <div className="notice" role="status">
      <p>此处有未完成的编辑草稿。</p>
      <button type="button" className="secondary" disabled={discarding} onClick={() => { setRestored(candidate); setCandidate(undefined); }}>恢复草稿</button>
      <button type="button" className="secondary" disabled={discarding} onClick={async () => {
        if (!window.confirm('放弃本机草稿？如果上次保存结果未确认，请先核对订单。')) return;
        setDiscarding(true);
        if (await write()) setCandidate(undefined);
        setDiscarding(false);
      }}>放弃草稿</button>
      <button type="button" className="text-button" disabled={discarding} onClick={onClose}>稍后处理</button>
    </div> : children(restored, { save: value => write(value), clear: () => write() })}
  </>;
}
