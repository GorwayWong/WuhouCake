import type { CreateOrderRequest, Detail, InformationChanges, InformationRequest } from './types';

export const specificationFields = [
  ['size', '尺寸'], ['flavor', '口味'], ['filling', '夹馅'],
  ['base', '内胚'], ['message', '祝福语'], ['requirements', '特殊要求'],
] as const;
type Specification = typeof specificationFields[number][0];
export interface ItemDraft {
  key: string; name: string; productType: string; quantity: string;
  unitPrice: string; memberPrice: string; attributes: Record<Specification, string>;
}
export interface OrderDraft {
  customerName: string; phone: string; memberPhone: string; buyerName: string;
  fulfillmentType: 'DELIVERY' | 'PICKUP'; address: string; requestedReceiveDate: string;
  plannedHandoffAt: string; plannedFinishAt: string; totalAmount: string; items: ItemDraft[];
}
export function newItem(): ItemDraft {
  return { key: crypto.randomUUID(), name: '', productType: 'CAKE', quantity: '1', unitPrice: '', memberPrice: '',
    attributes: { size: '', flavor: '', filling: '', base: '', message: '', requirements: '' } };
}
export function newDraft(date: string): OrderDraft {
  return { customerName: '', phone: '', memberPhone: '', buyerName: '', fulfillmentType: 'DELIVERY', address: '',
    requestedReceiveDate: date, plannedHandoffAt: '', plannedFinishAt: '', totalAmount: '', items: [newItem()] };
}
export function moneyToCents(input: string): number | null {
  const value = input.trim();
  if (!value) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error('请输入非负金额，最多保留两位小数。');
  const [yuan, fraction = ''] = value.split('.');
  const cents = BigInt(yuan) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('金额过大，请核对后重新填写。');
  return Number(cents);
}
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function storeTime(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match || !validDate(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59) {
    throw new Error('请选择完整、有效的日期和时间。');
  }
  return `${value}:00+08:00`;
}
export function createOrderRequest(draft: OrderDraft): { request: CreateOrderRequest | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const text = (value: string, field: string, label: string, maximum: number, required = false) => {
    if (required && !value.trim()) errors[field] = `请填写${label}。`;
    else if (value.length > maximum) errors[field] = `${label}最多填写 ${maximum} 个字符。`;
    return value.trim() || null;
  };
  const amount = (value: string, field: string) => {
    try { return moneyToCents(value); }
    catch (error) { errors[field] = (error as Error).message; return null; }
  };
  const dateTime = (value: string, field: string, required = false) => {
    if (!value && !required) return null;
    try { return storeTime(value); }
    catch (error) { errors[field] = (error as Error).message; return null; }
  };
  if (!validDate(draft.requestedReceiveDate)) errors.requestedReceiveDate = '请选择有效的收货日期。';
  if (!draft.items.length) errors.items = '订单至少需要一件商品。';
  const request: CreateOrderRequest = {
    customer: {
      customerName: text(draft.customerName, 'customerName', '客户姓名', 80),
      phone: text(draft.phone, 'phone', '联系电话', 32, true) || '',
      memberPhone: text(draft.memberPhone, 'memberPhone', '会员手机', 32),
      buyerName: text(draft.buyerName, 'buyerName', '下单人', 80),
    },
    fulfillment: {
      type: draft.fulfillmentType,
      address: text(draft.address, 'address', '配送地址', Number.MAX_SAFE_INTEGER, draft.fulfillmentType === 'DELIVERY'),
      requestedReceiveDate: draft.requestedReceiveDate,
      plannedHandoffAt: dateTime(draft.plannedHandoffAt, 'plannedHandoffAt', true) || '',
      plannedFinishAt: dateTime(draft.plannedFinishAt, 'plannedFinishAt'),
    },
    items: draft.items.map((item, index) => {
      const path = `items.${index}`;
      const quantity = Number(item.quantity);
      if (!/^\d+$/.test(item.quantity) || !Number.isInteger(quantity) || quantity < 1 || quantity > 2147483647) {
        errors[`${path}.quantity`] = '数量须为 1–2147483647 之间的整数。';
      }
      return {
        name: text(item.name, `${path}.name`, '商品名称', 128, true) || '',
        productType: text(item.productType, `${path}.productType`, '商品类型', 32) || 'CAKE', quantity,
        unitPriceCents: amount(item.unitPrice, `${path}.unitPrice`),
        memberPriceCents: amount(item.memberPrice, `${path}.memberPrice`),
        attributes: Object.fromEntries(specificationFields.flatMap(([key]) => item.attributes[key].trim() ? [[key, item.attributes[key].trim()]] : [])),
      };
    }),
    totalAmountCents: amount(draft.totalAmount, 'totalAmount'),
  };
  return { request: Object.keys(errors).length ? null : request, errors };
}

