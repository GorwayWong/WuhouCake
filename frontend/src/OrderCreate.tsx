import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Cake, Plus, Trash, UserCircle, Truck, CurrencyCny } from '@phosphor-icons/react';
import { creationResultUnknown, errorText } from './api';
import { changeItemDraft, createOrderRequest, newItem, specificationFields } from './orderForm';
import { OrderRecognition } from './OrderRecognition';
import { EmployeeSelect } from './EmployeeSelect';
import { DateInput } from './DateInput';
import { ProductTypeSelect } from './ProductTypeSelect';
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
    <div className="page-heading"><div><p className="eyebrow">把客户的心意，交给下一位同事</p><h1>新建订单</h1></div></div>
    <p className="create-intro">标有 * 的内容必填。创建后可在订单详情添加参考图片、确认付款和制作进度。</p>
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
        const first = form.current?.elements.namedItem(Object.keys(result.errors)[0]);
        if (first instanceof HTMLElement) first.focus();
      }
    }}>
      <fieldset className="create-fields" disabled={busy || unknownResult}>
        <div className="create-top-groups">
          <section className="panel create-group"><h2><UserCircle />客户信息</h2><div className="create-grid">
            <Field label="下单员工（业绩归属）" name="creditedEmployeeId" error={errors.creditedEmployeeId}><EmployeeSelect id="creditedEmployeeId" value={draft.creditedEmployeeId || ''} onChange={value => change({ ...draft, creditedEmployeeId: value })} /></Field>
            {customerFields.map(([name, label, maximum]) => <Field key={name} label={label} name={name} error={errors[name]}><input {...inputProps(name)} type={name === 'phone' || name === 'memberPhone' ? 'tel' : 'text'} value={draft[name]} onChange={event => change({ ...draft, [name]: event.target.value })} required={name === 'phone'} maxLength={maximum} autoComplete="off" /></Field>)}
          </div><p className="form-help">客户订购人是向门店订购商品的客户，代他人订购时可填写。下单员工用于员工业绩统计；实际录单人由系统另行记录。</p></section>
          <section className="panel create-group"><h2><Truck />交接信息</h2><div className="create-grid">
            <Field label="交接方式" name="fulfillmentType"><select {...inputProps('fulfillmentType')} value={draft.fulfillmentType} onChange={event => change({ ...draft, fulfillmentType: event.target.value as OrderDraft['fulfillmentType'] })}><option value="DELIVERY">配送上门</option><option value="PICKUP">门店自提</option></select></Field>
            <Field label="收货日期 *" name="requestedReceiveDate" error={errors.requestedReceiveDate}><DateInput {...inputProps('requestedReceiveDate')} value={draft.requestedReceiveDate} onChange={value => change({ ...draft, requestedReceiveDate: value })} required /></Field>
            <Field label="取货时间 *" name="plannedHandoffAt" error={errors.plannedHandoffAt} wide><DateInput {...inputProps('plannedHandoffAt')} type="datetime-local" step={60} value={draft.plannedHandoffAt} onChange={value => change({ ...draft, plannedHandoffAt: value })} required /></Field>
            <Field label="计划出品时间" name="plannedFinishAt" error={errors.plannedFinishAt} wide><DateInput {...inputProps('plannedFinishAt')} type="datetime-local" step={60} value={draft.plannedFinishAt} onChange={value => change({ ...draft, plannedFinishAt: value })} /></Field>
            <Field label={draft.fulfillmentType === 'DELIVERY' ? '配送地址 *' : '地址（自提可留空）'} name="address" error={errors.address} wide><textarea {...inputProps('address')} rows={2} value={draft.address} onChange={event => change({ ...draft, address: event.target.value })} required={draft.fulfillmentType === 'DELIVERY'} /></Field>
          </div><p className="form-help">以上时间均为北京时间。取货时间指客户到店自提或配送员从门店取走商品的时间；收货日期决定订单在日历中显示在哪一天。</p></section>
        </div>
        <section className="panel create-group"><div className="section-heading"><h2><Cake />蛋糕信息</h2><span className="muted">{draft.items.length} 项商品</span></div>
          {draft.items.map((item, index) => <div className="create-item" key={item.key}>
            <div className="create-item-heading"><h3>商品 {index + 1}</h3><button type="button" className="text-button danger" aria-label={`移除商品 ${index + 1}`} disabled={draft.items.length === 1} onClick={() => change({ ...draft, items: draft.items.filter(other => other.key !== item.key) })}><Trash />移除</button></div>
            <div className="create-grid">
              {(['name', 'productType', 'quantity', 'unitPrice', 'memberPrice'] as const).map(field => {
                const name = `items.${index}.${field}`;
                const confirmType = field === 'productType' && item.requiresTypeConfirmation;
                const label = { name: '商品名称 *', productType: confirmType ? '商品类型 *' : '商品类型', quantity: '数量 *', unitPrice: '商品单价（元）', memberPrice: '会员单价（元）' }[field];
                return <Field key={field} label={label} name={name} error={errors[name]} wide={field === 'name'}>{field === 'productType' ? <ProductTypeSelect {...inputProps(name)} value={item.productType} onChange={event => updateItem(item.key, { productType: event.target.value })} required={confirmType} /> : <input {...inputProps(name)} type="text" inputMode={field === 'quantity' ? 'numeric' : field.endsWith('Price') ? 'decimal' : undefined} value={item[field]} onChange={event => updateItem(item.key, { [field]: event.target.value })} required={field === 'name' || field === 'quantity'} maxLength={field === 'name' ? 128 : undefined} placeholder={field.endsWith('Price') ? '未填写' : undefined} />}</Field>;
              })}
              {specificationFields.map(([key, label]) => { const name = `items.${index}.${key}`; return <Field key={key} label={key === 'size' ? '尺寸（寸，只填数字）' : label} name={name} error={errors[name]} wide={key === 'requirements'}>{key === 'requirements' ? <textarea id={name} name={name} rows={2} value={item.attributes[key]} onChange={event => updateItem(item.key, { attributes: { ...item.attributes, [key]: event.target.value } }, key)} /> : <input {...inputProps(name)} inputMode={key === 'size' ? 'decimal' : undefined} value={item.attributes[key]} onChange={event => updateItem(item.key, { attributes: { ...item.attributes, [key]: event.target.value } }, key)} />}</Field>; })}
            </div>
          </div>)}
          <button type="button" className="secondary" onClick={() => change({ ...draft, items: [...draft.items, newItem()] })}><Plus />添加商品</button>
        </section>
        <section className="panel create-group"><h2><CurrencyCny />金额信息</h2><div className="create-grid"><Field label="订单约定总金额（元）" name="totalAmount" error={errors.totalAmount}><input {...inputProps('totalAmount')} inputMode="decimal" value={draft.totalAmount} onChange={event => change({ ...draft, totalAmount: event.target.value })} placeholder="未填写" /></Field></div><p className="form-help">按与客户约定的金额填写；不会根据商品报价自动计算。留空与 0 元不同。</p></section>
      </fieldset>
      {Object.keys(errors).length > 0 && <div className="notice error" role="alert">请检查标出的内容后再创建订单。</div>}
      {error ? unknownResult ? <div className="notice error create-result" role="alert"><p>创建结果暂时无法确认，录单内容已保留。可重试确认上次提交；系统会返回原订单或完成原提交，不会因同次重试重复建单。确认成功后可在详情中修改。也可先核对收货日期 <strong>{submittedDate}</strong>、联系电话 <strong>{submittedPhone}</strong>。</p><a className="text-button" href={`#/?date=${submittedDate}`} target="_blank" rel="noreferrer">打开 {submittedDate} 工作台核对（新标签页）</a></div> : <div className="notice error" role="alert">本次请求未新增订单。{errorText(error)}</div> : null}
      <div className="create-submit"><span className="form-help">创建后为待制作、未付款。</span><button className="primary" disabled={busy}>{busy ? '正在创建订单…' : unknownResult ? '重试确认原订单' : '创建订单'}<ArrowRight /></button></div>
    </form>
  </div>;
}
