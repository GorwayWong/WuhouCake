import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Cake, Plus, Trash, UserCircle, Truck, CurrencyCny } from '@phosphor-icons/react';
import { creationResultUnknown, errorText } from './api';
import { changeItemDraft, createOrderRequest, newItem, fieldsForProduct } from './orderForm';
import { OrderRecognition } from './OrderRecognition';
import { OrderPackagePicker } from './OrderPackagePicker';
import { EmployeeSelect } from './EmployeeSelect';
import { DateInput } from './DateInput';
import { ProductTypeSelect } from './ProductTypeSelect';
import { Select } from './Select';
import { focusFormField } from './formFocus';
import type { ItemDraft, OrderDraft } from './orderForm';
import type { CreateOrderRequest } from './types';

function Field({ label, name, error, children, wide = false }: { label: string; name: string; error?: string; children: ReactNode; wide?: boolean }) {
  return <label className={wide ? 'form-wide' : undefined} htmlFor={name}>{label}{children}{error && <span className="field-error" id={`${name}-error`}>{error}</span>}</label>;
}
export function OrderCreate({ draft, initialDraft, onChange, onSubmit, busy, error, submitted, onRecognitionDirtyChange }: {
  draft: OrderDraft; onChange: (draft: OrderDraft) => void; onSubmit: (request: CreateOrderRequest) => void; busy: boolean; error: unknown; submitted?: CreateOrderRequest;
  onRecognitionDirtyChange: (dirty: boolean) => void;
  initialDraft: OrderDraft;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const form = useRef<HTMLFormElement>(null);
  const latest = useRef(draft); latest.current = draft;
  const manualFields = useRef(new Set<string>());
  const getDraft = useCallback(() => latest.current, []);
  const change = (next: OrderDraft) => {
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
    latest.current = next; setErrors({}); onChange(next);
  };
  const recognitionChange = (next: OrderDraft) => { latest.current = next; setErrors({}); onChange(next); };
  const updateItem = (key: string, changes: Partial<ItemDraft>, editedSpecification?: string) => {
    if (editedSpecification === 'size' && changes.attributes && !/^[0-9]{0,9}(?:\.[0-9]{0,2})?$/.test(changes.attributes.size)) {
      setErrors({ [`items.${draft.items.findIndex(item => item.key === key)}.size`]: '尺寸只能填写数字，最多两位小数。' }); return;
    }
    change({ ...draft, items: draft.items.map(item => item.key === key ? changeItemDraft(item, changes, editedSpecification) : item) });
  };
  const inputProps = (name: string) => ({ id: name, name, 'aria-invalid': Boolean(errors[name]), 'aria-describedby': errors[name] ? `${name}-error` : undefined });
  const customerFields = [['customerName', '客户姓名', 80], ['phone', '联系电话 *', 32], ['memberPhone', '会员手机', 32], ['buyerName', '客户订购人（可选）', 80]] as const;
  const submittedDate = submitted?.fulfillment.requestedReceiveDate || draft.requestedReceiveDate;
  const submittedPhone = submitted?.customer.phone || draft.phone;
  const unknownResult = creationResultUnknown(error);
  return <div className="create-page">
    <a className="back-link" href="#" aria-disabled={busy}><ArrowLeft />返回工作台</a>
    <div className="page-heading"><div><h1>新建订单</h1></div></div>
    <OrderRecognition draft={draft} initialDraft={initialDraft} getDraft={getDraft} manualFields={manualFields.current} onChange={recognitionChange} busy={busy || unknownResult} onDirtyChange={onRecognitionDirtyChange} />
    <form ref={form} noValidate onSubmit={event => {
      event.preventDefault();
      if (busy) return;
      if (unknownResult && submitted) { onSubmit(submitted); return; }
      if (!draft.creditedEmployeeId) { setErrors({ creditedEmployeeId: '请选择下单员工。' }); document.getElementById('creditedEmployeeId')?.focus(); return; }
      const result = createOrderRequest(draft);
      setErrors(result.errors);
      if (result.request) onSubmit(result.request);
      else {
        focusFormField(form.current, Object.keys(result.errors)[0]);
      }
    }}>
      <fieldset className="create-fields" disabled={busy || unknownResult}>
        <div className="create-top-groups">
          <section className="panel create-group"><h2><UserCircle />客户信息</h2><div className="create-grid">
            <Field label="下单员工（业绩归属）" name="creditedEmployeeId" error={errors.creditedEmployeeId}><EmployeeSelect name="creditedEmployeeId" disabled={busy || unknownResult} id="creditedEmployeeId" value={draft.creditedEmployeeId || ''} onChange={value => change({ ...draft, creditedEmployeeId: value })} /></Field>
            {customerFields.map(([name, label, maximum]) => <Field key={name} label={label} name={name} error={errors[name]}><input {...inputProps(name)} type={name === 'phone' || name === 'memberPhone' ? 'tel' : 'text'} value={draft[name]} onChange={event => change({ ...draft, [name]: event.target.value })} required={name === 'phone'} maxLength={maximum} autoComplete="off" /></Field>)}
          </div></section>
          <section className="panel create-group"><h2><Truck />交接信息</h2><div className="create-grid">
            <Field label="交接方式" name="fulfillmentType"><Select label="交接方式" disabled={busy || unknownResult} {...inputProps('fulfillmentType')} value={draft.fulfillmentType} onChange={value => change({ ...draft, fulfillmentType: value as OrderDraft['fulfillmentType'] })}><option value="DELIVERY">配送上门</option><option value="PICKUP">门店自提</option></Select></Field>
            <Field label="客户收货时间 *" name="requestedReceiveAt" error={errors.requestedReceiveAt || errors.requestedReceiveDate} wide><DateInput label="客户收货时间" disabled={busy || unknownResult} {...inputProps('requestedReceiveAt')} type="datetime-local" timeOptional resetTimeOnDateChange value={draft.requestedReceiveAt} onChange={(value, parts) => change({ ...draft, requestedReceiveAt: value, requestedReceiveDate: parts?.date || '' })} required /><span className="form-help">客户希望收到商品的时间，日期必填，时刻可待定。</span></Field>
            <Field label="到店取货时间（选填）" name="plannedHandoffAt" error={errors.plannedHandoffAt} wide><DateInput label="到店取货时间" disabled={busy || unknownResult} {...inputProps('plannedHandoffAt')} type="datetime-local" value={draft.plannedHandoffAt} onChange={value => change({ ...draft, plannedHandoffAt: value })} /></Field>
            <Field label="计划出品时间" name="plannedFinishAt" error={errors.plannedFinishAt} wide><DateInput label="计划出品时间" disabled={busy || unknownResult} {...inputProps('plannedFinishAt')} type="datetime-local" value={draft.plannedFinishAt} onChange={value => change({ ...draft, plannedFinishAt: value })} /></Field>
            <Field label={draft.fulfillmentType === 'DELIVERY' ? '配送地址 *' : '地址（自提可留空）'} name="address" error={errors.address} wide><textarea {...inputProps('address')} rows={2} value={draft.address} onChange={event => change({ ...draft, address: event.target.value })} required={draft.fulfillmentType === 'DELIVERY'} /></Field>
          </div><p className="form-help">到店取货时间为客户或配送员到店时间（北京时间）。</p></section>
        </div>
        <section className="panel create-group"><div className="section-heading"><h2><Cake />商品信息</h2><span className="muted">{draft.items.length} 项</span></div>
          <OrderPackagePicker items={draft.items} onChange={items => change({ ...draft, items })} disabled={busy || unknownResult} />
          {draft.items.map((item, index) => <div className="create-item" key={item.key}>
            <div className="create-item-heading"><h3>商品 {index + 1}</h3><button type="button" className="text-button danger" aria-label={`移除商品 ${index + 1}`} disabled={draft.items.length === 1} onClick={() => change({ ...draft, items: draft.items.filter(other => other.key !== item.key) })}><Trash />移除</button></div>
            <div className="create-grid">
              {((['name', 'productType', 'quantity', 'unitPrice', 'memberPrice']) as ('name' | 'productType' | 'quantity' | 'unitPrice' | 'memberPrice')[]).map(field => {
                const name = `items.${index}.${field}`;
                const confirmType = field === 'productType' && item.requiresTypeConfirmation;
                const label = { name: '商品名称 *', productType: confirmType ? '商品类型 *' : '商品类型', quantity: '数量 *', unitPrice: '商品单价（元）', memberPrice: '会员单价（元）' }[field];
                return <Field key={field} label={label} name={name} error={errors[name]} wide={field === 'name'}>{field === 'productType' ? <ProductTypeSelect disabled={busy || unknownResult} {...inputProps(name)} value={item.productType} onChange={value => updateItem(item.key, { productType: value })} required={confirmType} /> : <input {...inputProps(name)} type="text" inputMode={field === 'quantity' ? 'numeric' : field.endsWith('Price') ? 'decimal' : undefined} value={item[field]} onChange={event => updateItem(item.key, { [field]: event.target.value })} required={field === 'name' || field === 'quantity'} maxLength={field === 'name' ? 128 : undefined} placeholder={field.endsWith('Price') ? '未填写' : undefined} />}</Field>;
              })}
              {fieldsForProduct(item.productType).map(([key, label]) => { const name = `items.${index}.${key}`; return <Field key={key} label={key === 'size' ? '尺寸（寸，只填数字）' : label} name={name} error={errors[name]} wide={key === 'requirements'}>{key === 'requirements' ? <textarea id={name} name={name} rows={2} value={item.attributes[key] || ''} onChange={event => updateItem(item.key, { attributes: { ...item.attributes, [key]: event.target.value } }, key)} /> : <input {...inputProps(name)} inputMode={key === 'size' ? 'decimal' : undefined} value={item.attributes[key] || ''} onChange={event => updateItem(item.key, { attributes: { ...item.attributes, [key]: event.target.value } }, key)} />}</Field>; })}
            </div>
          </div>)}
          <button type="button" className="secondary" onClick={() => change({ ...draft, items: [...draft.items, newItem()] })}><Plus />添加商品</button>
        </section>
        <section className="panel create-group"><h2><CurrencyCny />金额信息</h2><div className="create-grid"><Field label="订单约定总金额（元）" name="totalAmount" error={errors.totalAmount}><input {...inputProps('totalAmount')} inputMode="decimal" value={draft.totalAmount} onChange={event => change({ ...draft, totalAmount: event.target.value })} placeholder="未填写" /></Field></div><p className="form-help">留空为未报价，0 为零元。</p></section>
      </fieldset>
      {Object.keys(errors).length > 0 && <div className="notice error" role="alert">请检查标出的内容后再创建订单。</div>}
      {error ? unknownResult ? <div className="notice error create-result" role="alert"><p>创建结果未确认，输入已保留。请先核对客户收货日期 <strong>{submittedDate}</strong>、电话 <strong>{submittedPhone}</strong>；也可重试确认原订单，不会重复建单。</p><a className="text-button" href={`#/?date=${submittedDate}`} target="_blank" rel="noreferrer">打开 {submittedDate} 工作台核对（新标签页）</a></div> : <div className="notice error" role="alert">本次请求未新增订单。{errorText(error)}</div> : null}
      <div className="create-submit"><button className="primary" disabled={busy}>{busy ? '正在创建订单…' : unknownResult ? '重试确认原订单' : '创建订单'}<ArrowRight /></button></div>
    </form>
  </div>;
}
