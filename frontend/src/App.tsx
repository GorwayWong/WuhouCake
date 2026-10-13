import { useEffect, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CalendarBlank, LockKey, SignOut, UserCircle, WifiHigh, WifiSlash } from '@phosphor-icons/react';
import { api, forgetSession, refresh, session } from './api';
import type { Account } from './types';
import { connectOrders, synchronize } from './realtime';
import type { Connection } from './realtime';
import { today } from './dates';
import { Brand, ErrorNotice, Loading } from './ui';
import { Calendar } from './Calendar';
import { OrderDetail } from './OrderDetail';

function Login({ changePassword = false }: { changePassword?: boolean }) {
  const [employee, setEmployee] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState('');
  const profile = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => api<Account>('/me', { signal }), enabled: changePassword });
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
      try { await session.logout(); setEmployee(''); setPassword(''); setNewPassword(''); setMessage(''); }
      catch (error) { setError(error); } finally { setBusy(false); }
    }}>退出登录</button>}
    <p className="login-help">账号由门店管理员开通。无法登录时，请联系管理员。</p>
  </form></section></main>;
}
function Workspace({ token }: { token: string }) {
  const client = useQueryClient();
  const [selected, setSelected] = useState(today);
  const [mode, setMode] = useState<'week' | 'month'>('week');
  const [hash, setHash] = useState(window.location.hash);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [logoutError, setLogoutError] = useState<unknown>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => api<Account>('/me', { signal }) });
  useEffect(() => {
    synchronize(client);
    return connectOrders(client, setConnection);
  }, [client, token]);
  useEffect(() => { const listener = () => { setHash(window.location.hash); window.scrollTo(0, 0); }; window.addEventListener('hashchange', listener); return () => window.removeEventListener('hashchange', listener); }, []);
  const id = /^#\/orders\/([a-f\d-]{36})$/i.exec(hash)?.[1];
  return <><header className="app-header"><div className="header-inner"><Brand /><span className="header-divider" /><span className="header-title">门店工作台</span><div className="header-right"><span className={`connection ${connection}`} role="status">{connection === 'live' ? <WifiHigh /> : <WifiSlash />}<span>{connection === 'live' ? '协作已连接' : connection === 'connecting' ? '正在连接' : '正在重连'}</span></span><span className="account"><UserCircle size={23} />{me.data?.nickname || '员工'}</span><button className="icon-button" aria-label="退出登录" disabled={loggingOut} onClick={async () => { setLoggingOut(true); try { await session.logout(); } catch (error) { setLogoutError(error); } finally { setLoggingOut(false); } }}><SignOut size={21} /></button></div></div></header><main className="workspace"><ErrorNotice error={logoutError} /><ErrorNotice error={me.error} retry={() => void me.refetch()} />{connection === 'reconnecting' && <div className="notice">实时连接暂时中断，正在自动重连；恢复后会重新获取最新订单。</div>}{id ? <OrderDetail key={id} id={id} /> : <Calendar selected={selected} setSelected={setSelected} mode={mode} setMode={setMode} />}</main><footer className="app-footer"><CalendarBlank size={18} /><span>午逅 Story</span><span>把心意，准时送达。</span></footer></>;
}
export function App() {
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  const client = useQueryClient();
  useEffect(() => { if (!state.token) client.clear(); }, [client, state.token]);
  if (state.loading) return <Loading />;
  if (!state.token || state.token.passwordChangeRequired) return <>{state.error && <div className="session-error"><ErrorNotice error={state.error} retry={() => void refresh().catch(() => {})} /></div>}<Login changePassword={Boolean(state.token?.passwordChangeRequired)} /></>;
  return <Workspace token={state.token.accessToken} />;
}
