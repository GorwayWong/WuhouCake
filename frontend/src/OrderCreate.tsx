import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Cake, Plus, Trash, UserCircle, Truck, CurrencyCny } from '@phosphor-icons/react';
import { creationResultUnknown, errorText } from './api';
import { createOrderRequest, newItem, specificationFields } from './orderForm';
import type { ItemDraft, OrderDraft } from './orderForm';
import type { CreateOrderRequest } from './types';

function Field({ label, name, error, children, wide = false }: { label: string; name: string; error?: string; children: ReactNode; wide?: boolean }) {
  return <label className={wide ? 'form-wide' : undefined} htmlFor={name}>{label}{children}{error && <span className="field-error" id={`${name}-error`}>{error}</span>}</label>;
}
export function OrderCreate({ draft, onChange, onSubmit, busy, error, submitted }: {
  draft: OrderDraft; onChange: (draft: OrderDraft) => void; onSubmit: (request: CreateOrderRequest) => void; busy: boolean; error: unknown; submitted?: CreateOrderRequest;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const form = useRef<HTMLFormElement>(null);
  const change = (next: OrderDraft) => { setErrors({}); onChange(next); };
  const updateItem = (key: string, changes: Partial<ItemDraft>) => change({ ...draft, items: draft.items.map(item => item.key === key ? { ...item, ...changes } : item) });
  const inputProps = (name: string) => ({ id: name, name, 'aria-invalid': Boolean(errors[name]), 'aria-describedby': errors[name] ? `${name}-error` : undefined });
  const customerFields = [['customerName', '客户姓名', 80], ['phone', '联系电话 *', 32], ['memberPhone', '会员手机', 32], ['buyerName', '下单人', 80]] as const;
  const submittedDate = submitted?.fulfillment.requestedReceiveDate || draft.requestedReceiveDate;
  const submittedPhone = submitted?.customer.phone || draft.phone;
  return <div className="create-page">
    <a className="back-link" href="#" aria-disabled={busy}><ArrowLeft />返回工作台</a>
    <div className="page-heading"><div><p className="eyebrow">把客户的心意，交给下一位同事</p><h1>新建订单</h1></div></div>
    <p className="create-intro">标有 * 的内容必填。创建后可在订单详情添加参考图片、确认付款和制作进度。</p>
    <form ref={form} noValidate onSubmit={event => {
      event.preventDefault();
      if (busy) return;
      const result = createOrderRequest(draft);
      setErrors(result.errors);
      if (result.request) onSubmit(result.request);
      else {
        const first = form.current?.elements.namedItem(Object.keys(result.errors)[0]);
        if (first instanceof HTMLElement) first.focus();
      }
    }}>
      <fieldset className="create-fields" disabled={busy}>
        <div className="create-top-groups">
          <section className="panel create-group"><h2><UserCircle />客户信息</h2><div className="create-grid">
            {customerFields.map(([name, label, maximum]) => <Field key={name} label={label} name={name} error={errors[name]}><input {...inputProps(name)} type={name === 'phone' || name === 'memberPhone' ? 'tel' : 'text'} value={draft[name]} onChange={event => change({ ...draft, [name]: event.target.value })} required={name === 'phone'} maxLength={maximum} autoComplete="off" /></Field>)}
          </div></section>
          <section className="panel create-group"><h2><Truck />交接信息</h2><div className="create-grid">
            <Field label="交接方式" name="fulfillmentType"><select {...inputProps('fulfillmentType')} value={draft.fulfillmentType} onChange={event => change({ ...draft, fulfillmentType: event.target.value as OrderDraft['fulfillmentType'] })}><option value="DELIVERY">配送上门</option><option value="PICKUP">门店自提</option></select></Field>
            <Field label="收货日期 *" name="requestedReceiveDate" error={errors.requestedReceiveDate}><input {...inputProps('requestedReceiveDate')} type="date" value={draft.requestedReceiveDate} onChange={event => change({ ...draft, requestedReceiveDate: event.target.value })} required /></Field>
            <Field label="计划交接时间 *" name="plannedHandoffAt" error={errors.plannedHandoffAt} wide><input {...inputProps('plannedHandoffAt')} type="datetime-local" step={60} value={draft.plannedHandoffAt} onChange={event => change({ ...draft, plannedHandoffAt: event.target.value })} required /></Field>
            <Field label="计划出品时间" name="plannedFinishAt" error={errors.plannedFinishAt} wide><input {...inputProps('plannedFinishAt')} type="datetime-local" step={60} value={draft.plannedFinishAt} onChange={event => change({ ...draft, plannedFinishAt: event.target.value })} /></Field>
            <Field label={draft.fulfillmentType === 'DELIVERY' ? '配送地址 *' : '地址（自提可留空）'} name="address" error={errors.address} wide><textarea {...inputProps('address')} rows={2} value={draft.address} onChange={event => change({ ...draft, address: event.target.value })} required={draft.fulfillmentType === 'DELIVERY'} /></Field>
          </div><p className="form-help">以上时间均为门店时间（北京时间）。收货日期决定订单归日。</p></section>
        </div>
        <section className="panel create-group"><div className="section-heading"><h2><Cake />蛋糕信息</h2><span className="muted">{draft.items.length} 件商品</span></div>
          {draft.items.map((item, index) => <div className="create-item" key={item.key}>
            <div className="create-item-heading"><h3>商品 {index + 1}</h3><button type="button" className="text-button danger" aria-label={`移除商品 ${index + 1}`} disabled={draft.items.length === 1} onClick={() => change({ ...draft, items: draft.items.filter(other => other.key !== item.key) })}><Trash />移除</button></div>
            <div className="create-grid">
              {(['name', 'productType', 'quantity', 'unitPrice', 'memberPrice'] as const).map(field => {
                const name = `items.${index}.${field}`;
                const label = { name: '商品名称 *', productType: '商品类型', quantity: '数量 *', unitPrice: '商品单价（元）', memberPrice: '会员单价（元）' }[field];
                return <Field key={field} label={label} name={name} error={errors[name]} wide={field === 'name'}><input {...inputProps(name)} type="text" inputMode={field === 'quantity' ? 'numeric' : field.endsWith('Price') ? 'decimal' : undefined} value={item[field]} onChange={event => updateItem(item.key, { [field]: event.target.value })} required={field === 'name' || field === 'quantity'} maxLength={field === 'name' ? 128 : field === 'productType' ? 32 : undefined} placeholder={field.endsWith('Price') ? '未填写' : undefined} /></Field>;
              })}
              {specificationFields.map(([key, label]) => { const name = `items.${index}.${key}`; return <Field key={key} label={label} name={name} wide={key === 'requirements'}>{key === 'requirements' ? <textarea id={name} name={name} rows={2} value={item.attributes[key]} onChange={event => updateItem(item.key, { attributes: { ...item.attributes, [key]: event.target.value } })} /> : <input id={name} name={name} value={item.attributes[key]} onChange={event => updateItem(item.key, { attributes: { ...item.attributes, [key]: event.target.value } })} />}</Field>; })}
            </div>
          </div>)}
          <button type="button" className="secondary" onClick={() => change({ ...draft, items: [...draft.items, newItem()] })}><Plus />添加商品</button>
        </section>
        <section className="panel create-group"><h2><CurrencyCny />金额信息</h2><div className="create-grid"><Field label="订单约定总金额（元）" name="totalAmount" error={errors.totalAmount}><input {...inputProps('totalAmount')} inputMode="decimal" value={draft.totalAmount} onChange={event => change({ ...draft, totalAmount: event.target.value })} placeholder="未填写" /></Field></div><p className="form-help">按与客户约定的金额填写；不会根据商品报价自动计算。留空与 0 元不同。</p></section>
      </fieldset>
      {Object.keys(errors).length > 0 && <div className="notice error" role="alert">请检查标出的内容后再创建订单。</div>}
      {error ? creationResultUnknown(error) ? <div className="notice error create-result" role="alert"><p>创建结果暂时无法确认，可能已成功写入，录单内容已保留。请先核对收货日期 <strong>{submittedDate}</strong>、联系电话 <strong>{submittedPhone}</strong> 及对应订单，再决定是否重新提交。</p><a className="text-button" href={`#/?date=${submittedDate}`} target="_blank" rel="noreferrer">打开 {submittedDate} 工作台核对（新标签页）</a></div> : <div className="notice error" role="alert">创建请求已被拒绝，订单未创建。{errorText(error)}</div> : null}
      <div className="create-submit"><span className="form-help">创建后为待制作、未付款。</span><button className="primary" disabled={busy}>{busy ? '正在创建订单…' : '创建订单'}<ArrowRight /></button></div>
    </form>
  </div>;
}
