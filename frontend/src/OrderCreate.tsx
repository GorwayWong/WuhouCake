import { createContext, useContext, useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Cake, Plus, Trash, Receipt, CurrencyCny } from '@phosphor-icons/react';
import { creationResultUnknown, errorText } from './api';
import { changeItemDraft, createOrderRequest, newItem, fieldsForProduct } from './orderForm';
import { OrderRecognition } from './OrderRecognition';
import { formFeedback, retainRecognitionFeedback } from './recognition';
import type { RecognitionFeedbackMap } from './recognition';
import { OrderPackagePicker } from './OrderPackagePicker';
import { DateInput } from './DateInput';
import { ProductTypeSelect } from './ProductTypeSelect';
import { focusFormField } from './formFocus';
import { itemKeyForField, selectItemAfterChange, summarizeItemPrices } from './orderItemView';
import type { PriceSummary } from './orderItemView';
import { exactYuan } from './money';
import type { ItemDraft, OrderDraft } from './orderForm';
import type { CreateOrderRequest } from './types';
import type { DraftEditor } from './orderDraftStorage';

const RecognitionFields = createContext<RecognitionFeedbackMap>({});
function Field({ label, name, error, children, wide = false }: { label: string; name: string; error?: string; children: ReactNode; wide?: boolean }) {
  const mark = useContext(RecognitionFields)[name];
  const message = error || mark?.error;
  const imported = Boolean(mark && !mark.error && mark.source !== 'DEFAULT');
  return <label className={[wide ? 'form-wide' : '', imported ? 'recognition-filled' : ''].filter(Boolean).join(' ') || undefined} htmlFor={name} data-recognition={mark ? 'true' : undefined}>
    <span className="form-field-heading">{label}{mark && !mark.error && <span className="recognition-field-badge">{mark.source === 'DEFAULT' ? '系统默认' : mark.needsReview ? '请核对' : '已带入'}</span>}</span>
    {children}{message && <span className="field-error" id={`${name}-error`}>{message}</span>}
  </label>;
}
function PriceHint({ label, summary }: { label: string; summary: PriceSummary }) {
  const notes = [summary.missing ? '有商品未填价格' : '', summary.invalid ? '有商品数量或价格未完成' : ''].filter(Boolean);
  return <div><dt>{label}</dt><dd><strong>{summary.included ? `¥${exactYuan(String(summary.cents))}` : '—'}</strong>{notes.length > 0 && <span>（{notes.join('；')}）</span>}</dd></div>;
}
export function OrderCreate({ draft, initialDraft, onChange, onSubmit, busy, error, submitted, editor, onEditorChange, blocked }: {
  draft: OrderDraft; onChange: (draft: OrderDraft, editor?: Partial<DraftEditor>) => void; onSubmit: (request: CreateOrderRequest) => void; busy: boolean; error: unknown; submitted?: CreateOrderRequest;
  blocked: boolean; editor: DraftEditor; onEditorChange: (editor: Partial<DraftEditor>) => void;
  initialDraft: OrderDraft;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selectedItemKey, selectItem] = useState(editor.selectedItemKey || draft.items[0]?.key || '');
  const setSelectedItemKey = (key: string) => { selectItem(key); onEditorChange({ selectedItemKey: key }); };
  const activeIndex = Math.max(0, draft.items.findIndex(item => item.key === selectedItemKey));
  const activeItem = draft.items[activeIndex];
  const priceSummary = summarizeItemPrices(draft.items);
  const cardStart = useRef<HTMLDivElement>(null);
  const [pendingTarget, setPendingTarget] = useState<{ field?: string; focus?: boolean } | null>(null);
  const [feedback, setFeedback] = useState<RecognitionFeedbackMap>(editor.feedback);
  const feedbackRef = useRef(feedback);
  const getFeedback = useCallback(() => feedbackRef.current, []);
  const updateFeedback = (next: RecognitionFeedbackMap) => { feedbackRef.current = next; setFeedback(next); };
  const feedbackByName = formFeedback(draft, feedback);
  const form = useRef<HTMLFormElement>(null);
  useLayoutEffect(() => {
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => window.scrollTo(0, editor.scrollY)); });
    return () => cancelAnimationFrame(frame);
  }, []);
  useLayoutEffect(() => {
    if (!pendingTarget) return;
    if (pendingTarget.field) {
      if (pendingTarget.focus) focusFormField(form.current, pendingTarget.field);
      else Array.from(form.current?.querySelectorAll<HTMLElement>('label[for]') || [])
        .find(element => element.getAttribute('for') === pendingTarget.field)?.scrollIntoView({ block: 'center' });
    } else cardStart.current?.scrollIntoView({ block: 'start' });
    setPendingTarget(null);
  }, [pendingTarget, activeItem?.key]);
  const revealField = (field: string, items: ItemDraft[], focus = false) => {
    const key = itemKeyForField(items, field);
    if (key) setSelectedItemKey(key);
    setPendingTarget({ field, focus });
  };
  const switchItem = (offset: number) => {
    const item = draft.items[activeIndex + offset];
    if (!item) return;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setSelectedItemKey(item.key); setPendingTarget({});
  };
  const latest = useRef(draft); latest.current = draft;
  const manualFields = useRef(new Set<string>(editor.manualFields));
  const getDraft = useCallback(() => latest.current, []);
  const change = (next: OrderDraft) => {
    const selection = selectItemAfterChange(latest.current.items, next.items, activeItem?.key || '');
    if (selection !== activeItem?.key) { selectItem(selection); setPendingTarget({}); }
    for (const field of Object.keys(next) as (keyof OrderDraft)[]) if (field !== 'items' && next[field] !== latest.current[field]) manualFields.current.add(field === 'totalAmount' ? 'totalAmountCents' : field);
    for (const item of next.items) {
      const previous = latest.current.items.find(x => x.key === item.key);
      if (!previous) manualFields.current.add(item.key + '.new');
      else {
        for (const field of ['name', 'productType', 'quantity', 'unitPrice', 'memberPrice'] as const)
          if (previous[field] !== item[field]) manualFields.current.add(item.key + '.' + (field === 'unitPrice' ? 'unitPriceCents' : field === 'memberPrice' ? 'memberPriceCents' : field));
        for (const field of Object.keys(item.attributes) as (keyof ItemDraft['attributes'])[]) if (previous.attributes[field] !== item.attributes[field]) manualFields.current.add(item.key + '.' + field);
      }
    }
    updateFeedback(retainRecognitionFeedback(next, feedbackRef.current));
    latest.current = next; setErrors({}); onChange(next, { feedback: feedbackRef.current, manualFields: [...manualFields.current], selectedItemKey: selection });
  };
  const recognitionChange = (next: OrderDraft, marks: RecognitionFeedbackMap, restore = false) => {
    const selection = selectItemAfterChange(latest.current.items, next.items, activeItem?.key || '', !restore);
    selectItem(selection);
    updateFeedback(retainRecognitionFeedback(next, restore ? marks : { ...feedbackRef.current, ...marks }));
    latest.current = next; setErrors({}); onChange(next, { feedback: feedbackRef.current, manualFields: [...manualFields.current], selectedItemKey: selection });
    const names = Object.keys(formFeedback(next, marks));
    if (!restore && names.length) revealField(names.find(name => !name.startsWith('items.')) || names[0], next.items);
    else if (selection !== activeItem?.key) setPendingTarget({});
  };
  const updateItem = (key: string, changes: Partial<ItemDraft>, editedSpecification?: string) => {
    if (editedSpecification === 'size' && changes.attributes && !/^[0-9]{0,9}(?:\.[0-9]{0,2})?$/.test(changes.attributes.size)) {
      setErrors({ [`items.${draft.items.findIndex(item => item.key === key)}.size`]: '尺寸只能填写数字，最多两位小数。' }); return;
    }
    change({ ...draft, items: draft.items.map(item => item.key === key ? changeItemDraft(item, changes, editedSpecification) : item) });
  };
  const inputProps = (name: string) => ({ id: name, name, 'aria-invalid': Boolean(errors[name]), 'aria-describedby': errors[name] || feedbackByName[name]?.error ? `${name}-error` : undefined });
  const customerFields = [['customerName', '客户姓名', 80], ['phone', '联系电话 *', 32], ['memberPhone', '会员手机', 32]] as const;
  const submittedDate = submitted?.fulfillment.requestedReceiveDate || draft.requestedReceiveDate;
  const submittedPhone = submitted?.customer.phone || draft.phone;
  const unknownResult = creationResultUnknown(error);
  const editBlocked = busy || unknownResult || blocked;
  return <div className="create-page">
    <OrderRecognition initialDraft={initialDraft} getDraft={getDraft} getFeedback={getFeedback} manualFields={manualFields.current} onChange={recognitionChange} busy={editBlocked} text={editor.text} open={editor.open} onEditorChange={onEditorChange} />
    <RecognitionFields.Provider value={feedbackByName}><form ref={form} noValidate onSubmit={event => {
      event.preventDefault();
      if (busy || blocked) return;
      if (unknownResult && submitted) { onSubmit(submitted); return; }
      const result = createOrderRequest(draft);
      setErrors(result.errors);
      if (result.request) onSubmit(result.request);
      else {
        revealField(Object.keys(result.errors)[0], draft.items, true);
      }
    }}>
      <fieldset className="create-fields" disabled={editBlocked}>
        <section className="panel create-group create-order-info"><h2><Receipt />订单信息</h2><div className="create-grid create-customer-grid">
            {customerFields.map(([name, label, maximum]) => <Field key={name} label={label} name={name} error={errors[name]} wide={name === 'memberPhone'}><input {...inputProps(name)} type={name === 'phone' || name === 'memberPhone' ? 'tel' : 'text'} value={draft[name]} onChange={event => change({ ...draft, [name]: event.target.value })} required={name === 'phone'} maxLength={maximum} autoComplete="off" /></Field>)}
            <Field label="地址 *" name="address" error={errors.address} wide><textarea {...inputProps('address')} rows={2} value={draft.address} onChange={event => change({ ...draft, address: event.target.value })} placeholder="配送填写地址，自提填写‘自提’" required /></Field>
            <Field label="收货时间 *" name="requestedReceiveAt" error={errors.requestedReceiveAt || errors.requestedReceiveDate} wide><DateInput label="收货时间" disabled={editBlocked} {...inputProps('requestedReceiveAt')} type="datetime-local" dateDisplay="month-day" showTimeHint={false} timeOptional resetTimeOnDateChange value={draft.requestedReceiveAt} onChange={(value, parts) => change({ ...draft, requestedReceiveAt: value, requestedReceiveDate: parts?.date || '' })} required /></Field>
            <Field label="出品时间" name="plannedFinishAt" error={errors.plannedFinishAt} wide><DateInput label="出品时间" disabled={editBlocked} {...inputProps('plannedFinishAt')} type="datetime-local" dateDisplay="month-day" value={draft.plannedFinishAt} onChange={value => change({ ...draft, plannedFinishAt: value })} /></Field>
        </div></section>
        <section className="panel create-group"><div className="section-heading"><h2><Cake />商品信息</h2><span className="muted">{draft.items.length} 项</span></div>
          <OrderPackagePicker items={draft.items} onChange={items => change({ ...draft, items })} disabled={editBlocked} />
          <div className="item-card-navigation" ref={cardStart} role="group" aria-label="商品切换">
            <button type="button" className="secondary icon-button" aria-label="上一个商品" disabled={activeIndex === 0} onClick={() => switchItem(-1)}><ArrowLeft /></button>
            <div className="item-card-caption"><span aria-live="polite">第 {activeIndex + 1} / {draft.items.length} 个商品</span><strong>{activeItem?.name.trim() || '未命名商品'}</strong></div>
            <button type="button" className="secondary icon-button" aria-label="下一个商品" disabled={activeIndex >= draft.items.length - 1} onClick={() => switchItem(1)}><ArrowRight /></button>
          </div>
          {activeItem && <div className="create-item" key={activeItem.key}>
            <div className="create-item-heading"><h3>商品 {activeIndex + 1}</h3><button type="button" className="text-button danger" aria-label={`移除商品 ${activeIndex + 1}`} disabled={draft.items.length === 1} onClick={() => change({ ...draft, items: draft.items.filter(other => other.key !== activeItem.key) })}><Trash />移除</button></div>
            <div className="create-grid">
              {((['name', 'productType', 'quantity', 'unitPrice', 'memberPrice']) as ('name' | 'productType' | 'quantity' | 'unitPrice' | 'memberPrice')[]).map(field => {
                const name = `items.${activeIndex}.${field}`;
                const confirmType = field === 'productType' && activeItem.requiresTypeConfirmation;
                const label = { name: '商品名称 *', productType: confirmType ? '商品类型 *' : '商品类型', quantity: '数量 *', unitPrice: '商品单价（元）', memberPrice: '会员单价（元）' }[field];
                return <Field key={field} label={label} name={name} error={errors[name]} wide={field === 'name'}>{field === 'productType' ? <ProductTypeSelect disabled={editBlocked} {...inputProps(name)} value={activeItem.productType} onChange={value => updateItem(activeItem.key, { productType: value })} required={confirmType} /> : <input {...inputProps(name)} type="text" inputMode={field === 'quantity' ? 'numeric' : field.endsWith('Price') ? 'decimal' : undefined} value={activeItem[field]} onChange={event => updateItem(activeItem.key, { [field]: event.target.value })} required={field === 'name' || field === 'quantity'} maxLength={field === 'name' ? 128 : undefined} placeholder={field.endsWith('Price') ? '未填写' : undefined} />}</Field>;
              })}
              {fieldsForProduct(activeItem.productType).map(([key, label]) => { const name = `items.${activeIndex}.${key}`; return <Field key={key} label={key === 'size' ? '尺寸（寸，只填数字）' : label} name={name} error={errors[name]} wide={key === 'requirements'}>{key === 'requirements' ? <textarea {...inputProps(name)} rows={2} value={activeItem.attributes[key] || ''} onChange={event => updateItem(activeItem.key, { attributes: { ...activeItem.attributes, [key]: event.target.value } }, key)} /> : <input {...inputProps(name)} inputMode={key === 'size' ? 'decimal' : undefined} value={activeItem.attributes[key] || ''} onChange={event => updateItem(activeItem.key, { attributes: { ...activeItem.attributes, [key]: event.target.value } }, key)} />}</Field>; })}
            </div>
          </div>}
          {draft.items.length > 1 && <div className="item-card-footer" role="group" aria-label="商品底部切换">
            <button type="button" className="secondary" disabled={activeIndex === 0} onClick={() => switchItem(-1)}><ArrowLeft />上一项</button>
            <span>{activeIndex + 1} / {draft.items.length}</span>
            <button type="button" className="secondary" disabled={activeIndex >= draft.items.length - 1} onClick={() => switchItem(1)}>下一项<ArrowRight /></button>
          </div>}
          <button type="button" className="secondary" onClick={() => change({ ...draft, items: [...draft.items, newItem()] })}><Plus />添加商品</button>
        </section>
        <section className="panel create-group"><h2><CurrencyCny />金额信息</h2><dl className="item-price-summary" aria-label="商品价格参考合计"><PriceHint label="普通价合计" summary={priceSummary.regular} /><PriceHint label="会员价合计" summary={priceSummary.member} /></dl><div className="create-grid"><Field label="订单约定总金额（元）" name="totalAmount" error={errors.totalAmount}><input {...inputProps('totalAmount')} inputMode="decimal" value={draft.totalAmount} onChange={event => change({ ...draft, totalAmount: event.target.value })} placeholder="未填写" /></Field></div><p className="form-help">留空为未报价，0 为零元。</p></section>
      </fieldset>
      {Object.keys(errors).length > 0 && <div className="notice error" role="alert">请检查标出的内容后再创建订单。</div>}
      {error ? unknownResult ? <div className="notice error create-result" role="alert"><p>创建结果未确认，输入已保留。请先核对客户收货日期 <strong>{submittedDate}</strong>、电话 <strong>{submittedPhone}</strong>；也可重试确认原订单，不会重复建单。</p><a className="text-button" href={`#/?date=${submittedDate}`} target="_blank" rel="noreferrer">打开 {submittedDate} 工作台核对（新标签页）</a></div> : <div className="notice error" role="alert">本次请求未新增订单。{errorText(error)}</div> : null}
      <div className="create-submit"><button className="primary" disabled={busy || blocked}>{busy ? '正在创建订单…' : unknownResult ? '重试确认原订单' : '创建订单'}<ArrowRight /></button></div>
    </form></RecognitionFields.Provider>
  </div>;
}
