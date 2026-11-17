import { ProductFieldLabel, ProductFormFields } from './ProductFormFields';
import { firstItemFormError } from './productFormLayout';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError, creationResultUnknown } from './api';
import { canEditItems, changeItemDraft, conversionNeedsReview, itemChangeRequest, itemDraft, itemInput, newItem, textSpecification } from './orderForm';
import type { Detail, Item, ItemAddRequest, ItemChangeRequest } from './types';
import type { ItemDraft } from './orderForm';
import type { EditDraftWriter } from './EditDraftRecovery';
import { randomUUID } from './uuid';

type ItemBasis = Omit<Item, 'recentNotes' | 'productionStatus' | 'currentStageCode'>;
export interface PendingItemAddition { key: string; request: ItemAddRequest }
export interface ItemEditDraft {
  version: number;
  original?: ItemBasis;
  conversionSource?: ItemBasis;
  value: ItemDraft;
  pending?: PendingItemAddition;
}
function itemBasis(item?: Item): ItemBasis | undefined {
  if (!item) return undefined;
  const { itemId, name, quantity, productType, unitPriceCents, memberPriceCents, attributes } = item;
  return { itemId, name, quantity, productType, unitPriceCents, memberPriceCents, attributes };
}
function basisItem(item: ItemBasis): Item { return { ...item, recentNotes: [] }; }
import { ErrorNotice, Product, valueText } from './ui';
import { ProductTypeSelect } from './ProductTypeSelect';
import { focusFormField } from './formFocus';
import { visibleSpecification } from './specificationText';

