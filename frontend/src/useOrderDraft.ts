import { useCallback, useEffect, useRef, useState } from 'react';
import { DraftConflict, OrderDraftSlot, draftStorageKey, freshOrderDraft, hasDraftContent } from './orderDraftStorage';
import type { DraftEditor, OrderDraftRecord } from './orderDraftStorage';
import type { OrderDraft } from './orderForm';
import type { CreateOrderRequest } from './types';
import { removeDraftImage, removeDraftImages } from './draftImages';

type SaveStatus = 'idle' | 'saved' | 'error' | 'conflict';
export interface DraftCandidate { record: OrderDraftRecord | null; invalid: boolean }
export function useOrderDraft() {
  const [draft, setDraft] = useState<OrderDraftRecord | null>(null);
  const draftRef = useRef(draft);
  const [candidate, setCandidate] = useState<DraftCandidate | null>(null);
  const candidateRef = useRef(candidate);
  const [cleanupWarning, setCleanupWarning] = useState('');
  const [status, setStatus] = useState<SaveStatus>('idle');
  const statusRef = useRef<SaveStatus>('idle');
  const slot = useRef<OrderDraftSlot | null>(null);
  const entered = useRef(false);
  const date = useRef('');
  const accountId = useRef('');
  const setLocal = useCallback((record: OrderDraftRecord | null) => { draftRef.current = record; setDraft(record); }, []);
  const showCandidate = useCallback((value: DraftCandidate | null) => { candidateRef.current = value; setCandidate(value); }, []);
  const saveStatus = useCallback((value: SaveStatus) => { statusRef.current = value; setStatus(value); }, []);
  const failed = useCallback((error: unknown) => { saveStatus(error instanceof DraftConflict ? 'conflict' : 'error'); }, [saveStatus]);
  const persist = useCallback((record: OrderDraftRecord): boolean => {
    if (statusRef.current === 'conflict' || !slot.current) return false;
    try {
      if (hasDraftContent(record)) { setLocal(slot.current.write(record)); saveStatus('saved'); }
      else { slot.current.remove(); setLocal({ ...record, updatedAt: '', revision: '' }); saveStatus('idle'); }
      return true;
    } catch (error) { setLocal(record); failed(error); return false; }
  }, [setLocal, saveStatus, failed]);
  const open = useCallback((id: string, canEnter: boolean, selectedDate?: string) => {
    if (accountId.current !== id || canEnter !== Boolean(slot.current)) {
      accountId.current = id; slot.current = canEnter ? new OrderDraftSlot(id) : null;
      setCleanupWarning('');
      entered.current = false; setLocal(null); showCandidate(null); saveStatus('idle');
    }
    if (!canEnter || selectedDate === undefined || entered.current) return;
    entered.current = true; date.current = selectedDate;
    if (statusRef.current === 'conflict') return;
    try {
      // An unsaved in-memory snapshot remains useful after session expiry or a storage failure.
      const memory = draftRef.current;
      if (memory) slot.current!.check();
      const stored = slot.current!.read();
      if (stored.invalid) { showCandidate(stored); setLocal(null); return; }
      const record = hasDraftContent(memory) ? memory : stored.record;
      if (record && hasDraftContent(record)) {
        showCandidate({ record, invalid: false }); setLocal(null);
        if (statusRef.current !== 'error') saveStatus('saved');
        return;
      }
      setLocal(freshOrderDraft(id, selectedDate)); saveStatus('idle');
    } catch (error) {
      if (hasDraftContent(draftRef.current)) { showCandidate({ record: draftRef.current, invalid: false }); setLocal(null); }
      else setLocal(freshOrderDraft(id, selectedDate));
      failed(error);
    }
  }, [setLocal, showCandidate, saveStatus, failed]);
  const accept = useCallback(() => {
    const record = candidateRef.current?.record;
    if (!record || record.accountId !== slot.current?.accountId) return;
    setLocal(record); showCandidate(null);
    if (statusRef.current !== 'error' && statusRef.current !== 'conflict') saveStatus(record.updatedAt ? 'saved' : 'idle');
  }, [setLocal, showCandidate, saveStatus]);
  const clear = useCallback(() => {
    if (statusRef.current === 'conflict') return false;
    try {
      const current = draftRef.current || candidateRef.current?.record;
      slot.current?.remove(); setLocal(null); showCandidate(null); saveStatus('idle');
      const owner = slot.current;
      if (current && (current.imageStorageUsed || current.value.items.some(item => item.images?.length))) void removeDraftImages(current).catch(() => {
        if (slot.current === owner) setCleanupWarning('旧草稿的本机图片未能清理，可能仍占用存储空间；不会影响新草稿保存。');
      });
      return true;
    }
    catch (error) { if (error instanceof DraftConflict) failed(error); return false; }
  }, [setLocal, showCandidate, saveStatus, failed]);
  const discard = useCallback(() => {
    if (!clear()) return false;
    setLocal(freshOrderDraft(accountId.current, date.current)); return true;
  }, [clear, setLocal]);
  const close = useCallback(() => {
    // Keep the last snapshot in memory as well when browser storage is unavailable.
    if (candidateRef.current?.record) setLocal(candidateRef.current.record);
    showCandidate(null); entered.current = false;
  }, [showCandidate, setLocal]);
  const leave = useCallback(() => { entered.current = false; }, []);
  const change = useCallback((value: OrderDraft, editor?: Partial<DraftEditor>, retainRemovedImages = false) => {
    const before = draftRef.current;
    if (!before) return false;
    const saved = persist({ ...before, value, imageStorageUsed: before.imageStorageUsed || value.items.some(item => item.images?.length), editor: { ...before.editor, ...editor } });
    if (saved && !retainRemovedImages) for (const item of before.value.items) for (const image of item.images || []) {
      if (!value.items.some(next => next.key === item.key && next.images?.some(candidate => candidate.id === image.id)))
        void removeDraftImage(before, item.key, image.id).catch(error => { if (accountId.current === before.accountId) failed(error); });
    }
    return saved;
  }, [persist, failed]);
  const created = useCallback((orderId: string) => {
    if (!draftRef.current) return false;
    return persist({ ...draftRef.current, createdOrderId: orderId });
  }, [persist]);
  const changeEditor = useCallback((editor: Partial<DraftEditor>) => {
    if (draftRef.current) change(draftRef.current.value, editor);
  }, [change]);
  const prepare = useCallback((request: CreateOrderRequest) => {
    const record = draftRef.current;
    if (!record) return false;
    const saved = persist({ ...record, pending: record.pending || request });
    if (!saved) setLocal(record);
    return saved;
  }, [persist, setLocal]);
  const rejected = useCallback(() => {
    if (draftRef.current) persist({ ...draftRef.current, pending: undefined });
  }, [persist]);
  const retry = useCallback(() => { if (draftRef.current) persist(draftRef.current); }, [persist]);
  const retained = useCallback((): DraftCandidate | null => {
    if (candidateRef.current) return candidateRef.current;
    if (hasDraftContent(draftRef.current)) return { record: draftRef.current, invalid: false };
    if (!slot.current) return null;
    try { return slot.current.read(); }
    catch (error) { failed(error); return { record: null, invalid: true }; }
  }, [failed]);
  const restore = useCallback((record: OrderDraftRecord) => { persist(record); }, [persist]);
  useEffect(() => {
    const flush = () => {
      if (entered.current && !candidateRef.current && draftRef.current) {
        const record = draftRef.current;
        persist({ ...record, editor: { ...record.editor, scrollY: window.scrollY } });
      }
    };
    const hidden = () => { if (document.visibilityState === 'hidden') flush(); };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scroll = () => { if (timer === undefined) timer = setTimeout(() => { timer = undefined; flush(); }, 250); };
    const storage = (event: StorageEvent) => {
      if (slot.current && (event.key === null || event.key === draftStorageKey(slot.current.accountId))) {
        try { slot.current.check(); } catch (error) { failed(error); }
      }
    };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', flush);
    window.addEventListener('scroll', scroll, { passive: true });
    window.addEventListener('storage', storage);
    return () => {
      clearTimeout(timer); document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', flush); window.removeEventListener('scroll', scroll); window.removeEventListener('storage', storage);
    };
  }, [persist, failed]);
  return { draft, draftRef, candidate, status, cleanupWarning, open, accept, discard, clear, close, leave, change, changeEditor, prepare, created, rejected, retry, retained, restore };
}
