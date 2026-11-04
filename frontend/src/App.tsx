import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CalendarBlank, LockKey, SignOut, UserCircle, WifiHigh, WifiSlash } from '@phosphor-icons/react';
import { api, creationResultUnknown, forgetSession, refresh, session } from './api';
import type { Account, CreateOrderRequest, Detail } from './types';
import { collectUpdate, connectOrders, synchronize } from './realtime';
import type { Connection, OrderUpdate } from './realtime';
import { OrderUpdates } from './OrderUpdates';
import { today } from './dates';
import { orderAccess } from './access';
import { calendarHref, defaultCalendarView, readCalendarView } from './calendarView';
import type { CalendarView, CreatedOrderFocus } from './calendarView';
import { allCalendarFilters } from './calendarFilters';
import { Brand, ErrorNotice, Loading } from './ui';
import { PaymentOrders } from './PaymentOrders';
import { readPaymentList } from './paymentListRoute';
import { Calendar } from './Calendar';
import { OrderDetail, OrderHistory } from './OrderDetail';
import { workspaceRoute } from './routes';
import type { ManagementView } from './management';
import type { ReactNode } from 'react';
import { OrderCreate } from './OrderCreate';
import type { OrderDraft } from './orderForm';
import { hasDraftContent } from './orderDraftStorage';
import type { DraftEditor, OrderDraftRecord } from './orderDraftStorage';
import { useOrderDraft } from './useOrderDraft';
import { OrderDraftRecovery } from './OrderDraftRecovery';
import { AdminOrders } from './AdminOrders';
import { EmployeeAdmin } from './EmployeeAdmin';
import { OrderPackageAdmin } from './OrderPackageAdmin';
import { newPasswordError } from './passwordForm';
import { CustomerSubmissions, CustomerSubmissionDetail, canHandleSubmissions } from './CustomerSubmissions';

const pendingCreationError = new Error('创建结果尚未确认');

