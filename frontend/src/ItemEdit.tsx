import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError, creationResultUnknown } from './api';
import { canEditItems, changeItemDraft, itemChangeRequest, itemDraft, itemInput, newItem, fieldsForProduct, textSpecification } from './orderForm';
import type { Detail, ItemAddRequest, ItemChangeRequest } from './types';
import { ErrorNotice, Product, valueText } from './ui';
import { ProductTypeSelect } from './ProductTypeSelect';
import { focusFormField } from './formFocus';

function Field({ name, label, error, children, wide = false }: { name: string; label: string; error?: string; children: ReactNode; wide?: boolean }) {
  return <label htmlFor={`item-${name}`} className={wide ? 'form-wide' : undefined}>{label}{children}{error && <span className="field-error" id={`item-${name}-error`}>{error}</span>}</label>;
}
export function ItemEdit({ initial, itemId, latest, reopened, busy, error, onSave, onCancel, onDirtyChange }: {
  initial: Detail; itemId?: string; latest: Detail; reopened?: Detail; busy: boolean; error: unknown;
  onSave: (request: ItemChangeRequest | ItemAddRequest) => Promise<unknown>; onCancel: () => void; onDirtyChange: (dirty: boolean) => void;
}) {
  busy = busy || Boolean(latest.deletion || latest.deleted);
  const original = initial.items.find(item => item.itemId === itemId);
  const [initialDraft] = useState(() => original ? itemDraft(original) : newItem());
  const [draft, setDraft] = useState(initialDraft);
  const [baseline, setBaseline] = useState<Detail | null>(initial);
  const [conflict, setConflict] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const attemptedVersion = useRef(initial.version);
  const form = useRef<HTMLFormElement>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initialDraft);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  useEffect(() => {
    if (reopened) { setBaseline(reopened); setConflict(true); }
  }, [reopened]);
  const stale = !baseline || latest.version > baseline.version;
  const canReview = latest.version > (baseline?.version ?? attemptedVersion.current);
  const current = latest.items.find(item => item.itemId === itemId);
  const unavailable = !canEditItems(latest) || Boolean(itemId && !current);
  const unknownAddition = !itemId && creationResultUnknown(error);
  const change = (next: typeof draft) => {
    if (next.attributes.size !== draft.attributes.size && !/^[0-9]{0,9}(?:\.[0-9]{0,2})?$/.test(next.attributes.size)) { setErrors({ size: '尺寸只能填写数字，最多两位小数。' }); return; }
    setDraft(next); setErrors({});
  };
  const props = (name: string) => ({ id: `item-${name}`, name, 'aria-invalid': Boolean(errors[name]), 'aria-describedby': errors[name] ? `item-${name}-error` : undefined });
  return <form className="item-form" ref={form} noValidate onSubmit={async event => {
    event.preventDefault();
    if (busy || !baseline || stale || unavailable) return;
    const input = itemInput(draft);
    const result = itemId ? itemChangeRequest(initial, itemId, draft, baseline) : { request: input.item ? { expectedVersion: baseline.version, item: input.item } : null, errors: input.errors };
    setErrors(result.errors);
    if (Object.keys(result.errors).length) {
      focusFormField(form.current, Object.keys(result.errors)[0]);
      return;
    }
    if (!result.request) { onCancel(); return; }
    attemptedVersion.current = result.request.expectedVersion;
    try { await onSave(result.request); }
    catch (error) {
      if (error instanceof ApiError && error.code === 'CONCURRENT_MODIFICATION') { setConflict(true); setBaseline(null); }
    }
  }}>
    <fieldset className="create-fields" disabled={busy}>
      <div className="create-grid">
        {((['name', 'productType', 'quantity', 'unitPrice', 'memberPrice']) as ('name' | 'productType' | 'quantity' | 'unitPrice' | 'memberPrice')[]).map((name, index) => <Field key={name} name={name} label={{ name: '商品名称 *', productType: '商品类型', quantity: '数量 *', unitPrice: '商品单价（元）', memberPrice: '会员单价（元）' }[name]} error={errors[name]} wide={name === 'name'}>{name === 'productType' ? <ProductTypeSelect disabled={busy} {...props(name)} value={draft.productType} onChange={value => change(changeItemDraft(draft, { productType: value }))} /> : <input {...props(name)} autoFocus={index === 0} value={draft[name]} inputMode={name === 'quantity' ? 'numeric' : name.endsWith('Price') ? 'decimal' : undefined} maxLength={name === 'name' ? 128 : undefined} required={name === 'name' || name === 'quantity'} placeholder={name.endsWith('Price') ? '未填写' : undefined} onChange={event => change(changeItemDraft(draft, { [name]: event.target.value }))} />}</Field>)}
        {fieldsForProduct(draft.productType).map(([key, label]) => {
          const structured = !textSpecification(original?.attributes[key]) || !textSpecification((baseline || latest).items.find(item => item.itemId === itemId)?.attributes[key]);
          return <Field key={key} name={key} label={key === 'size' ? '尺寸（寸，只填数字）' : label} error={errors[key]} wide={key === 'requirements'}>{structured ? <span className="preserved-specification">{valueText(current?.attributes[key] ?? original?.attributes[key])}<small>此规格保留原值。</small></span> : key === 'requirements' ? <textarea {...props(key)} rows={2} value={draft.attributes[key] || ''} onChange={event => change(changeItemDraft(draft, { attributes: { ...draft.attributes, [key]: event.target.value } }, key))} /> : <input {...props(key)} inputMode={key === 'size' ? 'decimal' : undefined} value={draft.attributes[key] || ''} onChange={event => change(changeItemDraft(draft, { attributes: { ...draft.attributes, [key]: event.target.value } }, key))} />}</Field>;
        })}
      </div>
      <p className="form-help">商品报价不改变订单总额。{!itemId && latest.status === 'PROCESSING' && '追加商品后需重新确认制作进度。'}</p>
      <ErrorNotice error={unknownAddition ? null : error} />
      {unknownAddition && <p className="notice error" role="alert">追加结果未确认，输入已保留。请先核对商品列表和记录，再决定是否重试。</p>}
      {unavailable && <p className="notice" role="status">{itemId && !current ? '商品已移除，输入已保留。请取消编辑并核对订单。' : ['WAITING_DELIVERY', 'WAITING_PICKUP'].includes(latest.status) ? '订单已待交接，输入已保留。请先退回“其他已确认”，核对后保存。' : '订单状态已变，暂不能编辑。输入已保留，请核对状态。'}</p>}
      {(conflict || stale) && <div className="information-review"><p className="notice" role="status">{stale ? '订单已更新，输入已保留。核对最新内容后再保存。' : '已核对，请确认修改后保存。'}{!baseline && !canReview && '请先刷新订单。'}</p><h3>最新订单（用于核对）</h3><p>{latest.items.length} 件商品 · {canEditItems(latest) ? '允许修改商品' : '当前不允许修改商品'}</p>{itemId ? current && <Product item={current} prices /> : latest.items.map(item => <Product key={item.itemId} item={item} prices />)}{stale && <button type="button" className="secondary" disabled={!canReview || unavailable} onClick={() => { setBaseline(latest); setConflict(true); }}>已核对最新版本，继续编辑</button>}</div>}
      <div className="actions"><button className="primary" disabled={busy || stale || unavailable}>{busy ? '正在保存…' : '保存'}</button><button type="button" className="secondary" onClick={onCancel}>取消</button></div>
    </fieldset>
  </form>;
}
