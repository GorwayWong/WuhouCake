import { Plus, Trash } from '@phosphor-icons/react';
import { DateInput } from './DateInput';
import { ProductTypeSelect } from './ProductTypeSelect';
import { Select } from './Select';
import { EmployeeSelect } from './EmployeeSelect';
import { changeItemDraft, newItem } from './orderForm';
import { productTypeLabel } from './productTypes';
import type { SubmissionDraft } from './customerSubmission';
import type { ItemDraft } from './orderForm';

export function SubmissionFields({ draft, onChange, errors, busy, staff = false }: {
  draft: SubmissionDraft; onChange: (value: SubmissionDraft) => void; errors: Record<string, string>; busy: boolean; staff?: boolean;
}) {
  const props = (name: string) => ({ id: name, name, 'aria-invalid': Boolean(errors[name]), 'aria-describedby': errors[name] ? name + '-error' : undefined });
  const issue = (name: string) => errors[name] && <span className="field-error" id={name + '-error'}>{errors[name]}</span>;
  const handoffLabel = '到店取货时间';
  const updateItem = (index: number, patch: Partial<ItemDraft>, specification?: string) => onChange({ ...draft,
    items: draft.items.map((item, i) => i === index ? changeItemDraft(item, patch, specification) : item) });
  return <fieldset className="create-fields submission-fields" disabled={busy}>
    <section className="panel create-group"><h2>收货信息</h2><div className="create-grid">
      <label>联系电话 *<input {...props('phone')} type="tel" autoComplete="tel" value={draft.phone} maxLength={32} required onChange={e => onChange({ ...draft, phone: e.target.value })} />{issue('phone')}</label>
      <label>会员手机号（选填）<input {...props('memberPhone')} type="tel" value={draft.memberPhone} maxLength={32} onChange={e => onChange({ ...draft, memberPhone: e.target.value })} />{issue('memberPhone')}</label>
      <label>收货方式<Select {...props('fulfillmentType')} label="收货方式" value={draft.fulfillmentType} disabled={busy} onChange={value => onChange({ ...draft, fulfillmentType: value as SubmissionDraft['fulfillmentType'] })}><option value="DELIVERY">配送上门</option><option value="PICKUP">门店自提</option></Select></label>
      <label>客户收货时间（北京时间） *<DateInput {...props('requestedReceiveAt')} type="datetime-local" label="客户收货时间" value={draft.requestedReceiveAt} required disabled={busy} onChange={value => onChange({ ...draft, requestedReceiveAt: value })} />{issue('requestedReceiveAt')}</label>
      <label className="form-wide">{draft.fulfillmentType === 'DELIVERY' ? '配送地址 *' : '地址（选填）'}<textarea {...props('address')} autoComplete="street-address" rows={2} value={draft.address} maxLength={2000} required={draft.fulfillmentType === 'DELIVERY'} onChange={e => onChange({ ...draft, address: e.target.value })} />{issue('address')}</label>
    </div></section>
    <section className="panel create-group"><div className="section-heading"><h2>商品信息</h2><span className="muted">{draft.items.length} 项商品</span></div>
      {draft.items.map((item, index) => <div className="create-item" key={item.key}><div className="create-item-heading"><h3>商品 {index + 1}</h3><button type="button" className="text-button danger" disabled={busy || draft.items.length === 1} onClick={() => onChange({ ...draft, items: draft.items.filter((_, i) => i !== index) })}><Trash />移除商品 {index + 1}</button></div><div className="create-grid">
        <label>商品类型 *<ProductTypeSelect {...props(`items.${index}.productType`)} value={item.productType} disabled={busy} onChange={value => {
          const next = changeItemDraft(item, { productType: value, name: item.name === productTypeLabel(item.productType) ? productTypeLabel(value) : item.name });
          onChange({ ...draft, items: draft.items.map((other, i) => i === index ? next : other) });
        }} />{issue(`items.${index}.productType`)}</label>
        <label>数量 *<input {...props(`items.${index}.quantity`)} inputMode="numeric" value={item.quantity} required onChange={e => updateItem(index, { quantity: e.target.value })} />{issue(`items.${index}.quantity`)}</label>
        <label className="form-wide">商品名称 *<input {...props(`items.${index}.name`)} maxLength={128} value={item.name} required onChange={e => updateItem(index, { name: e.target.value })} />{issue(`items.${index}.name`)}</label>
        {(item.productType === 'CAKE' ? [['size', '尺寸（寸） *'], ['base', '内胚'], ['filling', '夹心／配料'], ['flavor', '奶油（选填）'], ['message', '祝福语（选填）'], ['requirements', '其他要求（选填）']] : [['specification', '规格（选填）'], ['requirements', '其他要求（选填）']]).map(([key, label]) => {
          const field = key as keyof ItemDraft['attributes'], name = `items.${index}.${key}`;
          return <label key={key} className={key === 'requirements' ? 'form-wide' : undefined}>{label}{key === 'requirements' ? <textarea {...props(name)} maxLength={2000} rows={2} value={item.attributes[field] || ''} onChange={e => updateItem(index, { attributes: { ...item.attributes, [field]: e.target.value } }, field)} /> : <input {...props(name)} inputMode={key === 'size' ? 'decimal' : undefined} maxLength={2000} required={key === 'size'} value={item.attributes[field] || ''} onChange={e => updateItem(index, { attributes: { ...item.attributes, [field]: e.target.value } }, field)} />}{issue(name)}</label>;
        })}
        {staff && (['unitPrice', 'memberPrice'] as const).map(key => <label key={key}>{key === 'unitPrice' ? '商品单价（元，选填）' : '会员单价（元，选填）'}<input {...props(`items.${index}.${key}`)} inputMode="decimal" value={item[key]} onChange={e => updateItem(index, { [key]: e.target.value })} />{issue(`items.${index}.${key}`)}</label>)}
      </div></div>)}
      <button type="button" className="secondary" disabled={busy || draft.items.length >= 30} onClick={() => onChange({ ...draft, items: [...draft.items, { ...newItem(), name: '蛋糕' }] })}><Plus />添加商品</button>{issue('items')}
    </section>
    {staff && <section className="panel create-group"><h2>接单信息</h2><div className="create-grid">
      <label>整单约定金额（元） *<input {...props('totalAmount')} inputMode="decimal" value={draft.totalAmount} onChange={e => onChange({ ...draft, totalAmount: e.target.value })} />{issue('totalAmount')}</label>
      <label>业绩归属员工 *<EmployeeSelect id="creditedEmployeeId" value={draft.creditedEmployeeId} disabled={busy} onChange={value => onChange({ ...draft, creditedEmployeeId: value })} />{issue('creditedEmployeeId')}</label>
      <label className="form-wide">{handoffLabel}（选填）<DateInput {...props('plannedHandoffAt')} type="datetime-local" label={handoffLabel} value={draft.plannedHandoffAt} disabled={busy} onChange={value => onChange({ ...draft, plannedHandoffAt: value })} />{issue('plannedHandoffAt')}<span className="form-help">{draft.fulfillmentType === 'PICKUP' ? '客户到店取走商品的时间。' : '配送员到店取走商品的时间。'}</span></label>
      <label className="form-wide">计划出品时间（选填）<DateInput {...props('plannedFinishAt')} type="datetime-local" label="计划出品时间" value={draft.plannedFinishAt} disabled={busy} onChange={value => onChange({ ...draft, plannedFinishAt: value })} />{issue('plannedFinishAt')}<span className="form-help">门店计划完成制作、备齐商品的时间。</span></label>
    </div></section>}
  </fieldset>;
}
