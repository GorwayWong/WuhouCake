import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';
import type { EmployeeAccount, Page } from './types';
import { Empty, ErrorNotice, Loading } from './ui';

const roleNames: Record<string, string> = { MANAGER: '管理人员', FRONT_DESK: '前台', PASTRY_CHEF: '糕点师傅' };
interface Provisioned { account: EmployeeAccount; temporaryPassword: string }
export function EmployeeAdmin({ onWritingChange, onDirtyChange }: { onWritingChange: (value: boolean) => void; onDirtyChange: (value: boolean) => void }) {
  const client = useQueryClient();
  const [draftFilter, setDraftFilter] = useState({ employeeNumber: '', nickname: '', status: '', jobRole: '' });
  const [filters, setFilters] = useState(draftFilter); const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<EmployeeAccount | 'new' | null>(null);
  const [number, setNumber] = useState(''); const [name, setName] = useState(''); const [roles, setRoles] = useState<string[]>(['FRONT_DESK']);
  const [systemRole, setSystemRole] = useState('STAFF');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null); const [message, setMessage] = useState('');
  const [provisioned, setProvisioned] = useState<Provisioned | null>(null);
  const active = useRef<AbortController | null>(null);
  const initial = useRef('');
  const dirty = Boolean(editing && JSON.stringify([number, name, roles, systemRole]) !== initial.current);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => { active.current?.abort(); onWritingChange(false); onDirtyChange(false); }, [onWritingChange, onDirtyChange]);
  const params = new URLSearchParams({ page: String(page), size: '20', ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()])) });
  const query = useQuery({ queryKey: ['employees', params.toString()], queryFn: ({ signal }) => api<Page<EmployeeAccount>>(`/admin/employees?${params}`, { signal }) });
  function edit(employee: EmployeeAccount | 'new') {
    if (dirty && !window.confirm('员工资料尚未保存，是否丢弃输入？')) return;
    const n = employee === 'new' ? '' : employee.employeeNumber, nick = employee === 'new' ? '' : employee.nickname;
    const r = employee === 'new' ? ['FRONT_DESK'] : employee.jobRoles, s = employee === 'new' ? 'STAFF' : employee.systemRole || 'STAFF';
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
      setEditing(null); setMessage('员工操作已保存。');
      await Promise.all([client.invalidateQueries({ queryKey: ['employees'] }), client.invalidateQueries({ queryKey: ['employee-options'] }), client.invalidateQueries({ queryKey: ['me'] })]);
    } catch (failure) { if (!controller.signal.aborted) { setError(failure); if (failure instanceof ApiError && failure.code === 'CONCURRENT_MODIFICATION') { setMessage('员工资料已被更新，输入已保留。请重新查询并核对后打开编辑。'); void query.refetch(); } } }
    finally { if (active.current === controller) { active.current = null; setBusy(false); onWritingChange(false); } }
  }
  return <div className="management-page"><div className="page-heading"><div><h1>员工管理</h1><p className="muted">归档员工保留工号、订单归属和操作历史。</p></div><button className="primary" disabled={busy} onClick={() => edit('new')}>新增员工</button></div>
    <section className="panel"><form onSubmit={e => { e.preventDefault(); setFilters({ ...draftFilter }); setPage(1); if (JSON.stringify(filters) === JSON.stringify(draftFilter)) void query.refetch(); }}><fieldset className="export-filters" disabled={busy}>
      <label>工号<input value={draftFilter.employeeNumber} maxLength={32} onChange={e => setDraftFilter({ ...draftFilter, employeeNumber: e.target.value })} /></label><label>姓名<input value={draftFilter.nickname} maxLength={80} onChange={e => setDraftFilter({ ...draftFilter, nickname: e.target.value })} /></label>
      <label>状态<select value={draftFilter.status} onChange={e => setDraftFilter({ ...draftFilter, status: e.target.value })}><option value="">全部</option><option value="ACTIVE">在职</option><option value="ARCHIVED">已归档</option></select></label>
      <label>岗位<select value={draftFilter.jobRole} onChange={e => setDraftFilter({ ...draftFilter, jobRole: e.target.value })}><option value="">全部</option>{Object.entries(roleNames).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label>
    </fieldset><button className="secondary" disabled={busy}>查询员工</button></form></section>
    {editing && <section className="panel employee-editor"><h2>{editing === 'new' ? '新增员工' : `编辑员工 · ${editing.employeeNumber}`}</h2><form onSubmit={e => { e.preventDefault(); if (!roles.length) { setMessage('请至少选择一个岗位。'); return; } void mutate(editing === 'new' ? '' : `/${editing.accountId}`, editing === 'new' ? 'POST' : 'PATCH', editing === 'new' ? { employeeNumber: number.trim(), nickname: name.trim(), jobRoles: roles, systemRole } : { expectedVersion: editing.version, nickname: name.trim(), jobRoles: roles }); }}>
      <fieldset className="export-filters" disabled={busy}><label>工号<input required value={number} readOnly={editing !== 'new'} maxLength={32} onChange={e => setNumber(e.target.value)} /></label><label>员工姓名<input required value={name} maxLength={80} onChange={e => setName(e.target.value)} /></label>
      {editing === 'new' && <label>系统权限<select value={systemRole} onChange={e => setSystemRole(e.target.value)}><option value="STAFF">普通员工</option><option value="SUPER_ADMIN">超级管理员</option></select></label>}
      <fieldset className="roles-field"><legend>岗位（可多选）</legend>{Object.entries(roleNames).map(([v, n]) => <label className="check-label" key={v}><input type="checkbox" checked={roles.includes(v)} onChange={e => setRoles(e.target.checked ? [...roles, v] : roles.filter(r => r !== v))} />{n}</label>)}</fieldset></fieldset>
      <div className="actions"><button className="primary" disabled={busy}>{busy ? '正在保存…' : '保存员工'}</button><button type="button" className="secondary" disabled={busy} onClick={() => { if (!dirty || window.confirm('是否丢弃未保存的员工资料？')) setEditing(null); }}>取消编辑</button></div></form></section>}
    <ErrorNotice error={error} />{message && <p className="notice" role="status">{message}</p>}
    {provisioned && <section className="panel"><h2>{provisioned.account.nickname} · 初始密码</h2><p>请交给本人，首次登录需要修改。关闭后不再显示。</p><details><summary>查看本次初始密码</summary><code className="temporary-password">{provisioned.temporaryPassword}</code></details><button className="text-button" onClick={() => setProvisioned(null)}>关闭初始密码</button></section>}
    <ErrorNotice error={query.error} retry={() => void query.refetch()} />{query.isPending ? <Loading /> : query.data && (query.data.items.length ? <><p className="form-help table-help">可左右滑动表格，查看员工操作。</p><div className="panel table-scroll" tabIndex={0} role="region" aria-label="员工列表，可左右滚动"><table className="management-table"><thead><tr><th>工号／员工</th><th>岗位</th><th>状态／权限</th><th>操作</th></tr></thead><tbody>{query.data.items.map(e => <tr key={e.accountId}><td>{e.nickname}<small>{e.employeeNumber}</small></td><td>{e.jobRoles.map(r => roleNames[r] || r).join('、')}</td><td>{e.status === 'ACTIVE' ? '在职' : '已归档'}<small>{e.systemRole === 'SUPER_ADMIN' ? '超级管理员' : '普通员工'}</small></td><td><div className="actions"><button className="text-button" disabled={busy || e.status !== 'ACTIVE'} onClick={() => edit(e)}>编辑</button><button className="text-button" disabled={busy || e.status !== 'ACTIVE' || Boolean(editing)} onClick={() => { if (window.confirm(`重置 ${e.nickname} 的密码？旧登录会立即失效。`)) void mutate(`/${e.accountId}/reset-password`, 'POST'); }}>重置密码</button><button className="text-button danger" disabled={busy || e.status !== 'ACTIVE' || Boolean(editing)} onClick={() => { if (window.confirm(`归档 ${e.nickname}？该员工将无法登录，历史记录保留。`)) void mutate(`/${e.accountId}/archive`, 'POST'); }}>归档</button></div></td></tr>)}</tbody></table></div><div className="pagination"><button className="secondary" disabled={busy || page === 1 || query.isFetching} onClick={() => setPage(p => p - 1)}>上一页</button><span>第 {page} 页 · {query.data.total} 位员工</span><button className="secondary" disabled={busy || page * 20 >= query.data.total || query.isFetching} onClick={() => setPage(p => p + 1)}>下一页</button></div></> : <Empty>没有符合条件的员工，可清空条件后重试。</Empty>)}
  </div>;
}
