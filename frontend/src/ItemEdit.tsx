import { ProductFieldLabel, ProductFormFields } from './ProductFormFields';
import { firstItemFormError } from './productFormLayout';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError, creationResultUnknown } from './api';
import { canEditItems, changeItemDraft, conversionNeedsReview, itemChangeRequest, itemDraft, itemInput, newItem, textSpecification } from './orderForm';
import type { Detail, ItemAddRequest, ItemChangeRequest } from './types';
import { ErrorNotice, Product, valueText } from './ui';
import { ProductTypeSelect } from './ProductTypeSelect';
import { focusFormField } from './formFocus';
import { visibleSpecification } from './specificationText';

function Field({ name, label, error, children, className }: { name: string; label: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return <label htmlFor={`item-${name}`} className={className}><span className="form-field-heading">{label}</span>{children}{error && <span className="field-error" id={`item-${name}-error`}>{error}</span>}</label>;
}
export function ItemEdit({ initial, itemId, latest, reopened, busy, error, onSave, onCancel, onDirtyChange, onSaveUnchanged, prices = true }: {
  prices?: boolean; initial: Detail; itemId?: string; latest: Detail; reopened?: Detail; busy: boolean; error: unknown;
  onSave: (request: ItemChangeRequest | ItemAddRequest) => Promise<unknown>; onSaveUnchanged?: () => Promise<unknown>; onCancel: () => void; onDirtyChange: (dirty: boolean) => void;
}) {
  busy = busy || Boolean(latest.deletion || latest.deleted);
  const original = initial.items.find(item => item.itemId === itemId);
  const [initialDraft] = useState(() => original ? itemDraft(original) : newItem());
  const [draft, setDraft] = useState(initialDraft);
  const [baseline, setBaseline] = useState<Detail | null>(initial);
  const [conversionSource, setConversionSource] = useState(original);
  const [previousSpecification, setPreviousSpecification] = useState<string | null>(null);
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
  const needsConversionReview = Boolean(original && current && conversionSource && conversionNeedsReview(conversionSource, current, draft, original.productType));
  const unavailable = !canEditItems(latest) || Boolean(itemId && !current);
  const unknownAddition = !itemId && creationResultUnknown(error);
  const change = (next: typeof draft) => {
    if (next.attributes.size !== draft.attributes.size && !/^[0-9]{0,9}(?:\.[0-9]{0,2})?$/.test(next.attributes.size)) { setErrors({ size: '尺寸只能填写数字，最多两位小数。' }); return; }
    setDraft(next); setErrors({});
  };
  const props = (name: string) => ({ id: `item-${name}`, name, 'aria-invalid': Boolean(errors[name]), 'aria-describedby': errors[name] ? `item-${name}-error` : undefined });
  return <form className="item-form" ref={form} noValidate onSubmit={async event => {
    event.preventDefault();
    if (busy || !baseline || stale || unavailable || needsConversionReview) return;
    const input = itemInput(draft);
    const result = itemId ? itemChangeRequest(initial, itemId, draft, baseline, conversionSource)
      : { request: input.item ? { expectedVersion: baseline.version, item: input.item } : null, errors: input.errors };
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
      <ProductFormFields type={draft.productType} prices={prices} renderField={field => {
        const required = field === 'name' || field === 'quantity';
        if (field === 'name' || field === 'quantity' || field === 'unitPrice' || field === 'memberPrice') return <Field name={field} label={<ProductFieldLabel field={field} required={required} />} error={errors[field]}>
          <input {...props(field)} autoFocus={field === 'name'} value={draft[field]} inputMode={field === 'quantity' ? 'numeric' : field.endsWith('Price') ? 'decimal' : undefined} maxLength={field === 'name' ? 128 : undefined} required={required} placeholder={field.endsWith('Price') ? '未填写' : undefined} onChange={event => change(changeItemDraft(draft, { [field]: event.target.value }))} />
        </Field>;
        const structured = !textSpecification(original?.attributes[field]) || !textSpecification((baseline || latest).items.find(item => item.itemId === itemId)?.attributes[field]);
        const stored = current?.attributes[field] ?? original?.attributes[field];
        if (field === 'specification' && structured && visibleSpecification(stored) === '') return null;
        const value = field === 'specification' && draft.attributes[field] === original?.attributes[field]
          ? visibleSpecification(draft.attributes[field]) : draft.attributes[field];
        return <Field name={field} label={<ProductFieldLabel field={field} />} error={errors[field]}>{structured ? <span className="preserved-specification">{valueText(stored)}<small>此字段保留原值。</small></span> : (field === 'requirements' || field === 'filling' || field === 'specification') ? <textarea {...props(field)} rows={2} value={value || ''} onChange={event => change(changeItemDraft(draft, { attributes: { ...draft.attributes, [field]: event.target.value } }, field))} /> : <input {...props(field)} inputMode={field === 'size' ? 'decimal' : undefined} value={value || ''} onChange={event => change(changeItemDraft(draft, { attributes: { ...draft.attributes, [field]: event.target.value } }, field))} />}</Field>;
      }} />

      {prices && <p className="form-help">{initial.pricingMode === 'ITEM_SUM' ? '保存后按商品单价和数量更新订单金额；已付款订单不能改变成交金额。' : '此历史订单保留手填整单金额，商品报价修改不会自动调整整单金额。'}</p>}
      <ErrorNotice error={unknownAddition ? null : error} />
      {unknownAddition && <p className="notice error" role="alert">追加结果未确认，输入已保留。请先核对商品列表和记录，再决定是否重试。</p>}
      {unavailable && <p className="notice" role="status">{itemId && !current ? '商品已移除，输入已保留。请取消编辑并核对订单。' : '订单状态已变，暂不能编辑。输入已保留，请核对状态。'}</p>}
      {(conflict || stale || needsConversionReview) && <div className="information-review">
        <p className="notice" role="status">{needsConversionReview ? '商品规格已更新，请基于最新商品重新转换。'
          : stale ? '订单已更新，输入已保留。核对最新内容后再保存。' : '已核对，请确认修改后保存。'}
          {!baseline && !canReview && '请先刷新订单。'}</p>
        <h3>同事保存的商品资料</h3>
        {itemId ? current && <Product item={current} prices={prices} itemSum={latest.pricingMode === 'ITEM_SUM'} /> : latest.items.map(item => <Product key={item.itemId} item={item} prices={prices} itemSum={latest.pricingMode === 'ITEM_SUM'} />)}
        {needsConversionReview && current ? <button type="button" className="secondary" disabled={unavailable} onClick={() => {
          setPreviousSpecification(draft.attributes.specification);
          setDraft(changeItemDraft(itemDraft(current), {
            productType: draft.productType,
            name: draft.name === initialDraft.name ? current.name : draft.name,
            quantity: draft.quantity === initialDraft.quantity ? String(current.quantity) : draft.quantity,
          }));
          setConversionSource(current);
          setBaseline(latest);
          setConflict(true);
          setErrors({});
        }}>基于最新商品重新转换</button> : stale && <button type="button" className="secondary" disabled={!canReview || unavailable} onClick={() => { setBaseline(latest); setConflict(true); }}>核对后继续编辑</button>}
        {previousSpecification !== null && <div><strong>重新转换前的商品说明（供核对）</strong><p className="product-spec-text">{visibleSpecification(previousSpecification) || '未填写'}</p></div>}
      </div>}
      {latest.status === 'WAITING_DELIVERY' ? <p className="form-help">保存后将通知制作同事重新核对。</p>
        : !itemId && latest.status !== 'CAKE_BASE' && <p className="form-help">追加商品后需重新确认制作进度。</p>}
      <div className="actions"><button className="primary" disabled={busy || stale || unavailable || needsConversionReview}>{busy ? '正在保存…' : '保存'}</button><button type="button" className="secondary" onClick={onCancel}>取消</button></div>
    </fieldset>
  </form>;
}
