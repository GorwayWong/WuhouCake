import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle } from '@phosphor-icons/react';
import { ApiError, creationResultUnknown, readPublicOrderEntry, submitPublicOrder } from './api';
import { ErrorNotice, Loading } from './ui';
import { SubmissionFields } from './SubmissionFields';
import { draftFromSubmissionContent, newSubmissionDraft, submissionRequest, submissionDirty } from './customerSubmission';
import { clearPendingSubmission, readPendingSubmission, storePendingSubmission } from './publicSubmissionStorage';
import { focusFormField } from './formFocus';
import { firstProductFormError } from './productFormLayout';
import { randomUUID } from './uuid.ts';

export function PublicOrderEntry({ token, onLeaveGuard }: { token: string; onLeaveGuard: (guard: (() => boolean) | null) => void }) {
  const client = useQueryClient();
  const entryKey = ['public-entry', token];
  const [pending, setPending] = useState(() => readPendingSubmission(token));
  const [draft, setDraft] = useState(() => pending ? draftFromSubmissionContent(pending.content) : newSubmissionDraft());
  const initial = useRef(draft);
  const [errors, setErrors] = useState<Record<string, string>>({}); const [error, setError] = useState<unknown>(null);
  const entry = useQuery({ queryKey: entryKey, networkMode: 'always', refetchOnReconnect: true, retry: false, queryFn: async ({ signal }) => {
    const value = await readPublicOrderEntry(token, signal);
    if (!signal.aborted) setError((current: unknown) => current instanceof ApiError && current.code === 'ENTRY_UNAVAILABLE' ? null : current);
    return value;
  } });
  const [receipt, setReceipt] = useState<{ submissionNo: string } | null>(null); const [busy, setBusy] = useState(false);
  const [stored, setStored] = useState(Boolean(pending));
  const [cleanupFailed, setCleanupFailed] = useState(false);
  const writing = useRef<AbortController | null>(null); const form = useRef<HTMLFormElement>(null);
  useEffect(() => () => writing.current?.abort(), []);
  const dirty = submissionDirty(draft, initial.current);
  const atRisk = (dirty || Boolean(pending)) && !(pending && stored);
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
  const abandon = () => {
    if (!pending || writing.current || !window.confirm('请先向客服核对。放弃本页重试记录后，已经收到的填单仍会保留。确定放弃吗？')) return;
    if (stored && !clearPendingSubmission(token, pending.key)) { setCleanupFailed(true); return; }
    const next = newSubmissionDraft();
    initial.current = next; setDraft(next); setPending(null); setStored(false); setErrors({}); setError(null); setCleanupFailed(false);
  };
  return <main className="customer-page"><header className="customer-header"><img className="customer-brand" src="/brand.jpg" alt="午逅 Story" />{entry.data && <span>客服：{entry.data.ownerName}</span>}</header>
    {receipt ? <section className="panel submission-success" role="status"><CheckCircle size={42} /><h1>已提交，待客服确认</h1><p>修改请联系接待客服。</p><p className="submission-number">填单编号：{receipt.submissionNo}</p><button type="button" className="secondary" onClick={() => {
      if (pending && !clearPendingSubmission(token, pending.key)) return;
      const next = newSubmissionDraft(); initial.current = next; setDraft(next); setReceipt(null); setError(null); setPending(null); setStored(false); setCleanupFailed(false);
    }}>再填一单</button>{cleanupFailed && <p className="notice error">暂存记录清理失败，请重试「再填一单」。</p>}</section>
    : !dirty && !uncertain && !entry.data ? entry.isFetching ? <Loading /> : <section className="panel"><h1>暂时无法填写</h1><ErrorNotice error={entry.error} retry={checkEntry} /></section> : <>
      <div className="customer-intro"><h1>填写预订信息</h1></div>
      <form ref={form} noValidate onSubmit={async event => {
        event.preventDefault(); if (writing.current || !entry.data || unavailable) return;
        let request = pending;
        const retry = request !== null;
        if (!request) {
          const result = submissionRequest(draft); setErrors(result.errors);
          if (Object.keys(result.errors).length) { focusFormField(form.current, firstProductFormError(result.errors, draft.items)!); return; }
          request = { key: randomUUID(), content: result.content };
        }
        const controller = new AbortController();
        writing.current = controller; setBusy(true); setError(null);
        const persisted = (retry && stored) || storePendingSubmission(token, request);
        setStored(persisted); setPending(request);
        try {
          const result = await submitPublicOrder(token, request.key, request.content, controller.signal);
          const cleared = !persisted || clearPendingSubmission(token, request.key);
          if (!controller.signal.aborted) {
            setReceipt(result); setPending(cleared ? null : request); setCleanupFailed(!cleared);
          }
        } catch (failure) {
          if (controller.signal.aborted) return;
          if (!retry && !creationResultUnknown(failure)) {
            if (persisted && !clearPendingSubmission(token, request.key)) setCleanupFailed(true);
            else { setPending(null); setStored(false); }
          }
          setError(failure);
          if (failure instanceof ApiError && failure.code === 'ENTRY_UNAVAILABLE')
            void client.invalidateQueries({ queryKey: entryKey, exact: true });
        } finally { writing.current = null; if (!controller.signal.aborted) setBusy(false); }
      }}>
        <SubmissionFields draft={draft} onChange={value => { setDraft(value); setErrors({}); if (!submissionEntryUnavailable) setError(null); }} errors={errors} busy={busy || uncertain} />
        {needsEntryCheck && entry.isFetching ? <p className="notice" role="status">正在检查填写入口…</p>
          : <ErrorNotice error={needsEntryCheck ? entry.error ?? error : error} retry={needsEntryCheck ? checkEntry : undefined} />}
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
        <div className="create-submit"><p className="form-help">提交后待客服确认</p>{uncertain && <button type="button" className="secondary" disabled={busy} onClick={abandon}>放弃重试</button>}<button className="primary" disabled={busy || !entry.data || unavailable}>{busy ? '正在提交…' : uncertain ? '重试提交' : '提交预订'}<ArrowRight /></button></div>
      </form></>}
  </main>;
}
