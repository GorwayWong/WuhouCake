import { useCallback, useRef, useState } from 'react';
import { DraftConflict, OrderDraftSlot, decodeOrderDraft, freshOrderDraft, hasDraftContent } from './orderDraftStorage';
import type { DraftEditor, OrderDraftRecord } from './orderDraftStorage';
import type { OrderDraft } from './orderForm';
import type { CreateOrderRequest } from './types';
import { localImageError, removeDraftImage, removeDraftImages, restoreWorkingDraftImages, snapshotDraftImages, persistDraftImages } from './draftImages';
import type { StoredImage } from './draftImages';
import { CreationDraftConflict, readCreationDraft, removeCreationDraft, saveCreationDraft } from './creationDraftStorage';
import type { SavedCreationDraft } from './creationDraftStorage';
import { randomUUID } from './uuid';

type SavedOrder = SavedCreationDraft<{ record: OrderDraftRecord; images: StoredImage[] }>;
export interface DraftCandidate { record: OrderDraftRecord | null; invalid: boolean }
const key = (accountId: string) => `order:${accountId}`;
const content = (record: OrderDraftRecord) => JSON.stringify([record.value, record.editor.text]);
const conflictMessage = '其他标签页已更新草稿。再次保存将使用当前内容。';
const storageMessage = '草稿保存失败。请保留当前页面，检查浏览器存储空间后重试。';

function serializeSubmission<T>(accountId: string, operation: () => T) {
  return navigator.locks ? navigator.locks.request(`wuhou:order-submit:${accountId}`, operation) : Promise.resolve().then(operation);
}

