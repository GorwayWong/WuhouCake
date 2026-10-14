import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError } from './api';
import { informationDraft, informationRequest } from './orderForm';
import type { Detail, InformationRequest } from './types';
import { time } from './dates';
import { ErrorNotice, money } from './ui';

export function InformationSummary({ order, includeAmount = false }: { order: Detail; includeAmount?: boolean }) {
  return <dl className="info-grid">
    <div><dt>客户姓名</dt><dd>{order.customer.customerName || '未填写'}</dd></div><div><dt>联系电话</dt><dd><a href={`tel:${order.customer.phone}`}>{order.customer.phone}</a></dd></div>
    <div><dt>会员手机</dt><dd>{order.customer.memberPhone || '未填写'}</dd></div><div><dt>下单人</dt><dd>{order.customer.buyerName || '未填写'}</dd></div>
    <div><dt>收货日期</dt><dd>{order.fulfillment.requestedReceiveDate}</dd></div><div><dt>计划交付</dt><dd>{time(order.fulfillment.plannedHandoffAt, true)}</dd></div>
    <div><dt>计划出品</dt><dd>{time(order.fulfillment.plannedFinishAt, true)}</dd></div><div><dt>下单时间</dt><dd>{time(order.createdAt, true)}</dd></div>
    <div className="wide"><dt>{order.fulfillment.type === 'PICKUP' ? '自提安排' : '配送地址'}</dt><dd>{order.fulfillment.type === 'PICKUP' ? `门店自提${order.fulfillment.address ? ` · ${order.fulfillment.address}` : ''}` : order.fulfillment.address}</dd></div>
    {includeAmount && <div><dt>订单约定总金额</dt><dd>{money(order.totalAmountCents)}</dd></div>}
  </dl>;
}
function Field({ name, label, error, children, wide = false }: { name: string; label: string; error?: string; children: ReactNode; wide?: boolean }) {
  return <label className={wide ? 'form-wide' : undefined} htmlFor={`edit-${name}`}>{label}{children}{error && <span className="field-error" id={`edit-${name}-error`}>{error}</span>}</label>;
}
export function InformationEdit({ initial, latest, busy, error, onSave, onCancel, onDirtyChange }: {
  initial: Detail; latest: Detail; busy: boolean; error: unknown; onSave: (request: InformationRequest) => Promise<unknown>; onCancel: () => void; onDirtyChange: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState(() => informationDraft(initial));
  const [baseline, setBaseline] = useState<Detail | null>(initial);
  const [conflict, setConflict] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const attemptedVersion = useRef(initial.version);
  const form = useRef<HTMLFormElement>(null);
  const pending = informationRequest(initial, draft);
  const dirty = Boolean(pending.request) || Boolean(Object.keys(pending.errors).length && JSON.stringify(draft) !== JSON.stringify(informationDraft(initial)));
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  useEffect(() => {
    if (conflict && !baseline && latest.version > attemptedVersion.current) setBaseline(latest);
  }, [conflict, baseline, latest]);
  const props = (name: string) => ({ id: `edit-${name}`, name, 'aria-invalid': Boolean(errors[name]), 'aria-describedby': errors[name] ? `edit-${name}-error` : undefined });
  const change = (next: typeof draft) => { setDraft(next); setErrors({}); };
  return <form ref={form} className="information-form" noValidate onSubmit={async event => {
    event.preventDefault();
    if (busy || !baseline) return;
    const result = informationRequest(initial, draft, baseline);
    setErrors(result.errors);
    if (Object.keys(result.errors).length) {
      const first = form.current?.elements.namedItem(Object.keys(result.errors)[0]);
      if (first instanceof HTMLElement) first.focus();
      return;
    }
    if (!result.request) { onCancel(); return; }
    attemptedVersion.current = result.request.expectedVersion;
    try { await onSave(result.request); }
    catch (error) {
      if (error instanceof ApiError && error.code === 'CONCURRENT_MODIFICATION') { setConflict(true); setBaseline(null); }
    }
  }}>
    <fieldset className="create-fields" disabled={busy}>
      <div className="information-group"><h3>客户信息</h3><div className="create-grid">
        {([['customerName', '客户姓名', 80], ['phone', '联系电话 *', 32], ['memberPhone', '会员手机', 32], ['buyerName', '下单人', 80]] as const).map(([name, label, maximum], index) => <Field key={name} name={name} label={label} error={errors[name]}><input {...props(name)} autoFocus={index === 0} type={name === 'phone' || name === 'memberPhone' ? 'tel' : 'text'} value={draft[name]} maxLength={maximum} required={name === 'phone'} onChange={event => change({ ...draft, [name]: event.target.value })} /></Field>)}
      </div></div>
      <div className="information-group"><h3>配送／自提与交接时间</h3><div className="create-grid">
        <Field name="fulfillmentType" label="交接方式" error={errors.fulfillmentType}><select {...props('fulfillmentType')} value={draft.fulfillmentType} onChange={event => change({ ...draft, fulfillmentType: event.target.value as typeof draft.fulfillmentType })}><option value="DELIVERY">配送上门</option><option value="PICKUP">门店自提</option></select></Field>
        <Field name="requestedReceiveDate" label="收货日期 *" error={errors.requestedReceiveDate}><input {...props('requestedReceiveDate')} type="date" required value={draft.requestedReceiveDate} onChange={event => change({ ...draft, requestedReceiveDate: event.target.value })} /></Field>
        <Field name="address" label={draft.fulfillmentType === 'DELIVERY' ? '配送地址 *' : '地址（自提可留空）'} error={errors.address} wide><textarea {...props('address')} rows={2} required={draft.fulfillmentType === 'DELIVERY'} value={draft.address} onChange={event => change({ ...draft, address: event.target.value })} /></Field>
        {([['plannedHandoffAt', '计划交接时间 *'], ['plannedFinishAt', '计划出品时间']] as const).map(([name, label]) => <Field key={name} name={name} label={label} error={errors[name]}><input {...props(name)} type="datetime-local" step={60} required={name === 'plannedHandoffAt'} value={draft[name]} onChange={event => change({ ...draft, [name]: event.target.value })} /></Field>)}
      </div><p className="form-help">时间按北京时间填写。收货日期决定日历归日，与计划交接时间分别保存。</p></div>
      <div className="information-group"><h3>订单约定总金额</h3><div className="create-grid"><Field name="totalAmount" label="约定总金额（元）" error={errors.totalAmount}><input {...props('totalAmount')} inputMode="decimal" value={draft.totalAmount} placeholder="未填写" onChange={event => change({ ...draft, totalAmount: event.target.value })} /></Field></div><p className="form-help">留空表示未填写，0 元表示约定为零；修改金额不改变付款状态，不按商品报价计算。</p></div>
      <ErrorNotice error={error} />
      {conflict && <div className="information-review"><p className="notice" role="status">输入已保留。请核对下方最新资料，再点击保存修改；只提交你改过的字段。{!baseline && '最新资料尚未读取，请先重试顶部的数据读取。'}</p><h3>最新资料（用于核对）</h3><InformationSummary order={latest} includeAmount /></div>}
      <div className="actions"><button className="primary" disabled={busy || !baseline}>{busy ? '正在保存…' : '保存修改'}</button><button className="secondary" type="button" onClick={onCancel}>取消</button></div>
    </fieldset>
  </form>;
}