export type InformationDraft = Omit<OrderDraft, 'items'>;
function localStoreTime(value: string | null): string {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const part = (type: string) => parts.find(part => part.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}
export function informationDraft(order: Detail): InformationDraft {
  const cents = order.totalAmountCents == null ? null : BigInt(order.totalAmountCents);
  return { customerName: order.customer.customerName || '', phone: order.customer.phone, memberPhone: order.customer.memberPhone || '', buyerName: order.customer.buyerName || '',
    fulfillmentType: order.fulfillment.type as InformationDraft['fulfillmentType'], address: order.fulfillment.address || '', requestedReceiveDate: order.fulfillment.requestedReceiveDate,
    plannedHandoffAt: localStoreTime(order.fulfillment.plannedHandoffAt), plannedFinishAt: localStoreTime(order.fulfillment.plannedFinishAt),
    totalAmount: cents == null ? '' : `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}` };
}
export function informationRequest(original: Detail, draft: InformationDraft, baseline = original): { request: InformationRequest | null; errors: Record<string, string> } {
  const initial = informationDraft(original), current = informationDraft(baseline);
  const changes: InformationChanges = {}, errors: Record<string, string> = {};
  for (const [field, label, maximum] of [['customerName', '客户姓名', 80], ['phone', '联系电话', 32], ['memberPhone', '会员手机', 32], ['buyerName', '下单人', 80], ['address', '地址', 2147483647]] as const) {
    const value = draft[field].trim() || null;
    if (draft[field].length > maximum) errors[field] = `${label}最多填写 ${maximum} 个字符。`;
    if (field === 'phone' && !value) errors.phone = '请填写联系电话。';
    if (value !== (initial[field] || null) && value !== (current[field] || null)) {
      if (field === 'phone') changes.phone = value || '';
      else changes[field] = value;
    }
  }
  if (!['DELIVERY', 'PICKUP'].includes(draft.fulfillmentType)) errors.fulfillmentType = '请选择配送或自提。';
  else if (draft.fulfillmentType !== initial.fulfillmentType && draft.fulfillmentType !== current.fulfillmentType) changes.fulfillmentType = draft.fulfillmentType;
  if (draft.requestedReceiveDate !== initial.requestedReceiveDate && draft.requestedReceiveDate !== current.requestedReceiveDate) {
    if (!validDate(draft.requestedReceiveDate)) errors.requestedReceiveDate = '请选择有效的收货日期。';
    else changes.requestedReceiveDate = draft.requestedReceiveDate;
  }
  for (const field of ['plannedHandoffAt', 'plannedFinishAt'] as const) {
    // 未改动的分钟输入不回写，保留服务端秒与微秒精度。
    if (draft[field] === initial[field] || draft[field] === current[field]) continue;
    if (field === 'plannedFinishAt' && !draft[field]) changes.plannedFinishAt = null;
    else {
      try { changes[field] = storeTime(draft[field]); }
      catch (error) { errors[field] = (error as Error).message; }
    }
  }
  if (draft.totalAmount !== initial.totalAmount) {
    try {
      const cents = moneyToCents(draft.totalAmount);
      if (cents !== original.totalAmountCents && cents !== baseline.totalAmountCents) changes.totalAmountCents = cents;
    } catch (error) { errors.totalAmount = (error as Error).message; }
  }
  const type = changes.fulfillmentType ?? baseline.fulfillment.type;
  const address = 'address' in changes ? changes.address : baseline.fulfillment.address;
  if (type === 'DELIVERY' && !address) errors.address = '请填写配送地址。';
  return { request: !Object.keys(errors).length && Object.keys(changes).length ? { expectedVersion: baseline.version, changes } : null, errors };
}