export function useOrderDraft() {
  const [cleanupFailed, setCleanupFailed] = useState(false);
  const [draft, setDraft] = useState<OrderDraftRecord | null>(null);
  const draftRef = useRef<OrderDraftRecord | null>(null);
  const [candidate, setCandidate] = useState<DraftCandidate | null>(null);
  const [saved, setSaved] = useState<SavedOrder | null>(null);
  const [error, setError] = useState('');
  const [restored, setRestored] = useState(false);
  const [busy, setBusy] = useState(false);
  const slot = useRef<OrderDraftSlot | null>(null);
  const entered = useRef(false);
  const generation = useRef(0);
  const active = useRef(false);
  const date = useRef('');
  const keyRevision = useRef<string | null>(null);
  const baseline = useRef('');
  const accountId = useRef('');
  const setLocal = useCallback((record: OrderDraftRecord | null) => { draftRef.current = record; setDraft(record); }, []);
  const deleteWorkingImages = useCallback((record: OrderDraftRecord) => {
    if (record.imageStorageUsed || record.value.items.some(item => item.images?.length)) {
      void removeDraftImages(record).catch(() => {
        if (accountId.current === record.accountId) setCleanupFailed(true);
      });
    }
  }, []);
  const leave = useCallback(() => {
    generation.current++;
    entered.current = false;
    setSaved(null); setCandidate(null); setRestored(false);
    const current = draftRef.current;
    setLocal(null);
    if (current && !current.pending && !current.createdOrderId) deleteWorkingImages(current);
  }, [setLocal, deleteWorkingImages]);
  const suspend = useCallback(() => { entered.current = false; generation.current++; setSaved(null); setCandidate(null); }, []);
  const start = useCallback(() => {
    const value = freshOrderDraft(accountId.current, date.current);
    baseline.current = content(value);
    setSaved(null); setCandidate(null); setRestored(false); setLocal(value);
  }, [setLocal]);

  const open = useCallback((id: string, canEnter: boolean, selectedDate?: string) => {
    if (accountId.current !== id || canEnter !== Boolean(slot.current)) {
      leave();
      accountId.current = id; slot.current = canEnter ? new OrderDraftSlot(id) : null;
      setError(''); setCleanupFailed(false);
    }
    if (!canEnter || selectedDate === undefined || entered.current) return;
    entered.current = true; date.current = selectedDate;
    const run = ++generation.current;
    if (draftRef.current) return; // 同账号登录恢复时保留当前页的输入。
    const pendingSlot = slot.current!;
    let legacy: DraftCandidate | undefined;
    try {
      legacy = pendingSlot.read();
      if (legacy.invalid) { setCandidate(legacy); return; }
      if (legacy.record?.pending || legacy.record?.createdOrderId) {
        setLocal(legacy.record); setRestored(true); return;
      }
    } catch {
      setError('本机提交恢复记录无法读取，提交前请检查浏览器存储权限。');
    }
    void (async () => {
      try {
        let found = await readCreationDraft<SavedOrder['value']>(key(id));
        if (generation.current !== run) return;
        const record = legacy?.record;
        if (record && hasDraftContent(record) && !found) {
          // 旧版本的本机自动草稿迁移到同账号的新建槽。
          const images = await snapshotDraftImages(record);
          if (generation.current !== run) return;
          try { await saveCreationDraft(key(id), null, { record, images }); }
          catch (failure) { if (!(failure instanceof CreationDraftConflict)) throw failure; }
          found = await readCreationDraft<SavedOrder['value']>(key(id));
          if (found?.value.record.requestId === record.requestId) {
            try { await serializeSubmission(id, () => pendingSlot.remove()); deleteWorkingImages(record); }
            catch { /* 新草稿已经保存，旧记录留待下次核对。 */ }
          }
        }
        if (generation.current !== run) return;
        keyRevision.current = found?.revision ?? null;
        if (found) setSaved(found);
        else start();
      } catch {
        if (generation.current !== run) return;
        if (legacy?.record) setCandidate(legacy);
        else start();
        setError('本机草稿无法读取，请检查浏览器存储权限。');
      }
    })();
  }, [leave, start, setLocal, deleteWorkingImages]);

  const accept = useCallback(() => {
    if (active.current || !saved) return;
    const { record, images } = saved.value || {};
    const validated = decodeOrderDraft(JSON.stringify(record), accountId.current);
    if (!validated || !Array.isArray(images)) { setError('草稿内容无法读取，可重新填写。'); return; }
    const copy = { ...validated, requestId: randomUUID(), idempotencyKey: validated.idempotencyKey || validated.requestId, savedRevision: saved.revision };
    restoreWorkingDraftImages(copy, images);
    baseline.current = content(copy);
    setLocal(copy); setSaved(null); setRestored(true); setError('');
  }, [saved, setLocal]);
  const acceptLegacy = useCallback(() => {
    const record = candidate?.record;
    if (!record) return;
    // 旧图片缺失时仍可恢复原表单，移除缺失图片后手动保存。
    setLocal(record); setCandidate(null); setRestored(true);
  }, [candidate, setLocal]);

  const needsSave = useCallback(() => {
    const record = draftRef.current;
    return Boolean(record && !record.pending && !record.createdOrderId && content(record) !== baseline.current);
  }, []);
  const save = useCallback(async () => {
    const current = draftRef.current;
    if (active.current || !current || current.pending || current.createdOrderId) return false;
    const run = generation.current, revision = keyRevision.current;
    active.current = true; setBusy(true); setError('');
    try {
      const images = await snapshotDraftImages(current);
      if (run !== generation.current) return false;
      const record = { ...current, revision: randomUUID(), updatedAt: new Date().toISOString(), idempotencyKey: randomUUID(), savedRevision: undefined,
        editor: { ...current.editor, scrollY: window.scrollY } };
      await saveCreationDraft(key(current.accountId), revision, { record, images });
      return run === generation.current;
    } catch (failure) {
      if (run !== generation.current) return false;
      if (failure instanceof CreationDraftConflict) {
        try {
          const latest = await readCreationDraft(key(current.accountId));
          if (run !== generation.current) return false;
          keyRevision.current = latest?.revision ?? null;
          setError(conflictMessage);
          return false;
        } catch { /* 输入仍保留在页面。 */ }
      }
      setError(failure instanceof DOMException ? storageMessage : localImageError(failure));
      return false;
    } finally { active.current = false; setBusy(false); }
  }, []);

  const change = useCallback((value: OrderDraft, editor?: Partial<DraftEditor>, retainRemovedImages = false) => {
    const before = draftRef.current;
    if (!before || active.current || before.pending || before.createdOrderId) return false;
    setLocal({ ...before, value, imageStorageUsed: before.imageStorageUsed || value.items.some(item => item.images?.length), editor: { ...before.editor, ...editor } });
    if (!retainRemovedImages) for (const item of before.value.items) for (const image of item.images ?? []) {
      if (!value.items.some(next => next.key === item.key && next.images?.some(nextImage => nextImage.id === image.id))) {
        void removeDraftImage(before, item.key, image.id).catch(() => {});
      }
    }
    return true;
  }, [setLocal]);
  const changeEditor = useCallback((editor: Partial<DraftEditor>) => {
    if (draftRef.current) change(draftRef.current.value, editor);
  }, [change]);

  const persist = useCallback(async (record: OrderDraftRecord) => {
    const storage = slot.current;
    try {
      if (!storage || storage.accountId !== record.accountId) return false;
      const next = await serializeSubmission(record.accountId, () => {
        const previous = storage.read();
        if (previous.invalid || (previous.record?.pending || previous.record?.createdOrderId) && previous.record.requestId !== record.requestId) throw new DraftConflict();
        return storage.write(record);
      });
      if (storage !== slot.current) return false;
      setLocal(next); setError('');
      return true;
    } catch (failure) {
      setError(failure instanceof DraftConflict ? '此账号另有订单结果待确认，请回到原标签页核对。' : '本机提交记录保存失败，请检查浏览器存储后重试。');
      return false;
    }
  }, [setLocal]);
  const prepare = useCallback(async (request: CreateOrderRequest) => {
    const current = draftRef.current;
    if (!current) return false;
    if (!current.pending && !current.createdOrderId) {
      try { await persistDraftImages(current); }
      catch (failure) { setError(localImageError(failure)); return false; }
      if (draftRef.current !== current) return false;
    }
    return persist({ ...current, pending: current.pending ?? request });
  }, [persist]);
  const created = useCallback(async (orderId: string) => {
    const current = draftRef.current;
    return current ? persist({ ...current, createdOrderId: orderId }) : false;
  }, [persist]);
  const removePending = useCallback(async (current: OrderDraftRecord | null, discard = false) => {
    const storage = slot.current;
    if (!storage) return false;
    try {
      await serializeSubmission(storage.accountId, () => {
        const stored = storage.read();
        if (stored.invalid && !(discard && !current) || stored.record &&
          (current?.requestId !== stored.record.requestId || discard && current.revision !== stored.record.revision)) throw new DraftConflict();
        storage.remove();
      });
      return true;
    } catch { setError('本机提交记录未能清理，请核对原订单后重试。'); return false; }
  }, []);
  const rejected = useCallback(async () => {
    const current = draftRef.current;
    if (current && await removePending(current) && draftRef.current === current) setLocal({ ...current, pending: undefined });
  }, [setLocal, removePending]);
  const clear = useCallback(async () => {
    const current = draftRef.current;
    if (!current) return false;
    try {
      if (current.savedRevision) await removeCreationDraft(key(current.accountId), current.savedRevision);
    } catch { setError('订单已创建，本机草稿清理失败，请重试确认。'); return false; }
    if (!await removePending(current)) return false;
    if (draftRef.current === current) setLocal(null);
    deleteWorkingImages(current);
    return true;
  }, [setLocal, deleteWorkingImages, removePending]);
  const discard = useCallback(async () => {
    const current = draftRef.current || candidate?.record || null;
    const owner = slot.current;
    if (!await removePending(current, true) || slot.current !== owner) return false;
    if (current) deleteWorkingImages(current);
    setLocal(null);
    entered.current = false;
    open(accountId.current, true, date.current);
    return true;
  }, [candidate, deleteWorkingImages, removePending, open, setLocal]);

  return { restored, draft, draftRef, candidate, saved, error, cleanupFailed, busy, open, leave, suspend, start, accept, acceptLegacy,
    save, needsSave, change, changeEditor, prepare, created, clear, rejected, discard, hasSaved: keyRevision.current !== null };
}
