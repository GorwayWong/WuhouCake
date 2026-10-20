import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError } from './api';
import { informationDraft, informationRequest } from './orderForm';
import type { Detail, InformationRequest } from './types';
import { time } from './dates';
import { ErrorNotice, money } from './ui';
import { EmployeeSelect } from './EmployeeSelect';
import { DateInput } from './DateInput';
import { Select } from './Select';
import { focusFormField } from './formFocus';

export function InformationSummary({ order, includeAmount = false }: { order: Detail; includeAmount?: boolean }) {
  return <dl className="info-grid">
    <div><dt>下单员工（业绩归属）</dt><dd>{order.creditedEmployee ? `${order.creditedEmployee.nickname} · ${order.creditedEmployee.employeeNumber}` : '未归属'}</dd></div>
    <div><dt>客户姓名</dt><dd>{order.customer.customerName || '未填写'}</dd></div><div><dt>联系电话</dt><dd><a href={`tel:${order.customer.phone}`}>{order.customer.phone}</a></dd></div>
    <div><dt>会员手机</dt><dd>{order.customer.memberPhone || '未填写'}</dd></div><div><dt>客户订购人</dt><dd>{order.customer.buyerName || '未填写'}</dd></div>
    <div><dt>收货日期</dt><dd>{order.fulfillment.requestedReceiveDate}</dd></div><div><dt>取货时间</dt><dd>{time(order.fulfillment.plannedHandoffAt, true)}</dd></div>
    <div><dt>当前期望收货时间</dt><dd>{order.fulfillment.requestedReceiveAt ? time(order.fulfillment.requestedReceiveAt, true) : '具体时刻未填写'}</dd></div>
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
  const stale = !baseline || latest.version > baseline.version;
  const canReview = latest.version > (baseline?.version ?? attemptedVersion.current);
  const props = (name: string) => ({ id: `edit-${name}`, name, 'aria-invalid': Boolean(errors[name]), 'aria-describedby': errors[name] ? `edit-${name}-error` : undefined });
  const change = (next: typeof draft) => { setDraft(next); setErrors({}); };
  return <form ref={form} className="information-form" noValidate onSubmit={async event => {
    event.preventDefault();
    if (busy || !baseline || stale) return;
    const result = informationRequest(initial, draft, baseline);
    setErrors(result.errors);
    if (Object.keys(result.errors).length) {
      focusFormField(form.current, Object.keys(result.errors)[0]);
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
        <Field name="creditedEmployeeId" label="下单员工（业绩归属）" error={errors.creditedEmployeeId}><EmployeeSelect name="creditedEmployeeId" disabled={busy} id="edit-creditedEmployeeId" value={draft.creditedEmployeeId || ''} saved={initial.creditedEmployee} onChange={value => change({ ...draft, creditedEmployeeId: value })} /></Field>
        {([['customerName', '客户姓名', 80], ['phone', '联系电话 *', 32], ['memberPhone', '会员手机', 32], ['buyerName', '客户订购人', 80]] as const).map(([name, label, maximum], index) => <Field key={name} name={name} label={label} error={errors[name]}><input {...props(name)} autoFocus={index === 0} type={name === 'phone' || name === 'memberPhone' ? 'tel' : 'text'} value={draft[name]} maxLength={maximum} required={name === 'phone'} onChange={event => change({ ...draft, [name]: event.target.value })} /></Field>)}
      </div></div>
      <div className="information-group"><h3>配送／自提与交接时间</h3><div className="create-grid">
        <Field name="fulfillmentType" label="交接方式" error={errors.fulfillmentType}><Select label="交接方式" disabled={busy} {...props('fulfillmentType')} value={draft.fulfillmentType} onChange={value => change({ ...draft, fulfillmentType: value as typeof draft.fulfillmentType })}><option value="DELIVERY">配送上门</option><option value="PICKUP">门店自提</option></Select></Field>
        <Field name="requestedReceiveAt" label="期望收货日期和时刻" error={errors.requestedReceiveAt} wide><DateInput label="期望收货时间" disabled={busy} {...props('requestedReceiveAt')} type="datetime-local" resetTimeOnDateChange value={draft.requestedReceiveAt} onChange={(value, parts) => change({ ...draft, requestedReceiveAt: value, requestedReceiveDate: parts?.date || draft.requestedReceiveDate })} /><span className="form-help">日历收货日期：{draft.requestedReceiveDate}。改期后请重新填写时刻；历史未填写的具体时刻不会自动推算。</span></Field>
        <Field name="address" label={draft.fulfillmentType === 'DELIVERY' ? '配送地址 *' : '地址（自提可留空）'} error={errors.address} wide><textarea {...props('address')} rows={2} required={draft.fulfillmentType === 'DELIVERY'} value={draft.address} onChange={event => change({ ...draft, address: event.target.value })} /></Field>
        {([['plannedHandoffAt', '取货时间 *'], ['plannedFinishAt', '计划出品时间']] as const).map(([name, label]) => <Field key={name} name={name} label={label} error={errors[name]}><DateInput label={label.replace(' *', '')} disabled={busy} {...props(name)} type="datetime-local" required={name === 'plannedHandoffAt'} value={draft[name]} onChange={value => change({ ...draft, [name]: value })} /></Field>)}
      </div><p className="form-help">北京时间；取货指客户自提或配送员到店取走。</p></div>
      <div className="information-group"><h3>订单约定总金额</h3><div className="create-grid"><Field name="totalAmount" label="约定总金额（元）" error={errors.totalAmount}><input {...props('totalAmount')} inputMode="decimal" value={draft.totalAmount} placeholder="未填写" onChange={event => change({ ...draft, totalAmount: event.target.value })} /></Field></div><p className="form-help">留空为未报价，0 为零元；修改金额不改变付款状态。</p></div>
      <ErrorNotice error={error} />
      {(conflict || stale) && <div className="information-review"><p className="notice" role="status">{stale ? '订单已有新版本，你的输入已保留。请先核对最新资料。' : '已核对最新版本，请再次检查自己的修改后保存。'}只提交你改过的字段。{!baseline && !canReview && '最新资料尚未读取，请重试顶部的数据读取。'}</p><h3>最新资料（用于核对）</h3><InformationSummary order={latest} includeAmount />{stale && <button type="button" className="secondary" disabled={!canReview} onClick={() => { setBaseline(latest); setConflict(true); }}>已核对最新版本，继续编辑</button>}</div>}
      <div className="actions"><button className="primary" disabled={busy || stale}>{busy ? '正在保存…' : '保存修改'}</button><button className="secondary" type="button" onClick={onCancel}>取消</button></div>
    </fieldset>
  </form>;
}
