import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle } from '@phosphor-icons/react';
import { ApiError, missingPublicImages, readPublicOrderEntry, submitPublicOrder } from './api';
import { ErrorNotice, Loading } from './ui';
import { SubmissionFields } from './SubmissionFields';
import { copyLegacyDraftImages, publicDraftImages, replaceDraftImageIds, stagePublicDraftImages } from './publicDraftImages';
import { draftFromSubmissionContent, newSubmissionDraft, submissionRequest, submissionDirty } from './customerSubmission';
import { clearPendingSubmission, readPendingSubmission, storePendingSubmission } from './publicSubmissionStorage';
import { focusFormField } from './formFocus';
import { firstProductFormError } from './productFormLayout';
import { randomUUID } from './uuid.ts';
import { EditDraftSlot, pruneExpiredDrafts, publicDraftPrefix } from './editDraftStorage';
import type { DraftWriteResult } from './editDraftStorage';
import type { PendingSubmission } from './publicSubmissionStorage';
import type { SubmissionDraft } from './customerSubmission';

const draftLifetime = 24 * 60 * 60 * 1000;
type SavedPublicDraft = { value: SubmissionDraft; expiresAt?: number; pending?: PendingSubmission; stagedAt?: Record<string, number>; legacyCopyIds?: string[] };
type LoadedDraft = SavedPublicDraft & { files: Map<string, File> };
type RecoveryIssue = 'changed' | 'other-draft' | 'unavailable';

function submissionRejected(error: unknown): error is ApiError {
  return error instanceof ApiError && (
    (error.status === 400 && ['VALIDATION_FAILED', 'SUBMISSION_PRODUCT_TYPE_INVALID',
      'SUBMISSION_QUANTITY_INVALID', 'SUBMISSION_CAKE_SIZE_REQUIRED'].includes(error.code))
    || (error.status === 404 && error.code === 'ENTRY_UNAVAILABLE')
    || (error.status === 409 && ['ORDER_IMAGE_LIMIT_EXCEEDED', 'ORDER_IMAGE_COUNT_EXCEEDED', 'ORDER_IMAGE_STORAGE_EXCEEDED'].includes(error.code))
    || (error.status === 413 && error.code === 'SUBMISSION_TOO_LARGE')
    || (error.status === 429 && error.code === 'SUBMISSION_THROTTLED')
  );
}

