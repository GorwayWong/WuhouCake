import { ProductFieldLabel, ProductFormFields } from './ProductFormFields';
import { firstItemFormError } from './productFormLayout';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError, creationResultUnknown } from './api';
import { canEditItems, changeItemDraft, itemChangeRequest, itemDraft, itemInput, newItem, textSpecification } from './orderForm';
import type { Detail, ItemAddRequest, ItemChangeRequest } from './types';
import { ErrorNotice, Product, valueText } from './ui';
import { ProductTypeSelect } from './ProductTypeSelect';
import { focusFormField } from './formFocus';

function Field({ name, label, error, children, className }: { name: string; label: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return <label htmlFor={`item-${name}`} className={className}><span className="form-field-heading">{label}</span>{children}{error && <span className="field-error" id={`item-${name}-error`}>{error}</span>}</label>;
}
export function ItemEdit({ initial, itemId, latest, reopened, busy, error, onSave, onCancel, onDirtyChange, onSaveUnchanged }: {
  initial: Detail; itemId?: string; latest: Detail; reopened?: Detail; busy: boolean; error: unknown;
  onSave: (request: ItemChangeRequest | ItemAddRequest) => Promise<unknown>; onSaveUnchanged?: () => Promise<unknown>; onCancel: () => void; onDirtyChange: (dirty: boolean) => void;
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
      focusFormField(form.current, firstItemFormError(result.errors, draft.productType, true)!);
      return;
    }
    if (!result.request) { try { if (onSaveUnchanged) await onSaveUnchanged(); else onCancel(); } catch { /* 保存错误由父级操作提示展示。 */ } return; }
    attemptedVersion.current = result.request.expectedVersion;
    try { await onSave(result.request); }
    catch (error) {
      if (error instanceof ApiError && error.code === 'CONCURRENT_MODIFICATION') { setConflict(true); setBaseline(null); }
    }
  }}>
    <fieldset className="create-fields" disabled={busy}>
      <div className="create-item-heading product-form-heading"><h3>商品信息</h3><Field className="product-type-field" name="productType" label="商品类型" error={errors.productType}><ProductTypeSelect disabled={busy} {...props('productType')} value={draft.productType} onChange={value => change(changeItemDraft(draft, { productType: value }))} /></Field></div>
      <ProductFormFields type={draft.productType} prices renderField={field => {
        const required = field === 'name' || field === 'quantity';
        if (field === 'name' || field === 'quantity' || field === 'unitPrice' || field === 'memberPrice') return <Field name={field} label={<ProductFieldLabel field={field} required={required} />} error={errors[field]}>
          <input {...props(field)} autoFocus={field === 'name'} value={draft[field]} inputMode={field === 'quantity' ? 'numeric' : field.endsWith('Price') ? 'decimal' : undefined} maxLength={field === 'name' ? 128 : undefined} required={required} placeholder={field.endsWith('Price') ? '未填写' : undefined} onChange={event => change(changeItemDraft(draft, { [field]: event.target.value }))} />
        </Field>;
        const structured = !textSpecification(original?.attributes[field]) || !textSpecification((baseline || latest).items.find(item => item.itemId === itemId)?.attributes[field]);
        return <Field name={field} label={<ProductFieldLabel field={field} />} error={errors[field]}>{structured ? <span className="preserved-specification">{valueText(current?.attributes[field] ?? original?.attributes[field])}<small>此规格保留原值。</small></span> : (field === 'requirements' || field === 'filling' || field === 'specification') ? <textarea {...props(field)} rows={2} value={draft.attributes[field] || ''} onChange={event => change(changeItemDraft(draft, { attributes: { ...draft.attributes, [field]: event.target.value } }, field))} /> : <input {...props(field)} inputMode={field === 'size' ? 'decimal' : undefined} value={draft.attributes[field] || ''} onChange={event => change(changeItemDraft(draft, { attributes: { ...draft.attributes, [field]: event.target.value } }, field))} />}</Field>;
      }} />
      <p className="form-help">商品报价不改变订单总额。{!itemId && latest.status !== 'CAKE_BASE' && '追加商品后需重新确认制作进度。'}</p>
      <ErrorNotice error={unknownAddition ? null : error} />
      {unknownAddition && <p className="notice error" role="alert">追加结果未确认，输入已保留。请先核对商品列表和记录，再决定是否重试。</p>}
      {unavailable && <p className="notice" role="status">{itemId && !current ? '商品已移除，输入已保留。请取消编辑并核对订单。' : latest.status === 'WAITING_DELIVERY' ? '订单已待交接，输入已保留。请先退回装饰，核对后保存。' : '订单状态已变，暂不能编辑。输入已保留，请核对状态。'}</p>}
      {(conflict || stale) && <div className="information-review"><p className="notice" role="status">{stale ? '订单已更新，输入已保留。核对最新内容后再保存。' : '已核对，请确认修改后保存。'}{!baseline && !canReview && '请先刷新订单。'}</p><h3>最新订单（用于核对）</h3><p>{latest.items.length} 件商品 · {canEditItems(latest) ? '允许修改商品' : '当前不允许修改商品'}</p>{itemId ? current && <Product item={current} prices /> : latest.items.map(item => <Product key={item.itemId} item={item} prices />)}{stale && <button type="button" className="secondary" disabled={!canReview || unavailable} onClick={() => { setBaseline(latest); setConflict(true); }}>已核对最新版本，继续编辑</button>}</div>}
      <div className="actions"><button className="primary" disabled={busy || stale || unavailable}>{busy ? '正在保存…' : '保存'}</button><button type="button" className="secondary" onClick={onCancel}>取消</button></div>
    </fieldset>
  </form>;
}
