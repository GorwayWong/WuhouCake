import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ImageSquare, Plus, Trash } from '@phosphor-icons/react';
import { api, ApiError, creationResultUnknown, errorText, fetchPackageImage } from './api';
import { newPackageItem, packageDraft, packageImagePath, packageRequest, packageSummary } from './orderPackages';
import type { OrderPackage, PackageBody, PackageRow } from './orderPackages';
import type { Page } from './types';
import { Empty, ErrorNotice, Loading, money } from './ui';
import { focusFormField } from './formFocus';
import { time } from './dates';
import { randomUUID } from './uuid';
import { exactYuan } from './money';
import { imageFileError } from './imagePreview';
import { PackageDialog } from './PackageDialog';

const priceText = (cents: number | null) => cents == null ? '' : exactYuan(cents);
type Body = PackageBody;
type Pending = { method: 'POST' | 'PUT' | 'DELETE'; path: string; body?: Body; key: string; target?: OrderPackage; files?: { id: string; file: File }[] };

export function OrderPackageAdmin({ onDirtyChange, onWritingChange }: {
  onDirtyChange: (dirty: boolean) => void; onWritingChange: (writing: boolean) => void;
}) {
  const client = useQueryClient();
  const [keyword, setKeyword] = useState(''), [search, setSearch] = useState(''), [page, setPage] = useState(1);
  const params = new URLSearchParams({ keyword: search, page: String(page), size: '20' });
  const query = useQuery({ queryKey: ['order-packages', params.toString()], queryFn: ({ signal }) => api<Page<OrderPackage>>(`/order-packages?${params}`, { signal }) });
  const [editing, setEditing] = useState<OrderPackage | 'new' | null>(null);
  const [name, setName] = useState(''), [items, setItems] = useState<PackageRow[]>([]);
  const [original, setOriginal] = useState(''), [member, setMember] = useState('');
  const [specEditor, setSpecEditor] = useState<{ itemId: string; index: number; value: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null), [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false), [pending, setPending] = useState<Pending | null>(null);
  const [conflict, setConflict] = useState(false), [latest, setLatest] = useState<OrderPackage | null>(null);
  const baseline = useRef(''), creationKey = useRef(randomUUID());
  const active = useRef<AbortController | null>(null), form = useRef<HTMLFormElement>(null);
  const dirty = Boolean(pending || editing && JSON.stringify([name, items, original, member]) !== baseline.current);
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
      const nextOriginal = current === 'new' ? '' : priceText(current.originalAmountCents);
      const nextMember = current === 'new' ? '' : priceText(current.memberAmountCents);
      baseline.current = JSON.stringify([nextName, nextItems, nextOriginal, nextMember]); creationKey.current = randomUUID();
      setEditing(current); setName(nextName); setItems(nextItems); setOriginal(nextOriginal); setMember(nextMember); setErrors({}); setConflict(false); setLatest(null);
    } catch (failure) { if (!controller.signal.aborted) setError(failure); }
    finally { if (active.current === controller) { active.current = null; setBusy(false); } }
  }
  function close() {
    if (busy || pending || dirty && !window.confirm('套餐尚未保存，确定放弃修改吗？')) return;
    setEditing(null); setItems([]); setSpecEditor(null); setError(null); setErrors({}); setConflict(false); setLatest(null);
  }
  function success(operation: Pending) {
    setPending(null); setError(null); setEditing(null); setItems([]); setSpecEditor(null); setConflict(false); setLatest(null);
    setMessage(operation.method === 'DELETE' ? '套餐已删除，已带入订单的商品不受影响。' : '套餐已保存，员工下单时即可选用。');
    if (operation.method === 'POST') { setSearch(''); setKeyword(''); setPage(1); }
    else if (operation.method === 'DELETE' && query.data?.items.length === 1 && page > 1) setPage(page - 1);
    void client.invalidateQueries({ queryKey: ['order-packages'] });
  }
  async function write(operation: Pending) {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); onWritingChange(true); setError(null); setMessage('');
    try {
      let body: Body | FormData | undefined = operation.body;
      if (operation.files?.length) {
        const multipart = new FormData();
        multipart.append('package', new Blob([JSON.stringify(body)], { type: 'application/json' }));
        for (const { id, file } of operation.files) multipart.append(id, file);
        body = multipart;
      }
      await api(operation.path, { method: operation.method, body, headers: operation.method === 'POST' ? { 'Idempotency-Key': operation.key } : undefined, signal: controller.signal });
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
  const updateItem = (index: number, change: Partial<PackageRow>) => { setItems(current => current.map((item, i) => i === index ? { ...item, ...change } : item)); setErrors({}); };
  return <div className="management-page package-management">
    <div className="page-heading"><div><h1>{editing ? editing === 'new' ? '新建套餐' : '编辑套餐' : '套餐管理'}</h1>{!editing && <p className="muted">维护常用商品组合，供员工下单时快速填写。</p>}</div>{!editing && <button className="primary" disabled={disabled} onClick={() => void start('new')}><Plus />新建套餐</button>}</div>
    {message && <div className="notice" role="status">{message}</div>}
    <ErrorNotice error={error} />
    {pending && <div className="notice error" role="alert"><p>操作结果尚未确认，输入已保留。请先确认原请求结果，再继续编辑。</p><button className="secondary" disabled={busy} onClick={() => void verify()}>{busy ? '正在确认…' : '确认原操作结果'}</button></div>}
    {editing ? <>
      <button className="text-button back-link" disabled={disabled} onClick={close}><ArrowLeft />返回套餐列表</button>
      <form ref={form} noValidate onSubmit={event => {
        event.preventDefault(); if (disabled || conflict) return;
        const result = packageRequest(name, items, original, member); setErrors(result.errors);
        if (!result.body) { focusFormField(form.current, Object.keys(result.errors)[0]); return; }
        void write({ method: editing === 'new' ? 'POST' : 'PUT', path: editing === 'new' ? '/order-packages' : `/order-packages/${editing.id}`,
          body: { ...result.body, ...(editing === 'new' ? {} : { expectedVersion: editing.version }) }, files: items.flatMap(item => item.file && item.imageId ? [{ id: item.imageId, file: item.file }] : []), key: creationKey.current, target: editing === 'new' ? undefined : editing });
      }}>
        <fieldset className="create-fields" disabled={disabled}>
          <section className="panel create-group"><label className="package-name">套餐名称 *<input {...inputProps('name')} value={name} maxLength={80} placeholder="例如：下午茶套餐" onChange={event => { setName(event.target.value); setErrors({}); }} required />{fieldError('name')}</label></section>
          <section className="panel create-group"><div className="section-heading"><h2>商品内容</h2><span className="muted">{items.length} 项商品</span></div>
            <table className="package-items-table"><thead><tr><th scope="col">图片</th><th scope="col">名称</th><th scope="col">规格</th><th scope="col">数量</th></tr></thead>
              <tbody>{items.map((item, index) => <tr key={item.itemId}>
                <td><PackageImagePreview file={item.file} path={editing !== 'new' && item.imageId && !item.file ? packageImagePath(editing.id, item) : undefined} />
                  <label className="package-image-select"><span>{item.imageId ? '换图' : '选图'}</span><input {...inputProps(`items.${index}.image`)} type="file" accept="image/jpeg,image/png" aria-label={`商品 ${index + 1} 的图片`} onChange={event => {
                    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
                    const problem = imageFileError(file);
                    if (problem) { setErrors({ [`items.${index}.image`]: problem }); return; }
                    updateItem(index, { file, imageId: randomUUID() });
                  }} /></label>
                  {item.imageId && <button type="button" className="text-button package-row-action" aria-label={`删除商品 ${index + 1} 的图片`} onClick={() => updateItem(index, { file: undefined, imageId: null })}>删图</button>}
                </td>
                <td><input {...inputProps(`items.${index}.name`)} aria-label={`商品 ${index + 1} 的名称`} value={item.name} maxLength={128} placeholder="商品名称" required onChange={event => updateItem(index, { name: event.target.value })} />
                  <button type="button" className="text-button danger package-row-action" disabled={items.length === 1} aria-label={`移除商品 ${index + 1}`} onClick={() => { setItems(items.filter((_, i) => i !== index)); setErrors({}); }}><Trash aria-hidden="true" />移除</button>
                </td>
                <td><button type="button" className="secondary package-spec-button" aria-label={`编辑商品 ${index + 1} 的规格`} onClick={() => setSpecEditor({ itemId: item.itemId, index, value: item.specification })}>{item.specification ? <span>{item.specification}</span> : '填写'}</button></td>
                <td><input {...inputProps(`items.${index}.quantity`)} aria-label={`商品 ${index + 1} 的数量`} value={item.quantity} inputMode="numeric" required onChange={event => updateItem(index, { quantity: event.target.value })} /></td>
              </tr>).flatMap((row, index) => [row, ...( ['image', 'name', 'quantity'].some(field => errors[`items.${index}.${field}`]) ?
                [<tr key={`errors-${items[index].itemId}`}><td colSpan={4} className="package-row-errors">{['image', 'name', 'quantity'].map(field => <div key={field}>{fieldError(`items.${index}.${field}`)}</div>)}</td></tr>] : [])])}</tbody>
            </table>
            {fieldError('items')}<button type="button" className="secondary package-add-row" onClick={() => setItems([...items, newPackageItem()])}><Plus />添加商品</button>
          </section>
          <section className="panel create-group"><h2>套餐金额</h2>
            {editing !== 'new' && editing.originalAmountCents == null && <p className="form-help">此套餐尚未设置原价，请补齐后保存。</p>}
            <div className="create-grid order-pricing-fields">
              <label>原价（元） *<input {...inputProps('original')} value={original} inputMode="decimal" required onChange={event => { setOriginal(event.target.value); setErrors({}); }} />{fieldError('original')}</label>
              <label>会员价（元）<input {...inputProps('member')} value={member} inputMode="decimal" onChange={event => { setMember(event.target.value); setErrors({}); }} />{fieldError('member')}</label>
            </div>
          </section>
        </fieldset>
        {conflict && <section className="panel package-conflict"><h2>核对最新套餐</h2><p>套餐已被修改，请核对最新内容。当前编辑内容仍保留在上方。</p><button type="button" className="secondary" disabled={disabled} onClick={() => void readLatest()}>读取最新版本</button>{latest && <><h3>{latest.name} · 版本 {latest.version}</h3><p>原价 {money(latest.originalAmountCents)} · 会员价 {money(latest.memberAmountCents)}</p>{latest.items.map(item => <div key={item.itemId}><strong>{item.name} × {item.quantity}</strong><p className="product-spec-text">{String(item.attributes.specification ?? '规格未填写')}</p>{item.imageId && <PackageImagePreview path={packageImagePath(latest.id, item)} />}</div>)}<button type="button" className="secondary" disabled={disabled} onClick={() => { if (window.confirm('已核对最新套餐，下一次保存将使用上方当前输入更新此版本。确定继续吗？')) { setEditing(latest); setConflict(false); setLatest(null); setError(null); setMessage('已采用最新版本号，请继续调整上方内容后保存。'); } }}>已核对，继续编辑当前内容</button></>}</section>}
        {specEditor && <PackageDialog title={`商品 ${specEditor.index + 1} 的规格`} onCancel={() => setSpecEditor(null)}>
          <label>规格说明<textarea autoFocus rows={5} placeholder="可换行填写，例如口味、包装和其他要求" value={specEditor.value} onChange={event => setSpecEditor({ ...specEditor, value: event.target.value })} /></label>
          <div className="package-actions"><button type="button" className="secondary" onClick={() => setSpecEditor(null)}>取消</button>
            <button type="button" className="primary" onClick={() => { const index = items.findIndex(item => item.itemId === specEditor.itemId); if (index >= 0) updateItem(index, { specification: specEditor.value }); setSpecEditor(null); }}>确认规格</button></div>
        </PackageDialog>}
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
  return JSON.stringify(stable({ name: current.name, items: current.items, originalAmountCents: current.originalAmountCents, memberAmountCents: current.memberAmountCents })) === JSON.stringify(stable({ name: body.name, items: body.items, originalAmountCents: body.originalAmountCents, memberAmountCents: body.memberAmountCents }));
}

function PackageImagePreview({ file, path }: { file?: File; path?: string }) {
  const [url, setUrl] = useState(''), [problem, setProblem] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let preview = '';
    setUrl(''); setProblem('');
    if (file || path) void (file ? Promise.resolve(file) : fetchPackageImage(path!, controller.signal)).then(blob => {
      if (!controller.signal.aborted) { preview = URL.createObjectURL(blob); setUrl(preview); }
    }).catch(error => { if (!controller.signal.aborted) setProblem(errorText(error)); });
    return () => { controller.abort(); if (preview) URL.revokeObjectURL(preview); };
  }, [file, path, attempt]);
  if (url) return <img className="package-thumbnail" src={url} alt="套餐商品参考图" />;
  if (problem) return <button type="button" className="text-button package-row-action" title={problem} onClick={() => setAttempt(attempt + 1)}>重试</button>;
  return <span className="package-thumbnail package-thumbnail-empty" aria-label={file || path ? '正在读取图片' : '未选图片'}><ImageSquare aria-hidden="true" /></span>;
}
