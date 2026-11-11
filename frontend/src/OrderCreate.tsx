import { Select } from './Select';
import { paymentMethods } from './orderPayment';
import { ProductFieldLabel, ProductFormFields } from './ProductFormFields';
import { firstProductFormError } from './productFormLayout';
import { DraftItemImages } from './DraftItemImages';
import { localImageError, requireDraftImages } from './draftImages';
import type { ImageScope } from './draftImages';
import { changePickupTime, changeFinishTime } from './orderTimes';
import { FinishTimeHelp } from './FinishTimeHelp';
import { createContext, useContext, useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Cake, Plus, Trash, Receipt, CurrencyCny } from '@phosphor-icons/react';
import { creationResultUnknown, errorText } from './api';
import { changeItemDraft, createOrderRequest, newItem } from './orderForm';
import { OrderRecognition } from './OrderRecognition';
import { formFeedback, retainRecognitionFeedback } from './recognition';
import type { RecognitionFeedbackMap } from './recognition';
import { OrderPackagePicker } from './OrderPackagePicker';
import { DateInput } from './DateInput';
import { OrderingMethodInput } from './OrderingMethodInput';
import { ProductTypeSelect } from './ProductTypeSelect';
import { focusFormField } from './formFocus';
import { itemKeyForField, selectItemAfterChange } from './orderItemView';
import type { ItemDraft, OrderDraft } from './orderForm';
import type { CreateOrderRequest } from './types';
import type { DraftEditor } from './orderDraftStorage';

