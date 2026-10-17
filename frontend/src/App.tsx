import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CalendarBlank, LockKey, SignOut, UserCircle, WifiHigh, WifiSlash } from '@phosphor-icons/react';
import { api, creationResultUnknown, forgetSession, refresh, session } from './api';
import type { Account, CreateOrderRequest, Detail } from './types';
import { collectUpdate, connectOrders, synchronize } from './realtime';
import type { Connection, OrderUpdate } from './realtime';
import { OrderUpdates } from './OrderUpdates';
import { today, workbenchDate } from './dates';
import { Brand, ErrorNotice, Loading } from './ui';
import { Calendar } from './Calendar';
import { OrderDetail } from './OrderDetail';
import { OrderCreate } from './OrderCreate';
import { newDraft } from './orderForm';
import type { OrderDraft } from './orderForm';
import { AdminOrders } from './AdminOrders';
import { EmployeeAdmin } from './EmployeeAdmin';

interface DraftRecord { accountId: string; requestId: string; initial: OrderDraft; value: OrderDraft }
function changed(draft: DraftRecord | null) { return Boolean(draft && JSON.stringify(draft.initial) !== JSON.stringify(draft.value)); }

function Login({ changePassword = false, onAccount, onLogout }: { changePassword?: boolean; onAccount: (accountId: string) => void; onLogout: () => Promise<boolean> }) {
  const [employee, setEmployee] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState('');
  const profile = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => api<Account>('/me', { signal }), enabled: changePassword });
  useEffect(() => { if (changePassword && profile.data) onAccount(profile.data.accountId); }, [changePassword, profile.data, onAccount]);
  return <main className="login-layout"><section className="login-story"><img className="login-logo" src="/brand.jpg" alt="午逅 Story" /><p className="eyebrow">用心制作，温柔以待</p><h1>把每一份心意，<br />做成美好的日常。</h1><p>从第一层夹馅，到最后一次交付。<br />和同事一起，照顾好每一张订单。</p><span className="story-footer">午逅 · 员工工作台</span></section><section className="login-form-wrap"><form className="login-form" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError(null); setMessage('');
    try {
      if (changePassword) {
        await api('/me/password', { method: 'POST', body: { currentPassword: password, newPassword } });
        setEmployee(profile.data?.employeeNumber || employee.trim());
        setPassword(''); setNewPassword(''); setMessage('密码已更新，请使用新密码重新登录。'); forgetSession();
      } else { await session.login(employee.trim(), password); setPassword(''); }
    } catch (error) { setError(error); } finally { setBusy(false); }
  }}><span className="form-icon"><LockKey size={26} /></span><p className="eyebrow">WU HOU · STORY</p><h2>{changePassword ? '设置你的新密码' : '欢迎回到午逅'}</h2><p className="muted">{changePassword ? '首次登录需要修改初始密码，完成后请重新登录。' : '登录，开始今天的甜蜜工作。'}</p>
    {message && <div className="notice success" role="status">{message}</div>}
    {changePassword && <p className="muted">当前工号：{profile.data?.employeeNumber || employee || '正在读取…'}</p>}
    {!changePassword && <label>员工工号<input name="employeeNumber" autoComplete="username" value={employee} onChange={event => setEmployee(event.target.value)} required maxLength={32} disabled={busy} placeholder="输入员工工号" /></label>}
    <label>{changePassword ? '当前密码' : '登录密码'}<input name="password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required maxLength={256} disabled={busy} placeholder="输入密码" /></label>
    {changePassword && <label>新密码<input type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} required maxLength={256} disabled={busy} placeholder="15–128 个字符，不能与当前密码相同" /><span className="muted">密码长度为 15–128 个字符。</span></label>}
    <ErrorNotice error={error} /><button className="primary" disabled={busy}>{busy ? '请稍候…' : changePassword ? '保存新密码' : '登录工作台'}<ArrowRight /></button>
    {changePassword && <button type="button" className="text-button" disabled={busy} onClick={async () => {
      setBusy(true);
      try { if (await onLogout()) { setEmployee(''); setPassword(''); setNewPassword(''); setMessage(''); } }
      catch (error) { setError(error); } finally { setBusy(false); }
    }}>退出登录</button>}
    <p className="login-help">账号由门店管理员开通。无法登录时，请联系管理员。</p>
  </form></section></main>;
}
function Workspace({ token, hash, selected, setSelected, mode, setMode, draft, onAccount, onDraftChange, onSubmit, creating, createError, submitted, notice, dismissNotice, onLogout, onEditDirtyChange, writing, onWritingChange }: {
  token: string; hash: string; draft: DraftRecord | null; onAccount: (accountId: string, date?: string) => void;
  selected: string; setSelected: (date: string) => void; mode: 'week' | 'month'; setMode: (mode: 'week' | 'month') => void;
  onDraftChange: (draft: OrderDraft) => void; onSubmit: (request: CreateOrderRequest) => void;
  creating: boolean; createError: unknown; submitted?: CreateOrderRequest; notice: string; dismissNotice: () => void; onLogout: () => Promise<boolean>;
  onEditDirtyChange: (dirty: boolean) => void;
  writing: boolean; onWritingChange: (pending: boolean) => void;
}) {
  const client = useQueryClient();
  const [connection, setConnection] = useState<Connection>('connecting');
  const [updates, setUpdates] = useState<OrderUpdate[]>([]);
  const notify = useCallback((change: OrderUpdate) => setUpdates(current => collectUpdate(current, change)), []);
  const [logoutError, setLogoutError] = useState<unknown>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => api<Account>('/me', { signal }) });
  useEffect(() => {
    synchronize(client);
    return connectOrders(client, setConnection, notify);
  }, [client, token, notify]);
  useEffect(() => { setUpdates([]); }, [me.data?.accountId]);
  useEffect(() => { if (me.data) onAccount(me.data.accountId, hash === '#/orders/new' ? selected : undefined); }, [me.data, hash, selected, onAccount]);
  const id = /^#\/orders\/([a-f\d-]{36})$/i.exec(hash)?.[1];
  return <><header className="app-header"><div className="header-inner"><Brand /><span className="header-divider" /><span className="header-title">门店工作台</span><div className="header-right"><span className={`connection ${connection}`} role="status">{connection === 'live' ? <WifiHigh /> : <WifiSlash />}<span>{connection === 'live' ? '协作已连接' : connection === 'connecting' ? '正在连接' : '正在重连'}</span></span><OrderUpdates currentOrderId={id} updates={updates} clear={() => setUpdates([])} dismiss={id => setUpdates(current => current.filter(update => update.orderId !== id))} /><span className="account"><UserCircle size={23} />{me.data?.nickname || '员工'}</span><button className="icon-button" aria-label="退出登录" disabled={loggingOut || creating || writing} onClick={async () => { setLoggingOut(true); try { await onLogout(); } catch (error) { setLogoutError(error); } finally { setLoggingOut(false); } }}><SignOut size={21} /></button></div></div></header><nav className="app-nav" aria-label="工作区导航"><a href="#" aria-current={!hash.startsWith('#/admin') ? 'page' : undefined}>日历工作台</a>{me.data?.systemRole === 'SUPER_ADMIN' && <><a href="#/admin/orders" aria-current={hash === '#/admin/orders' ? 'page' : undefined}>订单查询与统计</a><a href="#/admin/employees" aria-current={hash === '#/admin/employees' ? 'page' : undefined}>员工管理</a></>}</nav><main className="workspace"><ErrorNotice error={logoutError} /><ErrorNotice error={me.error} retry={() => void me.refetch()} />{notice && <div className="notice" role="status">{notice}<button className="text-button" onClick={dismissNotice}>关闭</button></div>}{connection === 'reconnecting' && <div className="notice">实时连接暂时中断，正在自动重连；恢复后会重新获取最新订单。</div>}{hash === '#/orders/new' ? draft && draft.accountId === me.data?.accountId ? <OrderCreate key={draft.accountId} draft={draft.value} initialDraft={draft.initial} onChange={onDraftChange} onSubmit={onSubmit} busy={creating} error={createError} submitted={submitted} onRecognitionDirtyChange={onEditDirtyChange} /> : <Loading /> : id ? <OrderDetail key={id} id={id} onEditDirtyChange={onEditDirtyChange} onWritingChange={onWritingChange} /> : hash === '#/admin/orders' ? me.data?.systemRole === 'SUPER_ADMIN' ? <AdminOrders onWritingChange={onWritingChange} /> : <p role="alert">当前账号无管理权限。</p> : hash === '#/admin/employees' ? me.data?.systemRole === 'SUPER_ADMIN' ? <EmployeeAdmin onWritingChange={onWritingChange} onDirtyChange={onEditDirtyChange} /> : <p role="alert">当前账号无管理权限。</p> : me.data ? <Calendar key={me.data.accountId} accountId={me.data.accountId} selected={selected} setSelected={setSelected} mode={mode} setMode={setMode} onWritingChange={onWritingChange} /> : <Loading />}</main><footer className="app-footer"><CalendarBlank size={18} /><span>午逅 Story</span><span>把心意，准时送达。</span></footer></>;
}
export function App() {
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  const client = useQueryClient();
  const [hash, setHash] = useState(window.location.hash);
  const [selected, setSelected] = useState(() => workbenchDate(window.location.hash) || today());
  const [mode, setMode] = useState<'week' | 'month'>('week');
  const hashRef = useRef(hash);
  const historyPosition = useRef<number>(typeof window.history.state?.wuhouRoutePosition === 'number' ? window.history.state.wuhouRoutePosition : 0);
  const [draft, setDraft] = useState<DraftRecord | null>(null);
  const draftRef = useRef<DraftRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const [notice, setNotice] = useState('');
  const [editDirty, setEditDirty] = useState(false);
  const editDirtyRef = useRef(false);
  const onEditDirtyChange = useCallback((dirty: boolean) => { editDirtyRef.current = dirty; setEditDirty(dirty); }, []);
  const [writing, setWriting] = useState(false);
  const writingRef = useRef(false);
  const onWritingChange = useCallback((pending: boolean) => {
    writingRef.current = pending; setWriting(pending);
    if (!pending) setNotice(current => current === '操作尚未完成，请稍候再离开。' ? '' : current);
  }, []);
  const saveDraft = useCallback((next: DraftRecord | null) => { draftRef.current = next; setDraft(next); }, []);
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
      saveDraft(null);
      setNotice('订单已创建，可继续确认付款和制作。');
      const next = `#/orders/${order.orderId}`;
      window.history.replaceState(window.history.state, '', next);
      hashRef.current = next; setHash(next); window.scrollTo(0, 0);
    },
    onSettled: () => { creatingRef.current = false; setCreating(false); },
  });
  const allowLeave = useCallback(() => {
    if (creatingRef.current) { setNotice('订单正在创建，请稍候再离开。'); return false; }
    if (writingRef.current) { setNotice('操作尚未完成，请稍候再离开。'); return false; }
    if (changed(draftRef.current)) return window.confirm('录单内容尚未保存，离开将丢弃输入。确定离开吗？');
    return !editDirtyRef.current || window.confirm('订单修改尚未保存，离开将丢弃输入。确定离开吗？');
  }, []);
  const onAccount = useCallback((accountId: string, date?: string) => {
    let current = draftRef.current;
    if (current && current.accountId !== accountId) {
      saveDraft(null); creation.reset(); current = null;
      setSelected(today()); setMode('week');
      if (date !== undefined) date = today();
      setNotice('当前登录员工已变化，之前的录单草稿已清除。');
    }
    if (!current && date !== undefined) {
      const value = newDraft(date);
      value.creditedEmployeeId = accountId;
      saveDraft({ accountId, requestId: crypto.randomUUID(), initial: value, value });
    }
  }, [saveDraft, creation.reset]);
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
        if (hashRef.current === '#/orders/new') { saveDraft(null); creation.reset(); }
      }
      historyPosition.current = typeof position === 'number' && position !== historyPosition.current ? position : historyPosition.current + 1;
      window.history.replaceState({ ...window.history.state, wuhouRoutePosition: historyPosition.current }, '');
      const date = workbenchDate(next);
      if (date) { setSelected(date); setMode('week'); }
      hashRef.current = next; setHash(next); window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', listener);
    return () => window.removeEventListener('hashchange', listener);
  }, [allowLeave, saveDraft, creation.reset]);
  const dirty = changed(draft);
  useEffect(() => {
    if (!dirty && !editDirty && !creating && !writing) return;
    const listener = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  }, [dirty, editDirty, creating, writing]);
  useEffect(() => { if (!state.token) client.clear(); }, [client, state.token]);
  const logout = async () => {
    if (!allowLeave()) return false;
    await session.logout();
    setSelected(today()); setMode('week');
    saveDraft(null); creation.reset(); setNotice('');
    return true;
  };
  if (state.loading) return <Loading />;
  if (!state.token || state.token.passwordChangeRequired) return <>{dirty && <div className="draft-session-notice notice" role="status">登录已失效，录单草稿暂时保留在当前标签页。同一员工重新登录后可继续；刷新或关闭后无法恢复。</div>}{state.error && <div className="session-error"><ErrorNotice error={state.error} retry={() => void refresh().catch(() => {})} /></div>}<Login changePassword={Boolean(state.token?.passwordChangeRequired)} onAccount={onAccount} onLogout={logout} /></>;
  return <Workspace token={state.token.accessToken} hash={hash} selected={selected} setSelected={setSelected} mode={mode} setMode={setMode} draft={draft} onAccount={onAccount} creating={creating} writing={writing} createError={creation.error} submitted={creation.variables} notice={notice} dismissNotice={() => setNotice('')} onEditDirtyChange={onEditDirtyChange} onWritingChange={onWritingChange} onDraftChange={value => {
    if (draftRef.current) saveDraft({ ...draftRef.current, value });
    if (!creationResultUnknown(creation.error)) creation.reset();
  }} onSubmit={request => {
    if (creatingRef.current) return;
    creatingRef.current = true; setCreating(true); setNotice(''); creation.mutate(request);
  }} onLogout={logout} />;
}
