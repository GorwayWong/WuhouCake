import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CheckCircle } from '@phosphor-icons/react';
import { publicApi, creationResultUnknown } from './api';
import { ErrorNotice, Loading } from './ui';
import { SubmissionFields } from './SubmissionFields';
import { newSubmissionDraft, submissionRequest, submissionDirty } from './customerSubmission';
import type { SubmissionContent } from './customerSubmission';
import { focusFormField } from './formFocus';
import { randomUUID } from './uuid.ts';

export function PublicOrderEntry({ token, onLeaveGuard }: { token: string; onLeaveGuard: (guard: (() => boolean) | null) => void }) {
  const entry = useQuery({ queryKey: ['public-entry', token], queryFn: ({ signal }) => publicApi<{ ownerName: string }>(`/public/order-entries/${encodeURIComponent(token)}`, { signal }), retry: false });
  const [draft, setDraft] = useState(newSubmissionDraft);
  const initial = useRef(draft);
  const [errors, setErrors] = useState<Record<string, string>>({}); const [error, setError] = useState<unknown>(null);
  const [receipt, setReceipt] = useState<{ submissionNo: string } | null>(null); const [busy, setBusy] = useState(false);
  const pending = useRef<{ key: string; content: SubmissionContent } | null>(null);
  const writing = useRef(false); const form = useRef<HTMLFormElement>(null);
  const dirty = submissionDirty(draft, initial.current);
  useEffect(() => {
    onLeaveGuard(() => Boolean(receipt) || !dirty || window.confirm('填写内容尚未提交确认，离开将丢弃输入。确定离开吗？'));
    return () => onLeaveGuard(null);
  }, [dirty, receipt, onLeaveGuard]);
  useEffect(() => {
    if (receipt || !dirty) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', leave); return () => window.removeEventListener('beforeunload', leave);
  }, [dirty, receipt]);
  const uncertain = creationResultUnknown(error);
  return <main className="customer-page"><header className="customer-header"><img className="customer-brand" src="/brand.jpg" alt="午逅 Story" />{entry.data && <span>客服：{entry.data.ownerName}</span>}</header>
    {entry.isPending ? <Loading /> : !entry.data ? <section className="panel"><h1>暂时无法填写</h1><ErrorNotice error={entry.error} retry={() => void entry.refetch()} /></section> : receipt ? <section className="panel submission-success" role="status"><CheckCircle size={42} /><h1>已提交，待客服确认</h1><p>修改请联系接待客服。</p><p className="submission-number">填单编号：{receipt.submissionNo}</p><button type="button" className="secondary" onClick={() => { const next = newSubmissionDraft(); initial.current = next; setDraft(next); setReceipt(null); setError(null); pending.current = null; }}>再填一单</button></section> : <>
      <div className="customer-intro"><h1>填写预订信息</h1></div>
      <form ref={form} noValidate onSubmit={async event => {
        event.preventDefault(); if (writing.current) return;
        if (!uncertain || !pending.current) {
          const result = submissionRequest(draft); setErrors(result.errors);
          if (Object.keys(result.errors).length) { focusFormField(form.current, Object.keys(result.errors)[0]); return; }
          pending.current = { key: randomUUID(), content: result.content };
        }
        writing.current = true; setBusy(true); setError(null);
        try { setReceipt(await publicApi(`/public/order-entries/${encodeURIComponent(token)}/submissions`, { method: 'POST', body: pending.current.content, headers: { 'Idempotency-Key': pending.current.key } })); pending.current = null; }
        catch (failure) { setError(failure); } finally { writing.current = false; setBusy(false); }
      }}>
        <SubmissionFields draft={draft} onChange={value => { setDraft(value); setErrors({}); setError(null); }} errors={errors} busy={busy || uncertain} />
        <ErrorNotice error={error} />{uncertain && <p className="notice" role="status">结果未确认，输入已保留。请先向客服核对，再重试。</p>}
        {!!Object.keys(errors).length && <p className="notice error" role="alert">请检查标出的内容。</p>}
        <div className="create-submit"><p className="form-help">提交后待客服确认</p><button className="primary" disabled={busy || !entry.data}>{busy ? '正在提交…' : uncertain ? '重试提交' : '提交预订'}<ArrowRight /></button></div>
      </form></>}
  </main>;
}
