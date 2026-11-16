import { useState } from 'react';
import type { Detail } from './types';
import { Select } from './Select';
import { paymentMethods } from './orderPayment';

export function OrderPaymentEditor({ order, disabled, save }: {
  order: Detail; disabled: boolean; save: (method: string) => void;
}) {
  const current = order.paymentMethod || (order.paymentStatus === 'PAID' ? 'UNKNOWN' : 'UNPAID');
  const [method, setMethod] = useState(current);
  disabled = disabled || order.pricingMode === 'ITEM_SUM' && order.totalAmountCents === null;
  const paid = order.paymentStatus === 'PAID';
  return <div className="order-payment-editor"><label>支付方式<Select label="支付方式" value={method} onChange={setMethod} disabled={disabled}>
    {current === 'UNKNOWN' && <option value="UNKNOWN" disabled>已付款（方式未记录）</option>}
    {Object.entries(paymentMethods).filter(([value]) => !paid || value !== 'UNPAID').map(([value, label]) => <option key={value} value={value}>{label}</option>)}
  </Select></label><button type="button" className="secondary" disabled={disabled || method === current || method === 'UNKNOWN'} onClick={() => save(method)}>{paid ? '保存支付方式' : '确认已付款'}</button><p className="form-help">{order.pricingMode === 'ITEM_SUM' && order.totalAmountCents === null ? '商品报价未完整，请补齐单价后再登记付款。' : '请先核对线下款项，再登记支付方式。'}</p></div>;
}
