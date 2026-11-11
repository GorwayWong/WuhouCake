import { ProductFieldLabel, ProductFormFields } from './ProductFormFields';
import { changePickupTime, changeFinishTime } from './orderTimes';
import { FinishTimeHelp } from './FinishTimeHelp';
import { Plus, Trash } from '@phosphor-icons/react';
import { DateInput } from './DateInput';
import { ProductTypeSelect } from './ProductTypeSelect';
import { Select } from './Select';
import { EmployeeSelect } from './EmployeeSelect';
import { changeItemDraft, newItem } from './orderForm';
import { productTypeLabel } from './productTypes';
import type { SubmissionDraft } from './customerSubmission';
import type { ProductFormField } from './productFormLayout';
import type { ItemDraft } from './orderForm';

export function SubmissionFields({ draft, onChange, errors, busy, staff = false }: {
  draft: SubmissionDraft; onChange: (value: SubmissionDraft) => void; errors: Record<string, string>; busy: boolean; staff?: boolean;
}) {
  const customerRows: ProductFormField[][] = [['size', 'quantity'], ['base', 'flavor'], ['filling'], ['message'], ['requirements']];
  const customerLabels: Partial<Record<ProductFormField, string>> = { size: '尺寸（寸）', base: '内胚', flavor: '奶油', filling: '夹心馅料', requirements: '其他要求' };
  const hints: Partial<Record<ProductFormField, string>> = { base: '（不填默认原味）', flavor: '（不填默认原味动物奶油）', filling: '（不填默认芒果）' };
  const label = (field: ProductFormField, required: boolean) => staff ? <ProductFieldLabel field={field} required={required} /> : <>{customerLabels[field] || (field === 'quantity' ? '数量' : '祝福语')}{required && ' *'}{hints[field] && <small className="specification-default-hint">{hints[field]}</small>}</>;
  const props = (name: string) => ({ id: name, name, 'aria-invalid': Boolean(errors[name]), 'aria-describedby': errors[name] ? name + '-error' : undefined });
  const issue = (name: string) => errors[name] && <span className="field-error" id={name + '-error'}>{errors[name]}</span>;
  const updateItem = (index: number, patch: Partial<ItemDraft>, specification?: string) => onChange({ ...draft,
    items: draft.items.map((item, i) => i === index ? changeItemDraft(item, patch, specification) : item) });
  return <fieldset className="create-fields submission-fields" disabled={busy}>
    <section className="panel create-group"><h2>收货信息</h2><div className="create-grid">
      <label>联系电话 *<input {...props('phone')} type="tel" autoComplete="tel" value={draft.phone} maxLength={32} required onChange={e => onChange({ ...draft, phone: e.target.value })} />{issue('phone')}</label>
      <label>会员手机号（选填）<input {...props('memberPhone')} type="tel" value={draft.memberPhone} maxLength={32} onChange={e => onChange({ ...draft, memberPhone: e.target.value })} />{issue('memberPhone')}</label>
      <label>收货方式<Select {...props('fulfillmentType')} label="收货方式" value={draft.fulfillmentType} disabled={busy} onChange={value => onChange({ ...draft, fulfillmentType: value as SubmissionDraft['fulfillmentType'] })}><option value="DELIVERY">配送上门</option><option value="PICKUP">门店自提</option></Select></label>
      <label>取货时间（北京时间） *<DateInput {...props('requestedReceiveAt')} type="datetime-local" label="取货时间" value={draft.requestedReceiveAt} required disabled={busy} onChange={value => onChange(changePickupTime(draft, value))} />{issue('requestedReceiveAt')}<span className="form-help">客户或配送员从门店取走商品的时间（配送订单指配送员取走，非送达时间）。</span></label>
      <label className="form-wide">{draft.fulfillmentType === 'DELIVERY' ? '配送地址 *' : '地址（选填）'}<textarea {...props('address')} autoComplete="street-address" rows={2} value={draft.address} maxLength={2000} required={draft.fulfillmentType === 'DELIVERY'} onChange={e => onChange({ ...draft, address: e.target.value })} />{issue('address')}</label>
    </div></section>
    <section className="panel create-group"><div className="section-heading"><h2>商品信息</h2><span className="muted">{draft.items.length} 项商品</span></div>
      {draft.items.map((item, index) => <div className="create-item" key={item.key}>
        <div className="create-item-heading product-form-heading"><h3>商品 {index + 1}</h3>
          {staff && <label className="product-type-field" htmlFor={`items.${index}.productType`}><span className="form-field-heading">商品类型 *</span><ProductTypeSelect {...props(`items.${index}.productType`)} value={item.productType} disabled={busy} required onChange={value => {
            const next = changeItemDraft(item, { productType: value, name: item.name === productTypeLabel(item.productType) ? productTypeLabel(value) : item.name });
            onChange({ ...draft, items: draft.items.map((other, i) => i === index ? next : other) });
          }} />{issue(`items.${index}.productType`)}</label>}
          <button type="button" className="text-button danger" disabled={busy || draft.items.length === 1} onClick={() => onChange({ ...draft, items: draft.items.filter((_, i) => i !== index) })}><Trash />移除商品 {index + 1}</button>
        </div>
        <ProductFormFields type={item.productType} prices={staff} rows={staff ? undefined : customerRows} renderField={field => {
          const name = `items.${index}.${field}`, required = field === 'name' || field === 'quantity' || field === 'size';
          if (field === 'name' || field === 'quantity' || field === 'unitPrice' || field === 'memberPrice') return <label htmlFor={name}><span className="form-field-heading">{label(field, required)}</span><input {...props(name)} maxLength={field === 'name' ? 128 : undefined} inputMode={field === 'quantity' ? 'numeric' : field.endsWith('Price') ? 'decimal' : undefined} value={item[field]} required={required} onChange={event => updateItem(index, { [field]: event.target.value })} />{issue(name)}</label>;
          return <label htmlFor={name}><span className="form-field-heading">{label(field, required)}</span>{(field === 'requirements' || field === 'filling' || field === 'specification') ? <textarea {...props(name)} maxLength={field === 'specification' ? 16000 : 2000} rows={2} value={item.attributes[field] || ''} onChange={event => updateItem(index, { attributes: { ...item.attributes, [field]: event.target.value } }, field)} /> : <input {...props(name)} inputMode={field === 'size' ? 'decimal' : undefined} maxLength={2000} required={required} value={item.attributes[field] || ''} onChange={event => updateItem(index, { attributes: { ...item.attributes, [field]: event.target.value } }, field)} />}{issue(name)}{!staff && field === 'filling' && <span className="form-help">可换火龙果、草莓、奥利奥碎、黄油脆片、脆啵啵、马蹄爆爆珠，也可混搭，最多三种。</span>}</label>;
        }} />
      </div>)}
      <button type="button" className="secondary" disabled={busy || draft.items.length >= 30} onClick={() => onChange({ ...draft, items: [...draft.items, { ...newItem(), name: '蛋糕' }] })}><Plus />添加商品</button>{issue('items')}
    </section>
    {staff && <section className="panel create-group"><h2>接单信息</h2><div className="create-grid">
      <label>整单约定金额（元） *<input {...props('totalAmount')} inputMode="decimal" value={draft.totalAmount} onChange={e => onChange({ ...draft, totalAmount: e.target.value })} />{issue('totalAmount')}</label>
      <label>业绩归属员工 *<EmployeeSelect id="creditedEmployeeId" value={draft.creditedEmployeeId} disabled={busy} onChange={value => onChange({ ...draft, creditedEmployeeId: value })} />{issue('creditedEmployeeId')}</label>
      <label className="form-wide">出品时间（选填）<DateInput {...props('plannedFinishAt')} type="datetime-local" label="出品时间" value={draft.plannedFinishAt} disabled={busy} onChange={value => onChange(changeFinishTime(draft, value))} />{issue('plannedFinishAt')}<FinishTimeHelp draft={draft} disabled={busy} onChange={onChange} /></label>
    </div></section>}
  </fieldset>;
}