function Login({ changePassword = false, onAccount, onLogout }: { changePassword?: boolean; onAccount: (accountId: string) => void; onLogout: () => Promise<boolean> }) {
  const [employee, setEmployee] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [validation, setValidation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState('');
  const profile = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => api<Account>('/me', { signal }), enabled: changePassword });
  useEffect(() => { if (changePassword && profile.data) onAccount(profile.data.accountId); }, [changePassword, profile.data, onAccount]);
  return <main className="login-layout"><section className="login-story"><img className="login-logo" src="/brand.jpg" alt="午逅 Story" /><h1>午逅工作台</h1></section><section className="login-form-wrap"><form className="login-form" onSubmit={async event => {
    event.preventDefault();
    if (busy) return;
    setError(null); setMessage('');
    const problem = changePassword ? newPasswordError(newPassword, confirmation) : '';
    setValidation(problem);
    if (problem) return;
    setBusy(true);
    try {
      if (changePassword) {
        await api('/me/password', { method: 'POST', body: { currentPassword: password, newPassword } });
        setEmployee(profile.data?.employeeNumber || employee.trim());
        setPassword(''); setNewPassword(''); setConfirmation(''); setShowPassword(false); setMessage('密码已更新，请使用新密码重新登录。'); forgetSession();
      } else { await session.login(employee.trim(), password); setPassword(''); }
    } catch (error) { setError(error); } finally { setBusy(false); }
  }}><span className="form-icon"><LockKey size={26} /></span><h2>{changePassword ? '设置新密码' : '员工登录'}</h2>{changePassword && <p className="muted">首次登录需修改密码，完成后重新登录。</p>}
    {message && <div className="notice success" role="status">{message}</div>}
    {changePassword && <p className="muted">当前工号：{profile.data?.employeeNumber || employee || '正在读取…'}</p>}
    {!changePassword && <label>员工工号<input name="employeeNumber" autoComplete="username" value={employee} onChange={event => setEmployee(event.target.value)} required maxLength={32} disabled={busy} placeholder="输入员工工号" /></label>}
    <label>{changePassword ? '当前密码' : '登录密码'}<input name={changePassword ? 'currentPassword' : 'password'} type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required maxLength={256} disabled={busy} placeholder={changePassword ? '填写初始化或重置时使用的旧密码' : '输入密码'} /></label>
    {changePassword && <><label>新密码<input name="newPassword" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={newPassword} onChange={event => { setNewPassword(event.target.value); setValidation(''); }} required maxLength={256} disabled={busy} placeholder="8–128 个字符，不能与当前密码相同" /></label><label>确认新密码<input name="confirmPassword" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={confirmation} onChange={event => { setConfirmation(event.target.value); setValidation(''); }} required maxLength={256} disabled={busy} placeholder="再次输入新密码" /></label></>}
    <button type="button" className="text-button" aria-pressed={showPassword} disabled={busy} onClick={() => setShowPassword(value => !value)}>{showPassword ? '隐藏密码' : '显示密码'}</button>
    {validation && <p className="field-error" role="alert">{validation}</p>}
    <ErrorNotice error={error} /><button className="primary" disabled={busy}>{busy ? '请稍候…' : changePassword ? '保存新密码' : '登录工作台'}<ArrowRight /></button>
    {changePassword && <button type="button" className="text-button" disabled={busy} onClick={async () => {
      setBusy(true);
      try { if (await onLogout()) { setEmployee(''); setPassword(''); setNewPassword(''); setConfirmation(''); setValidation(''); setShowPassword(false); setMessage(''); } }
      catch (error) { setError(error); } finally { setBusy(false); }
    }}>退出登录</button>}
    <p className="login-help">账号问题请联系门店管理员。</p>
  </form></section></main>;
}
function Workspace({ token, hash, calendarView, onCalendarChange, draft, onAccount, onDraftChange, onSubmit, creating, createError, submitted, notice, dismissNotice, onLogout, onEditDirtyChange, writing, onWritingChange, createdOrder, onCreatedOrderLocated, draftControls, onEditorChange, draftBlocked, draftAccountId }: {
  token: string; hash: string; draft: OrderDraftRecord | null; onAccount: (accountId: string, date?: string, canEnter?: boolean) => void;
  calendarView: CalendarView; onCalendarChange: (view: CalendarView) => void;
  draftAccountId: string; draftBlocked: boolean; draftControls: ReactNode; onEditorChange: (editor: Partial<DraftEditor>) => void;
  onDraftChange: (draft: OrderDraft, editor?: Partial<DraftEditor>) => void; onSubmit: (request: CreateOrderRequest) => void;
  creating: boolean; createError: unknown; submitted?: CreateOrderRequest; notice: string; dismissNotice: () => void; onLogout: () => Promise<boolean>;
  onEditDirtyChange: (dirty: boolean) => void;
  writing: boolean; onWritingChange: (pending: boolean) => void;
  createdOrder: CreatedOrderFocus | null; onCreatedOrderLocated: (orderId: string) => void;
}) {
  const selected = calendarView.date;
  const [filters, setFilters] = useState({ ...allCalendarFilters });
  useEffect(() => { if (createdOrder) setFilters({ ...allCalendarFilters }); }, [createdOrder?.orderId]);
  const client = useQueryClient();
  const [connection, setConnection] = useState<Connection>('connecting');
  const [updates, setUpdates] = useState<OrderUpdate[]>([]);
  const notify = useCallback((change: OrderUpdate) => setUpdates(current => collectUpdate(current, change)), []);
  const [logoutError, setLogoutError] = useState<unknown>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const managementView = useRef<ManagementView | null>(null);
  const [queryOrderId, setQueryOrderId] = useState<string | null>(null);
  const saveManagementView = useCallback((view: ManagementView) => { managementView.current = view; }, []);
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => api<Account>('/me', { signal }) });
  const pendingSubmissions = useQuery({ queryKey: ['customer-submissions', 'pending-count'], queryFn: ({ signal }) => api<{ count: number }>('/customer-submissions/pending-count', { signal }), enabled: canHandleSubmissions(me.data), refetchInterval: 30000 });
  useEffect(() => {
    synchronize(client);
    return connectOrders(client, setConnection, notify);
  }, [client, token, notify]);
  useEffect(() => { setUpdates([]); managementView.current = null; setQueryOrderId(null); setFilters({ ...allCalendarFilters }); }, [me.data?.accountId]);
  useEffect(() => { if (me.data) onAccount(me.data.accountId, hash === '#/orders/new' && orderAccess(me.data).entry ? selected : undefined, orderAccess(me.data).entry); }, [me.data, hash, selected, onAccount]);
  useEffect(() => { if (me.data && hash === '#/admin/employees' && me.data.systemRole !== 'SUPER_ADMIN') window.location.hash = '#'; }, [me.data, hash]);
  const route = workspaceRoute(hash, me.data?.systemRole);
  const access = orderAccess(me.data);
  const canManagePackages = Boolean(me.data?.jobRoles.some(role => role === 'MANAGER' || role === 'STORE_MANAGER'));
  const id = route.id;
  useEffect(() => { if (!id && route.kind !== 'orders') setQueryOrderId(null); }, [id, route.kind]);
  return <><header className="app-header"><div className="header-inner"><Brand /><span className="header-divider" /><span className="header-title">门店工作台</span><div className="header-right"><span className={`connection ${connection}`} role="status">{connection === 'live' ? <WifiHigh /> : <WifiSlash />}<span>{connection === 'live' ? '协作已连接' : connection === 'connecting' ? '正在连接' : '正在重连'}</span></span><OrderUpdates currentOrderId={id} updates={updates} clear={() => setUpdates([])} dismiss={id => setUpdates(current => current.filter(update => update.orderId !== id))} /><span className="account"><UserCircle size={23} />{me.data?.nickname || '员工'}</span><button className="icon-button" aria-label="退出登录" disabled={loggingOut || creating || writing} onClick={async () => { setLoggingOut(true); try { await onLogout(); } catch (error) { setLogoutError(error); } finally { setLoggingOut(false); } }}><SignOut size={21} /></button></div></div></header><nav className="app-nav" aria-label="工作区导航"><a href={calendarHref(calendarView)} aria-current={['calendar', 'create', 'order', 'history', 'payment-orders'].includes(route.kind) ? 'page' : undefined}>日历工作台</a>{access.management && <a href="#/admin/orders" aria-current={route.kind === 'orders' ? 'page' : undefined}>订单查询与统计</a>}{canManagePackages && <a href="#/admin/order-packages" aria-current={route.kind === 'packages' ? 'page' : undefined}>套餐管理</a>}{canHandleSubmissions(me.data) && <a href="#/customer-submissions" aria-current={['submissions', 'submission'].includes(route.kind) ? 'page' : undefined}>客户填单{Boolean(pendingSubmissions.data?.count) && <span className="pending-count" aria-label={`${pendingSubmissions.data!.count} 份待处理填单`} title="全部待处理填单">{pendingSubmissions.data!.count > 99 ? '99+' : pendingSubmissions.data!.count}</span>}</a>}{me.data?.systemRole === 'SUPER_ADMIN' && <a href="#/admin/employees" aria-current={route.kind === 'employees' ? 'page' : undefined}>员工管理</a>}</nav><main className="workspace"><ErrorNotice error={logoutError} /><ErrorNotice error={me.error} retry={() => void me.refetch()} />{notice && <div className="notice" role="status">{notice}<button className="text-button" onClick={dismissNotice}>关闭</button></div>}{connection === 'reconnecting' && <div className="notice">实时连接暂时中断，正在自动重连；恢复后会重新获取最新订单。</div>}{hash === '#/orders/new' && access.entry && draftAccountId === me.data?.accountId && draftControls}{hash === '#/orders/new' ? !access.entry ? <p className="notice">当前岗位不显示接单信息。</p> : draft && draft.accountId === me.data?.accountId ? <OrderCreate key={draft.requestId} draft={draft.value} initialDraft={draft.initial} onChange={onDraftChange} onSubmit={onSubmit} busy={creating} error={createError} submitted={submitted} editor={draft.editor} onEditorChange={onEditorChange} blocked={draftBlocked} /> : <Loading /> : route.kind === 'submission' && id ? <CustomerSubmissionDetail key={id} id={id} onDirtyChange={onEditDirtyChange} onWritingChange={onWritingChange} /> : route.kind === 'submissions' && me.data ? <CustomerSubmissions key={me.data.accountId} account={me.data} onWritingChange={onWritingChange} /> : route.kind === 'history' && id ? !access.history && route.type !== 'NOTE' ? <p className="notice">当前岗位不显示完整操作记录。</p> : <OrderHistory account={me.data} key={id + (route.type || 'all')} id={id} initialType={route.type} returnToCalendar={route.returnToCalendar} /> : id ? <OrderDetail account={me.data} key={id} id={id} returnToCalendar={route.returnToCalendar} returnToOrders={queryOrderId === id} onEditDirtyChange={onEditDirtyChange} onWritingChange={onWritingChange} /> : route.kind === 'payment-orders' ? !access.amounts ? <p className="notice">当前岗位不显示付款明细。</p> : <PaymentOrders route={readPaymentList(hash)!} /> : route.kind === 'orders' ? !access.management ? <p className="notice">当前岗位不显示订单财务查询。</p> : me.data ? <AdminOrders initialView={managementView.current} onViewChange={saveManagementView} onOpenOrder={setQueryOrderId} onWritingChange={onWritingChange} /> : <Loading /> : route.kind === 'packages' ? !me.data ? <Loading /> : canManagePackages ? <OrderPackageAdmin key={me.data.accountId} onWritingChange={onWritingChange} onDirtyChange={onEditDirtyChange} /> : <p className="notice">仅店长可以管理套餐。</p> : route.kind === 'employees' && me.data ? <EmployeeAdmin accountId={me.data.accountId} onWritingChange={onWritingChange} onDirtyChange={onEditDirtyChange} /> : me.data ? <Calendar account={me.data} key={me.data.accountId} view={calendarView} onViewChange={onCalendarChange} filters={filters} onFiltersChange={setFilters} createdOrder={createdOrder?.accountId === me.data.accountId && createdOrder.date === selected ? createdOrder : undefined} onCreatedOrderLocated={onCreatedOrderLocated} /> : <Loading />}</main><footer className="app-footer"><CalendarBlank size={18} /><span>午逅 Story</span></footer></>;
}
export function App() {
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  const client = useQueryClient();
  const [hash, setHash] = useState(window.location.hash);
  const [calendarView, setCalendarView] = useState(() => readCalendarView(window.location.hash)
    || readCalendarView(workspaceRoute(window.location.hash).returnToCalendar || '') || readCalendarView(readPaymentList(workspaceRoute(window.location.hash).returnToCalendar || '')?.from || '') || defaultCalendarView(today()));
  const setSelected = useCallback((date: string) => setCalendarView(defaultCalendarView(date)), []);
  const onCalendarChange = useCallback((view: CalendarView) => { window.location.hash = calendarHref(view); }, []);
  const hashRef = useRef(hash);
  const historyPosition = useRef<number>(typeof window.history.state?.wuhouRoutePosition === 'number' ? window.history.state.wuhouRoutePosition : 0);
  const drafts = useOrderDraft();
  const { draft, draftRef, candidate, status: draftStatus, open: openDraft, leave: leaveDraft, change: changeDraft, changeEditor, clear: clearDraft, prepare: prepareDraft, rejected: rejectDraft } = drafts;
  const draftStatusRef = useRef(draftStatus); draftStatusRef.current = draftStatus;
  const accountRef = useRef('');
  useEffect(() => { if (!state.token) leaveDraft(); }, [state.token, leaveDraft]);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const [notice, setNotice] = useState('');
  const [createdOrder, setCreatedOrder] = useState<CreatedOrderFocus | null>(null);
  const onCreatedOrderLocated = useCallback((orderId: string) => {
    setCreatedOrder(current => current?.orderId === orderId && !current.located ? { ...current, located: true } : current);
  }, []);
  useEffect(() => {
    if (createdOrder && (!state.token || workspaceRoute(hash).kind !== 'calendar' || calendarView.date !== createdOrder.date)) setCreatedOrder(null);
  }, [hash, calendarView.date, state.token, createdOrder]);
  const [editDirty, setEditDirty] = useState(false);
  const editDirtyRef = useRef(false);
  const onEditDirtyChange = useCallback((dirty: boolean) => { editDirtyRef.current = dirty; setEditDirty(dirty); }, []);
  const [writing, setWriting] = useState(false);
  const writingRef = useRef(false);
  const onWritingChange = useCallback((pending: boolean) => {
    writingRef.current = pending; setWriting(pending);
    if (!pending) setNotice(current => current === '操作尚未完成，请稍候再离开。' ? '' : current);
  }, []);
  const creation = useMutation({
    mutationFn: (request: CreateOrderRequest) => {
      if (!draftRef.current) throw new Error('录单草稿已失效，请重新打开录单页面。');
      return api<Detail>('/orders', { method: 'POST', body: request, headers: { 'Idempotency-Key': draftRef.current.requestId } });
    },
    onSuccess: order => {
      if (session.snapshot().token) {
        synchronize(client, order.orderId);
        client.setQueryData(['order', order.orderId, 'detail'], order);
      }
      const date = order.fulfillment.requestedReceiveDate;
      setCreatedOrder({ accountId: draftRef.current!.accountId, orderId: order.orderId, orderNo: order.orderNo, date, located: false });
      const cleared = clearDraft(); leaveDraft();
      setSelected(date);
      setNotice(cleared ? '' : '订单已创建，但本机草稿未能清除。再次恢复时请先核对原订单。');
      const next = calendarHref(defaultCalendarView(date));
      window.history.replaceState(window.history.state, '', next);
      hashRef.current = next; setHash(next); window.scrollTo(0, 0);
    },
    onError: error => { if (!creationResultUnknown(error)) rejectDraft(); },
    onSettled: () => { creatingRef.current = false; setCreating(false); },
  });
  const allowLeave = useCallback((discarding = false) => {
    if (creatingRef.current) { setNotice('订单正在创建，请稍候再离开。'); return false; }
    if (writingRef.current) { setNotice('操作尚未完成，请稍候再离开。'); return false; }
    if (hashRef.current === '#/orders/new') return discarding || !hasDraftContent(draftRef.current) || !['error', 'conflict'].includes(draftStatusRef.current) || window.confirm('本机草稿保存未完成，关闭或刷新页面可能丢失输入。仍要离开吗？');
    return !editDirtyRef.current || window.confirm('未保存的内容将丢失，确定离开吗？');
  }, []);
  const onAccount = useCallback((accountId: string, date?: string, canEnter = false) => {
    setCreatedOrder(current => current && current.accountId !== accountId ? null : current);
    if (accountRef.current && accountRef.current !== accountId) {
      creation.reset(); setSelected(today()); setNotice('');
    }
    accountRef.current = accountId;
    openDraft(accountId, canEnter, date);
  }, [openDraft, creation.reset, setSelected]);
  useEffect(() => {
    window.history.replaceState({ ...window.history.state, wuhouRoutePosition: historyPosition.current }, '');
    const listener = () => {
      const next = window.location.hash;
      const position: unknown = window.history.state?.wuhouRoutePosition;
      if (next === hashRef.current) return;
      if ((hashRef.current === '#/orders/new' && draftRef.current) || editDirtyRef.current || writingRef.current) {
        if (!allowLeave()) {
          // 回到原历史项，保留被取消后退的工作台入口。
          if (typeof position === 'number' && position !== historyPosition.current) window.history.go(historyPosition.current - position);
          else {
            window.history.replaceState({ ...window.history.state, wuhouRoutePosition: historyPosition.current + 1 }, '');
            window.history.back();
          }
          return;
        }
        if (hashRef.current === '#/orders/new') {
          if (draftRef.current && !candidate) changeEditor({ scrollY: window.scrollY });
          leaveDraft(); creation.reset();
        }
      }
      historyPosition.current = typeof position === 'number' && position !== historyPosition.current ? position : historyPosition.current + 1;
      window.history.replaceState({ ...window.history.state, wuhouRoutePosition: historyPosition.current }, '');
      const source = workspaceRoute(next).returnToCalendar || '';
      const view = readCalendarView(next) || readCalendarView(source) || readCalendarView(readPaymentList(source)?.from || '');
      if (view) setCalendarView(view);
      const calendarNavigation = workspaceRoute(hashRef.current).kind === 'calendar' && workspaceRoute(next).kind === 'calendar';
      hashRef.current = next; setHash(next);
      if (!calendarNavigation) window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', listener);
    return () => window.removeEventListener('hashchange', listener);
  }, [allowLeave, leaveDraft, changeEditor, creation.reset, candidate, draftRef]);
  const dirty = hasDraftContent(draft) || Boolean(candidate);
  useEffect(() => {
    if (!(dirty && draftStatus !== 'saved') && !editDirty && !creating && !writing) return;
    const listener = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  }, [dirty, draftStatus, editDirty, creating, writing]);
  useEffect(() => { if (!state.token) client.clear(); }, [client, state.token]);
  const discardWarning = (pending: boolean) => pending ? '订单可能已经创建，请先核对工作台。删除本机草稿不会撤销订单。' : '';
  const logout = async () => {
    if (!allowLeave(true)) return false;
    const retained = drafts.retained();
    const current = retained?.record;
    if ((current || retained?.invalid) && !window.confirm(`退出登录将清除未提交草稿，确定退出吗？${discardWarning(Boolean(current?.pending))}`)) return false;
    if (!clearDraft()) { setNotice('本机草稿未能清除，请处理保存提示后重试退出。'); return false; }
    try { await session.logout(); }
    catch (error) { if (current) drafts.restore(current); throw error; }
    leaveDraft();
    const view = defaultCalendarView(today());
    setCalendarView(view);
    const next = calendarHref(view);
    window.history.replaceState(window.history.state, '', next);
    hashRef.current = next; setHash(next);
    creation.reset(); setNotice('');
    return true;
  };
  const discard = () => {
    const current = draftRef.current || candidate?.record;
    if (window.confirm(`确定放弃草稿？原草稿将被删除。${discardWarning(Boolean(current?.pending))}`) && drafts.discard()) creation.reset();
  };
  const draftControls = <>
    {draftStatus === 'conflict' ? <div className="notice error" role="alert">其他标签页已更新或清除了草稿，当前页面已暂停保存。请重新载入后选择恢复。<button className="text-button" onClick={() => window.location.reload()}>重新载入</button></div>
      : draftStatus === 'error' ? <div className="notice error" role="alert">本机保存失败，请暂勿关闭页面。<button className="text-button" onClick={drafts.retry}>重试保存</button></div>
      : draftStatus === 'saved' && draft && <p className="draft-save-status" role="status">草稿已保存在本机 · {new Date(draft.updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}</p>}
    {draft && <div className="draft-actions"><button type="button" className="text-button danger" disabled={creating || draftStatus === 'conflict'} onClick={discard}>放弃草稿</button></div>}
    {candidate && <OrderDraftRecovery candidate={candidate} blocked={draftStatus === 'conflict'} accept={drafts.accept} discard={discard} dismiss={() => { drafts.close(); window.location.hash = calendarHref(calendarView); }} />}
  </>;
  if (state.loading) return <Loading />;
  if (!state.token || state.token.passwordChangeRequired) return <>{dirty && <div className="draft-session-notice notice" role="status">登录已失效，未提交草稿已保留。同一员工重新登录后可选择恢复；请留意本机保存是否成功。</div>}{state.error && <div className="session-error"><ErrorNotice error={state.error} retry={() => void refresh().catch(() => {})} /></div>}<Login changePassword={Boolean(state.token?.passwordChangeRequired)} onAccount={onAccount} onLogout={logout} /></>;
  return <Workspace createdOrder={createdOrder} onCreatedOrderLocated={onCreatedOrderLocated} draftAccountId={accountRef.current} draftControls={draftControls} onEditorChange={changeEditor} draftBlocked={draftStatus === 'conflict'} token={state.token.accessToken} hash={hash} calendarView={calendarView} onCalendarChange={onCalendarChange} draft={draft} onAccount={onAccount} creating={creating} writing={writing} createError={creation.error || (!creating && draft?.pending ? pendingCreationError : null)} submitted={draft?.pending || creation.variables} notice={notice} dismissNotice={() => setNotice('')} onEditDirtyChange={onEditDirtyChange} onWritingChange={onWritingChange} onDraftChange={(value, editor) => {
    changeDraft(value, editor);
    if (!draftRef.current?.pending) creation.reset();
  }} onSubmit={request => {
    if (creatingRef.current || !prepareDraft(request)) return;
    creatingRef.current = true; setCreating(true); setNotice(''); creation.mutate(draftRef.current!.pending!);
  }} onLogout={logout} />;
}
