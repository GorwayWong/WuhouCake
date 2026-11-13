import { useEmployeeOptions } from './EmployeeSelect';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, DownloadSimple, QrCode } from '@phosphor-icons/react';
import { api, ApiError, creationResultUnknown, readQuery } from './api';
import { Empty, ErrorNotice, Loading, money, statusNames } from './ui';
import { EmployeeSelect } from './EmployeeSelect';
import { Select } from './Select';
import { SubmissionFields } from './SubmissionFields';
import { draftFromSubmission, submissionRequest, overdueSubmissionDate, searchSubmissionView, submissionListQuery } from './customerSubmission';
import type { EntryLink, SubmissionContent, SubmissionDetail, SubmissionDuplicate, SubmissionOrigin, SubmissionReview, SubmissionListView } from './customerSubmission';
import { brandedQr } from './brandedQr';
import { exactYuan } from './money';
import type { Account, Page } from './types';
import { businessDate, businessTime, time, today } from './dates';
import { synchronize } from './realtime';
import { focusFormField } from './formFocus';
import { firstProductFormError } from './productFormLayout';
import { hasPermissions, orderAccess } from './access';

export function canHandleSubmissions(account?: Account): boolean {
  return orderAccess(account).submissions;
}
function ContentSummary({ content, historical = false }: { content: SubmissionContent; historical?: boolean }) {
  const displayTime = historical ? (value: string) => time(value, true) : businessTime;
  const labels: Record<string, string> = { size: '尺寸（寸）', base: '内胚', filling: '夹心／口味', flavor: '奶油', message: '祝福语', requirements: '其他要求', specification: '规格' };
  return <div className="submission-summary"><p><strong>{content.phone}</strong>{content.memberPhone && ` · 会员 ${content.memberPhone}`}</p><p>取货时间：{displayTime(content.requestedReceiveAt)} · {content.fulfillmentType === 'PICKUP' ? '自提' : '配送'}</p>{content.address && <p>{content.address}</p>}
    <ul>{content.items.map((item, index) => <li key={index}><strong>{item.name} × {item.quantity}</strong><p className="product-spec-text">{Object.entries(item.attributes).filter(([, value]) => value).map(([key, value]) => `${labels[key] || key}：${value}`).join('；')}</p></li>)}</ul>
  </div>;
}
export function SubmissionHistory({ data }: { data: SubmissionDetail }) {
  const names: Record<string, string> = { SUBMITTED: '用户填写', REVIEWED: '员工核对', CONFIRMED: '确认接单', DELETED: '移出待确认列表' };
  return <section className="panel"><h2>填写与处理记录</h2><ol className="activity-feed">{data.activities.map(activity => <li key={activity.id}><span className="activity-dot" /><div>
    <div className="note-meta"><strong>{activity.actorName}</strong><span>{names[activity.type] || activity.type}</span><time>{time(activity.createdAt, true)}</time></div>
    {activity.type === 'CONFIRMED' && <p>业绩归属：{String(activity.details.creditedEmployeeName || '已记录')}</p>}
    {activity.type === 'CONFIRMED' && Boolean(activity.details.duplicateReview) && <details><summary>已核实为独立订单</summary><DuplicateRecords historical records={(activity.details.duplicateReview as { records: SubmissionDuplicate[] }).records} /></details>}
    {activity.type === 'REVIEWED' && <details><summary>查看更正前后内容</summary><div className="submission-log"><h3>更正前</h3><ReviewSummary value={activity.details.before} /><h3>更正后</h3><ReviewSummary value={activity.details.after} /></div></details>}
  </div></li>)}</ol></section>;
}
function ReviewSummary({ value }: { value: unknown }) {
  const review = value as (Partial<SubmissionReview> & { creditedEmployeeName?: string }) | null;
  return review?.content ? <><ContentSummary historical content={{ ...review.content, requestedReceiveAt: review.plannedHandoffAt || review.content.requestedReceiveAt }} />{review.plannedHandoffAt && Date.parse(review.plannedHandoffAt) !== Date.parse(review.content.requestedReceiveAt) && <p className="notice">历史原客户收货时间：{time(review.content.requestedReceiveAt, true)}；原到店取货时间：{time(review.plannedHandoffAt, true)}，请核对。</p>}<p>整单金额：{review.totalAmountCents == null ? '未填写' : `${exactYuan(review.totalAmountCents)} 元`}</p><p>出品时间：{review.plannedFinishAt ? time(review.plannedFinishAt, true) : '待定'}</p><p>业绩归属：{review.creditedEmployeeName || '未填写'}</p></> : <p>未填写</p>;
}
function DuplicateRecords({ records, historical = false }: { records: SubmissionDuplicate[]; historical?: boolean }) {
  return <ul className="duplicate-records">{records.map(record => <li key={`${record.kind}:${record.id}`}>
    <div className="note-meta"><strong>{record.kind === 'ORDER' ? `订单 #${record.orderNo}` : `填单 F${record.id}`}</strong><span>{record.kind === 'SUBMISSION' ? '待确认' : statusNames[record.status] || record.status}</span>{record.status === 'CANCELLED' && <span>历史参考</span>}</div>
    <p>{record.phone} · 取货 {record.requestedReceiveAt ? historical ? time(record.requestedReceiveAt, true) : businessTime(record.requestedReceiveAt) : `${historical ? record.requestedReceiveDate : businessDate(record.requestedReceiveDate)}（时刻未填写）`}</p>
    <p>{record.items.map(item => `${item.name} × ${item.quantity}`).join('、')} · 合计 {record.items.reduce((sum, item) => sum + item.quantity, 0)} 件</p>
    <p>金额：{money(record.totalAmountCents)} · 经办：{record.handledBy}</p>
    <a className="text-button" href={record.kind === 'ORDER' ? `#/orders/${record.id}` : `#/customer-submissions/${record.id}`} target="_blank" rel="noreferrer">查看{record.kind === 'ORDER' ? '订单' : '填单'}详情<ArrowRight /></a>
  </li>)}</ul>;
}
function EntryManager({ account, onWritingChange }: { account: Account; onWritingChange: (busy: boolean) => void }) {
  const client = useQueryClient(); const [owner, setOwner] = useState(account.accountId);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null); const [qrImage, setQrImage] = useState<{ url: string; owner: string; data: string } | null>(null);
  const [qrError, setQrError] = useState<unknown>(null); const [qrAttempt, setQrAttempt] = useState(0);
  const entry = useQuery({ queryKey: ['customer-entry', owner], queryFn: ({ signal }) => api<EntryLink | null>(`/customer-submissions/entry?ownerId=${owner}`, { signal }) });
  useEffect(() => {
    let alive = true; setQrImage(null); setQrError(null);
    const url = entry.data?.url;
    if (url) void brandedQr(url).then(data => { if (alive) setQrImage({ url, owner, data }); })
      .catch(failure => { if (alive) setQrError(failure); });
    return () => { alive = false; };
  }, [entry.data?.url, owner, qrAttempt]);
  const image = !busy && qrImage?.owner === owner && qrImage.url === entry.data?.url ? qrImage.data : '';
  const change = async (action: string) => {
    if (busy) return;
    if (action === 'RESET' && !window.confirm('重置二维码？已发出的二维码将失效。')) return;
    setBusy(true); onWritingChange(true); setError(null);
    if (action === 'RESET') setQrImage(null);
    try { const result = await api<EntryLink>(`/customer-submissions/entry?ownerId=${owner}`, { method: 'POST', body: { action } }); client.setQueryData(['customer-entry', owner], result); }
    catch (failure) { setError(failure); await entry.refetch(); } finally { setBusy(false); onWritingChange(false); }
  };
  return <section className="panel entry-manager"><div className="section-heading"><h2><QrCode />填单二维码</h2></div>
    {hasPermissions(account, 'CUSTOMER_ENTRY_MANAGE_ALL') && <label>管理员工二维码<EmployeeSelect disabled={busy} value={owner} emptyLabel="请选择员工" onChange={value => { if (value) { setOwner(value); setError(null); } }} /></label>}
    <ErrorNotice error={entry.error || error} retry={() => { void entry.refetch(); setQrAttempt(value => value + 1); }} />
    {Boolean(qrError) && <p className="notice" role="alert">二维码生成失败。<button className="text-button" onClick={() => setQrAttempt(value => value + 1)}>重新生成图片</button></p>}
    {entry.isPending ? <Loading /> : entry.data ? <div className="entry-content"><div>{image && <img className="entry-qr" src={image} alt={`${entry.data.ownerName}的客户填单二维码`} width={240} height={240} />}</div><div><h3>{entry.data.ownerName} · {entry.data.enabled ? '接收填单中' : '已停用'}</h3><a className="entry-url" href={entry.data.url} target="_blank" rel="noreferrer">打开客户填写页面<ArrowRight /></a><div className="actions">
      {image && <a className="secondary" href={image} download={`午逅填单-${entry.data.ownerName}.png`}><DownloadSimple />下载二维码</a>}
      <button className="secondary" type="button" disabled={busy} onClick={() => void change(entry.data!.enabled ? 'DISABLE' : 'ENABLE')}>{entry.data.enabled ? '停用' : '重新启用'}</button><button className="text-button danger" type="button" disabled={busy} onClick={() => void change('RESET')}>重置二维码</button>
    </div></div></div> : <>{owner === account.accountId ? <button className="secondary" disabled={busy} onClick={() => void change('CREATE')}>{busy ? '正在生成…' : '生成我的二维码'}</button> : <p className="muted">该员工尚未生成二维码，请由本人先生成。</p>}</>}
  </section>;
}
const submissionListViews = new Map<string, SubmissionListView>();
export function CustomerSubmissions({ account, onWritingChange }: { account: Account; onWritingChange: (busy: boolean) => void }) {
  const client = useQueryClient();
  const [view, setView] = useState<SubmissionListView>(() => submissionListViews.get(account.accountId) || { mine: false, status: 'PENDING', keyword: '', page: 1 });
  const [searchText, setSearchText] = useState(view.keyword);
  const { mine, status, keyword, page } = view;
  const changeView = (next: SubmissionListView) => { setView(next); submissionListViews.set(account.accountId, next); };
  const params = submissionListQuery(view);
  const query = useQuery({ queryKey: ['customer-submissions', params], gcTime: 0, staleTime: 0, queryFn: ({ signal }) => readQuery<Page<SubmissionDetail>>(`/customer-submissions?${params}`, signal), refetchInterval: 15000, enabled: canHandleSubmissions(account) });
  const actualPage = query.data?.page;
  const canCorrectPage = query.isFetchedAfterMount && query.isSuccess && !query.isFetching;
  const result = actualPage === page ? query.data : undefined;
  useEffect(() => {
    if (canCorrectPage && actualPage != null && actualPage !== page) {
      const next = { mine, status, keyword, page: actualPage };
      setView(next); submissionListViews.set(account.accountId, next);
    }
  }, [actualPage, canCorrectPage, page, mine, status, keyword, account.accountId]);
  if (!canHandleSubmissions(account)) return <Empty>前台和管理人员可以处理客户填单。</Empty>;
  return <div className="management-page"><div className="page-heading"><div><h1>客户填单</h1></div></div>
    <section className="panel"><form className="submission-search" onSubmit={event => { event.preventDefault(); const next = searchSubmissionView(view, searchText); changeView(next); if (submissionListQuery(next) === params) void query.refetch(); }}>
      <label htmlFor="submission-search">手机号／填单编号<input id="submission-search" type="search" enterKeyHint="search" value={searchText} maxLength={100} placeholder="输入手机号或填单编号" onChange={event => setSearchText(event.target.value)} /></label>
      <button type="submit" className="primary">搜索</button><button type="button" className="secondary" disabled={!searchText && !keyword} onClick={() => { setSearchText(''); changeView(searchSubmissionView(view, '')); }}>清除</button>
    </form><div className="submission-filters"><label>查看范围<Select label="查看范围" value={mine ? 'mine' : 'all'} onChange={value => { changeView({ ...view, mine: value === 'mine', page: 1 }); }}><option value="mine">我的二维码收到的</option><option value="all">全部客服的</option></Select></label><label>处理状态<Select label="处理状态" value={status} onChange={value => { changeView({ ...view, status: value as SubmissionListView['status'], page: 1 }); }}><option value="ALL">全部</option><option value="PENDING">待确认</option><option value="CONFIRMED">已确认</option></Select></label><button className="secondary" disabled={query.isFetching} onClick={() => void client.invalidateQueries({ queryKey: ['customer-submissions'] })}>刷新列表</button></div>
      <ErrorNotice error={query.error} retry={() => void query.refetch()} />{query.isPending || (actualPage !== page && !query.isError) ? <Loading /> : result?.total === 0 ? <Empty>{keyword ? '未找到匹配的填单。' : `暂无${mine ? '我的' : ''}${status === 'ALL' ? '' : status === 'PENDING' ? '待确认' : '已确认'}填单。`}</Empty> : !result ? null : !result.items.length ? <Empty><span>当前页暂无记录，请刷新</span><button className="text-button" onClick={() => { if (page === 1) void query.refetch(); else changeView({ ...view, page: 1 }); }}>返回第一页</button></Empty> : <ul className="submission-list">{result.items.map(({ submission: s, duplicates }) => { const overdueDate = overdueSubmissionDate(s, today()); return <li key={s.id}><div><div className="note-meta"><strong>{s.original.phone}</strong><span>{s.ownerName}</span><span className="submission-state">{s.status === 'CONFIRMED' ? '已确认' : '待确认'}</span><time>{time(s.createdAt, true)}</time></div><p className="submission-reference">填单编号：F{s.id}</p>{s.reviewed?.content.phone && s.reviewed.content.phone !== s.original.phone && <p className="muted">核对手机号：{s.reviewed.content.phone}</p>}<p>{s.original.items.map(item => `${item.name} × ${item.quantity}`).join('、')}</p><p className="muted">原始客户填写取货 {businessTime(s.original.requestedReceiveAt)} · {s.original.fulfillmentType === 'PICKUP' ? '自提' : '配送'}</p>{overdueDate && <p className="submission-warning">取货日期已过（{businessDate(overdueDate)}），待核对</p>}{duplicates.some(record => record.requiresAcknowledgement) && <span className="submission-warning">有疑似重复记录，请核对。</span>}</div><a className="secondary" href={`#/customer-submissions/${s.id}`}>{s.status === 'CONFIRMED' ? '查看记录' : '核对填单'}<ArrowRight /></a></li>; })}</ul>}
      {result && (result.total > 20 || page > 1) && <div className="pagination"><button className="secondary" disabled={page === 1} onClick={() => changeView({ ...view, page: page - 1 })}>上一页</button><span>第 {page} 页 · {result.total} 份</span><button className="secondary" disabled={page * 20 >= result.total} onClick={() => changeView({ ...view, page: page + 1 })}>下一页</button></div>}
    </section><details className="panel entry-settings"><summary>填单二维码管理</summary><EntryManager account={account} onWritingChange={onWritingChange} /></details>
  </div>;
}
export function CustomerSubmissionDetail({ id, onDirtyChange, onWritingChange }: { id: string; onDirtyChange: (dirty: boolean) => void; onWritingChange: (busy: boolean) => void }) {
  const query = useQuery({ queryKey: ['customer-submission', id], queryFn: ({ signal }) => readQuery<SubmissionDetail>(`/customer-submissions/${id}`, signal), refetchInterval: 15000 });
  return <><a className="back-link" href="#/customer-submissions"><ArrowLeft />返回客户填单</a><ErrorNotice error={query.error} retry={() => void query.refetch()} />{query.data ? <SubmissionEditor key={id} initial={query.data} latest={query.data} onDirtyChange={onDirtyChange} onWritingChange={onWritingChange} /> : query.isPending && <Loading />}</>;
}
function SubmissionEditor({ initial, latest, onDirtyChange, onWritingChange }: { initial: SubmissionDetail; latest: SubmissionDetail; onDirtyChange: (dirty: boolean) => void; onWritingChange: (busy: boolean) => void }) {
  const client = useQueryClient(); const [baseline, setBaseline] = useState(initial); const [draft, setDraft] = useState(() => draftFromSubmission(initial.submission));
  const [savedDraft, setSavedDraft] = useState(() => JSON.stringify(draft)); const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null); const [message, setMessage] = useState('');
  const [activeAction, setActiveAction] = useState<'save' | 'confirm' | 'delete' | null>(null);
  const busy = activeAction !== null;
  const writing = useRef(false); const form = useRef<HTMLFormElement>(null); const mounted = useRef(true);
  const [acknowledge, setAcknowledge] = useState<string | null>(null);
  useEffect(() => { setAcknowledge(null); }, [latest.duplicateCheckToken]);
  const dirty = JSON.stringify(draft) !== savedDraft, submission = baseline.submission;
  const employees = useEmployeeOptions(false, submission.status === 'PENDING');
  const [employeeChosen, setEmployeeChosen] = useState(false);
  const ownerEligible = employees.data?.some(employee => employee.accountId === submission.ownerId && employee.status !== 'ARCHIVED');
  const defaultEmployee = !employeeChosen && ownerEligible ? submission.ownerId : '';
  const effectiveDraft = { ...draft, creditedEmployeeId: draft.creditedEmployeeId || defaultEmployee };
  const stale = latest.submission.version !== submission.version;
  const itemIdConflict = error instanceof ApiError && error.code === 'SUBMISSION_ITEM_ID_CONFLICT';
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; onWritingChange(false); };
  }, [onWritingChange]);
  const accept = (data: SubmissionDetail) => {
    const next = draftFromSubmission(data.submission); setBaseline(data); setDraft(next); setSavedDraft(JSON.stringify(next)); setEmployeeChosen(false); setErrors({});
    client.setQueryData(['customer-submission', submission.id], data); setAcknowledge(null);
  };
  const act = async (action: 'save' | 'confirm' | 'delete') => {
    if (writing.current) return;
    if (action === 'delete' && !window.confirm('将此填单移出待确认列表？原始内容和删除记录仍会保留。')) return;
    let body: unknown = { expectedVersion: submission.version };
    const needsSave = action === 'save' || action === 'confirm' && (dirty || !submission.reviewed || Boolean(defaultEmployee && !submission.reviewed.creditedEmployeeId));
    if (needsSave || action === 'confirm') {
      const result = submissionRequest(effectiveDraft, true);
      if (action === 'confirm') {
        if (result.review.totalAmountCents == null) result.errors.totalAmount ||= '请填写整单约定金额。';
        if (!result.review.creditedEmployeeId) result.errors.creditedEmployeeId = '请选择业绩归属员工。';
      }
      setErrors(result.errors);
      if (Object.keys(result.errors).length) { setError(null); focusFormField(form.current, firstProductFormError(result.errors, draft.items)!); return; }
      body = { expectedVersion: submission.version, review: result.review };
    }
    writing.current = true; setActiveAction(action); onWritingChange(true); setError(null); setMessage('');
    try {
      const path = `/customer-submissions/${submission.id}`;
      let data: SubmissionDetail;
      if (action === 'confirm') {
        const saved = needsSave ? await api<SubmissionDetail>(path, { method: 'PATCH', body }) : null;
        if (saved) {
          if (!mounted.current) return;
          accept(saved);
          await client.invalidateQueries({ queryKey: ['customer-submissions'] });
          if (!mounted.current) return;
          if (saved.duplicates.some(record => record.requiresAcknowledgement)) {
            setMessage('已暂存。请核实疑似重复单后继续接单。');
            return;
          }
        }
        data = await api<SubmissionDetail>(path + '/confirm', { method: 'POST', body: {
          expectedVersion: saved?.submission.version ?? submission.version,
          duplicateCheckToken: saved ? null : acknowledge,
        } });
      } else {
        data = await api<SubmissionDetail>(path, { method: action === 'save' ? 'PATCH' : 'DELETE', body });
      }
      await client.invalidateQueries({ queryKey: ['customer-submissions'] });
      if (!mounted.current) return;
      if (action === 'delete') { onDirtyChange(false); window.location.hash = '#/customer-submissions'; }
      else { accept(data); setMessage(action === 'confirm' ? '已确认并生成正式订单。' : '核对结果已保存。'); if (action === 'confirm') await synchronize(client, data.submission.orderId!); }
    } catch (failure) {
      if (mounted.current) {
        setAcknowledge(null); setError(failure); await client.invalidateQueries({ queryKey: ['customer-submission', submission.id] });
        const refreshed = client.getQueryData<SubmissionDetail>(['customer-submission', submission.id]);
        if (mounted.current && refreshed && (action === 'confirm' && refreshed.submission.status === 'CONFIRMED' || action === 'delete' && refreshed.submission.status === 'DELETED')) {
          accept(refreshed); setError(null);
        }
      }
    }
    finally { writing.current = false; if (mounted.current) { setActiveAction(null); onWritingChange(false); } }
  };
  const reviewed = submission.reviewed;
  const duplicates = latest.duplicates;
  const requiresAcknowledgement = duplicates.some(record => record.requiresAcknowledgement);
  const editable = submission.status === 'PENDING' && latest.submission.status === 'PENDING';
  return <div className="management-page"><div className="page-heading"><div><h1>{submission.status === 'CONFIRMED' ? '已确认填单' : submission.status === 'DELETED' ? '已删除填单' : '核对客户填单'}</h1><p className="muted">来源：用户填写 · 发码客服 {submission.ownerName} · {time(submission.createdAt, true)}</p></div></div>
    {(stale || itemIdConflict) && <div className="notice" role="status">{itemIdConflict ? '无法安全关联历史报价。输入已保留，请读取最新结果后核对商品。' : '填单已更新，输入已保留。请核对最新内容。'}<button className="text-button" disabled={busy} onClick={() => { if (!dirty || window.confirm('放弃未保存输入，读取最新核对结果？')) { accept(latest); setError(null); } }}>读取最新结果</button></div>}
    <section className="panel"><h2>客户原始填写</h2><ContentSummary content={submission.original} /></section>
    {duplicates.length > 0 && editable && <section className="panel submission-warning" aria-label="疑似重复记录"><h2>疑似重复记录（{duplicates.length}）</h2><p>请核对以下同电话、同取货日的记录是否重复。</p><DuplicateRecords records={duplicates} />{requiresAcknowledgement && <label className="check-label"><input type="checkbox" checked={acknowledge === latest.duplicateCheckToken} disabled={busy || stale || dirty || creationResultUnknown(error)} onChange={e => setAcknowledge(e.target.checked ? latest.duplicateCheckToken : null)} />已核实，这是独立订单，继续接单。</label>}</section>}
    {submission.orderId && <a className="primary" href={`#/orders/${submission.orderId}`}>查看正式订单<ArrowRight /></a>}
    {editable && <form ref={form} noValidate onSubmit={event => { event.preventDefault(); void act('save'); }}><h2>客服核对结果</h2>{reviewed?.plannedHandoffAt && Date.parse(reviewed.plannedHandoffAt) !== Date.parse(reviewed.content.requestedReceiveAt) && <p className="notice">历史时间不同，请核对：原到店取货时间 {businessTime(reviewed.plannedHandoffAt)}；原客户收货时间 {businessTime(reviewed.content.requestedReceiveAt)}。修改取货时间后两项将同步。</p>}<SubmissionFields staff draft={effectiveDraft} onChange={value => {
      const changedEmployee = value.creditedEmployeeId !== effectiveDraft.creditedEmployeeId;
      if (changedEmployee) setEmployeeChosen(true);
      setDraft({ ...value, creditedEmployeeId: changedEmployee ? value.creditedEmployeeId : draft.creditedEmployeeId }); setErrors({}); setError(null); setMessage(''); }} errors={errors} busy={busy || stale || creationResultUnknown(error)} />
      <ErrorNotice error={error} />{message && <p className="notice success" role="status">{message}</p>}{creationResultUnknown(error) && <p className="notice">结果未确认，输入已保留。请先核对最新结果，再决定是否重试。<button className="text-button" type="button" disabled={busy} onClick={() => void client.invalidateQueries({ queryKey: ['customer-submission', submission.id] }, { throwOnError: true }).then(() => {
        const refreshed = client.getQueryData<SubmissionDetail>(['customer-submission', submission.id]);
        if (!mounted.current || !refreshed) return;
        if (refreshed.submission.status !== 'PENDING') accept(refreshed);
        setError(null);
      }).catch(() => {})}>核对最新结果</button></p>}
      <div className="create-submit"><button className="text-button danger" type="button" disabled={busy || stale} onClick={() => void act('delete')}>删除未确认填单</button><div className="actions"><button className="secondary" disabled={busy || stale || creationResultUnknown(error)}>{activeAction === 'save' ? '正在暂存…' : '暂存核对结果'}</button><button type="button" className="primary" disabled={busy || stale || creationResultUnknown(error) || Boolean(!dirty && reviewed && requiresAcknowledgement && acknowledge !== latest.duplicateCheckToken)} onClick={() => void act('confirm')}>{activeAction === 'confirm' ? '正在确认…' : '确认接单'}<ArrowRight /></button></div></div>
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
