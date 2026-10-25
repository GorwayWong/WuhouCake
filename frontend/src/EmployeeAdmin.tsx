import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';
import type { EmployeeAccount, Page } from './types';
import { Empty, ErrorNotice, Loading } from './ui';
import { newPasswordError } from './passwordForm';
import { Select } from './Select';

const newRoles: Record<string, string> = { STORE_MANAGER: '店长', PASTRY_SUPERVISOR: '裱花主管', FRONT_DESK_SUPERVISOR: '前厅主管', DECORATOR: '裱花师', BAKER: '烘焙师', FRONT_DESK_CLERK: '前厅店员' };
const roleNames: Record<string, string> = { ...newRoles, MANAGER: '原管理人员（待确认）', FRONT_DESK: '原前台（待确认）', PASTRY_CHEF: '原糕点师／裱花师（待确认）' };
interface Provisioned { account: EmployeeAccount; temporaryPassword: string }
export function EmployeeAdmin({ accountId, onWritingChange, onDirtyChange }: { accountId: string; onWritingChange: (value: boolean) => void; onDirtyChange: (value: boolean) => void }) {
  const client = useQueryClient();
  const [draftFilter, setDraftFilter] = useState({ employeeNumber: '', nickname: '', status: '', jobRole: '' });
  const [filters, setFilters] = useState(draftFilter); const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<EmployeeAccount | 'new' | null>(null);
  const [number, setNumber] = useState(''); const [name, setName] = useState(''); const [roles, setRoles] = useState<string[]>(['FRONT_DESK_CLERK']);
  const [systemRole, setSystemRole] = useState('STAFF');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null); const [message, setMessage] = useState('');
  const [provisioned, setProvisioned] = useState<Provisioned | null>(null);
  const [passwordEmployee, setPasswordEmployee] = useState<EmployeeAccount | null>(null);
  const [newPassword, setNewPassword] = useState(''), [confirmation, setConfirmation] = useState('');
  const [passwordValidation, setPasswordValidation] = useState(''), [showPassword, setShowPassword] = useState(false);
  const passwordPanel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!provisioned) return;
    passwordPanel.current?.scrollIntoView({ block: 'center' });
    passwordPanel.current?.querySelector('summary')?.focus({ preventScroll: true });
  }, [provisioned]);
  const active = useRef<AbortController | null>(null);
  const initial = useRef('');
  const dirty = Boolean(editing && JSON.stringify([number, name, roles, systemRole]) !== initial.current) || Boolean(passwordEmployee && (newPassword || confirmation));
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => { active.current?.abort(); onWritingChange(false); onDirtyChange(false); }, [onWritingChange, onDirtyChange]);
  const params = new URLSearchParams({ page: String(page), size: '20', ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()])) });
  const query = useQuery({ queryKey: ['employees', params.toString()], queryFn: ({ signal }) => api<Page<EmployeeAccount>>(`/admin/employees?${params}`, { signal }) });
  function edit(employee: EmployeeAccount | 'new') {
    if (dirty && !window.confirm('员工资料尚未保存，是否丢弃输入？')) return;
    const n = employee === 'new' ? '' : employee.employeeNumber, nick = employee === 'new' ? '' : employee.nickname;
    const r = employee === 'new' ? ['FRONT_DESK_CLERK'] : employee.jobRoles, s = employee === 'new' ? 'STAFF' : employee.systemRole || 'STAFF';
    setEditing(employee); setNumber(n); setName(nick); setRoles(r); setSystemRole(s); setError(null); setMessage(''); setProvisioned(null);
    initial.current = JSON.stringify([n, nick, r, s]);
  }
  async function mutate(path: string, method: 'POST' | 'PATCH', body?: unknown) {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); onWritingChange(true); setError(null); setMessage(''); setProvisioned(null);
    try {
      const result = await api<EmployeeAccount | Provisioned>(`/admin/employees${path}`, { method, body, signal: controller.signal });
      if (controller.signal.aborted) return;
      if ('temporaryPassword' in result) setProvisioned(result);
      setEditing(null); setPasswordEmployee(null); setNewPassword(''); setConfirmation(''); setShowPassword(false); setPasswordValidation('');
      setMessage('temporaryPassword' in result ? '初始密码已生成，请交给该员工。' : path.endsWith('/password') ? '密码已修改，员工需重新登录并改密。' : '员工资料已保存。');
      await Promise.all([client.invalidateQueries({ queryKey: ['employees'] }), client.invalidateQueries({ queryKey: ['employee-options'] }), client.invalidateQueries({ queryKey: ['me'] })]);
    } catch (failure) { if (!controller.signal.aborted) { setError(failure); if (failure instanceof ApiError && failure.code === 'CONCURRENT_MODIFICATION') { setMessage(passwordEmployee ? '账号资料已更新，新密码输入已保留。请核对最新版本后重试。' : '员工资料已更新，输入已保留。请重新查询并核对。'); void query.refetch(); } } }
    finally { if (active.current === controller) { active.current = null; setBusy(false); onWritingChange(false); } }
  }
  const latestPasswordEmployee = query.data?.items.find(employee => employee.accountId === passwordEmployee?.accountId);
  return <div className="management-page"><div className="page-heading"><div><h1>员工管理</h1></div><button className="primary" disabled={busy || Boolean(passwordEmployee)} onClick={() => edit('new')}>新增员工</button></div>
    <section className="panel"><form onSubmit={e => { e.preventDefault(); setFilters({ ...draftFilter }); setPage(1); if (JSON.stringify(filters) === JSON.stringify(draftFilter)) void query.refetch(); }}><fieldset className="export-filters" disabled={busy}>
      <label>工号<input value={draftFilter.employeeNumber} maxLength={32} onChange={e => setDraftFilter({ ...draftFilter, employeeNumber: e.target.value })} /></label><label>姓名<input value={draftFilter.nickname} maxLength={80} onChange={e => setDraftFilter({ ...draftFilter, nickname: e.target.value })} /></label>
      <label>状态<Select label="员工状态" disabled={busy} value={draftFilter.status} onChange={value => setDraftFilter({ ...draftFilter, status: value })}><option value="">全部</option><option value="ACTIVE">在职</option><option value="ARCHIVED">已归档</option></Select></label>
      <label>岗位<Select label="员工岗位" disabled={busy} value={draftFilter.jobRole} onChange={value => setDraftFilter({ ...draftFilter, jobRole: value })}><option value="">全部</option>{Object.entries(roleNames).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</Select></label>
    </fieldset><button className="secondary" disabled={busy}>查询员工</button></form></section>
    {editing && <section className="panel employee-editor"><h2>{editing === 'new' ? '新增员工' : `编辑员工 · ${editing.employeeNumber}`}</h2><form onSubmit={e => { e.preventDefault(); if (!roles.length) { setMessage('请至少选择一个岗位。'); return; } void mutate(editing === 'new' ? '' : `/${editing.accountId}`, editing === 'new' ? 'POST' : 'PATCH', editing === 'new' ? { employeeNumber: number.trim(), nickname: name.trim(), jobRoles: roles, systemRole } : { expectedVersion: editing.version, nickname: name.trim(), jobRoles: roles }); }}>
      <fieldset className="export-filters" disabled={busy}><label>工号<input required value={number} readOnly={editing !== 'new'} maxLength={32} onChange={e => setNumber(e.target.value)} /></label><label>员工姓名<input required value={name} maxLength={80} onChange={e => setName(e.target.value)} /></label>
      <p className="form-help">店长同时具有超级管理员权限，可管理员工和查询审计；移除店长岗位会同步撤销该身份，系统至少保留一位管理员。</p>
      <fieldset className="roles-field"><legend>岗位（可多选）</legend>{Object.entries(roleNames).filter(([v]) => v in newRoles || roles.includes(v)).map(([v, n]) => <label className="check-label" key={v}><input type="checkbox" checked={roles.includes(v)} onChange={e => setRoles(e.target.checked ? [...roles, v] : roles.filter(r => r !== v))} />{n}</label>)}</fieldset></fieldset>
      <div className="actions"><button className="primary" disabled={busy}>{busy ? '正在保存…' : '保存员工'}</button><button type="button" className="secondary" disabled={busy} onClick={() => { if (!dirty || window.confirm('是否丢弃未保存的员工资料？')) setEditing(null); }}>取消编辑</button></div></form></section>}
    {passwordEmployee && <section className="panel employee-editor password-editor"><h2>修改密码 · {passwordEmployee.nickname}</h2><p className="form-help">工号 {passwordEmployee.employeeNumber} · 保存后旧登录失效，员工首次登录需改密。</p><form onSubmit={event => { event.preventDefault(); if (busy) return; const problem = newPasswordError(newPassword, confirmation); setPasswordValidation(problem); if (!problem) void mutate(`/${passwordEmployee.accountId}/password`, 'PATCH', { expectedVersion: passwordEmployee.version, newPassword }); }}>
      <fieldset className="export-filters" disabled={busy}><label>新密码<input autoFocus type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={newPassword} onChange={event => { setNewPassword(event.target.value); setPasswordValidation(''); }} required maxLength={256} placeholder="8–128 个字符" /></label><label>确认新密码<input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={confirmation} onChange={event => { setConfirmation(event.target.value); setPasswordValidation(''); }} required maxLength={256} /></label></fieldset>
      <button type="button" className="text-button" aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? '隐藏密码' : '显示密码'}</button>
      {passwordValidation && <p className="field-error" role="alert">{passwordValidation}</p>}
      {latestPasswordEmployee && latestPasswordEmployee.version !== passwordEmployee.version && <p className="notice">账号资料已变化。<button type="button" className="text-button" disabled={busy} onClick={() => { setPasswordEmployee(latestPasswordEmployee); setError(null); setMessage('已核对最新版本，请再次保存。'); }}>已核对，使用最新账号版本</button></p>}
      <div className="actions"><button className="primary" disabled={busy}>{busy ? '正在保存…' : '保存密码'}</button><button type="button" className="secondary" disabled={busy} onClick={() => { if (!dirty || window.confirm('放弃未保存的新密码？')) { setPasswordEmployee(null); setNewPassword(''); setConfirmation(''); setShowPassword(false); setPasswordValidation(''); setError(null); } }}>取消</button></div>
    </form></section>}
    <ErrorNotice error={error} />{message && <p className="notice" role="status">{message}</p>}
    {provisioned && <section className="panel" ref={passwordPanel} aria-label="本次生成的初始密码"><h2>{provisioned.account.nickname}（{provisioned.account.employeeNumber}）· 初始密码</h2><p className="form-help">密码仅显示一次；首次登录需改密。</p><details><summary>查看本次初始密码</summary><code className="temporary-password">{provisioned.temporaryPassword}</code><button type="button" className="text-button" onClick={async () => { try { await navigator.clipboard.writeText(provisioned.temporaryPassword); setMessage('初始密码已复制。'); } catch { setMessage('复制失败，请手动复制。'); } }}>复制初始密码</button></details><button type="button" className="text-button" onClick={() => setProvisioned(null)}>已记录，关闭初始密码</button></section>}
    <ErrorNotice error={query.error} retry={() => void query.refetch()} />{query.isPending ? <Loading /> : query.data && (query.data.items.length ? <><div className="panel table-scroll" tabIndex={0} role="region" aria-label="员工列表，可左右滚动"><table className="management-table"><thead><tr><th>工号／员工</th><th>岗位</th><th>状态／权限</th><th>操作</th></tr></thead><tbody>{query.data.items.map(e => <tr key={e.accountId}><td>{e.nickname}<small>{e.employeeNumber}</small></td><td>{e.jobRoles.map(r => roleNames[r] || r).join('、')}</td><td>{e.status === 'ACTIVE' ? '在职' : '已归档'}<small>{e.systemRole === 'SUPER_ADMIN' ? '超级管理员' : '普通员工'}</small></td><td><div className="actions"><button className="text-button" disabled={busy || e.status !== 'ACTIVE' || Boolean(passwordEmployee)} onClick={() => edit(e)}>编辑</button><button className="text-button" disabled={busy || e.status !== 'ACTIVE' || Boolean(editing) || Boolean(passwordEmployee) || e.accountId === accountId} onClick={() => { setPasswordEmployee(e); setNewPassword(''); setConfirmation(''); setPasswordValidation(''); setShowPassword(false); setError(null); setMessage(''); setProvisioned(null); }}>修改密码</button><button className="text-button" disabled={busy || e.status !== 'ACTIVE' || Boolean(editing) || Boolean(passwordEmployee) || e.accountId === accountId} onClick={() => { if (window.confirm(`重置 ${e.nickname} 的密码？将生成随机密码，旧登录立即失效。`)) void mutate(`/${e.accountId}/reset-password`, 'POST'); }}>重置密码</button><button className="text-button danger" disabled={busy || e.status !== 'ACTIVE' || Boolean(editing) || Boolean(passwordEmployee)} onClick={() => { if (window.confirm(`归档 ${e.nickname}？该员工将无法登录，历史记录保留。`)) void mutate(`/${e.accountId}/archive`, 'POST'); }}>归档</button></div></td></tr>)}</tbody></table></div><div className="pagination"><button className="secondary" disabled={busy || page === 1 || query.isFetching} onClick={() => setPage(p => p - 1)}>上一页</button><span>第 {page} 页 · {query.data.total} 位员工</span><button className="secondary" disabled={busy || page * 20 >= query.data.total || query.isFetching} onClick={() => setPage(p => p + 1)}>下一页</button></div></> : <Empty>暂无匹配员工。</Empty>)}
  </div>;
}
