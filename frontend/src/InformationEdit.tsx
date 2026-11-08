import { changePickupTime, changeFinishTime, pickupInstant, pickupDate, hasLegacyTimeConflict } from './orderTimes';
import { FinishTimeHelp } from './FinishTimeHelp';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError, creationResultUnknown } from './api';
import { amountInformationRequest, informationDraft, informationRequest } from './orderForm';
import type { Detail, InformationRequest } from './types';
import { businessDate, businessTime } from './dates';
import { ErrorNotice, money } from './ui';
import { EmployeeSelect } from './EmployeeSelect';
import { DateInput } from './DateInput';
import { Select } from './Select';
import { OrderingMethodInput } from './OrderingMethodInput';
import { focusFormField } from './formFocus';

export function InformationSummary({ order, includeAmount = false }: { order: Detail; includeAmount?: boolean }) {
  return <dl className="info-grid">
    <div><dt>下单方式</dt><dd>{order.orderingMethod || '未填写'}</dd></div>
    <div><dt>下单员工（业绩归属）</dt><dd>{order.creditedEmployee ? `${order.creditedEmployee.nickname} · ${order.creditedEmployee.employeeNumber}` : '未归属'}</dd></div>
    <div><dt>客户姓名</dt><dd>{order.customer?.customerName || '未填写'}</dd></div><div><dt>联系电话</dt><dd><a href={`tel:${order.customer?.phone}`}>{order.customer?.phone}</a></dd></div>
    <div><dt>会员手机</dt><dd>{order.customer?.memberPhone || '未填写'}</dd></div><div><dt>订购人姓名</dt><dd>{order.customer?.buyerName || '未填写'}</dd></div>
    <div><dt>取货时间</dt><dd>{pickupInstant(order.fulfillment) ? businessTime(pickupInstant(order.fulfillment)!) : `${businessDate(pickupDate(order.fulfillment))} · 时刻待定`}</dd></div>
    <div><dt>出品时间</dt><dd>{order.fulfillment.plannedFinishAt ? businessTime(order.fulfillment.plannedFinishAt) : '待定'}</dd></div><div><dt>下单时间</dt><dd>{businessTime(order.createdAt)}</dd></div>
    <div className="wide"><dt>{order.fulfillment.type === 'PICKUP' ? '自提安排' : '配送地址'}</dt><dd>{order.fulfillment.type === 'PICKUP' ? `门店自提${order.fulfillment.address ? ` · ${order.fulfillment.address}` : ''}` : order.fulfillment.address}</dd></div>
    {includeAmount && <div><dt>订单约定总金额</dt><dd>{money(order.totalAmountCents)}</dd></div>}
  </dl>;
}
function Field({ name, label, error, children, wide = false }: { name: string; label: string; error?: string; children: ReactNode; wide?: boolean }) {
  return <label className={wide ? 'form-wide' : undefined} htmlFor={`edit-${name}`}>{label}{children}{error && <span className="field-error" id={`edit-${name}-error`}>{error}</span>}</label>;
}
export function InformationEdit({ initial, latest, busy, error, onSave, onCancel, onDirtyChange, onSaveUnchanged, amountOnly = false }: {
  amountOnly?: boolean; initial: Detail; latest: Detail; busy: boolean; error: unknown; onSave: (request: InformationRequest) => Promise<unknown>; onSaveUnchanged?: () => Promise<unknown>; onCancel: () => void; onDirtyChange: (dirty: boolean) => void;
}) {
  busy = busy || Boolean(latest.deletion || latest.deleted);
  const [draft, setDraft] = useState(() => informationDraft(initial));
  const [baseline, setBaseline] = useState<Detail | null>(initial);
  const [conflict, setConflict] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const attemptedVersion = useRef(initial.version);
  const form = useRef<HTMLFormElement>(null);
  const request = (baseline = initial) => amountOnly ? amountInformationRequest(initial, draft.totalAmount, baseline, draft.memberAmount ?? '') : informationRequest(initial, draft, baseline);
  const pending = request();
  const dirty = Boolean(pending.request) || Boolean(Object.keys(pending.errors).length && JSON.stringify(draft) !== JSON.stringify(informationDraft(initial)));
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  const stale = !baseline || latest.version > baseline.version;
  const canReview = latest.version > (baseline?.version ?? attemptedVersion.current);
  const props = (name: string) => ({ id: `edit-${name}`, name, 'aria-invalid': Boolean(errors[name]), 'aria-describedby': errors[name] ? `edit-${name}-error` : undefined });
  const change = (next: typeof draft) => { setDraft(next); setErrors({}); };
  return <form ref={form} className="information-form" noValidate onSubmit={async event => {
    event.preventDefault();
    if (busy || !baseline || stale) return;
    const result = request(baseline);
    setErrors(result.errors);
    if (Object.keys(result.errors).length) {
      focusFormField(form.current, Object.keys(result.errors)[0]);
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
      {!amountOnly && <><div className="information-group"><h3>客户信息</h3><div className="create-grid">
        <Field name="orderingMethod" label="下单方式" error={errors.orderingMethod}><OrderingMethodInput id="edit-orderingMethod" disabled={busy} value={draft.orderingMethod || ''} custom={draft.orderingMethodCustom} invalid={Boolean(errors.orderingMethod)} describedBy={props('orderingMethod')['aria-describedby']} onChange={method => change({ ...draft, ...method })} /></Field>
        <Field name="creditedEmployeeId" label="下单员工（业绩归属）" error={errors.creditedEmployeeId}><EmployeeSelect name="creditedEmployeeId" disabled={busy} id="edit-creditedEmployeeId" value={draft.creditedEmployeeId || ''} saved={initial.creditedEmployee} onChange={value => change({ ...draft, creditedEmployeeId: value })} /></Field>
        {([['customerName', '客户姓名', 80], ['phone', '联系电话 *', 32], ['memberPhone', '会员手机', 32], ['buyerName', '订购人姓名（选填）', 80]] as const).map(([name, label, maximum], index) => <Field key={name} name={name} label={label} error={errors[name]}><input {...props(name)} autoFocus={index === 0} type={name === 'phone' || name === 'memberPhone' ? 'tel' : 'text'} placeholder={name === 'buyerName' ? '实际向门店下单的客户' : undefined} value={draft[name]} maxLength={maximum} required={name === 'phone'} onChange={event => change({ ...draft, [name]: event.target.value })} /></Field>)}
      </div></div>
      <div className="information-group"><h3>配送／自提与交接时间</h3><div className="create-grid">
        <Field name="fulfillmentType" label="交接方式" error={errors.fulfillmentType}><Select label="交接方式" disabled={busy} {...props('fulfillmentType')} value={draft.fulfillmentType} onChange={value => change({ ...draft, fulfillmentType: value as typeof draft.fulfillmentType })}><option value="DELIVERY">配送上门</option><option value="PICKUP">门店自提</option></Select></Field>
        <Field name="requestedReceiveAt" label="取货时间 *" error={errors.requestedReceiveAt || errors.requestedReceiveDate} wide><DateInput label="取货时间" disabled={busy} {...props('requestedReceiveAt')} type="datetime-local" timeOptional required resetTimeOnDateChange value={draft.requestedReceiveAt} onChange={(value, parts) => change({ ...changePickupTime(draft, value), requestedReceiveDate: parts?.date || '' })} /><span className="form-help">客户或配送员从门店取走商品的时间，日期必填，时刻可待定。</span></Field>
        <Field name="address" label={draft.fulfillmentType === 'DELIVERY' ? '配送地址 *' : '地址（自提可留空）'} error={errors.address} wide><textarea {...props('address')} rows={2} required={draft.fulfillmentType === 'DELIVERY'} value={draft.address} onChange={event => change({ ...draft, address: event.target.value })} /></Field>
        <Field name="plannedFinishAt" label="出品时间" error={errors.plannedFinishAt}><DateInput label="出品时间" disabled={busy} {...props('plannedFinishAt')} type="datetime-local" value={draft.plannedFinishAt} onChange={value => change(changeFinishTime(draft, value))} /><FinishTimeHelp draft={draft} disabled={busy} onChange={change} /></Field>
      </div>{hasLegacyTimeConflict(initial.fulfillment) && <p className="notice" role="status">历史时间不同，请核对：原到店取货时间 {businessTime(initial.fulfillment.plannedHandoffAt!)}；原客户收货时间 {businessTime(initial.fulfillment.requestedReceiveAt!)}。修改取货时间后，两项将同步。</p>}</div></>}
      <div className="information-group"><h3>金额信息</h3><div className="create-grid order-pricing-fields"><Field name="totalAmount" label="原价（元）" error={errors.totalAmount}><input {...props('totalAmount')} autoFocus={amountOnly} inputMode="decimal" value={draft.totalAmount} placeholder="未填写" onChange={event => change({ ...draft, totalAmount: event.target.value })} /></Field><Field name="memberAmount" label="会员价（元）" error={errors.memberAmount}><input {...props('memberAmount')} inputMode="decimal" value={draft.memberAmount || ''} placeholder="未填写" onChange={event => change({ ...draft, memberAmount: event.target.value })} /></Field></div><p className="form-help">会员价优先作为成交金额，未填则使用原价。留空为未报价，0 为零元。付款状态不变。</p></div>
      <ErrorNotice error={error} />{creationResultUnknown(error) && <p className="notice error" role="alert">资料保存结果未确认，图片仍暂存。请先核对最新资料，再决定保存或取消；取消不会撤销可能已保存的资料。</p>}
      {(conflict || stale) && <div className="information-review"><p className="notice" role="status">{stale ? '订单已更新，输入已保留。核对最新内容后再保存。' : '已核对，请确认修改后保存。'}{!baseline && !canReview && '请先刷新订单。'}</p><h3>最新资料（用于核对）</h3>{amountOnly ? <p>当前订单金额：{money(latest.totalAmountCents)}</p> : <InformationSummary order={latest} includeAmount />}{stale && <button type="button" className="secondary" disabled={!canReview} onClick={() => { setBaseline(latest); setConflict(true); }}>已核对最新版本，继续编辑</button>}</div>}
      <div className="actions"><button className="primary" disabled={busy || stale}>{busy ? '正在保存…' : '保存修改'}</button><button className="secondary" type="button" onClick={onCancel}>取消</button></div>
    </fieldset>
  </form>;
}
