import { useEffect, useRef, useState } from 'react';
import { isCancelledError, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorText } from './api';
import { Select } from './Select';
import { appendPackage, packageSummary } from './orderPackages';
import type { OrderPackage } from './orderPackages';
import type { ItemDraft } from './orderForm';
import type { Page } from './types';

export function OrderPackagePicker({ items, onChange, disabled }: { items: ItemDraft[]; onChange: (items: ItemDraft[]) => void; disabled: boolean }) {
  const client = useQueryClient();
  const [keyword, setKeyword] = useState(''), [search, setSearch] = useState(''), [page, setPage] = useState(1);
  const params = new URLSearchParams({ keyword: search, page: String(page), size: '20' });
  const query = useQuery({ queryKey: ['order-packages', params.toString()], queryFn: ({ signal }) => api<Page<OrderPackage>>(`/order-packages?${params}`, { signal }), refetchOnMount: 'always' });
  const [selected, setSelected] = useState(''), [added, setAdded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState<unknown>(null);
  const chosen = query.data?.items.find(value => value.id === selected);
  const latest = useRef({ items, onChange, disabled }); latest.current = { items, onChange, disabled };
  const active = useRef<AbortController | null>(null);
  const readKey = useRef<readonly string[] | null>(null);
  useEffect(() => () => { active.current?.abort(); if (readKey.current) void client.cancelQueries({ queryKey: readKey.current, exact: true }); }, [client]);
  useEffect(() => {
    if (!query.isSuccess || query.isFetching) return;
    const last = Math.max(1, Math.ceil(query.data.total / query.data.size));
    if (page > last) { setPage(last); setSelected(''); }
    else if (selected && !query.data.items.some(value => value.id === selected)) { setSelected(''); setMessage('所选套餐已更新或已移出当前列表，请重新选择。已填写商品保持不变。'); }
  }, [query.data, query.isSuccess, query.isFetching, page, selected]);
  async function append() {
    if (!chosen || active.current || disabled) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError(null); setMessage('');
    const key = ['order-packages', 'detail', chosen.id]; readKey.current = key;
    try {
      const value = await client.fetchQuery({ queryKey: key, queryFn: ({ signal }) => api<OrderPackage>(`/order-packages/${chosen.id}`, { signal }), staleTime: 0, gcTime: 0 });
      if (controller.signal.aborted || latest.current.disabled) return;
      latest.current.onChange(appendPackage(latest.current.items, value));
      setAdded(current => [...current, value.id]); setMessage(`已带入“${value.name}”的 ${value.items.length} 项商品，可继续修改。`);
    } catch (failure) { if (!controller.signal.aborted) {
      if (isCancelledError(failure)) setMessage('套餐内容已更新，当前录单内容已保留，请核对后重新带入。');
      else { setError(failure); void query.refetch(); }
    } }
    finally { if (active.current === controller) { active.current = null; readKey.current = null; setBusy(false); } }
  }
  return <div className="package-picker">
    <div className="package-actions"><label>搜索套餐<input value={keyword} placeholder="输入套餐名称" maxLength={80} disabled={disabled || busy} onChange={event => setKeyword(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); setSearch(keyword.trim()); setPage(1); setSelected(''); } }} /></label>
      <button type="button" className="secondary" disabled={disabled || busy} onClick={() => { setSearch(keyword.trim()); setPage(1); setSelected(''); void query.refetch(); }}>搜索</button>
      <label>选择套餐<Select label="选择套餐" value={selected} onChange={setSelected} disabled={disabled || busy || query.isPending}>
        <option value="">{query.isPending ? '正在读取…' : '选择套餐'}</option>{query.data?.items.map(value => <option key={value.id} value={value.id}>{value.name} · {value.items.length} 项</option>)}
      </Select></label><button type="button" className="secondary" disabled={disabled || busy || !chosen} onClick={() => void append()}>{busy ? '正在读取…' : added.includes(selected) ? '再添加一份' : '带入商品'}</button></div>
    {chosen && <p className="package-summary">{chosen.items.length} 项商品：{packageSummary(chosen)}</p>}
    {query.data && query.data.total > 20 && <div className="package-actions"><button type="button" className="text-button" disabled={disabled || busy || page === 1} onClick={() => { setPage(page - 1); setSelected(''); }}>上一页</button><span>第 {page} 页，共 {query.data.total} 个套餐</span><button type="button" className="text-button" disabled={disabled || busy || page * 20 >= query.data.total} onClick={() => { setPage(page + 1); setSelected(''); }}>下一页</button></div>}
    {query.data?.total === 0 && <p className="muted">{search ? '没有匹配的套餐。' : '暂无套餐，请联系店长维护。'}</p>}
    <p className="form-help">套餐商品追加到当前订单，可按客户需求调整；报价与订单金额请另行填写。</p>
    {message && <p role="status">{message}</p>}{(error || query.error) && <p className="field-error" role="alert">{errorText(error || query.error)}</p>}
  </div>;
}
