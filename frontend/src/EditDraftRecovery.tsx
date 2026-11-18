import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { EditDraftSlot } from './editDraftStorage';
import type { DraftWriteResult } from './editDraftStorage';
export { editDraftKey, listLockedDraftKeys } from './editDraftStorage';
export type { DraftAccess } from './editDraftStorage';

export interface EditDraftWriter<T> {
  save(value: T): Promise<DraftWriteResult>;
  clear(): Promise<boolean>;
  reload(): Promise<void>;
}

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
  const [slot] = useState(() => new EditDraftSlot<T>(scope));
  // A status refresh must keep the mounted editor's inputs and storage revision paired.
  const [restoreOnOpen] = useState(openStored);
  const latestWrite = useRef(0);
  useEffect(() => {
    let active = true;
    void slot.read().then(value => {
      if (!active) return;
      if (restoreOnOpen) setRestored(value);
      else setCandidate(value);
    }).catch(() => { if (active) setStatus('error'); }).finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [restoreOnOpen, slot]);

  async function write(value?: T): Promise<DraftWriteResult> {
    const writeId = ++latestWrite.current;
    setStatus('saving');
    const result = await slot.write(value);
    if (writeId === latestWrite.current) setStatus(result === 'conflict' ? 'conflict'
      : result === 'unavailable' ? 'error' : value === undefined ? 'idle' : 'saved');
    return result;
  }

  async function reload() {
    try {
      const value = await slot.read();
      if (value) setCandidate(value);
      setStatus(value ? 'saved' : 'idle');
    } catch { setStatus('error'); }
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
        if (await write() === 'saved') setCandidate(undefined);
        setDiscarding(false);
      }}>放弃草稿</button>
      <button type="button" className="text-button" disabled={discarding} onClick={onClose}>稍后处理</button>
    </div> : children(restored, { save: value => write(value), clear: async () => await write() === 'saved', reload })}
  </>;
}