const RecognitionFields = createContext<RecognitionFeedbackMap>({});
function Field({ label, name, error, children, wide = false, className = '' }: { label: ReactNode; name: string; error?: string; children: ReactNode; wide?: boolean; className?: string }) {
  const mark = useContext(RecognitionFields)[name];
  const message = error || mark?.error;
  const imported = Boolean(mark && !mark.error && mark.source !== 'DEFAULT');
  return <label className={[wide ? 'form-wide' : '', imported ? 'recognition-filled' : '', className].filter(Boolean).join(' ') || undefined} htmlFor={name} data-recognition={mark ? 'true' : undefined}>
    <span className="form-field-heading">{label}{mark && !mark.error && (mark.source !== 'DEFAULT' || mark.needsReview) && <span className="recognition-field-badge">{mark.needsReview ? '请核对' : '已带入'}</span>}</span>
    {children}{message && <span className="field-error" id={`${name}-error`}>{message}</span>}
    {mark?.hint && <span className="form-help" id={`${name}-recognition-hint`}>{mark.hint}</span>}
  </label>;
}
export function OrderCreate({ draft, initialDraft, onChange, onSubmit, busy, error, submitted, editor, onEditorChange, blocked, imageScope, canUploadImages = false, canRecordPayment = false, onImageWritingChange, createdOrderId }: {
  draft: OrderDraft; onChange: (draft: OrderDraft, editor?: Partial<DraftEditor>, retainRemovedImages?: boolean, requireSaved?: boolean) => boolean; onSubmit: (request: CreateOrderRequest) => void; busy: boolean; error: unknown; submitted?: CreateOrderRequest;
  imageScope: ImageScope; canUploadImages?: boolean; canRecordPayment?: boolean; onImageWritingChange: (busy: boolean) => void; createdOrderId?: string;
  blocked: boolean; editor: DraftEditor; onEditorChange: (editor: Partial<DraftEditor>) => void;
  initialDraft: OrderDraft;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [imageBusy, setImageBusy] = useState(false);
  const imageWriting = (pending: boolean) => { setImageBusy(pending); onImageWritingChange(pending); };
  const [selectedItemKey, selectItem] = useState(editor.selectedItemKey || draft.items[0]?.key || '');
  const setSelectedItemKey = (key: string) => { selectItem(key); onEditorChange({ selectedItemKey: key }); };
  const activeIndex = Math.max(0, draft.items.findIndex(item => item.key === selectedItemKey));
  const activeItem = draft.items[activeIndex];
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
  const change = (next: OrderDraft, requireSaved = false) => {
    const previousFields = requireSaved ? new Set(manualFields.current) : null;
    const selection = selectItemAfterChange(latest.current.items, next.items, activeItem?.key || '');
    for (const field of Object.keys(next) as (keyof OrderDraft)[]) if (field !== 'items' && field !== 'finishTimeMode' && (field !== 'plannedFinishAt' || next.finishTimeMode === 'MANUAL') && next[field] !== latest.current[field]) manualFields.current.add(field === 'totalAmount' ? 'totalAmountCents' : field);
    for (const item of next.items) {
      const previous = latest.current.items.find(x => x.key === item.key);
      if (!previous) manualFields.current.add(item.key + '.new');
      else {
        for (const field of ['name', 'productType', 'quantity', 'unitPrice', 'memberPrice'] as const)
          if (previous[field] !== item[field]) manualFields.current.add(item.key + '.' + (field === 'unitPrice' ? 'unitPriceCents' : field === 'memberPrice' ? 'memberPriceCents' : field));
        for (const field of Object.keys(item.attributes) as (keyof ItemDraft['attributes'])[]) if (previous.attributes[field] !== item.attributes[field]) manualFields.current.add(item.key + '.' + field);
      }
    }
    if (next.finishTimeMode === 'AUTO') manualFields.current.delete('plannedFinishAt');
    const feedback = retainRecognitionFeedback(next, feedbackRef.current);
    const saved = onChange(next, { feedback, manualFields: [...manualFields.current], selectedItemKey: selection }, false, requireSaved);
    if (!saved && previousFields) { manualFields.current = previousFields; return false; }
    if (selection !== activeItem?.key) { selectItem(selection); setPendingTarget({}); }
    updateFeedback(feedback);
    latest.current = next; setErrors({});
    return saved;
  };
  const recognitionChange = (next: OrderDraft, marks: RecognitionFeedbackMap, restore = false) => {
    const selection = selectItemAfterChange(latest.current.items, next.items, activeItem?.key || '', !restore);
    selectItem(selection);
    updateFeedback(retainRecognitionFeedback(next, restore ? marks : { ...feedbackRef.current, ...marks }));
    latest.current = next; setErrors({}); onChange(next, { feedback: feedbackRef.current, manualFields: [...manualFields.current], selectedItemKey: selection }, true);
    const first = firstProductFormError(formFeedback(next, marks), next.items);
    if (!restore && first) revealField(first, next.items);
    else if (selection !== activeItem?.key) setPendingTarget({});
  };
  const updateItem = (key: string, changes: Partial<ItemDraft>, editedSpecification?: string) => {
    if (editedSpecification === 'size' && changes.attributes && !/^[0-9]{0,9}(?:\.[0-9]{0,2})?$/.test(changes.attributes.size)) {
      setErrors({ [`items.${draft.items.findIndex(item => item.key === key)}.size`]: '尺寸只能填写数字，最多两位小数。' }); return;
    }
    change({ ...draft, items: draft.items.map(item => item.key === key ? changeItemDraft(item, changes, editedSpecification) : item) });
  };
  const inputProps = (name: string) => ({ id: name, name, 'aria-invalid': Boolean(errors[name]), 'aria-describedby': [
    errors[name] || feedbackByName[name]?.error ? `${name}-error` : '',
    feedbackByName[name]?.hint ? `${name}-recognition-hint` : '',
  ].filter(Boolean).join(' ') || undefined });
  const customerFields = [['customerName', '客户姓名', 80], ['phone', '联系电话 *', 32], ['memberPhone', '会员手机', 32]] as const;
  const submittedDate = submitted?.fulfillment.requestedReceiveDate || draft.requestedReceiveDate;
  const submittedPhone = submitted?.customer.phone || draft.phone;
  const unknownResult = creationResultUnknown(error);
  const editBlocked = busy || imageBusy || unknownResult || blocked || Boolean(createdOrderId);
  return <div className="create-page">
    <OrderRecognition initialDraft={initialDraft} getDraft={getDraft} getFeedback={getFeedback} manualFields={manualFields.current} onChange={recognitionChange} busy={editBlocked} text={editor.text} open={editor.open} onEditorChange={onEditorChange} />
    <RecognitionFields.Provider value={feedbackByName}><form ref={form} noValidate onSubmit={async event => {
      event.preventDefault();
      if (busy || imageBusy || blocked) return;
      if (unknownResult && submitted) { onSubmit(submitted); return; }
      if (!canUploadImages && draft.items.some(item => item.images?.length)) { setErrors({ images: '当前账号没有图片上传或订单查看权限，请移除已选图片后提交，或联系店长调整权限。' }); return; }
      const result = createOrderRequest(draft);
      if (result.request?.paymentMethod && result.request.paymentMethod !== 'UNPAID' && !canRecordPayment) result.errors.paymentMethod = '当前账号不能登记已付款，请选择未付或联系店长。';
      setErrors(result.errors);
      if (result.request && !Object.keys(result.errors).length) {
        imageWriting(true);
        try { await requireDraftImages({ ...imageScope, value: draft }); onSubmit(result.request); }
        catch (failure) { setErrors({ images: localImageError(failure) }); }
        finally { imageWriting(false); }
      }
      else {
        revealField(firstProductFormError(result.errors, draft.items)!, draft.items, true);
      }
    }}>
      <fieldset className="create-fields" disabled={editBlocked}>
        <section className="panel create-group create-order-info"><h2><Receipt />订单信息</h2>
          <div className="create-grid create-time-grid">
            <Field label="取货时间 *" name="requestedReceiveAt" error={errors.requestedReceiveAt || errors.requestedReceiveDate}><DateInput label="取货时间" disabled={editBlocked} {...inputProps('requestedReceiveAt')} type="datetime-local" dateDisplay="business" compactTime showTimeHint={false} timeOptional resetTimeOnDateChange value={draft.requestedReceiveAt} onChange={(value, parts) => change({ ...changePickupTime(draft, value), requestedReceiveDate: parts?.date || '' })} required /></Field>
            <Field label="出品时间" name="plannedFinishAt" error={errors.plannedFinishAt}><DateInput label="出品时间" disabled={editBlocked} {...inputProps('plannedFinishAt')} type="datetime-local" dateDisplay="business" compactTime value={draft.plannedFinishAt} onChange={value => change(changeFinishTime(draft, value))} /><FinishTimeHelp draft={draft} disabled={editBlocked} onChange={change} /></Field>
          </div>
          <div className="create-grid create-customer-grid">
            <Field label="下单方式" name="orderingMethod" error={errors.orderingMethod} wide><OrderingMethodInput id="orderingMethod" disabled={editBlocked} value={draft.orderingMethod || ''} custom={draft.orderingMethodCustom} invalid={Boolean(errors.orderingMethod)} describedBy={inputProps('orderingMethod')['aria-describedby']} onChange={method => change({ ...draft, ...method })} /></Field>
            {customerFields.map(([name, label, maximum]) => <Field key={name} label={label} name={name} error={errors[name]} wide={name === 'memberPhone'}><input {...inputProps(name)} type={name === 'phone' || name === 'memberPhone' ? 'tel' : 'text'} value={draft[name]} onChange={event => change({ ...draft, [name]: event.target.value })} required={name === 'phone'} maxLength={maximum} autoComplete="off" /></Field>)}
            <Field label="地址 *" name="address" error={errors.address} wide><textarea {...inputProps('address')} rows={2} value={draft.address} onChange={event => change({ ...draft, address: event.target.value })} placeholder="配送填写地址，自提填写‘自提’" required /></Field>
        </div></section>
        <section className="panel create-group"><div className="section-heading"><h2><Cake />商品信息</h2><span className="muted">{draft.items.length} 项</span></div>
          <OrderPackagePicker draft={draft} getDraft={getDraft} onChange={next => change(next, true)} imageScope={imageScope} canUploadImages={canUploadImages} onImageWritingChange={imageWriting} disabled={editBlocked} />
          <div className="item-card-navigation" ref={cardStart} role="group" aria-label="商品切换">
            <button type="button" className="secondary icon-button" aria-label="上一个商品" disabled={activeIndex === 0} onClick={() => switchItem(-1)}><ArrowLeft /></button>
            <div className="item-card-caption"><span aria-live="polite">第 {activeIndex + 1} / {draft.items.length} 个商品</span><strong>{activeItem?.name.trim() || '未命名商品'}</strong></div>
            <button type="button" className="secondary icon-button" aria-label="下一个商品" disabled={activeIndex >= draft.items.length - 1} onClick={() => switchItem(1)}><ArrowRight /></button>
          </div>
          {activeItem && <div className="create-item" key={`fields:${activeItem.key}`}>
            <div className="create-item-heading product-form-heading"><h3>商品 {activeIndex + 1}</h3>
              <Field className="product-type-field" label={activeItem.requiresTypeConfirmation ? '商品类型 *' : '商品类型'} name={`items.${activeIndex}.productType`} error={errors[`items.${activeIndex}.productType`]}>
                <ProductTypeSelect disabled={editBlocked} {...inputProps(`items.${activeIndex}.productType`)} value={activeItem.productType} onChange={value => updateItem(activeItem.key, { productType: value })} required={Boolean(activeItem.requiresTypeConfirmation)} />
              </Field>
              <button type="button" className="text-button danger" aria-label={`移除商品 ${activeIndex + 1}`} disabled={draft.items.length === 1} onClick={() => change({ ...draft, items: draft.items.filter(other => other.key !== activeItem.key) })}><Trash />移除</button>
            </div>
            <ProductFormFields type={activeItem.productType} prices renderField={field => {
              const name = `items.${activeIndex}.${field}`;
              const required = field === 'name' || field === 'quantity';
              if (field === 'name' || field === 'quantity' || field === 'unitPrice' || field === 'memberPrice') return <Field label={<ProductFieldLabel field={field} required={required} />} name={name} error={errors[name]}>
                <input {...inputProps(name)} type="text" inputMode={field === 'quantity' ? 'numeric' : field.endsWith('Price') ? 'decimal' : undefined} value={activeItem[field]} onChange={event => updateItem(activeItem.key, { [field]: event.target.value })} required={required} maxLength={field === 'name' ? 128 : undefined} placeholder={field.endsWith('Price') ? '未填写' : undefined} />
              </Field>;
              return <Field label={<ProductFieldLabel field={field} />} name={name} error={errors[name]}>
                {(field === 'requirements' || field === 'filling' || field === 'specification') ? <textarea {...inputProps(name)} rows={2} value={activeItem.attributes[field] || ''} onChange={event => updateItem(activeItem.key, { attributes: { ...activeItem.attributes, [field]: event.target.value } }, field)} /> : <input {...inputProps(name)} inputMode={field === 'size' ? 'decimal' : undefined} value={activeItem.attributes[field] || ''} onChange={event => updateItem(activeItem.key, { attributes: { ...activeItem.attributes, [field]: event.target.value } }, field)} />}
                {field === 'specification' && (activeItem.unitPrice || activeItem.memberPrice) && <span className="form-help product-spec-text">
                  {[activeItem.unitPrice && `参考单价：¥${activeItem.unitPrice}`, activeItem.memberPrice && `参考会员价：¥${activeItem.memberPrice}`].filter(Boolean).join('\n')}
                </span>}
              </Field>;
            }} />
          </div>}
          {draft.items.length > 1 && <div className="item-card-footer" role="group" aria-label="商品底部切换">
            <button type="button" className="secondary" disabled={activeIndex === 0} onClick={() => switchItem(-1)}><ArrowLeft />上一项</button>
            <span>{activeIndex + 1} / {draft.items.length}</span>
            <button type="button" className="secondary" disabled={activeIndex >= draft.items.length - 1} onClick={() => switchItem(1)}>下一项<ArrowRight /></button>
          </div>}
          <DraftItemImages key={`images:${activeItem.key}`} scope={imageScope} itemId={activeItem.key} images={activeItem.images || []} disabled={editBlocked} allowed={canUploadImages} onBusyChange={imageWriting} onChange={images => change({ ...latest.current, items: latest.current.items.map(item => item.key === activeItem.key ? { ...item, images } : item) })} before={<button type="button" className="secondary" onClick={() => change({ ...draft, items: [...draft.items, newItem()] })}><Plus />添加商品</button>} />
        </section>
        <section className="panel create-group"><h2><CurrencyCny />金额信息</h2><div className="create-grid order-pricing-fields"><Field label="原价（元）" name="totalAmount" error={errors.totalAmount}><input {...inputProps('totalAmount')} inputMode="decimal" value={draft.totalAmount} onChange={event => change({ ...draft, totalAmount: event.target.value })} placeholder="未填写" /></Field><Field label="会员价（元）" name="memberAmount" error={errors.memberAmount}><input {...inputProps('memberAmount')} inputMode="decimal" value={draft.memberAmount || ''} onChange={event => change({ ...draft, memberAmount: event.target.value })} placeholder="未填写" /></Field><Field label="支付方式" name="paymentMethod" error={errors.paymentMethod} wide><Select label="支付方式" id="paymentMethod" value={draft.paymentMethod || 'UNPAID'} disabled={editBlocked} onChange={paymentMethod => change({ ...draft, paymentMethod })}>{Object.entries(paymentMethods).map(([value, label]) => <option key={value} value={value} disabled={!canRecordPayment && value !== 'UNPAID'}>{label}</option>)}</Select></Field></div><p className="form-help">填写会员价时按会员价成交，否则按原价。调整商品或数量后，请核对整单金额。留空为未报价，0 为零元；支付方式仅登记。</p></section>
      </fieldset>
      {Object.keys(errors).length > 0 && <div className="notice error" role="alert">{errors.images || '请检查标出的内容后再创建订单。'}</div>}
      {error ? createdOrderId ? <div className="notice error" role="alert">订单已创建，图片队列尚未保存完成。本机草稿已保留，请重试保存队列；也可先<a href={`#/orders/${createdOrderId}`}>查看订单详情</a>。</div> : unknownResult ? <div className="notice error create-result" role="alert"><p>创建结果未确认，输入已保留。请先核对取货日期 <strong>{submittedDate}</strong>、电话 <strong>{submittedPhone}</strong>；也可重试确认原订单，不会重复建单。</p><a className="text-button" href={`#/?date=${submittedDate}`} target="_blank" rel="noreferrer">打开 {submittedDate} 工作台核对（新标签页）</a></div> : <div className="notice error" role="alert">本次请求未新增订单。{errorText(error)}</div> : null}
      <div className="create-submit"><button className="primary" disabled={busy || imageBusy || blocked}>{busy ? '正在创建订单…' : createdOrderId ? '重试保存图片队列' : unknownResult ? '重试确认原订单' : '创建订单'}<ArrowRight /></button></div>
    </form></RecognitionFields.Provider>
  </div>;
}