export function PublicOrderEntry({ token, onLeaveGuard }: { token: string; onLeaveGuard: (guard: (() => boolean) | null) => void }) {
  const client = useQueryClient();
  const entryKey = ['public-entry', token];
  const [pending, setPending] = useState(() => readPendingSubmission(token));
  const [draft, updateDraft] = useState(() => pending ? draftFromSubmissionContent(pending.content) : newSubmissionDraft());
  const currentDraft = useRef(draft);
  function setDraft(value: SubmissionDraft) {
    currentDraft.current = value;
    updateDraft(value);
  }
  const initial = useRef(draft);
  const files = useRef(new Map<string, File>());
  const legacyCopies = useRef(new Set<string>());
  const stagedAt = useRef<Record<string, number>>({});
  const expiresAt = useRef<number | undefined>(undefined);
  const imageBase = `/public/order-entries/${encodeURIComponent(token)}`;
  const slot = useRef<EditDraftSlot<SavedPublicDraft> | undefined>(undefined);
  const hasDurableDraft = useRef(false);
  const legacyOnly = useRef(Boolean(pending));
  const sessionKey = useRef(pending?.key);
  const recoveredSession = useRef<PendingSubmission | null>(null);
  const rejectedSessionKey = useRef<string | undefined>(undefined);
  const latestWrite = useRef(0);
  const [loaded, setLoaded] = useState(false);
  const [candidate, setCandidate] = useState<LoadedDraft>();
  const [uploadStatus, setUploadStatus] = useState('');
  const [blockedRejection, setBlockedRejection] = useState<{ reason: ApiError; issue: RecoveryIssue } | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const missingImageIds = useRef<ReadonlySet<string> | null | undefined>(undefined);
  const [previewRevision, setPreviewRevision] = useState(0);
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
  const formHeading = useRef<HTMLHeadingElement>(null);
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
        const saved = await readSavedDraft();
        if (!active) return;
        hasDurableDraft.current = saved !== undefined;
        const legacy = readPendingSubmission(token);
        if (saved?.pending?.key === legacy?.key && legacy && saved) {
          legacyOnly.current = false;
          restoreDraft(saved);
          setPending(saved.pending ?? null);
          setStored(true);
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
    const attachments = new Map<string, File>();
    const saved = await slot.current?.read(attachments);
    hasDurableDraft.current = saved !== undefined;
    return saved && { ...saved, files: attachments };
  }

  function restoreDraft(saved: LoadedDraft) {
    files.current = saved.files;
    legacyCopies.current = new Set(saved.legacyCopyIds);
    stagedAt.current = saved.stagedAt ?? {};
    expiresAt.current = saved.expiresAt;
    setDraft(saved.value);
  }

  function openSavedDraft(saved: LoadedDraft) {
    legacyOnly.current = false;
    restoreDraft(saved);
    setPending(saved.pending ?? null); setStored(Boolean(saved.pending)); setTabOnly(false);
    setBlockedRejection(null); setPreviewRevision(0);
    setCandidate(undefined); setCleanupFailed(false); setSubmitNotSent(false); setStorage('saved');
  }

  async function persist(value?: SavedPublicDraft, beforeCommit?: () => boolean,
    allowCurrent?: (current?: SavedPublicDraft) => boolean): Promise<DraftWriteResult> {
    if (value?.expiresAt !== undefined) expiresAt.current = value.expiresAt;
    const write = ++latestWrite.current;
    setStorage('saving');
    const ids = publicDraftImages(value?.value ?? initial.current).map(row => row.id);
    const attachments = new Map(ids.flatMap(id => {
      const file = files.current.get(id);
      return file ? [[id, file] as const] : [];
    }));
    const metadata = value && { ...value, legacyCopyIds: ids.filter(id => legacyCopies.current.has(id)),
      stagedAt: Object.fromEntries(ids.filter(id => stagedAt.current[id] !== undefined)
      .map(id => [id, stagedAt.current[id]])) };
    const result = await slot.current?.write(metadata, value?.expiresAt, beforeCommit, allowCurrent, attachments) ?? 'unavailable';
    if (result === 'saved') hasDurableDraft.current = value !== undefined;
    if (result === 'conflict') hasDurableDraft.current = true;
    if (write === latestWrite.current) setStorage(result);
    return result;
  }

  function edit(value: SubmissionDraft) {
    setDraft(value); setErrors({}); setSubmitNotSent(false);
    if (!submissionEntryUnavailable) setError(null);
    const ids = new Set(publicDraftImages(value).map(row => row.id));
    for (const id of files.current.keys()) if (!ids.has(id)) files.current.delete(id);
    for (const id of legacyCopies.current) if (!ids.has(id)) legacyCopies.current.delete(id);
    for (const id of Object.keys(stagedAt.current)) if (!ids.has(id)) delete stagedAt.current[id];
    expiresAt.current = Date.now() + draftLifetime;
    void persist({ value, expiresAt: expiresAt.current });
  }

  function selectImage(itemId: string, file: File) {
    const id = randomUUID();
    files.current.set(id, file);
    const value = currentDraft.current;
    edit({ ...value, items: value.items.map(item => item.key === itemId
      ? { ...item, imageIds: [...(item.imageIds ?? []), id] } : item) });
  }

  function clearSession(key: string) {
    if (sessionKey.current !== key) return true;
    if (!clearPendingSubmission(token, key)) return false;
    sessionKey.current = undefined;
    if (recoveredSession.current?.key === key) recoveredSession.current = null;
    return true;
  }

  async function clear(request: PendingSubmission | null) {
    const durable = legacyOnly.current || !hasDurableDraft.current ? 'saved'
      : await persist(undefined, undefined, request ? current => !current || current.pending?.key === request.key : undefined);
    // A newer tab owns the persisted record when the revision has changed.
    return durable !== 'unavailable' && (!request || clearSession(request.key));
  }

  function reset() {
    const next = newSubmissionDraft();
    initial.current = next; setDraft(next); setPending(null); setStored(false); setTabOnly(false);
    setCandidate(undefined); setReceipt(null); setErrors({}); setError(null); setCleanupFailed(false); setStorage('idle');
    setSubmitNotSent(false);
    setRestoreSession(false);
    setBlockedRejection(null); setRecoveryMessage(''); setPreviewRevision(0);
    legacyOnly.current = false;
    files.current = new Map(); stagedAt.current = {}; expiresAt.current = undefined;
    legacyCopies.current = new Set();
  }

  const dirty = previewRevision > 0 || submissionDirty(draft, initial.current);
  const atRisk = pending ? !stored || tabOnly : dirty && storage !== 'saved';
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
  const legacyImages = (value: SubmissionDraft) =>
    publicDraftImages(value).filter(({ id }) => !files.current.has(id)).map(({ item, id }) => `${item}:${id}`).join('/');
  const legacyImageIds = legacyImages(draft);
  useEffect(() => {
    if (!loaded || candidate || pending || busy || !entry.data || !expiresAt.current || !legacyImageIds) return;
    const controller = new AbortController();
    void copyLegacyDraftImages(imageBase, currentDraft.current, files.current, controller.signal).then(copies => {
      if (controller.signal.aborted || writing.current || legacyImages(currentDraft.current) !== legacyImageIds
          || !copies.size) return;
      for (const [id, file] of copies) {
        files.current.set(id, file);
        legacyCopies.current.add(id);
      }
      const value = { ...currentDraft.current };
      setDraft(value);
      void persist({ value, expiresAt: expiresAt.current });
    }).catch(() => {});
    return () => controller.abort();
  }, [loaded, candidate, pending, busy, entry.data, legacyImageIds, imageBase]);
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
    files.current = new Map(); stagedAt.current = {}; expiresAt.current = undefined;
    legacyCopies.current = new Set();
    setPending(legacy);
    setDraft(draftFromSubmissionContent(legacy.content));
    setStored(true);
    setTabOnly(true);
    setRestoreSession(false);
    setSubmitNotSent(false);
    setBlockedRejection(null); setPreviewRevision(0);
    setError(null);
    return true;
  }

  async function returnToDraft(discard?: { request: PendingSubmission | null }) {
    if (writing.current) return;
    const controller = new AbortController();
    writing.current = controller; setBusy(true); setCleanupFailed(false);
    try {
      const selection = discard ?? (pending ? { request: pending } : undefined);
      // A session-only request can coexist with the editable draft. Read it before dropping the request.
      const readBeforeClear = Boolean(selection && legacyOnly.current);
      let saved = readBeforeClear ? await readSavedDraft() : undefined;
      if (controller.signal.aborted) return;
      if (selection && !await clear(selection.request)) {
        if (!controller.signal.aborted) setCleanupFailed(true);
        return;
      }
      if (controller.signal.aborted) return;
      const legacy = findLegacyPending();
      let storageUnavailable = false;
      if (!legacy && !readBeforeClear) {
        try { saved = await readSavedDraft(); }
        catch (failure) {
          if (selection || hasDurableDraft.current) throw failure;
          storageUnavailable = true;
        }
      }
      if (controller.signal.aborted) return;
      reset();
      if (!restoreLegacyPending(legacy)) {
        setCandidate(saved);
        if (storageUnavailable) setStorage('unavailable');
      }
    } catch {
      if (!controller.signal.aborted) { setStorage('unavailable'); setCleanupFailed(true); }
    } finally { writing.current = null; if (!controller.signal.aborted) setBusy(false); }
  }

  async function recoverRejectedDraft(request: PendingSubmission, reason: ApiError, signal: AbortSignal, value = draft) {
    const result = await persist({ value, expiresAt: Date.now() + draftLifetime }, undefined,
      current => !current || current.pending?.key === request.key);
    if (signal.aborted) return;
    if (result === 'conflict' || result === 'unavailable' && (legacyOnly.current || hasDurableDraft.current)) {
      let issue: RecoveryIssue = 'unavailable';
      if (result === 'conflict') {
        issue = 'changed';
        try {
          const saved = await slot.current?.read();
          if (saved && saved.pending?.key !== request.key) issue = 'other-draft';
        } catch { /* Keep the neutral recovery guidance until the saved draft can be verified. */ }
      }
      if (signal.aborted) return;
      setBlockedRejection({ reason, issue });
      if (blockedRejection) setRecoveryMessage(issue === 'other-draft'
        ? '仍未恢复编辑。手机里已有另一份草稿，你可以打开它，也可以留在当前页。'
        : issue === 'changed' ? '仍未恢复编辑。草稿有变动，请再点「恢复编辑」。'
        : '手机仍无法保存这笔填写。请保留此页，稍后再点「恢复编辑」。');
      return;
    }
    const sessionCleared = clearSession(request.key);
    rejectedSessionKey.current = sessionCleared ? undefined : request.key;
    legacyOnly.current = false;
    setBlockedRejection(null); setRecoveryMessage(''); setPreviewRevision(value => value + 1);
    setPending(null); setStored(false); setTabOnly(false);
    setCleanupFailed(!sessionCleared);
    setError(reason);
  }

  async function switchRejectedDraft() {
    if (!pending || blockedRejection?.issue !== 'other-draft' || writing.current) return;
    const controller = new AbortController();
    writing.current = controller; setBusy(true);
    try {
      const target = await slot.current?.read();
      if (controller.signal.aborted) return;
      let saved: LoadedDraft | undefined;
      if (target && target.pending?.key !== pending.key) {
        if (!window.confirm('这笔预订还没提交。切换后，当前填写将无法找回。要打开另一份草稿吗？')) return;
        saved = await readSavedDraft();
      }
      if (controller.signal.aborted) return;
      if (!saved || saved.pending?.key === pending.key) {
        setBlockedRejection({ ...blockedRejection, issue: 'changed' });
        setRecoveryMessage('另一份草稿已找不到。当前填写还在，请点「恢复编辑」继续这笔预订。');
        return;
      }
      // The saved draft belongs to a different request. Only clear this tab's rejected request.
      if (!clearSession(pending.key)) {
        setRecoveryMessage('无法切换草稿。当前填写还在，请保留此页，稍后再试。');
        return;
      }
      reset();
      openSavedDraft(saved);
      formHeading.current?.focus();
    } catch {
      if (!controller.signal.aborted)
        setRecoveryMessage('暂时无法打开另一份草稿。当前填写还在，请保留此页，稍后再试。');
    } finally {
      writing.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  const abandon = () => {
    if (pending && !writing.current && window.confirm('请先向客服核对。放弃本页重试记录后，已经收到的填单仍会保留。确定放弃吗？'))
      void returnToDraft();
  };
  const imageRejectionMessage = uncertain || !(error instanceof ApiError) ? '' :
    error.code === 'ORDER_IMAGE_STORAGE_EXCEEDED' ? '参考图片加起来太大，请移除部分图片后再次提交。' :
    error.code !== 'IMAGE_NOT_FOUND' ? '' :
    missingImageIds.current === null
      ? '这笔预订还没提交，暂时无法检查图片。请核对内容后再点「提交预订」，图片可用时会直接提交。'
      : Array.from(missingImageIds.current ?? publicDraftImages(draft).map(image => image.id)).every(id => files.current.has(id))
        ? '图片已保留，请再次提交。' : '请重新选择或移除标为失效的图片，再次提交。';
  const formError = imageRejectionMessage ? null : error;
  return <main className="customer-page"><header className="customer-header"><img className="customer-brand" src="/brand.jpg" alt="午逅 Story" />{entry.data && <span>客服：{entry.data.ownerName}</span>}</header>
    {receipt ? <section className="panel submission-success" role="status"><CheckCircle size={42} /><h1>已提交，待客服确认</h1><p>修改请联系接待客服。</p><p className="submission-number">填单编号：{receipt.submissionNo}</p><button type="button" className="secondary" disabled={busy} onClick={() => void returnToDraft()}>再填一单</button>{cleanupFailed && <p className="notice error" role="alert">暂存记录清理失败，请重试「再填一单」。</p>}</section>
    : !loaded ? <Loading />
    : !blockedRejection && (!entry.data && (!dirty || unavailable || candidate) || Boolean(candidate) && unavailable) ? entry.isFetching ? <Loading /> : <section className="panel"><h1>暂时无法填写</h1><ErrorNotice error={entry.error ?? error} retry={checkEntry} />{(pending || candidate?.pending) && <p>请联系发码客服核对原填单。</p>}</section>
    : candidate ? <section className="panel notice">
      <p>{candidate.pending ? '本机有一份待确认的预订。恢复后可以继续确认原提交。' : '本机有一份未提交的预订草稿。'}</p>
      <div className="actions">
        <button type="button" className="secondary" disabled={busy || entry.isFetching || storage === 'saving'} onClick={() => {
          if (!candidate.pending && candidate.expiresAt !== undefined && candidate.expiresAt <= Date.now()) { setCandidate(undefined); return; }
          openSavedDraft(candidate);
        }}>恢复草稿</button>
        <button type="button" className="secondary" disabled={busy || storage === 'saving'} onClick={() => {
          if (candidate.pending && !window.confirm('原预订可能已经提交，请先向客服核对。确定重新填写吗？')) return;
          void returnToDraft({ request: candidate.pending ?? null });
        }}>重新填写</button>
      </div>
      {cleanupFailed && <p role="alert">本机草稿未能清理，请重试。</p>}
    </section> : <>
      <div className="customer-intro"><h1 ref={formHeading} tabIndex={-1}>填写预订信息</h1></div>
      <form ref={form} noValidate onSubmit={async event => {
        event.preventDefault(); if (writing.current || !blockedRejection && (!entry.data || unavailable)) return;
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
        let submittingDraft = draft;
        let sent = false;
        let submissionFailure: unknown;
        let submittedAfterRepair = false;
        if (!blockedRejection) missingImageIds.current = undefined;
        const waiting = { used: false };
        const showProgress = (completed: number, total: number, paused?: boolean) =>
          setUploadStatus(paused ? `图片上传较忙，稍后继续（${completed}/${total}）` : `正在上传图片 ${completed}/${total}`);
        const stageImages = (target: Parameters<typeof stagePublicDraftImages>[6]) => stagePublicDraftImages(imageBase, submittingDraft, files.current,
          stagedAt.current, controller.signal, waiting, target, showProgress, async (id, startedAt) => {
            stagedAt.current[id] = startedAt;
            const result = await persist({ value: submittingDraft, ...(sent ? { pending: request! } : { expiresAt: expiresAt.current }) });
            if (result === 'conflict' || result === 'unavailable' && hasDurableDraft.current)
              throw new ApiError(409, 'CONCURRENT_MODIFICATION');
            if (sent && result === 'saved') durable = result;
          });
        try {
          if (blockedRejection) {
            setRecoveryMessage('');
            try { await readSavedDraft(); }
            catch {
              if (!controller.signal.aborted)
                setRecoveryMessage('手机暂时无法读取草稿。当前填写还在，请保留此页，稍后再点「恢复编辑」。');
              return;
            }
            if (!controller.signal.aborted) await recoverRejectedDraft(request, blockedRejection.reason, controller.signal);
            return;
          }
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
          if (!retry && publicDraftImages(submittingDraft).length) {
            const legacy = publicDraftImages(submittingDraft).filter(({ id }) => !files.current.has(id) || legacyCopies.current.has(id));
            const missing = await missingPublicImages(imageBase, legacy, controller.signal);
            controller.signal.throwIfAborted();
            if ([...missing].some(id => !files.current.has(id))) {
              missingImageIds.current = missing;
              throw new ApiError(404, 'IMAGE_NOT_FOUND');
            }
            if (missing.size) {
              const replacements = new Map<string, string>();
              for (const id of missing) {
                const replacement = randomUUID();
                replacements.set(id, replacement);
                files.current.set(replacement, files.current.get(id)!);
                files.current.delete(id);
                legacyCopies.current.delete(id);
              }
              submittingDraft = replaceDraftImageIds(submittingDraft, replacements);
              setDraft(submittingDraft);
              request = { key: request.key, content: submissionRequest(submittingDraft).content };
            }
            expiresAt.current = Date.now() + draftLifetime;
            const prepared = await persist({ value: submittingDraft, expiresAt: expiresAt.current }, noLegacyPending);
            if (controller.signal.aborted) return;
            if (!noLegacyPending()) { setRestoreSession(true); return; }
            if (prepared !== 'saved' && hasDurableDraft.current) { setSubmitNotSent(true); return; }
            await stageImages({ skip: new Set(legacy.map(row => row.id)) });
            setUploadStatus('');
          }
          durable = legacyOnly.current ? 'unavailable'
            : await persist({ value: submittingDraft, pending: request }, retry ? undefined : noLegacyPending);
          if (controller.signal.aborted) return;
          if (!retry && !noLegacyPending()) {
            if (durable === 'saved') {
              const editable = await persist({ value: submittingDraft, expiresAt: Date.now() + draftLifetime });
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
          sent = true;
          const submit = async () => {
            try {
              return await submitPublicOrder(token, request!.key, request!.content, controller.signal);
            } catch (failure) {
              submissionFailure = failure;
              throw failure;
            }
          };
          let result;
          try { result = await submit(); }
          catch (failure) {
            const images = publicDraftImages(submittingDraft);
            if (!(failure instanceof ApiError && failure.status === 404 && failure.code === 'IMAGE_NOT_FOUND')
                || !images.length || legacyOnly.current) throw failure;
            const missing = await missingPublicImages(imageBase, images, controller.signal);
            if ([...missing].some(id => !files.current.has(id) || legacyCopies.current.has(id))) {
              missingImageIds.current = missing;
              throw failure;
            }
            await stageImages({ missing });
            setUploadStatus('');
            submittedAfterRepair = true;
            result = await submit();
          }
          const cleared = await clear(request);
          if (!controller.signal.aborted) {
            setReceipt(result); setPending(cleared ? null : request); setCleanupFailed(!cleared);
          }
        } catch (failure) {
          if (controller.signal.aborted) return;
          const imageUnavailable = failure instanceof ApiError && failure.status === 404 && failure.code === 'IMAGE_NOT_FOUND';
          const storageExceeded = failure instanceof ApiError && failure.status === 409 && failure.code === 'ORDER_IMAGE_STORAGE_EXCEEDED';
          if ((imageUnavailable || storageExceeded) && failure === submissionFailure) {
            if (imageUnavailable && submittedAfterRepair) {
              try { missingImageIds.current = await missingPublicImages(imageBase, publicDraftImages(submittingDraft), controller.signal); }
              catch { missingImageIds.current = null; }
              if (controller.signal.aborted) return;
            }
            await recoverRejectedDraft(request, failure, controller.signal, submittingDraft);
            return;
          }
          if (imageUnavailable) setPreviewRevision(value => value + 1);
          if (failure === submissionFailure && submissionRejected(failure)
              && (submittedAfterRepair ? [400, 409, 413].includes(failure.status) : !retry)) {
            const sessionCleared = clearSession(request.key);
            rejectedSessionKey.current = sessionCleared ? undefined : request.key;
            legacyOnly.current = false;
            const editable = durable !== 'saved'
              || await persist({ value: submittingDraft, expiresAt: Date.now() + draftLifetime }) !== 'unavailable';
            if (controller.signal.aborted) return;
            setPending(null); setStored(false); setTabOnly(false);
            setCleanupFailed(!editable || !sessionCleared);
          }
          setError(failure);
          if (failure instanceof ApiError && failure.code === 'ENTRY_UNAVAILABLE')
            void client.invalidateQueries({ queryKey: entryKey, exact: true });
        } finally { writing.current = null; if (!controller.signal.aborted) { setBusy(false); setUploadStatus(''); } }
      }}>
        <SubmissionFields draft={draft} onChange={edit} errors={errors} busy={busy || uncertain} imageScope={{ base: imageBase, publicImage: true, previewRevision, localFiles: files.current, selectLocal: selectImage }} />
        {needsEntryCheck && entry.isFetching ? <p className="notice" role="status">正在检查填写入口…</p>
          : <ErrorNotice error={needsEntryCheck ? entry.error ?? formError : formError}
            retry={needsEntryCheck ? checkEntry : undefined} />}
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
        {uncertain && tabOnly && !blockedRejection && <p className="form-help" role="status">重试记录仅保存在当前标签页，请保留此页。</p>}
        {uncertain && !busy && !blockedRejection && <p className="notice" role="status">原提交结果仍待确认，输入已保留。请先向客服核对，再重试。</p>}
        {uncertain && !stored && !blockedRejection && <p className="notice" role="status">浏览器暂存不可用，本次只能在当前页面重试。</p>}
        {uncertain && unavailable && !blockedRejection && <p className="notice">填写入口暂不可用。请联系发码客服核对原填单。</p>}
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
        {imageRejectionMessage && <p className="notice error" role="alert">{imageRejectionMessage}</p>}
        <div className="create-submit">
          {blockedRejection ? <p className="form-help" role="status">
            {busy ? '正在处理草稿，请稍候。' : <>
              {blockedRejection.reason.code === 'IMAGE_NOT_FOUND' ? '这笔预订因图片失效未提交。' : '参考图片加起来太大，这笔预订还没提交。'}
              {recoveryMessage || (blockedRejection.issue === 'other-draft' ? '手机里已有另一份草稿。点「恢复编辑」只会处理当前填写，不会提交预订。'
                : blockedRejection.issue === 'changed' ? '草稿有变动，请点「恢复编辑」继续当前填写。'
                : '手机暂时无法保存这笔填写。请保留此页，稍后点「恢复编辑」。')}
            </>}
          </p> : !imageRejectionMessage && <p className="form-help" role="status">{uploadStatus || '提交后待客服确认'}</p>}
          {blockedRejection?.issue === 'other-draft' && <button type="button" className="secondary" disabled={busy} onClick={() => void switchRejectedDraft()}>打开另一份草稿</button>}
          {uncertain && !blockedRejection && <button type="button" className="secondary" disabled={busy} onClick={abandon}>放弃重试</button>}
          <button className="primary" disabled={busy || !blockedRejection && (!entry.data || unavailable)}>{busy ? (blockedRejection ? '正在恢复…' : '正在提交…') : blockedRejection ? '恢复编辑' : uncertain ? '重试提交' : '提交预订'}<ArrowRight /></button>
        </div>
      </form></>}
  </main>;
}
