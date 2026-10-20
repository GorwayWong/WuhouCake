import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, DownloadSimple, QrCode } from '@phosphor-icons/react';
import { api, creationResultUnknown } from './api';
import { Empty, ErrorNotice, Loading } from './ui';
import { EmployeeSelect } from './EmployeeSelect';
import { Select } from './Select';
import { SubmissionFields } from './SubmissionFields';
import { draftFromSubmission, submissionRequest } from './customerSubmission';
import type { EntryLink, SubmissionContent, SubmissionDetail, SubmissionOrigin, SubmissionReview } from './customerSubmission';
import type { Account, Page } from './types';
import { time } from './dates';
import { synchronize } from './realtime';
import { focusFormField } from './formFocus';

export function canHandleSubmissions(account?: Account): boolean {
  return Boolean(account?.jobRoles.some(role => role === 'FRONT_DESK' || role === 'MANAGER'));
}
function ContentSummary({ content }: { content: SubmissionContent }) {
  const labels: Record<string, string> = { size: '尺寸（寸）', base: '内胚', filling: '夹心／口味', flavor: '奶油', message: '祝福语', requirements: '其他要求' };
  return <div className="submission-summary"><p><strong>{content.phone}</strong>{content.memberPhone && ` · 会员 ${content.memberPhone}`}</p><p>{content.fulfillmentType === 'PICKUP' ? '自提' : '配送'} · {time(content.requestedReceiveAt, true)}</p>{content.address && <p>{content.address}</p>}
    <ul>{content.items.map((item, index) => <li key={index}><strong>{item.name} × {item.quantity}</strong><p>{Object.entries(item.attributes).filter(([, value]) => value).map(([key, value]) => `${labels[key] || key}：${value}`).join('；')}</p></li>)}</ul>
  </div>;
}
export function SubmissionHistory({ data }: { data: SubmissionDetail }) {
  const names: Record<string, string> = { SUBMITTED: '用户填写', REVIEWED: '员工核对', CONFIRMED: '确认接单', DELETED: '移出待确认列表' };
  return <section className="panel"><h2>填写与处理记录</h2><ol className="activity-feed">{data.activities.map(activity => <li key={activity.id}><span className="activity-dot" /><div>
    <div className="note-meta"><strong>{activity.actorName}</strong><span>{names[activity.type] || activity.type}</span><time>{time(activity.createdAt, true)}</time></div>
    {activity.type === 'SUBMITTED' && <p>来源：用户填写，联系电话未经验证。</p>}
    {activity.type === 'CONFIRMED' && <p>业绩归属：{String(activity.details.creditedEmployeeName || '已记录')}</p>}
    {activity.type === 'REVIEWED' && <details><summary>查看更正前后内容</summary><div className="submission-log"><h3>更正前</h3><ReviewSummary value={activity.details.before} /><h3>更正后</h3><ReviewSummary value={activity.details.after} /></div></details>}
    {activity.type === 'DELETED' && <p>填单和原始内容保留用于追溯。</p>}
  </div></li>)}</ol></section>;
}
function ReviewSummary({ value }: { value: unknown }) {
  const review = value as (Partial<SubmissionReview> & { creditedEmployeeName?: string }) | null;
  return review?.content ? <><ContentSummary content={review.content} /><p>整单金额：{review.totalAmountCents == null ? '未填写' : `${(review.totalAmountCents / 100).toFixed(2)} 元`}</p><p>内部交接时间：{time(review.plannedHandoffAt || null, true)}</p><p>业绩归属：{review.creditedEmployeeName || '未填写'}</p></> : <p>未填写</p>;
}
function EntryManager({ account, onWritingChange }: { account: Account; onWritingChange: (busy: boolean) => void }) {
  const client = useQueryClient(); const [owner, setOwner] = useState(account.accountId);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null); const [image, setImage] = useState('');
  const entry = useQuery({ queryKey: ['customer-entry', owner], queryFn: ({ signal }) => api<EntryLink | null>(`/customer-submissions/entry?ownerId=${owner}`, { signal }) });
  useEffect(() => {
    let alive = true; setImage('');
    if (entry.data?.url) void import('qrcode').then(QRCode => QRCode.toDataURL(entry.data!.url, { width: 320, margin: 4, errorCorrectionLevel: 'M' }))
      .then(result => { if (alive) setImage(result); }).catch(failure => { if (alive) setError(failure); });
    return () => { alive = false; };
  }, [entry.data?.url]);
  const change = async (action: string) => {
    if (busy) return;
    if (action === 'RESET' && !window.confirm('重置后，已发送的旧二维码将立即失效，当前启用或停用状态保持不变。确定重置吗？')) return;
    setBusy(true); onWritingChange(true); setError(null);
    try { const result = await api<EntryLink>(`/customer-submissions/entry?ownerId=${owner}`, { method: 'POST', body: { action } }); client.setQueryData(['customer-entry', owner], result); }
    catch (failure) { setError(failure); await entry.refetch(); } finally { setBusy(false); onWritingChange(false); }
  };
  return <section className="panel entry-manager"><div className="section-heading"><h2><QrCode />固定填单二维码</h2><span className="muted">二维码归属不等于业绩归属</span></div>
    {account.jobRoles.includes('MANAGER') && <label>管理员工二维码<EmployeeSelect disabled={busy} value={owner} emptyLabel="请选择员工" onChange={value => { if (value) { setOwner(value); setError(null); } }} /></label>}
    <ErrorNotice error={entry.error || error} retry={() => void entry.refetch()} />
    {entry.isPending ? <Loading /> : entry.data ? <div className="entry-content"><div>{image && <img className="entry-qr" src={image} alt={`${entry.data.ownerName}的客户填单二维码`} width={240} height={240} />}</div><div><h3>{entry.data.ownerName} · {entry.data.enabled ? '接收填单中' : '已停用'}</h3><p className="form-help">可长期使用。重置仅替换二维码，保留启停状态；停用或员工离职后不能接收新填单。</p><a className="entry-url" href={entry.data.url} target="_blank" rel="noreferrer">打开客户填写页面<ArrowRight /></a><div className="actions">
      {image && <a className="secondary" href={image} download={`午逅填单-${entry.data.ownerName}.png`}><DownloadSimple />下载二维码</a>}
      <button className="secondary" type="button" disabled={busy} onClick={() => void change(entry.data!.enabled ? 'DISABLE' : 'ENABLE')}>{entry.data.enabled ? '停用' : '重新启用'}</button><button className="text-button danger" type="button" disabled={busy} onClick={() => void change('RESET')}>重置二维码</button>
    </div></div></div> : <><p>生成固定二维码，将填写页面发给客户。</p>{owner === account.accountId ? <button className="secondary" disabled={busy} onClick={() => void change('CREATE')}>{busy ? '正在生成…' : '生成我的二维码'}</button> : <p className="muted">该员工尚未生成二维码，请由本人先生成。</p>}</>}
  </section>;
}
export function CustomerSubmissions({ account, onWritingChange }: { account: Account; onWritingChange: (busy: boolean) => void }) {
  const [mine, setMine] = useState(true); const [status, setStatus] = useState('PENDING'); const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: ['customer-submissions', mine, status, page], queryFn: ({ signal }) => api<Page<SubmissionDetail>>(`/customer-submissions?mine=${mine}&status=${status}&page=${page}`, { signal }), refetchInterval: 15000, enabled: canHandleSubmissions(account) });
  if (!canHandleSubmissions(account)) return <Empty>前台和管理人员可以处理客户填单。</Empty>;
  return <div className="management-page"><div className="page-heading"><div><h1>客户填单</h1><p className="muted">先核对需求，再确认接单。待确认填单不进入制作和经营统计。</p></div></div><EntryManager account={account} onWritingChange={onWritingChange} />
    <section className="panel"><div className="submission-filters"><label>查看范围<Select label="查看范围" value={mine ? 'mine' : 'all'} onChange={value => { setMine(value === 'mine'); setPage(1); }}><option value="mine">我的二维码收到的</option><option value="all">全部客服的</option></Select></label><label>处理状态<Select label="处理状态" value={status} onChange={value => { setStatus(value); setPage(1); }}><option value="PENDING">待确认</option><option value="CONFIRMED">已确认</option></Select></label><button className="secondary" disabled={query.isFetching} onClick={() => void query.refetch()}>刷新列表</button></div>
      <ErrorNotice error={query.error} retry={() => void query.refetch()} />{query.isPending ? <Loading /> : !query.data?.items.length ? <Empty>暂无{mine ? '我的' : ''}{status === 'PENDING' ? '待确认' : '已确认'}填单。客户提交后会出现在这里。</Empty> : <ul className="submission-list">{query.data.items.map(({ submission: s, newerSubmissionId }) => <li key={s.id}><div><div className="note-meta"><strong>{s.original.phone}</strong><span>{s.ownerName}</span><time>{time(s.createdAt, true)}</time></div><p>{s.original.items.map(item => `${item.name} × ${item.quantity}`).join('、')}</p><p className="muted">原始期望收货 {time(s.original.requestedReceiveAt, true)} · {s.original.fulfillmentType === 'PICKUP' ? '自提' : '配送'}</p>{newerSubmissionId && <span className="submission-warning">同手机号、同收货日期有更新填单，请核对。</span>}</div><a className="secondary" href={`#/customer-submissions/${s.id}`}>{s.status === 'CONFIRMED' ? '查看记录' : '核对填单'}<ArrowRight /></a></li>)}</ul>}
      {query.data && query.data.total > 20 && <div className="pagination"><button className="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} 页 · {query.data.total} 份</span><button className="secondary" disabled={page * 20 >= query.data.total} onClick={() => setPage(page + 1)}>下一页</button></div>}
    </section>
  </div>;
}
export function CustomerSubmissionDetail({ id, onDirtyChange, onWritingChange }: { id: string; onDirtyChange: (dirty: boolean) => void; onWritingChange: (busy: boolean) => void }) {
  const query = useQuery({ queryKey: ['customer-submission', id], queryFn: ({ signal }) => api<SubmissionDetail>(`/customer-submissions/${id}`, { signal }), refetchInterval: 15000 });
  return <><a className="back-link" href="#/customer-submissions"><ArrowLeft />返回客户填单</a><ErrorNotice error={query.error} retry={() => void query.refetch()} />{query.data ? <SubmissionEditor key={id} initial={query.data} latest={query.data} onDirtyChange={onDirtyChange} onWritingChange={onWritingChange} /> : query.isPending && <Loading />}</>;
}
function SubmissionEditor({ initial, latest, onDirtyChange, onWritingChange }: { initial: SubmissionDetail; latest: SubmissionDetail; onDirtyChange: (dirty: boolean) => void; onWritingChange: (busy: boolean) => void }) {
  const client = useQueryClient(); const [baseline, setBaseline] = useState(initial); const [draft, setDraft] = useState(() => draftFromSubmission(initial.submission));
  const [savedDraft, setSavedDraft] = useState(() => JSON.stringify(draft)); const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const writing = useRef(false); const form = useRef<HTMLFormElement>(null); const mounted = useRef(true);
  const [acknowledge, setAcknowledge] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== savedDraft, submission = baseline.submission;
  const stale = latest.submission.version !== submission.version;
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; onWritingChange(false); };
  }, [onWritingChange]);
  const accept = (data: SubmissionDetail) => {
    const next = draftFromSubmission(data.submission); setBaseline(data); setDraft(next); setSavedDraft(JSON.stringify(next)); setErrors({});
    client.setQueryData(['customer-submission', submission.id], data); setAcknowledge(null);
  };
  const act = async (action: 'save' | 'confirm' | 'delete') => {
    if (writing.current) return;
    if (action === 'delete' && !window.confirm('将此填单移出待确认列表？原始内容和删除记录仍会保留。')) return;
    let body: unknown = { expectedVersion: submission.version };
    if (action === 'save') {
      const result = submissionRequest(draft, true); setErrors(result.errors);
      if (Object.keys(result.errors).length) { focusFormField(form.current, Object.keys(result.errors)[0]); return; }
      body = { expectedVersion: submission.version, review: result.review };
    } else if (action === 'confirm') body = { expectedVersion: submission.version, acknowledgedNewerSubmissionId: acknowledge };
    writing.current = true; setBusy(true); onWritingChange(true); setError(null); setMessage('');
    try {
      const data = await api<SubmissionDetail>(`/customer-submissions/${submission.id}${action === 'confirm' ? '/confirm' : ''}`, { method: action === 'save' ? 'PATCH' : action === 'delete' ? 'DELETE' : 'POST', body });
      await client.invalidateQueries({ queryKey: ['customer-submissions'] });
      if (!mounted.current) return;
      if (action === 'delete') { onDirtyChange(false); window.location.hash = '#/customer-submissions'; }
      else { accept(data); setMessage(action === 'confirm' ? '已确认并生成正式订单。' : '核对结果已保存。'); if (action === 'confirm') await synchronize(client, data.submission.orderId!); }
    } catch (failure) {
      if (mounted.current) {
        setError(failure); await client.invalidateQueries({ queryKey: ['customer-submission', submission.id] });
        const refreshed = client.getQueryData<SubmissionDetail>(['customer-submission', submission.id]);
        if (mounted.current && refreshed && (action === 'confirm' && refreshed.submission.status === 'CONFIRMED' || action === 'delete' && refreshed.submission.status === 'DELETED')) {
          accept(refreshed); setError(null);
        }
      }
    }
    finally { writing.current = false; if (mounted.current) { setBusy(false); onWritingChange(false); } }
  };
  const reviewed = submission.reviewed;
  const ready = reviewed && reviewed.totalAmountCents != null && reviewed.creditedEmployeeId && reviewed.plannedHandoffAt;
  const newer = latest.newerSubmissionId;
  const editable = submission.status === 'PENDING' && latest.submission.status === 'PENDING';
  return <div className="management-page"><div className="page-heading"><div><h1>{submission.status === 'CONFIRMED' ? '已确认填单' : submission.status === 'DELETED' ? '已删除填单' : '核对客户填单'}</h1><p className="muted">来源：用户填写 · 发码客服 {submission.ownerName} · {time(submission.createdAt, true)}</p></div></div>
    {stale && <div className="notice" role="status">同事已更新此填单，请先核对最新记录。未保存输入仍保留。<button className="text-button" disabled={busy} onClick={() => { if (!dirty || window.confirm('放弃未保存输入，读取最新核对结果？')) accept(latest); }}>读取最新结果</button></div>}
    <section className="panel"><h2>客户原始填写</h2><ContentSummary content={submission.original} /></section>
    {newer && editable && <div className="notice submission-warning"><p>同手机号、同收货日期有更新的填单。请核实两份是否均有效。</p><a className="text-button" href={`#/customer-submissions/${newer}`}>查看更新填单</a><label className="check-label"><input type="checkbox" checked={acknowledge === newer} disabled={busy} onChange={e => setAcknowledge(e.target.checked ? newer : null)} />已核实，仍需确认这一份</label></div>}
    {submission.orderId && <a className="primary" href={`#/orders/${submission.orderId}`}>查看正式订单<ArrowRight /></a>}
    {editable && <form ref={form} noValidate onSubmit={event => { event.preventDefault(); void act('save'); }}><h2>客服核对结果</h2><SubmissionFields staff draft={draft} onChange={value => { setDraft(value); setErrors({}); setError(null); setMessage(''); }} errors={errors} busy={busy || stale || creationResultUnknown(error)} />
      <ErrorNotice error={error} />{message && <p className="notice success" role="status">{message}</p>}{creationResultUnknown(error) && <p className="notice">操作结果暂未确认。请读取最新结果核对，避免再次修改未确认的输入。<button className="text-button" type="button" disabled={busy} onClick={() => { accept(latest); setError(null); }}>读取最新结果</button></p>}
      <div className="create-submit"><button className="text-button danger" type="button" disabled={busy || stale} onClick={() => void act('delete')}>删除未确认填单</button><div className="actions"><button className="secondary" disabled={busy || stale || creationResultUnknown(error)}>{busy ? '处理中…' : '保存核对结果'}</button><button type="button" className="primary" disabled={busy || stale || dirty || !ready || Boolean(newer && acknowledge !== newer)} onClick={() => void act('confirm')}>确认接单<ArrowRight /></button></div></div><p className="form-help">先保存核对结果，再确认接单。金额、业绩归属与交接时间均必填。</p>
    </form>}
    {!editable && Boolean(error) && <ErrorNotice error={error} />}
    <SubmissionHistory data={latest} />
  </div>;
}
export function CustomerOrderOrigin({ orderId }: { orderId: string }) {
  const origin = useQuery({ queryKey: ['customer-origin', orderId], queryFn: ({ signal }) => api<SubmissionOrigin | null>(`/orders/${orderId}/customer-origin`, { signal }) });
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => api<Account>('/me', { signal }) });
  if (origin.error) return <ErrorNotice error={origin.error} retry={() => void origin.refetch()} />;
  return origin.data ? <div className="notice customer-origin"><span>来源：用户填写 · 发码客服 {origin.data.entryOwnerName}</span>{canHandleSubmissions(me.data) && <a className="text-button" href={`#/customer-submissions/${origin.data.submissionId}`}>查看原始填写与处理记录<ArrowRight /></a>}</div> : null;
}
