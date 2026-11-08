import { useState } from 'react';
import type { Detail } from './types';
import { Select } from './Select';
import { paymentMethods } from './orderPayment';

export function OrderPaymentEditor({ order, disabled, save }: {
  order: Detail; disabled: boolean; save: (method: string) => void;
}) {
  const current = order.paymentMethod || (order.paymentStatus === 'PAID' ? 'UNKNOWN' : 'UNPAID');
  const [method, setMethod] = useState(current);
  return <div className="order-payment-editor"><label>支付方式<Select label="支付方式" value={method} onChange={setMethod} disabled={disabled}>
    {current === 'UNKNOWN' && <option value="UNKNOWN" disabled>已付款（方式未记录）</option>}
    {Object.entries(paymentMethods).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
  </Select></label><button type="button" className="secondary" disabled={disabled || method === current || method === 'UNKNOWN'} onClick={() => save(method)}>{method === 'UNPAID' ? '改为未付款' : order.paymentStatus === 'PAID' ? '保存支付方式' : '确认已付款'}</button><p className="form-help">仅登记付款，不实际扣款。选择未付会清除付款时间。</p></div>;
}
