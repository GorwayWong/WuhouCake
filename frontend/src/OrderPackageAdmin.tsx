import { whenImageVisible } from './imagePreview';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ImageSquare, Plus, Trash } from '@phosphor-icons/react';
import { ApiError, creationResultUnknown, errorText, fetchPackageImage, readQuery, writeRequest, rejectedBeforeWrite } from './api';
import { packageDraftTab, readPackageDraft, savePackageDraft, removePackageDraft, packageDraftStorageMessage, PackageDraftConflict, packageCreationSlot } from './packageDraftStorage';
import type { PendingPackage, PackageDraftRecord } from './packageDraftStorage';
import { newPackageItem, packageImagePath, packageRequest, packageSummary, packageReferenceTotals, packagePricingProblem, samePackageContent } from './orderPackages';
import type { OrderPackage, PackageBody, PackageRow } from './orderPackages';
import type { Page } from './types';
import { Empty, ErrorNotice, Loading, money } from './ui';
import { focusFormField } from './formFocus';
import { time } from './dates';
import { randomUUID } from './uuid';
import { imageFileError } from './imagePreview';
import { PackageDialog } from './PackageDialog';
import { RestoreCreationDraft, SaveCreationDraft } from './CreationDraftDialog';
import type { DraftLeaveGuard } from './CreationDraftDialog';
import { editablePackage, mergePackageDraft } from './packageConflict';
import type { ConflictChoice, PackageConflict } from './packageConflict';

type Body = PackageBody;
type Pending = PendingPackage;

