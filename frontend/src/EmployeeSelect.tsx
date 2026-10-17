import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { EmployeeOption } from './types';
import { ErrorNotice } from './ui';

export function EmployeeSelect({ value, onChange, includeArchived = false, emptyLabel = '请选择下单员工', saved, disabled = false, id }: {
  value: string; onChange: (value: string) => void; includeArchived?: boolean; emptyLabel?: string;
  saved?: { accountId: string; employeeNumber: string; nickname: string } | null; disabled?: boolean; id?: string;
}) {
  const query = useQuery({ queryKey: ['employee-options', includeArchived], queryFn: ({ signal }) => api<EmployeeOption[]>(`/employees/options?includeArchived=${includeArchived}`, { signal }) });
  const options = query.data || [];
  return <><select id={id} value={value} disabled={disabled || query.isPending} onChange={event => onChange(event.target.value)}>
    <option value="">{query.isPending ? '正在读取员工…' : emptyLabel}</option>
    {saved && !options.some(e => e.accountId === saved.accountId) && <option value={saved.accountId}>{saved.nickname} · {saved.employeeNumber}（历史员工）</option>}
    {options.map(e => <option key={e.accountId} value={e.accountId}>{e.nickname} · {e.employeeNumber}{e.status === 'ARCHIVED' ? '（已归档）' : ''}</option>)}
  </select><ErrorNotice error={query.error} retry={() => void query.refetch()} /></>;
}
