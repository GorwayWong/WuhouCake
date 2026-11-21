import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle } from '@phosphor-icons/react';
import { ApiError, readPublicOrderEntry, submitPublicOrder } from './api';
import { ErrorNotice, Loading } from './ui';
import { SubmissionFields } from './SubmissionFields';
import { useSubmissionImagePending } from './SubmissionItemImages';
import { draftFromSubmissionContent, newSubmissionDraft, submissionRequest, submissionDirty } from './customerSubmission';
import { clearPendingSubmission, readPendingSubmission, storePendingSubmission } from './publicSubmissionStorage';
import { focusFormField } from './formFocus';
import { firstProductFormError } from './productFormLayout';
import { randomUUID } from './uuid.ts';
import { EditDraftSlot, pruneExpiredDrafts } from './editDraftStorage';
import type { DraftWriteResult } from './editDraftStorage';
import type { PendingSubmission } from './publicSubmissionStorage';
import type { SubmissionDraft } from './customerSubmission';

const publicDraftPrefix = 'public-submission:';
const draftLifetime = 24 * 60 * 60 * 1000;
type SavedPublicDraft = { value: SubmissionDraft; expiresAt?: number; pending?: PendingSubmission };

function submissionRejected(error: unknown) {
  return error instanceof ApiError && (
    (error.status === 400 && error.code === 'VALIDATION_FAILED')
    || (error.status === 404 && ['ENTRY_UNAVAILABLE', 'IMAGE_NOT_FOUND'].includes(error.code))
    || (error.status === 409 && ['ORDER_IMAGE_LIMIT_EXCEEDED', 'ORDER_IMAGE_COUNT_EXCEEDED', 'ORDER_IMAGE_STORAGE_EXCEEDED'].includes(error.code))
    || (error.status === 413 && error.code === 'SUBMISSION_TOO_LARGE')
    || (error.status === 429 && error.code === 'SUBMISSION_THROTTLED')
  );
}