function Field({ name, label, error, children, className }: { name: string; label: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return <label htmlFor={`item-${name}`} className={className}><span className="form-field-heading">{label}</span>{children}{error && <span className="field-error" id={`item-${name}-error`}>{error}</span>}</label>;
}
export function ItemEdit({ initial: opened, itemId, latest, reopened, busy, error, onSave, onCancel, onDirtyChange, onSaveUnchanged, prices = true, recovered, writer }: {
  prices?: boolean; initial: Detail; itemId?: string; latest: Detail; reopened?: Detail; busy: boolean; error: unknown;
  onSave: (request: ItemChangeRequest | ItemAddRequest, additionKey?: string) => Promise<unknown>;
  onSaveUnchanged?: () => Promise<unknown>; onCancel: () => Promise<boolean>; onDirtyChange: (dirty: boolean) => void;
  recovered?: ItemEditDraft; writer: EditDraftWriter<ItemEditDraft>;
}) {
  busy = busy || Boolean(latest.deletion || latest.deleted);
  const [initial] = useState(() => recovered ? {
    ...opened, version: recovered.version,
    items: recovered.original ? [basisItem(recovered.original)] : [],
  } : opened);
  const original = initial.items.find(item => item.itemId === itemId);
  const [initialDraft] = useState(() => original ? itemDraft(original) : newItem());
  const [draft, setDraft] = useState(recovered?.value ?? initialDraft);
  const [baseline, setBaseline] = useState<Detail | null>(initial);
  const [conversionSource, setConversionSource] = useState(recovered?.conversionSource ? basisItem(recovered.conversionSource) : original);
  const [pending, setPending] = useState(recovered?.pending);
  const [preparing, setPreparing] = useState(false);
  const sending = useRef(false);
  busy = busy || preparing;
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
  const unknownAddition = Boolean(pending);
  const snapshot = (value: ItemDraft, source = conversionSource, addition = pending): ItemEditDraft => ({
    version: initial.version, original: itemBasis(original), conversionSource: itemBasis(source), value, pending: addition,
  });
  const change = (next: typeof draft) => {
    if (next.attributes.size !== draft.attributes.size && !/^[0-9]{0,9}(?:\.[0-9]{0,2})?$/.test(next.attributes.size)) { setErrors({ size: '尺寸只能填写数字，最多两位小数。' }); return; }
    setDraft(next); setErrors({});
    void writer.save(snapshot(next));
  };
  const props = (name: string) => ({ id: `item-${name}`, name, 'aria-invalid': Boolean(errors[name]), 'aria-describedby': errors[name] ? `item-${name}-error` : undefined });
  async function sendAddition(addition: PendingItemAddition, retry: boolean) {
    sending.current = true;
    setPreparing(true);
    try {
      if (!retry && !await writer.save(snapshot(draft, conversionSource, addition))) return;
      setPending(addition);
      attemptedVersion.current = addition.request.expectedVersion;
      await onSave(addition.request, addition.key);
      await writer.clear();
    } catch (failure) {
      const concurrent = failure instanceof ApiError && failure.code === 'CONCURRENT_MODIFICATION';
      const sessionFailure = failure instanceof ApiError && (failure.status === 401 || failure.status === 403);
      if (concurrent || (!retry && !sessionFailure && !creationResultUnknown(failure))) {
        setPending(undefined);
        await writer.save({ ...snapshot(draft), pending: undefined });
      }
      if (concurrent) { setConflict(true); setBaseline(null); }
    } finally {
      setPreparing(false);
      sending.current = false;
    }
  }

  return <form className="item-form" ref={form} noValidate onSubmit={async event => {
    event.preventDefault();
    if (busy || sending.current || unavailable) return;
    if (pending) { await sendAddition(pending, true); return; }
    if (!baseline || stale || needsConversionReview) return;
    const input = itemInput(draft);
    const result = itemId ? itemChangeRequest(initial, itemId, draft, baseline, conversionSource)
      : { request: input.item ? { expectedVersion: baseline.version, item: { ...input.item, itemId: draft.key } } : null, errors: input.errors };
    setErrors(result.errors);
    if (Object.keys(result.errors).length) {
      focusFormField(form.current, firstItemFormError(result.errors, draft.productType, true)!);
      return;
    }
    if (!result.request) {
      try { if (onSaveUnchanged) await onSaveUnchanged(); else if (!await onCancel()) return; await writer.clear(); }
      catch { /* 保存错误由父级操作提示展示。 */ }
      return;
    }
    if ('item' in result.request) {
      await sendAddition({ key: randomUUID(), request: result.request }, false);
      return;
    }
    attemptedVersion.current = result.request.expectedVersion;
    try { await onSave(result.request); await writer.clear(); }
    catch (error) {
      if (error instanceof ApiError && error.code === 'CONCURRENT_MODIFICATION') { setConflict(true); setBaseline(null); }
    }
  }}>
    <fieldset className="create-fields" disabled={busy || unknownAddition}>
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
      <ErrorNotice error={error} />
      {unavailable && <p className="notice" role="status">{itemId && !current ? '商品已移除，输入已保留。请取消编辑并核对订单。' : '订单状态已变，暂不能编辑。输入已保留，请核对状态。'}</p>}
      {(conflict || stale || needsConversionReview) && <div className="information-review">
        <p className="notice" role="status">{needsConversionReview ? '商品规格已更新，请基于最新商品重新转换。'
          : stale ? '订单已更新，输入已保留。核对最新内容后再保存。' : '已核对，请确认修改后保存。'}
          {!baseline && !canReview && '请先刷新订单。'}</p>
        <h3>同事保存的商品资料</h3>
        {itemId ? current && <Product item={current} prices={prices} itemSum={latest.pricingMode === 'ITEM_SUM'} /> : latest.items.map(item => <Product key={item.itemId} item={item} prices={prices} itemSum={latest.pricingMode === 'ITEM_SUM'} />)}
        {needsConversionReview && current ? <button type="button" className="secondary" disabled={unavailable} onClick={() => {
          setPreviousSpecification(draft.attributes.specification);
          const next = changeItemDraft(itemDraft(current), {
            productType: draft.productType,
            name: draft.name === initialDraft.name ? current.name : draft.name,
            quantity: draft.quantity === initialDraft.quantity ? String(current.quantity) : draft.quantity,
          });
          setDraft(next);
          void writer.save(snapshot(next, current));
          setConversionSource(current);
          setBaseline(latest);
          setConflict(true);
          setErrors({});
        }}>基于最新商品重新转换</button> : stale && <button type="button" className="secondary" disabled={!canReview || unavailable} onClick={() => { setBaseline(latest); setConflict(true); }}>核对后继续编辑</button>}
        {previousSpecification !== null && <div><strong>重新转换前的商品说明（供核对）</strong><p className="product-spec-text">{visibleSpecification(previousSpecification) || '未填写'}</p></div>}
      </div>}
      {latest.status === 'WAITING_DELIVERY' ? <p className="form-help">保存后将通知制作同事重新核对。</p>
        : !itemId && latest.status !== 'CAKE_BASE' && <p className="form-help">追加商品后需重新确认制作进度。</p>}
    </fieldset>
    {unknownAddition && <p className="notice" role="status">{latest.items.some(item => item.itemId === pending?.request.item.itemId)
      ? '原商品已保存在当前订单。'
      : unavailable ? '追加结果待确认。订单重新可编辑后可使用原请求确认。'
      : '追加结果待确认。可使用原请求重试，已保存的商品不会重复追加。'}</p>}
    <div className="actions">
      <button className="primary" disabled={busy || unavailable || (!pending && (stale || needsConversionReview))}>{busy ? '正在保存…' : pending ? '确认追加结果' : '保存'}</button>
      <button type="button" className="secondary" disabled={busy} onClick={async () => {
        if (pending && !window.confirm('放弃待确认的追加草稿？请先核对订单中是否已有该商品。')) return;
        if (await onCancel()) await writer.clear();
      }}>取消</button>
    </div>
  </form>;
}
