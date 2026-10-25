import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash } from '@phosphor-icons/react';
import { api, ApiError, creationResultUnknown } from './api';
import { newPackageItem, packageDraft, packageRequest, packageSummary } from './orderPackages';
import type { OrderPackage } from './orderPackages';
import type { ItemDraft } from './orderForm';
import type { Page } from './types';
import { fieldsForProduct } from './orderForm';
import { ProductTypeSelect } from './ProductTypeSelect';
import { Empty, ErrorNotice, Loading, valueText } from './ui';
import { focusFormField } from './formFocus';
import { time } from './dates';
import { randomUUID } from './uuid';
import { productTypeLabel } from './productTypes';

type Body = { name: string; items: OrderPackage['items']; expectedVersion?: number };
type Pending = { method: 'POST' | 'PUT' | 'DELETE'; path: string; body?: Body; key: string; target?: OrderPackage };

export function OrderPackageAdmin({ onDirtyChange, onWritingChange }: {
  onDirtyChange: (dirty: boolean) => void; onWritingChange: (writing: boolean) => void;
}) {
  const client = useQueryClient();
  const [keyword, setKeyword] = useState(''), [search, setSearch] = useState(''), [page, setPage] = useState(1);
  const params = new URLSearchParams({ keyword: search, page: String(page), size: '20' });
  const query = useQuery({ queryKey: ['order-packages', params.toString()], queryFn: ({ signal }) => api<Page<OrderPackage>>(`/order-packages?${params}`, { signal }) });
  const [editing, setEditing] = useState<OrderPackage | 'new' | null>(null);
  const [name, setName] = useState(''), [items, setItems] = useState<ItemDraft[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null), [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false), [pending, setPending] = useState<Pending | null>(null);
  const [conflict, setConflict] = useState(false), [latest, setLatest] = useState<OrderPackage | null>(null);
  const baseline = useRef(''), creationKey = useRef(randomUUID());
  const active = useRef<AbortController | null>(null), form = useRef<HTMLFormElement>(null);
  const dirty = Boolean(pending || editing && JSON.stringify([name, items]) !== baseline.current);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (query.data) { const last = Math.max(1, Math.ceil(query.data.total / query.data.size)); if (page > last) setPage(last); }
  }, [query.data, page]);
  useEffect(() => () => { active.current?.abort(); onWritingChange(false); onDirtyChange(false); }, [onWritingChange, onDirtyChange]);
  useEffect(() => { if (editing) form.current?.querySelector<HTMLInputElement>('[name="name"]')?.focus(); }, [Boolean(editing)]);

  async function start(value: OrderPackage | 'new') {
    if (busy || pending) return;
    if (dirty && !window.confirm('套餐尚未保存，确定放弃修改吗？')) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError(null); setMessage('');
    try {
      const current = value === 'new' ? 'new' : await api<OrderPackage>(`/order-packages/${value.id}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const nextName = current === 'new' ? '' : current.name, nextItems = current === 'new' ? [newPackageItem()] : packageDraft(current);
      baseline.current = JSON.stringify([nextName, nextItems]); creationKey.current = randomUUID();
      setEditing(current); setName(nextName); setItems(nextItems); setErrors({}); setConflict(false); setLatest(null);
    } catch (failure) { if (!controller.signal.aborted) setError(failure); }
    finally { if (active.current === controller) { active.current = null; setBusy(false); } }
  }
  function close() {
    if (busy || pending || dirty && !window.confirm('套餐尚未保存，确定放弃修改吗？')) return;
    setEditing(null); setError(null); setErrors({}); setConflict(false); setLatest(null);
  }
  function success(operation: Pending) {
    setPending(null); setError(null); setEditing(null); setConflict(false); setLatest(null);
    setMessage(operation.method === 'DELETE' ? '套餐已删除，已带入订单的商品不受影响。' : '套餐已保存，员工下单时即可选用。');
    if (operation.method === 'POST') { setSearch(''); setKeyword(''); setPage(1); }
    else if (operation.method === 'DELETE' && query.data?.items.length === 1 && page > 1) setPage(page - 1);
    void client.invalidateQueries({ queryKey: ['order-packages'] });
  }
  async function write(operation: Pending) {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); onWritingChange(true); setError(null); setMessage('');
    try {
      await api(operation.path, { method: operation.method, body: operation.body, headers: operation.method === 'POST' ? { 'Idempotency-Key': operation.key } : undefined, signal: controller.signal });
      if (!controller.signal.aborted) success(operation);
    } catch (failure) {
      if (controller.signal.aborted) return;
      setError(failure);
      if (creationResultUnknown(failure)) setPending(operation);
      else {
        setPending(null);
        if (failure instanceof ApiError && failure.code === 'PACKAGE_NAME_CONFLICT') setErrors({ name: '套餐名称已存在，请使用可区分的名称。' });
        if (failure instanceof ApiError && failure.code === 'CONCURRENT_MODIFICATION') {
          setConflict(operation.method === 'PUT'); setMessage('套餐已被修改，请核对最新内容。当前输入已保留。');
          void client.invalidateQueries({ queryKey: ['order-packages'] });
        }
      }
    } finally { if (active.current === controller) { active.current = null; setBusy(false); onWritingChange(false); } }
  }
  async function verify() {
    if (!pending || active.current) return;
    const operation = pending;
    if (operation.method === 'POST') { await write(operation); return; }
    const controller = new AbortController(); active.current = controller; setBusy(true); onWritingChange(true); setError(null);
    let retry = false;
    try {
      const current = await api<OrderPackage>(`/order-packages/${operation.target!.id}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (operation.method === 'PUT' && samePackageContent(current, operation.body!)) success(operation);
      else if (current.version === operation.target!.version) retry = true;
      else {
        setPending(null); setConflict(operation.method === 'PUT'); setLatest(operation.method === 'PUT' ? current : null);
        setMessage('套餐已有其他修改，当前输入已保留。请核对最新内容后重新操作。');
        void client.invalidateQueries({ queryKey: ['order-packages'] });
      }
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof ApiError && failure.code === 'PACKAGE_NOT_FOUND') {
        if (operation.method === 'DELETE') success(operation);
        else { setPending(null); setError(failure); }
      } else setError(failure);
    } finally { if (active.current === controller) { active.current = null; setBusy(false); onWritingChange(false); } }
    if (retry && !controller.signal.aborted) await write(operation);
  }
  async function readLatest() {
    if (!editing || editing === 'new' || active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError(null);
    try {
      const value = await api<OrderPackage>(`/order-packages/${editing.id}`, { signal: controller.signal });
      if (!controller.signal.aborted) setLatest(value);
    } catch (failure) { if (!controller.signal.aborted) setError(failure); }
    finally { if (active.current === controller) { active.current = null; setBusy(false); } }
  }
  const disabled = busy || Boolean(pending);
  const inputProps = (field: string) => ({ name: field, id: `package-${field}`, 'aria-invalid': Boolean(errors[field]), 'aria-describedby': errors[field] ? `package-${field}-error` : undefined });
  const fieldError = (field: string) => errors[field] && <span className="field-error" id={`package-${field}-error`}>{errors[field]}</span>;
  const updateItem = (index: number, change: Partial<ItemDraft>) => { setItems(current => current.map((item, i) => i === index ? { ...item, ...change } : item)); setErrors({}); };
  return <div className="management-page package-management">
    <div className="page-heading"><div><h1>{editing ? editing === 'new' ? '新建套餐' : '编辑套餐' : '套餐管理'}</h1><p className="muted">维护常用商品组合，供员工下单时快速填写。</p></div>{!editing && <button className="primary" disabled={disabled} onClick={() => void start('new')}><Plus />新建套餐</button>}</div>
    {message && <div className="notice" role="status">{message}</div>}
    <ErrorNotice error={error} />
    {pending && <div className="notice error" role="alert"><p>操作结果尚未确认，输入已保留。请先确认原请求结果，再继续编辑。</p><button className="secondary" disabled={busy} onClick={() => void verify()}>{busy ? '正在确认…' : '确认原操作结果'}</button></div>}
    {editing ? <>
      <button className="text-button back-link" disabled={disabled} onClick={close}><ArrowLeft />返回套餐列表</button>
      <form ref={form} noValidate onSubmit={event => {
        event.preventDefault(); if (disabled || conflict) return;
        const result = packageRequest(name, items); setErrors(result.errors);
        if (!result.body) { focusFormField(form.current, Object.keys(result.errors)[0]); return; }
        void write({ method: editing === 'new' ? 'POST' : 'PUT', path: editing === 'new' ? '/order-packages' : `/order-packages/${editing.id}`,
          body: { ...result.body, ...(editing === 'new' ? {} : { expectedVersion: editing.version }) }, key: creationKey.current, target: editing === 'new' ? undefined : editing });
      }}>
        <fieldset className="create-fields" disabled={disabled}>
          <section className="panel create-group"><label className="package-name">套餐名称 *<input {...inputProps('name')} value={name} maxLength={80} placeholder="例如：下午茶套餐" onChange={event => { setName(event.target.value); setErrors({}); }} required />{fieldError('name')}</label><p className="form-help">名称用于下单时识别，不能与现有套餐重名。</p></section>
          <section className="panel create-group"><div className="section-heading"><h2>商品内容</h2><span className="muted">{items.length} 项商品</span></div><p className="form-help">规格可留空，下单时补充。祝福语和特殊要求仅填写通用内容，客户专属内容请在下单时填写。</p>
            {items.map((item, index) => <div className="create-item" key={item.key}><div className="create-item-heading"><h3>商品 {index + 1}</h3><button type="button" className="text-button danger" disabled={disabled || items.length === 1} aria-label={`移除商品 ${index + 1}`} onClick={() => { setItems(items.filter((_, i) => i !== index)); setErrors({}); }}><Trash />移除</button></div>
              <div className="create-grid">
                <label className="form-wide" htmlFor={`package-items.${index}.name`}>商品名称 *<input {...inputProps(`items.${index}.name`)} value={item.name} maxLength={128} required onChange={event => updateItem(index, { name: event.target.value })} />{fieldError(`items.${index}.name`)}</label>
                <label htmlFor={`package-items.${index}.productType`}>商品类型 *<ProductTypeSelect {...inputProps(`items.${index}.productType`)} value={item.productType} disabled={disabled} required onChange={value => updateItem(index, { productType: value })} />{fieldError(`items.${index}.productType`)}</label>
                <label htmlFor={`package-items.${index}.quantity`}>数量 *<input {...inputProps(`items.${index}.quantity`)} value={item.quantity} inputMode="numeric" required onChange={event => updateItem(index, { quantity: event.target.value })} />{fieldError(`items.${index}.quantity`)}</label>
                {fieldsForProduct(item.productType).map(([key, label]) => { const field = `items.${index}.${key}`; return <label key={key} className={key === 'requirements' ? 'form-wide' : undefined} htmlFor={`package-${field}`}>{key === 'size' ? '尺寸（寸，只填数字）' : label}{key === 'requirements' ? <textarea {...inputProps(field)} rows={2} value={item.attributes[key]} onChange={event => updateItem(index, { attributes: { ...item.attributes, [key]: event.target.value } })} /> : <input {...inputProps(field)} value={item.attributes[key]} inputMode={key === 'size' ? 'decimal' : undefined} onChange={event => updateItem(index, { attributes: { ...item.attributes, [key]: event.target.value } })} />}{fieldError(field)}</label>; })}
              </div>
            </div>)}
            {fieldError('items')}<button type="button" className="secondary" onClick={() => setItems([...items, newPackageItem()])}><Plus />添加商品</button>
          </section>
        </fieldset>
        {conflict && <section className="panel package-conflict"><h2>核对最新套餐</h2><p>套餐已被修改，请核对最新内容。当前编辑内容仍保留在上方。</p><button type="button" className="secondary" disabled={disabled} onClick={() => void readLatest()}>读取最新版本</button>{latest && <><h3>{latest.name} · 版本 {latest.version}</h3>{latest.items.map((item, i) => <div key={i}><strong>{item.name} × {item.quantity} · {productTypeLabel(item.productType)}</strong><p>{valueText(item.attributes) || '规格未填写'}</p></div>)}<button type="button" className="secondary" disabled={disabled} onClick={() => { if (window.confirm('已核对最新套餐，下一次保存将使用上方当前输入更新此版本。确定继续吗？')) { setEditing(latest); setConflict(false); setLatest(null); setError(null); setMessage('已采用最新版本号，请继续调整上方内容后保存。'); } }}>已核对，继续编辑当前内容</button></>}</section>}
        <div className="create-submit package-actions"><button type="button" className="secondary" disabled={disabled} onClick={close}>取消</button><button className="primary" disabled={disabled || conflict}>{busy ? '正在保存…' : editing === 'new' ? '保存套餐' : '保存修改'}</button></div>
      </form>
    </> : <>
      <section className="panel"><form onSubmit={event => { event.preventDefault(); setSearch(keyword.trim()); setPage(1); if (search === keyword.trim()) void query.refetch(); }}><fieldset className="package-actions" disabled={disabled}><label>搜索套餐<input value={keyword} maxLength={80} placeholder="输入套餐名称" onChange={event => setKeyword(event.target.value)} /></label><button className="secondary">搜索</button></fieldset></form></section>
      <ErrorNotice error={query.error} retry={() => void query.refetch()} />
      {query.isPending ? <Loading /> : query.data?.items.length ? <><section className="panel package-list" aria-label="套餐列表">{query.data.items.map(value => <article className="package-list-item" key={value.id}><div className="package-list-content"><h2>{value.name}</h2><p className="package-summary">{value.items.length} 项商品：{packageSummary(value)}</p><p className="muted">最近修改：{time(value.updatedAt || null, true)}</p></div><div className="package-actions"><button className="secondary" disabled={disabled} onClick={() => void start(value)}>编辑</button><button className="text-button danger" disabled={disabled} onClick={() => {
        if (window.confirm(`删除“${value.name}”后，将无法再次选择。已经带入订单的商品不受影响。`)) void write({ method: 'DELETE', path: `/order-packages/${value.id}?expectedVersion=${value.version}`, key: randomUUID(), target: value });
      }}>删除</button></div></article>)}</section><div className="package-pagination"><span>共 {query.data.total} 个套餐 · 第 {page} 页</span><div className="package-actions"><button className="secondary" disabled={disabled || page === 1} onClick={() => setPage(page - 1)}>上一页</button><button className="secondary" disabled={disabled || page * 20 >= query.data.total} onClick={() => setPage(page + 1)}>下一页</button></div></div></> : !query.error && <section className="panel"><Empty>{search ? '没有匹配的套餐，请调整搜索内容。' : '还没有套餐'}</Empty>{!search && <div className="package-empty-action"><button className="primary" disabled={disabled} onClick={() => void start('new')}><Plus />新建套餐</button></div>}</section>}
    </>}
  </div>;
}

function samePackageContent(current: OrderPackage, body: Body) {
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value;
  return JSON.stringify(stable({ name: current.name, items: current.items })) === JSON.stringify(stable({ name: body.name, items: body.items }));
}