export function PublicOrderEntry({ token, onLeaveGuard }: { token: string; onLeaveGuard: (guard: (() => boolean) | null) => void }) {
  const client = useQueryClient();
  const entryKey = ['public-entry', token];
  const [pending, setPending] = useState(() => readPendingSubmission(token));
  const [draft, setDraft] = useState(() => pending ? draftFromSubmissionContent(pending.content) : newSubmissionDraft());
  const initial = useRef(draft);
  const { pending: imagesPending, markPending } = useSubmissionImagePending();
  const slot = useRef<EditDraftSlot<SavedPublicDraft> | undefined>(undefined);
  const hasDurableDraft = useRef(false);
  const legacyOnly = useRef(Boolean(pending));
  const sessionKey = useRef(pending?.key);
  const recoveredSession = useRef<PendingSubmission | null>(null);
  const rejectedSessionKey = useRef<string | undefined>(undefined);
  const latestWrite = useRef(0);
  const [loaded, setLoaded] = useState(false);
  const [candidate, setCandidate] = useState<SavedPublicDraft>();
  const [storage, setStorage] = useState<DraftWriteResult | 'saving' | 'idle'>('idle');
  const [errors, setErrors] = useState<Record<string, string>>({}); const [error, setError] = useState<unknown>(null);
  const entry = useQuery({ queryKey: entryKey, networkMode: 'always', refetchOnReconnect: true, retry: false, queryFn: async ({ signal }) => {
    const value = await readPublicOrderEntry(token, signal);
    if (!signal.aborted) setError((current: unknown) => current instanceof ApiError && current.code === 'ENTRY_UNAVAILABLE' ? null : current);
    return value;
  } });
  const [receipt, setReceipt] = useState<{ submissionNo: string } | null>(null); const [busy, setBusy] = useState(false);
  const [stored, setStored] = useState(Boolean(pending));
  const [tabOnly, setTabOnly] = useState(Boolean(pending));
  const [cleanupFailed, setCleanupFailed] = useState(false);
  const [submitNotSent, setSubmitNotSent] = useState(false);
  const [restoreSession, setRestoreSession] = useState(false);
  const writing = useRef<AbortController | null>(null); const form = useRef<HTMLFormElement>(null);
  useEffect(() => () => writing.current?.abort(), []);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
        // Pruning requires write access. A failed prune must still allow draft recovery.
        await pruneExpiredDrafts(publicDraftPrefix).catch(() => {});
        if (!active) return;
        const key = publicDraftPrefix + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        const current = new EditDraftSlot<SavedPublicDraft>(key);
        slot.current = current;
        const saved = await current.read();
        if (!active) return;
        hasDurableDraft.current = saved !== undefined;
        const legacy = readPendingSubmission(token);
        if (saved?.pending?.key === legacy?.key && legacy && saved) {
          legacyOnly.current = false;
          setDraft(saved.value);
          setTabOnly(false);
        } else if (saved?.pending) {
          setPending(null);
          setCandidate(saved);
          legacyOnly.current = false;
        } else if (!legacy) setCandidate(saved);
      } catch { if (active) setStorage('unavailable'); }
      finally { if (active) setLoaded(true); }
    })();
    return () => { active = false; };
  }, [token]);

  async function readSavedDraft() {
    const saved = await slot.current?.read();
    hasDurableDraft.current = saved !== undefined;
    return saved;
  }

  async function persist(value?: SavedPublicDraft, beforeCommit?: () => boolean): Promise<DraftWriteResult> {
    const write = ++latestWrite.current;
    setStorage('saving');
    const result = await slot.current?.write(value, value?.expiresAt, beforeCommit) ?? 'unavailable';
    if (result === 'saved') hasDurableDraft.current = value !== undefined;
    if (result === 'conflict') hasDurableDraft.current = true;
    if (write === latestWrite.current) setStorage(result);
    return result;
  }

  function edit(value: SubmissionDraft) {
    setDraft(value); setErrors({}); setSubmitNotSent(false);
    if (!submissionEntryUnavailable) setError(null);
    void persist({ value, expiresAt: Date.now() + draftLifetime });
  }

  function clearSession(key: string) {
    if (sessionKey.current !== key) return true;
    if (!clearPendingSubmission(token, key)) return false;
    sessionKey.current = undefined;
    if (recoveredSession.current?.key === key) recoveredSession.current = null;
    return true;
  }

  async function clear(request: PendingSubmission | null) {
    const durable = legacyOnly.current || !hasDurableDraft.current ? 'saved' : await persist();
    // A newer tab owns the persisted record when the revision has changed.
    return durable !== 'unavailable' && (!request || clearSession(request.key));
  }

  function reset() {
    const next = newSubmissionDraft();
    initial.current = next; setDraft(next); setPending(null); setStored(false); setTabOnly(false);
    setCandidate(undefined); setReceipt(null); setErrors({}); setError(null); setCleanupFailed(false); setStorage('idle');
    setSubmitNotSent(false);
    setRestoreSession(false);
    legacyOnly.current = false;
  }

  const dirty = submissionDirty(draft, initial.current);
  const atRisk = imagesPending || (pending ? !stored || tabOnly : dirty && storage !== 'saved');
  useEffect(() => {
    onLeaveGuard(() => Boolean(receipt) || !atRisk || window.confirm('填写内容尚未提交确认，离开将丢弃输入。确定离开吗？'));
    return () => onLeaveGuard(null);
  }, [atRisk, receipt, onLeaveGuard]);
  useEffect(() => {
    if (receipt || !atRisk) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', leave); return () => window.removeEventListener('beforeunload', leave);
  }, [atRisk, receipt]);
  const uncertain = pending !== null;
  const submissionEntryUnavailable = error instanceof ApiError && error.code === 'ENTRY_UNAVAILABLE';
  const unavailable = (entry.error instanceof ApiError && entry.error.status === 404) || submissionEntryUnavailable;
  const needsEntryCheck = unavailable || !entry.data;
  const checkEntry = () => { void entry.refetch({ cancelRefetch: false }); };
  function findLegacyPending() {
    return readPendingSubmission(token) ?? recoveredSession.current;
  }

  function restoreLegacyPending(legacy = findLegacyPending()) {
    if (!legacy) return false;
    sessionKey.current = legacy.key;
    legacyOnly.current = true;
    setPending(legacy);
    setDraft(draftFromSubmissionContent(legacy.content));
    setStored(true);
    setTabOnly(true);
    setRestoreSession(false);
    setSubmitNotSent(false);
    setError(null);
    return true;
  }

  async function returnToDraft() {
    if (writing.current) return;
    const controller = new AbortController();
    writing.current = controller; setBusy(true);
    try {
      if (pending && !await clear(pending)) { if (!controller.signal.aborted) setCleanupFailed(true); return; }
      if (controller.signal.aborted) return;
      const legacy = findLegacyPending();
      let saved: SavedPublicDraft | undefined, failed = false;
      if (!legacy) {
        try { saved = await readSavedDraft(); } catch { failed = true; }
      }
      if (controller.signal.aborted) return;
      reset();
      if (!restoreLegacyPending(legacy)) {
        setCandidate(saved);
        if (failed) setStorage('unavailable');
      }
    } finally { writing.current = null; if (!controller.signal.aborted) setBusy(false); }
  }

  const abandon = () => {
    if (pending && !writing.current && window.confirm('请先向客服核对。放弃本页重试记录后，已经收到的填单仍会保留。确定放弃吗？'))
      void returnToDraft();
  };
  return <main className="customer-page"><header className="customer-header"><img className="customer-brand" src="/brand.jpg" alt="午逅 Story" />{entry.data && <span>客服：{entry.data.ownerName}</span>}</header>
    {receipt ? <section className="panel submission-success" role="status"><CheckCircle size={42} /><h1>已提交，待客服确认</h1><p>修改请联系接待客服。</p><p className="submission-number">填单编号：{receipt.submissionNo}</p><button type="button" className="secondary" disabled={busy} onClick={() => void returnToDraft()}>再填一单</button>{cleanupFailed && <p className="notice error" role="alert">暂存记录清理失败，请重试「再填一单」。</p>}</section>
    : !loaded ? <Loading />
    : (!entry.data && (!dirty || unavailable || candidate) || Boolean(candidate) && unavailable) ? entry.isFetching ? <Loading /> : <section className="panel"><h1>暂时无法填写</h1><ErrorNotice error={entry.error ?? error} retry={checkEntry} />{(pending || candidate?.pending) && <p>请联系发码客服核对原填单。</p>}</section>
    : candidate ? <section className="panel notice">
      <p>{candidate.pending ? '本机有一份待确认的预订。恢复后可以继续确认原提交。' : '本机有一份未提交的预订草稿。'}</p>
      <div className="actions">
        <button type="button" className="secondary" disabled={entry.isFetching || storage === 'saving'} onClick={() => {
          if (!candidate.pending && candidate.expiresAt !== undefined && candidate.expiresAt <= Date.now()) { setCandidate(undefined); return; }
          legacyOnly.current = false;
          setDraft(candidate.value); setPending(candidate.pending ?? null); setStored(Boolean(candidate.pending)); setTabOnly(false);
          setCandidate(undefined); setCleanupFailed(false); setSubmitNotSent(false); setStorage('saved');
        }}>恢复草稿</button>
        <button type="button" className="secondary" disabled={storage === 'saving'} onClick={async () => {
          if (candidate.pending && !window.confirm('原预订可能已经提交，请先向客服核对。确定重新填写吗？')) return;
          if (!await clear(candidate.pending ?? null)) { setCleanupFailed(true); return; }
          reset();
          restoreLegacyPending();
        }}>重新填写</button>
      </div>
      {cleanupFailed && <p role="alert">本机草稿未能清理，请重试。</p>}
    </section> : <>
      <div className="customer-intro"><h1>填写预订信息</h1></div>
      <form ref={form} noValidate onSubmit={async event => {
        event.preventDefault(); if (writing.current || imagesPending || !entry.data || unavailable) return;
        let request = pending;
        const retry = request !== null;
        if (!request) {
          const result = submissionRequest(draft); setErrors(result.errors);
          if (Object.keys(result.errors).length) { focusFormField(form.current, firstProductFormError(result.errors, draft.items)!); return; }
          request = { key: randomUUID(), content: result.content };
        }
        const controller = new AbortController();
        writing.current = controller; setBusy(true); setError(null); setSubmitNotSent(false); setCleanupFailed(false);
        setRestoreSession(false);
        let durable: DraftWriteResult = 'unavailable';
        try {
          if (!retry && rejectedSessionKey.current) {
            if (!clearSession(rejectedSessionKey.current)) {
              setCleanupFailed(true); setSubmitNotSent(true); return;
            }
            rejectedSessionKey.current = undefined;
          }
          const noLegacyPending = () => {
            recoveredSession.current = findLegacyPending();
            return !recoveredSession.current;
          };
          if (!retry && !noLegacyPending()) { setRestoreSession(true); return; }
          durable = legacyOnly.current ? 'unavailable'
            : await persist({ value: draft, pending: request }, retry ? undefined : noLegacyPending);
          if (controller.signal.aborted) return;
          if (!retry && !noLegacyPending()) {
            if (durable === 'saved') {
              const editable = await persist({ value: draft, expiresAt: Date.now() + draftLifetime });
              if (controller.signal.aborted) return;
              setCleanupFailed(editable === 'unavailable');
            }
            setRestoreSession(true); return;
          }
          const sessionOccupied = sessionKey.current !== undefined && sessionKey.current !== request.key;
          if (!retry && durable !== 'saved' && (hasDurableDraft.current || sessionOccupied)) {
            setSubmitNotSent(true); return;
          }
          const fallback = durable !== 'saved' && !sessionOccupied ? storePendingSubmission(token, request) : 'unavailable';
          if (!retry && typeof fallback === 'object') {
            recoveredSession.current = fallback; setRestoreSession(true); return;
          }
          const inTab = fallback === 'saved';
          if (inTab) sessionKey.current = request.key;
          setTabOnly(inTab);
          setStored(durable === 'saved' || inTab); setPending(request);
          const result = await submitPublicOrder(token, request.key, request.content, controller.signal);
          const cleared = await clear(request);
          if (!controller.signal.aborted) {
            setReceipt(result); setPending(cleared ? null : request); setCleanupFailed(!cleared);
          }
        } catch (failure) {
          if (controller.signal.aborted) return;
          const imageUnavailable = failure instanceof ApiError && failure.status === 404 && failure.code === 'IMAGE_NOT_FOUND';
          if (imageUnavailable || !retry && submissionRejected(failure)) {
            const sessionCleared = clearSession(request.key);
            rejectedSessionKey.current = sessionCleared ? undefined : request.key;
            legacyOnly.current = false;
            const editable = !(imageUnavailable || durable === 'saved')
              || await persist({ value: draft, expiresAt: Date.now() + draftLifetime }) !== 'unavailable';
            if (controller.signal.aborted) return;
            setPending(null); setStored(false); setTabOnly(false);
            setCleanupFailed(!editable || !sessionCleared);
          }
          setError(failure);
          if (failure instanceof ApiError && failure.code === 'ENTRY_UNAVAILABLE')
            void client.invalidateQueries({ queryKey: entryKey, exact: true });
        } finally { writing.current = null; if (!controller.signal.aborted) setBusy(false); }
      }}>
        <SubmissionFields draft={draft} onChange={edit} errors={errors} busy={busy || uncertain} imageScope={{ base: `/public/order-entries/${encodeURIComponent(token)}`, publicImage: true }} markImagePending={markPending} />
        {!uncertain && error instanceof ApiError && error.code === 'IMAGE_NOT_FOUND'
          ? <p className="notice error" role="alert">部分参考图片已失效。请移除读取失败的图片，按需重新上传后提交。</p>
          : needsEntryCheck && entry.isFetching ? <p className="notice" role="status">正在检查填写入口…</p>
          : <ErrorNotice error={needsEntryCheck ? entry.error ?? error : error} retry={needsEntryCheck ? checkEntry : undefined} />}
        {submitNotSent && <p className="notice error" role="alert">本次未发送，填写内容仍在本页。请处理暂存问题后再提交。</p>}
        {restoreSession && !pending && <div className="notice error" role="alert">
          <p>本次未发送。本页找到一笔待确认的提交，当前输入仍在本页。</p>
          <button type="button" className="secondary" disabled={busy} onClick={() => {
            if (!window.confirm('恢复原提交会替换当前表单，请先复制需要保留的输入。确定恢复吗？')) return;
            if (!restoreLegacyPending()) { setRestoreSession(false); setSubmitNotSent(true); }
          }}>恢复原提交</button>
        </div>}
        {!uncertain && dirty && storage === 'saved' && <p className="form-help" role="status">草稿已保存在本机，24 小时内可重扫本入口恢复。</p>}
        {!uncertain && dirty && storage === 'unavailable' && <p className="form-help" role="status">浏览器暂存不可用，请保留当前页面。</p>}
        {storage === 'conflict' && !pending && <div className="notice">
          <p role="status">另一标签页已更新草稿，当前输入仍在本页。</p>
          <button type="button" className="secondary" onClick={async () => {
            if (!window.confirm('请先复制需要保留的输入。读取另一标签页的草稿吗？')) return;
            try {
              const current = await readSavedDraft();
              if (current) setCandidate(current);
              setStorage('idle');
            } catch { setStorage('unavailable'); }
          }}>读取已保存的草稿</button>
        </div>}
        {uncertain && tabOnly && <p className="form-help" role="status">重试记录仅保存在当前标签页，请保留此页。</p>}
        {uncertain && !busy && <p className="notice" role="status">原提交结果仍待确认，输入已保留。请先向客服核对，再重试。</p>}
        {(busy || uncertain) && !stored && <p className="notice" role="status">浏览器暂存不可用，本次只能在当前页面重试。</p>}
        {uncertain && unavailable && <p className="notice">填写入口暂不可用。请联系发码客服核对原填单。</p>}
        {cleanupFailed && <p className="notice error">暂存记录清理失败，请重试。</p>}
        {!!Object.keys(errors).length && <p className="notice error" role="alert">请检查标出的内容。</p>}
        <section className="panel create-group customer-order-notice" aria-labelledby="order-notice-title">
          <h2 id="order-notice-title">订购需知</h2>
          <p>❣️1.下单以付款支付为准。</p>
          <p>❣️2.运费：3公里内满58元免运费，不满58元运费6元，3-7公里满120免运费，不满120满58运费6元，超出7公里运费另算。</p>
          <p>❣️3.夹层默认芒果，可以换火龙果，草莓，奥利奥碎，黄油脆片，脆啵啵，马蹄爆爆珠也可以混搭（三种）</p>
          <p>❣️4.【配套餐具&amp;配件说明】</p>
          <p>每个蛋糕标配：1盒蜡烛（8根）、1盒火柴、一把蛋糕刀、1个生日帽；蛋糕叉碟根据蛋糕尺寸匹配：</p>
          <table><caption className="sr-only">蛋糕叉碟标配数量</caption><thead><tr><th scope="col">蛋糕尺寸</th><th scope="col">叉碟份数</th></tr></thead><tbody>
            <tr><td>4寸-6寸</td><td>5人份</td></tr><tr><td>7寸-8寸</td><td>10人份</td></tr><tr><td>9寸</td><td>15人份</td></tr><tr><td>10寸</td><td>20人份</td></tr><tr><td>12寸</td><td>25人份</td></tr><tr><td>14寸</td><td>30人份</td></tr>
          </tbody></table>
          <p>注：超出标配数量以及其他款式蜡烛需另外购买♡</p>
        </section>
        <div className="create-submit"><p className="form-help">{imagesPending ? '请完成上传或移除未上传的图片。' : '提交后待客服确认'}</p>{uncertain && <button type="button" className="secondary" disabled={busy} onClick={abandon}>放弃重试</button>}<button className="primary" disabled={busy || imagesPending || !entry.data || unavailable}>{busy ? '正在提交…' : uncertain ? '重试提交' : '提交预订'}<ArrowRight /></button></div>
      </form></>}
  </main>;
}