export function OrderPackageAdmin({ accountId, onDirtyChange, onWritingChange, onDraftLeaveChange }: {
  accountId: string;
  onDirtyChange: (dirty: boolean) => void; onWritingChange: (writing: boolean) => void;
  onDraftLeaveChange: (guard: DraftLeaveGuard | null) => void;
}) {
  const client = useQueryClient();
  const [keyword, setKeyword] = useState(''), [search, setSearch] = useState(''), [page, setPage] = useState(1);
  const params = new URLSearchParams({ keyword: search, page: String(page), size: '20' });
  const query = useQuery({ queryKey: ['order-packages', params.toString()], queryFn: ({ signal }) => readQuery<Page<OrderPackage>>(`/order-packages?${params}`, signal) });
  const [editing, setEditing] = useState<OrderPackage | 'new' | null>(null);
  const [name, setName] = useState(''), [items, setItems] = useState<PackageRow[]>([]);
  const [original, setOriginal] = useState(''), [member, setMember] = useState('');
  const [specEditor, setSpecEditor] = useState<{ itemId: string; index: number; values: Pick<PackageRow, 'specification' | 'unitPrice' | 'memberPrice'> } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null), [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false), [pending, setPending] = useState<Pending | null>(null);
  const [conflict, setConflict] = useState(false), [latest, setLatest] = useState<OrderPackage | null>(null);
  const [choices, setChoices] = useState<Record<string, ConflictChoice>>({});
  const baseline = useRef(''), creationKey = useRef(randomUUID());
  const tabId = useRef(''), storageQueue = useRef(Promise.resolve()), storageRevision = useRef<string | null>(null);
  const [restored, setRestored] = useState(false), [storageError, setStorageError] = useState('');
  const [candidate, setCandidate] = useState<PackageDraftRecord | null>(null);
  const [exit, setExit] = useState<{ leave: () => void; stay: () => void } | null>(null);
  const [exitError, setExitError] = useState('');
  const slotRevision = useRef<string | null>(null), sourceRevision = useRef<string | undefined>(undefined);
  const active = useRef<AbortController | null>(null), form = useRef<HTMLFormElement>(null);
  const dirty = Boolean(pending || editing && JSON.stringify([name, items, original, member]) !== baseline.current);
  function snapshot(operation = pending): PackageDraftRecord {
    return { accountId, tabId: tabId.current, editing, name, items, original, member, baseline: baseline.current, creationKey: creationKey.current, pending: operation };
  }
  function persist(record: PackageDraftRecord | null) {
    const next = storageQueue.current.catch(() => {}).then(async () => {
      if (record) storageRevision.current = await savePackageDraft(record, storageRevision.current);
      else { await removePackageDraft(accountId, tabId.current, storageRevision.current); storageRevision.current = null; }
    });
    storageQueue.current = next;
    return next;
  }
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        tabId.current = packageDraftTab();
        const saved = await readPackageDraft(accountId, tabId.current);
        if (!alive) return;
        if (saved) {
          storageRevision.current = saved.revision ?? null;
          if (saved.editing === 'new' && !saved.pending) {
            // 旧版会把新套餐写入当前标签页。迁移仅在共享槽为空时写入。
            const changed = JSON.stringify([saved.name, saved.items, saved.original, saved.member]) !== saved.baseline;
            if (changed && !await readPackageDraft(accountId, packageCreationSlot)) {
              try { await savePackageDraft({ ...saved, tabId: packageCreationSlot }, null); }
              catch (failure) { if (!(failure instanceof PackageDraftConflict)) throw failure; }
            }
            if (!alive) return;
            await persist(null);
            if (!alive) return;
          } else {
            setEditing(saved.editing); setName(saved.name); setItems(saved.items); setOriginal(saved.original); setMember(saved.member);
            baseline.current = saved.baseline; creationKey.current = saved.creationKey; setPending(saved.pending);
            setMessage(saved.pending ? '已恢复待核对操作，请先确认原请求结果。' : '已恢复本机暂存的套餐，请核对后保存。');
          }
        }
        setRestored(true);
      } catch { if (alive) setStorageError('本机套餐暂存无法读取，请检查浏览器存储权限后刷新重试。'); }
    })();
    return () => { alive = false; };
  }, [accountId]);
  useEffect(() => {
    if (!restored || busy || pending || editing === 'new') return;
    const record = editing ? snapshot(null) : null;
    if (!record && storageRevision.current === null) return;
    const timer = setTimeout(() => { void persist(record).then(() => setStorageError('')).catch(error => setStorageError(packageDraftStorageMessage(error, '本机套餐暂存失败，请保留当前页面，检查存储空间后重试保存。'))); }, 400);
    return () => clearTimeout(timer);
  }, [restored, busy, editing, pending, name, items, original, member]);
  useLayoutEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useLayoutEffect(() => {
    if (editing !== 'new' || !dirty || pending) return;
    onDraftLeaveChange((leave, stay) => {
      if (active.current) return false;
      setExit(current => current ?? { leave, stay });
      return true;
    });
    return () => onDraftLeaveChange(null);
  }, [editing, dirty, pending, onDraftLeaveChange]);
  useEffect(() => {
    if (query.data) { const last = Math.max(1, Math.ceil(query.data.total / query.data.size)); if (page > last) setPage(last); }
  }, [query.data, page]);
  useEffect(() => () => { active.current?.abort(); onWritingChange(false); onDirtyChange(false); }, [onWritingChange, onDirtyChange]);
  useEffect(() => { if (editing) form.current?.querySelector<HTMLInputElement>('[name="name"]')?.focus(); }, [Boolean(editing)]);

  async function start(value: OrderPackage | 'new') {
    if (!restored || active.current || pending) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError(null); setMessage('');
    try {
      if (value === 'new') {
        const saved = await readPackageDraft(accountId, packageCreationSlot);
        if (controller.signal.aborted) return;
        slotRevision.current = saved?.revision ?? null;
        if (saved) setCandidate(saved);
        else openForm('new');
      } else {
        const current = await readQuery<OrderPackage>(`/order-packages/${value.id}`, controller.signal);
        if (!controller.signal.aborted) openForm(current);
      }
    } catch (failure) { if (!controller.signal.aborted) setError(failure); }
    finally { if (active.current === controller) { active.current = null; setBusy(false); } }
  }
  function openForm(value: OrderPackage | 'new', saved?: PackageDraftRecord) {
    const next = saved ?? (value === 'new' ? { name: '', items: [newPackageItem()], original: '', member: '' } : editablePackage(value));
    baseline.current = JSON.stringify([next.name, next.items, next.original, next.member]);
    creationKey.current = saved?.creationKey ?? randomUUID();
    sourceRevision.current = saved?.revision;
    setCandidate(null); setEditing(value); setName(next.name); setItems(next.items); setOriginal(next.original); setMember(next.member);
    setErrors({}); setConflict(false); setLatest(null); setChoices({});
  }
  function closeForm() {
    setEditing(null); setItems([]); setSpecEditor(null); setError(null); setErrors({}); setConflict(false); setLatest(null);
  }
  function close() {
    if (active.current || pending) return;
    if (editing === 'new' && dirty) { setExit({ leave: closeForm, stay: () => {} }); return; }
    if (!dirty || window.confirm('套餐尚未保存，确定放弃修改吗？')) closeForm();
  }
  function finishExit(save: boolean) {
    if (!exit || active.current) return;
    const leave = () => { setExit(null); setExitError(''); exit.leave(); };
    if (!save) { leave(); return; }
    const controller = new AbortController(); active.current = controller;
    setBusy(true); onWritingChange(true); setExitError('');
    void savePackageDraft({ ...snapshot(null), tabId: packageCreationSlot, creationKey: randomUUID() }, slotRevision.current)
      .then(() => {
        if (!controller.signal.aborted) { setMessage('草稿已保存。'); leave(); }
      })
      .catch(async failure => {
        if (controller.signal.aborted) return;
        if (failure instanceof PackageDraftConflict) {
          try {
            const saved = await readPackageDraft(accountId, packageCreationSlot);
            if (controller.signal.aborted) return;
            slotRevision.current = saved?.revision ?? null;
            setExitError('其他标签页已更新草稿。再次保存将使用当前内容。');
            return;
          } catch { if (controller.signal.aborted) return; }
        }
        setExitError('草稿保存失败。请保留当前页面，检查浏览器存储空间后重试。');
      })
      .finally(() => {
        if (active.current === controller) { active.current = null; setBusy(false); onWritingChange(false); }
      });
  }
  async function success(operation: Pending) {
    try {
      if (operation.draftRevision) {
        try { await removePackageDraft(accountId, packageCreationSlot, operation.draftRevision); }
        catch (failure) { if (!(failure instanceof PackageDraftConflict)) throw failure; }
      }
      await persist(null);
    } catch (failure) {
      setStorageError(packageDraftStorageMessage(failure, '服务端结果已确认，但本机恢复记录未能清理，请重试确认。'));
      setPending(operation); setError(null); return;
    }
    setStorageError('');
    setPending(null); setError(null); setEditing(null); setItems([]); setSpecEditor(null); setConflict(false); setLatest(null);
    setMessage(operation.method === 'DELETE' ? '套餐已删除，已带入订单的商品不受影响。' : '套餐已保存，员工下单时即可选用。');
    if (operation.method === 'POST') { setSearch(''); setKeyword(''); setPage(1); }
    else if (operation.method === 'DELETE' && query.data?.items.length === 1 && page > 1) setPage(page - 1);
    void client.invalidateQueries({ queryKey: ['order-packages'] });
  }
  async function write(operation: Pending) {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); onWritingChange(true); setError(null); setMessage('');
    let sent = false;
    try {
      await persist(snapshot(operation));
      if (controller.signal.aborted) return;
      setStorageError('');
      let body: Body | FormData | undefined = operation.body;
      if (operation.files?.length) {
        const multipart = new FormData();
        multipart.append('package', new Blob([JSON.stringify(body)], { type: 'application/json' }));
        for (const { id, file } of operation.files) multipart.append(id, file);
        body = multipart;
      }
      sent = true;
      await writeRequest(operation.path, { method: operation.method, body, headers: operation.method === 'POST' ? { 'Idempotency-Key': operation.key } : undefined, signal: controller.signal });
      if (!controller.signal.aborted) await success(operation);
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (!sent) { setStorageError(packageDraftStorageMessage(failure, '本机暂存失败，尚未发送保存请求。请保留当前页面，检查存储空间后重试。')); return; }
      if (creationResultUnknown(failure) || pending?.key === operation.key && rejectedBeforeWrite(failure)) { setError(failure); setPending(operation); }
      else {
        try { await persist(editing === 'new' ? null : snapshot(null)); }
        catch (storageFailure) {
          setStorageError(packageDraftStorageMessage(storageFailure, '请求未保存，但本机恢复记录未能更新。请重试确认原操作。'));
          setError(failure); setPending(operation);
          return;
        }
        setError(failure);
        setPending(null);
        if (failure instanceof ApiError && failure.code === 'PACKAGE_NAME_CONFLICT') setErrors({ name: '套餐名称已存在，请使用可区分的名称。' });
        if (failure instanceof ApiError && failure.code === 'CONCURRENT_MODIFICATION') {
          setConflict(operation.method === 'PUT'); setLatest(null); setChoices({}); setMessage('套餐已被修改，请核对最新内容。当前输入已保留。');
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
      const current = await readQuery<OrderPackage>(`/order-packages/${operation.target!.id}`, controller.signal);
      if (controller.signal.aborted) return;
      if (operation.method === 'PUT' && samePackageContent(current, operation.body!)) await success(operation);
      else if (current.version === operation.target!.version) retry = true;
      else {
        setPending(null); setConflict(operation.method === 'PUT'); setLatest(operation.method === 'PUT' ? current : null); setChoices({});
        setMessage('套餐已有其他修改，当前输入已保留。请核对最新内容后重新操作。');
        void client.invalidateQueries({ queryKey: ['order-packages'] });
      }
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof ApiError && failure.code === 'PACKAGE_NOT_FOUND') {
        if (operation.method === 'DELETE') await success(operation);
        else { setPending(null); setError(failure); }
      } else setError(failure);
    } finally { if (active.current === controller) { active.current = null; setBusy(false); onWritingChange(false); } }
    if (retry && !controller.signal.aborted) await write(operation);
  }
  async function readLatest() {
    if (!editing || editing === 'new' || active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError(null);
    try {
      const value = await readQuery<OrderPackage>(`/order-packages/${editing.id}`, controller.signal);
      if (!controller.signal.aborted) { setLatest(value); setChoices({}); }
    } catch (failure) { if (!controller.signal.aborted) setError(failure); }
    finally { if (active.current === controller) { active.current = null; setBusy(false); } }
  }
  const merge = conflict && latest && editing && editing !== 'new'
    ? mergePackageDraft(editablePackage(editing), { name, items, original, member }, editablePackage(latest), choices)
    : null;

  function applyMerge() {
    if (!latest || !merge?.resolved) return;
    const { values, restored } = merge;
    const rows = values.items.map(item => {
      if (!restored.has(item.itemId)) return item;
      return { ...item, itemId: randomUUID(), imageId: item.file ? item.imageId : null };
    });
    const nextBase = editablePackage(latest);
    baseline.current = JSON.stringify([nextBase.name, nextBase.items, nextBase.original, nextBase.member]);
    setName(values.name); setItems(rows); setOriginal(values.original); setMember(values.member);
    setEditing(latest); setLatest(null); setChoices({}); setConflict(false); setErrors({}); setError(null);
    setMessage('已合并最新内容，请核对并保存。');
  }
  const reference = packageReferenceTotals(items);
  const disabled = busy || Boolean(pending) || !restored;
  const inputProps = (field: string) => ({ name: field, id: `package-${field}`, 'aria-invalid': Boolean(errors[field]), 'aria-describedby': errors[field] ? `package-${field}-error` : undefined });
  const fieldError = (field: string) => errors[field] && <span className="field-error" id={`package-${field}-error`}>{errors[field]}</span>;
  const updateItem = (index: number, change: Partial<PackageRow>) => { setItems(current => current.map((item, i) => i === index ? { ...item, ...change } : item)); setErrors({}); };
  return <div className="management-page package-management">
    {candidate && <RestoreCreationDraft restore={() => openForm('new', candidate)} startFresh={() => openForm('new')} cancel={() => setCandidate(null)} />}
    {exit && <SaveCreationDraft hasSaved={slotRevision.current !== null} busy={busy} error={exitError}
      stay={() => { setExit(null); setExitError(''); exit.stay(); }} discard={() => finishExit(false)} save={() => finishExit(true)} />}
    <div className="page-heading"><div><h1>{editing ? editing === 'new' ? '新建套餐' : '编辑套餐' : '套餐管理'}</h1>{!editing && <p className="muted">维护常用商品组合，供员工下单时快速填写。</p>}</div>{!editing && <button className="primary" disabled={disabled} onClick={() => void start('new')}><Plus />新建套餐</button>}</div>
    {message && <div className="notice" role="status">{message}</div>}
    {storageError && <p className="notice error" role="alert">{storageError}</p>}
    <ErrorNotice error={error} />
    {pending && <div className="notice error" role="alert"><p>操作结果尚未确认，输入已保留。请先确认原请求结果，再继续编辑。</p><button className="secondary" disabled={busy} onClick={() => void verify()}>{busy ? '正在确认…' : '确认原操作结果'}</button></div>}
    {editing ? <>
      <button className="text-button back-link" disabled={disabled} onClick={close}><ArrowLeft />返回套餐列表</button>
      <form ref={form} noValidate onSubmit={event => {
        event.preventDefault(); if (disabled || conflict) return;
        const result = packageRequest(name, items, original, member); setErrors(result.errors);
        if (!result.body) { focusFormField(form.current, Object.keys(result.errors)[0]); return; }
        void write({ method: editing === 'new' ? 'POST' : 'PUT', path: editing === 'new' ? '/order-packages' : `/order-packages/${editing.id}`,
          body: { ...result.body, ...(editing === 'new' ? {} : { expectedVersion: editing.version }) }, files: items.flatMap(item => item.file && item.imageId ? [{ id: item.imageId, file: item.file }] : []), key: creationKey.current, target: editing === 'new' ? undefined : editing, draftRevision: editing === 'new' ? sourceRevision.current : undefined });
      }}>
        <fieldset className="create-fields" disabled={disabled || conflict}>
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
                <td><button type="button" className="secondary package-spec-button" aria-label={`编辑商品 ${index + 1} 的规格`} onClick={() => setSpecEditor({ itemId: item.itemId, index, values: { specification: item.specification, unitPrice: item.unitPrice, memberPrice: item.memberPrice } })}>{item.specification ? <span>{item.specification}</span> : '填写'}</button>
                  {!item.unitPrice.trim() && !item.memberPrice.trim() && <small className="form-help">未报价</small>}
                  {fieldError(`items.${index}.unitPrice`)}{fieldError(`items.${index}.memberPrice`)}
                </td>
                <td><input {...inputProps(`items.${index}.quantity`)} aria-label={`商品 ${index + 1} 的数量`} value={item.quantity} inputMode="numeric" required onChange={event => updateItem(index, { quantity: event.target.value })} /></td>
              </tr>).flatMap((row, index) => [row, ...( ['image', 'name', 'quantity'].some(field => errors[`items.${index}.${field}`]) ?
                [<tr key={`errors-${items[index].itemId}`}><td colSpan={4} className="package-row-errors">{['image', 'name', 'quantity'].map(field => <div key={field}>{fieldError(`items.${index}.${field}`)}</div>)}</td></tr>] : [])])}</tbody>
            </table>
            {fieldError('items')}<button type="button" className="secondary package-add-row" onClick={() => setItems([...items, newPackageItem()])}><Plus />添加商品</button>
          </section>
          <section className="panel create-group"><h2>套餐金额</h2>
            {editing !== 'new' && packagePricingProblem(editing) && <p className="notice">{packagePricingProblem(editing)} 原售价：{money(editing.originalAmountCents)}；会员售价：{money(editing.memberAmountCents)}。保存后采用以下商品合计。</p>}
            <dl className="package-amount-preview">
              <div><dt>原价合计</dt><dd>{money(reference.original)}</dd></div>
              <div><dt>会员合计</dt><dd>{money(reference.member)}</dd></div>
            </dl>
            {reference.invalid ? <p className="field-error">请核对商品数量和报价，合计不能超过金额上限。</p> : <p className="form-help">按商品单价 × 数量自动计算。{reference.unpriced} 项商品未报价。</p>}
            {fieldError('original')}

          </section>
        </fieldset>
        {conflict && <section className="panel package-conflict" aria-labelledby="package-conflict-heading">
          <h2 id="package-conflict-heading">核对最新套餐</h2>
          <p>套餐已被修改，当前输入已保留。</p>
          <button type="button" className="secondary" disabled={disabled} onClick={() => void readLatest()}>读取最新版本</button>
          {merge && latest && <>
            {merge.conflicts.length > 0 ? <p>请逐项选择要保留的内容。</p> : <p>双方的修改可以合并。</p>}
            {merge.conflicts.map(entry => <PackageConflictChoice key={entry.key} entry={entry} packageId={latest.id}
              choice={choices[entry.key]} disabled={disabled}
              onChoose={choice => setChoices(current => ({ ...current, [entry.key]: choice }))} />)}
            <button type="button" className="secondary" disabled={disabled || !merge.resolved} onClick={applyMerge}>应用合并结果</button>
          </>}
        </section>}
        {specEditor && <PackageDialog title={`商品 ${specEditor.index + 1} 的规格`} onCancel={() => setSpecEditor(null)}>
          <label>单价（元）<input inputMode="decimal" value={specEditor.values.unitPrice} onChange={event => setSpecEditor({ ...specEditor, values: { ...specEditor.values, unitPrice: event.target.value } })} /></label>
          <label>会员价（元）<input inputMode="decimal" value={specEditor.values.memberPrice} onChange={event => setSpecEditor({ ...specEditor, values: { ...specEditor.values, memberPrice: event.target.value } })} /></label>
          <label>特殊要求备注<textarea autoFocus rows={5} placeholder="可换行填写，例如口味、包装和其他要求" value={specEditor.values.specification} onChange={event => setSpecEditor({ ...specEditor, values: { ...specEditor.values, specification: event.target.value } })} /></label>
          <div className="package-actions"><button type="button" className="secondary" onClick={() => setSpecEditor(null)}>取消</button>
            <button type="button" className="primary" onClick={() => { const index = items.findIndex(item => item.itemId === specEditor.itemId); if (index >= 0) updateItem(index, specEditor.values); setSpecEditor(null); }}>确认规格</button></div>
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

function PackageConflictChoice({ entry, packageId, choice, disabled, onChoose }: {
  entry: PackageConflict; packageId: string; choice?: ConflictChoice; disabled: boolean; onChoose: (choice: ConflictChoice) => void;
}) {
  return <fieldset className="package-conflict-choice" disabled={disabled}>
    <legend>{entry.label}</legend>
    <div className="package-conflict-options">
      {(['local', 'remote'] as const).map(side => {
        const value = entry[side];
        let label = side === 'local' ? '保留当前输入' : '使用最新版本';
        if (entry.kind !== 'text') {
          if (value === null) label = side === 'local' ? '保留我的删除' : '接受最新版本的删除';
          else if (entry.kind === 'row' && side === 'local' && entry.remote === null)
            label = entry.local?.file ? '保留为新商品并使用本地新图' : '保留为新商品（不带旧图）';
        }
        return <div key={side}>
          <label className="package-conflict-option">
            <input type="radio" name={`package-conflict-${entry.key}`} checked={choice === side} onChange={() => onChoose(side)} />
            {label}
          </label>
          {entry.kind === 'text' ? <p className="product-spec-text">{entry[side] || '未填写'}</p> : (() => {
            const row = entry[side];
            if (!row) return null;
            const availablePath = row.imageId && (side === 'remote' || entry.remote !== null && row.imageId === entry.remote.imageId)
              ? packageImagePath(packageId, row) : undefined;
            return <>
              {entry.kind === 'row' && <p className="product-spec-text">{row.name} × {row.quantity}
                {`\n单价：${row.unitPrice || '未填写'} · 会员价：${row.memberPrice || '未填写'}`}
                {row.specification && `\n${row.specification}`}
              </p>}
              {(row.file || availablePath) ? <PackageImagePreview file={row.file} path={availablePath} />
                : <p className="muted">{row.imageId ? '旧图已不可用，可以在应用后重新上传。' : '无图片'}</p>}
            </>;
          })()}
        </div>;
      })}
    </div>
  </fieldset>;
}

function PackageImagePreview({ file, path }: { file?: File; path?: string }) {
  const [url, setUrl] = useState(''), [problem, setProblem] = useState(''), [attempt, setAttempt] = useState(0);
  const previewElement = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    setUrl(''); setProblem('');
    return whenImageVisible(file ? null : previewElement.current, () => {
      const controller = new AbortController(); let preview = '';
      const source = file ? Promise.resolve(file) : path ? fetchPackageImage(path, controller.signal) : null;
      if (source) void source.then(blob => {
        if (!controller.signal.aborted) { preview = URL.createObjectURL(blob); setUrl(preview); }
      }).catch(error => { if (!controller.signal.aborted) setProblem(errorText(error)); });
      return () => { controller.abort(); if (preview) URL.revokeObjectURL(preview); };
    });
  }, [file, path, attempt]);
  return <span ref={previewElement} style={{ display: 'inline-block' }}>
    {url ? <img className="package-thumbnail" src={url} alt="套餐商品参考图" />
      : problem ? <button type="button" className="text-button package-row-action" title={problem} onClick={() => setAttempt(attempt + 1)}>重试</button>
        : <span className="package-thumbnail package-thumbnail-empty" aria-label={file || path ? '正在读取图片' : '未选图片'}><ImageSquare aria-hidden="true" /></span>}
  </span>;
}
