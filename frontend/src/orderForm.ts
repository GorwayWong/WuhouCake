import { exactYuan } from './money.ts';
import { paymentMethods, effectiveOrderAmount } from './orderPayment.ts';
import { productionStatuses } from './orderStates.ts';
import { pickupInstant, pickupDate, defaultFinishTime } from './orderTimes.ts';
import type { FinishTimeMode } from './orderTimes.ts';
import type { CreateOrderRequest, Detail, InformationChanges, InformationRequest, Item, ItemChangeRequest, ItemInput } from './types';
import { cakeDefaults, numericSize } from './productRules.ts';
import type { CakeDefaultField } from './productRules.ts';
import { orderingMethodError } from './orderingMethod.ts';
import type { DraftImage } from './draftImages.ts';
import { randomUUID } from './uuid.ts';
import { isCake, normalizeProductType, productTypes } from './productTypes.ts';

export const specificationFields = [
  ['size', '尺寸'], ['flavor', '奶油'], ['filling', '夹馅'],
  ['base', '内胚'], ['message', '祝福语'], ['requirements', '特殊要求'], ['specification', '规格'],
] as const;
export function fieldsForProduct(type: string) {
  return isCake(type) ? specificationFields : specificationFields.filter(([key]) => key === 'specification');
}
type Specification = typeof specificationFields[number][0];
export interface ItemDraft {
  key: string; name: string; productType: string; quantity: string;
  unitPrice: string; memberPrice: string; attributes: Record<Specification, string>;
  defaultSpecifications?: CakeDefaultField[];
  requiresTypeConfirmation?: boolean;
  preservedAttributes?: Record<string, unknown>;
  images?: DraftImage[];
}
export interface OrderDraft {
  orderingMethod?: string;
  orderingMethodCustom?: boolean;
  creditedEmployeeId?: string;
  customerName: string; phone: string; memberPhone: string; buyerName: string;
  fulfillmentType: 'DELIVERY' | 'PICKUP'; address: string; requestedReceiveDate: string; requestedReceiveAt: string;
  plannedHandoffAt: string; plannedFinishAt: string; finishTimeMode?: FinishTimeMode; totalAmount: string; memberAmount?: string; paymentMethod?: string; items: ItemDraft[];
}
export function newItem(): ItemDraft {
  return { key: randomUUID(), name: '', productType: 'CAKE', quantity: '1', unitPrice: '', memberPrice: '',
    attributes: { size: '', flavor: '', filling: cakeDefaults.filling, base: cakeDefaults.base, message: '', requirements: '', specification: '' },
    defaultSpecifications: ['base', 'filling'] };
}
const legacyLabels: Record<string, string> = { ...Object.fromEntries(specificationFields),
  cakeBase: '内胚', greeting: '祝福语', otherRequirements: '特殊要求' };
function otherAttributes(attributes: Record<string, unknown>): string {
  const display = (value: unknown) => typeof value === 'string' ? value.trim() : value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  const spec = display(attributes.specification);
  const lines = Object.keys(attributes).sort().flatMap(key => {
    const value = display(attributes[key]);
    return key !== 'specification' && value ? [`${legacyLabels[key] || key}：${value}`] : [];
  });
  return [...new Set([spec, ...lines].filter(Boolean))].join('\n');
}
export function asOtherDraft(draft: ItemDraft): ItemDraft {
  const values: Record<string, unknown> = { ...draft.preservedAttributes, ...draft.attributes };
  // Preserve structured attributes that the old text fields could not edit.
  for (const [key, value] of Object.entries(draft.preservedAttributes || {}))
    if (!textSpecification(value) && !values[key]) values[key] = value;
  for (const key of draft.defaultSpecifications || [])
    if (values[key] === cakeDefaults[key]) delete values[key];
  const specification = otherAttributes(values);
  return { ...draft, productType: 'OTHER', unitPrice: '', memberPrice: '', defaultSpecifications: [], preservedAttributes: undefined,
    attributes: { size: '', flavor: '', filling: '', base: '', message: '', requirements: '', specification } };
}
export function migrateItemDraft(draft: ItemDraft): ItemDraft {
  const type = normalizeProductType(draft.productType);
  const next = type === 'OTHER' ? asOtherDraft(draft) : { ...draft, productType: type, unitPrice: '', memberPrice: '' };
  const legacyPrices = [['原商品单价', draft.unitPrice], ['原会员单价', draft.memberPrice]].flatMap(([label, value]) =>
    value.trim() ? [`${label}：${value.trim()} 元（仅供参考）`] : []);
  if (legacyPrices.length) next.attributes = { ...next.attributes, specification: [next.attributes.specification, ...legacyPrices].filter(Boolean).join('\n') };
  return next;
}
export function changeItemDraft(draft: ItemDraft, changes: Partial<ItemDraft>, editedSpecification?: string): ItemDraft {
  const next = { ...draft, ...changes, attributes: { ...(changes.attributes || draft.attributes) },
    defaultSpecifications: [...(draft.defaultSpecifications || [])] };
  next.unitPrice = ''; next.memberPrice = '';
  if (changes.productType !== undefined && draft.requiresTypeConfirmation && changes.productType.trim()) next.requiresTypeConfirmation = false;
  if (editedSpecification) next.defaultSpecifications = next.defaultSpecifications.filter(key => key !== editedSpecification);
  if (changes.productType !== undefined && normalizeProductType(changes.productType) === 'OTHER') {
    return asOtherDraft(next);
  } else if (changes.productType !== undefined && isCake(changes.productType)) {
    for (const key of ['base', 'filling'] as const) if (!next.attributes[key]) {
      next.attributes[key] = cakeDefaults[key]; next.defaultSpecifications.push(key);
    }
  }
  return next;
}
export function newDraft(date: string): OrderDraft {
  return { orderingMethod: '', customerName: '', phone: '', memberPhone: '', buyerName: '', fulfillmentType: 'DELIVERY', address: '',
    requestedReceiveDate: date, requestedReceiveAt: date, plannedHandoffAt: '', plannedFinishAt: '', finishTimeMode: 'AUTO', totalAmount: '', memberAmount: '', paymentMethod: 'UNPAID', items: [newItem()] };
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
export function itemInput(draft: ItemDraft, validateSize = true): { item: ItemInput | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (!draft.name.trim()) errors.name = '请填写商品名称。';
  else if (draft.name.length > 128) errors.name = '商品名称最多填写 128 个字符。';
  if (draft.productType.length > 32) errors.productType = '商品类型最多填写 32 个字符。';
  else if (!draft.productType.trim() || !Object.hasOwn(productTypes, normalizeProductType(draft.productType)) && draft.requiresTypeConfirmation) errors.productType = '请选择商品类型。';
  const quantity = Number(draft.quantity);
  if (!/^\d+$/.test(draft.quantity) || !Number.isInteger(quantity) || quantity < 1 || quantity > 2147483647) errors.quantity = '数量须为 1–2147483647 之间的整数。';
  const type = normalizeProductType(draft.productType);
  const effective = type === 'OTHER' ? asOtherDraft(draft) : draft;
  const item: ItemInput = { name: draft.name.trim(), productType: type, quantity,
    unitPriceCents: null, memberPriceCents: null,
    attributes: { ...Object.fromEntries(Object.entries(effective.preservedAttributes || {}).filter(([key]) => !fieldsForProduct(type).some(([visible]) => visible === key) || !textSpecification(effective.preservedAttributes?.[key]))),
      ...Object.fromEntries(fieldsForProduct(type || 'CAKE').flatMap(([key]) => (effective.attributes[key] || '').trim() ? [[key, effective.attributes[key].trim()]] : [])) } };
  if (item.productType?.toUpperCase() === 'CAKE') {
    for (const [key, value] of Object.entries(cakeDefaults)) item.attributes[key] ||= value;
    if (validateSize && draft.attributes.size.trim()) { try { item.attributes.size = numericSize(draft.attributes.size); } catch (error) { errors.size = (error as Error).message; } }
  }
  return { item: Object.keys(errors).length ? null : item, errors };
}
export function textSpecification(value: unknown): boolean { return value == null || typeof value === 'string'; }
export function itemDraft(item: Item): ItemDraft {
  return { key: item.itemId, name: item.name, productType: normalizeProductType(item.productType || ''), quantity: String(item.quantity),
    unitPrice: '', memberPrice: '', preservedAttributes: item.attributes,
    attributes: Object.fromEntries(specificationFields.map(([key]) => [key, typeof item.attributes[key] === 'string' ? item.attributes[key] : ''])) as ItemDraft['attributes'] };
}
export function canEditItems(order: Pick<Detail, 'status' | 'deletion' | 'deleted'>): boolean { return !order.deletion && !order.deleted && productionStatuses.includes(order.status); }
export function migrateOrderDraft(draft: OrderDraft): OrderDraft { return { ...draft, items: draft.items.map(migrateItemDraft) }; }
export function canRemoveItem(order: Detail, itemId: string): boolean { return canEditItems(order) && order.items.length > 1 && order.items.some(item => item.itemId === itemId); }
export function itemChangeRequest(original: Detail, itemId: string, draft: ItemDraft, baseline = original): { request: ItemChangeRequest | null; errors: Record<string, string> } {
  const before = original.items.find(item => item.itemId === itemId), current = baseline.items.find(item => item.itemId === itemId);
  if (!before || !current) return { request: null, errors: { item: '此商品已被移除，输入已保留，请取消编辑并核对订单。' } };
  const initial = itemDraft(before);
  const result = itemInput(draft, draft.attributes.size !== initial.attributes.size || draft.productType !== initial.productType);
  if (!result.item) return { request: null, errors: result.errors };
  const changes: Partial<ItemInput> = {};
  for (const field of ['name', 'productType', 'quantity'] as const) {
    if (draft[field] !== initial[field] && result.item[field] !== before[field] && result.item[field] !== current[field]) Object.assign(changes, { [field]: result.item[field] });
  }
  const attributes: Record<string, unknown> = {};
  if (result.item.productType === 'OTHER' && !isCake(draft.productType) && isCake(initial.productType)) {
    for (const key of Object.keys(current.attributes)) if (key !== 'specification') attributes[key] = null;
    attributes.specification = result.item.attributes.specification ?? null;
  } else for (const [key] of specificationFields) {
    if (!fieldsForProduct(draft.productType).some(([visible]) => visible === key) ||
      !textSpecification(before.attributes[key]) || !textSpecification(current.attributes[key]) || draft.attributes[key] === initial.attributes[key]) continue;
    const value = draft.attributes[key].trim() || null;
    if (value !== (before.attributes[key] ?? null) && value !== (current.attributes[key] ?? null)) attributes[key] = value;
  }
  if (Object.keys(attributes).length) changes.attributes = attributes;
  return { request: Object.keys(changes).length ? { expectedVersion: baseline.version, itemId, changes } : null, errors: {} };
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
export function receiptInstant(value: string, date: string): string | null {
  if (!validDate(date)) throw new Error('请选择取货日期。');
  if (!value || value === date) return null;
  if (value.slice(0, 10) !== date) throw new Error('取货日期与时刻不一致。');
  return storeTime(value);
}
export function createOrderRequest(draft: OrderDraft): { request: CreateOrderRequest | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const methodError = orderingMethodError(draft);
  if (methodError) errors.orderingMethod = methodError;
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
  let receiveAt: string | null = null;
  try { receiveAt = receiptInstant(draft.requestedReceiveAt, draft.requestedReceiveDate); }
  catch (error) { errors.requestedReceiveAt = (error as Error).message; }
  if (!validDate(draft.requestedReceiveDate)) errors.requestedReceiveDate = '请选择有效的取货日期。';
  if (!draft.items.length) errors.items = '订单至少需要一件商品。';
  const original = amount(draft.totalAmount, 'totalAmount');
  const member = amount(draft.memberAmount || '', 'memberAmount');
  const method = draft.paymentMethod || 'UNPAID';
  if (!Object.hasOwn(paymentMethods, method)) errors.paymentMethod = '请选择有效的支付方式。';
  const request: CreateOrderRequest = {
    orderingMethod: text((draft.orderingMethod || '').trim(), 'orderingMethod', '下单方式', 80),
    customer: {
      customerName: text(draft.customerName, 'customerName', '客户姓名', 80),
      phone: text(draft.phone, 'phone', '联系电话', 32, true) || '',
      memberPhone: text(draft.memberPhone, 'memberPhone', '会员手机', 32),
      buyerName: text(draft.buyerName, 'buyerName', '订购人姓名', 80),
    },
    fulfillment: {
      type: draft.address.trim() === '自提' ? 'PICKUP' : 'DELIVERY',
      address: text(draft.address, 'address', '地址', Number.MAX_SAFE_INTEGER, true),
      requestedReceiveDate: draft.requestedReceiveDate,
      requestedReceiveAt: receiveAt,
      plannedHandoffAt: receiveAt,
      plannedFinishAt: dateTime(draft.plannedFinishAt || (draft.finishTimeMode === 'AUTO' ? defaultFinishTime(draft.requestedReceiveAt) : ''), 'plannedFinishAt'),
    },
    items: draft.items.map((item, index) => {
      const result = itemInput(item);
      for (const [field, error] of Object.entries(result.errors)) errors[`items.${index}.${field}`] = error;
      return result.item ? { ...result.item, itemId: item.key } : result.item!;
    }),
    originalAmountCents: original, memberAmountCents: member, paymentMethod: method,
    totalAmountCents: effectiveOrderAmount(original, member),
  };
  return { request: Object.keys(errors).length ? null : request, errors };
}

export type InformationDraft = Omit<OrderDraft, 'items'> & { requestedReceiveAt: string };
function localStoreTime(value: string | null): string {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const part = (type: string) => parts.find(part => part.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}
export function informationDraft(order: Detail): InformationDraft {
  const original = order.originalAmountCents ?? (order.memberAmountCents == null ? order.totalAmountCents : null);
  const cents = original == null ? null : BigInt(original);
  return { orderingMethod: order.orderingMethod || '', customerName: order.customer?.customerName || '', phone: order.customer?.phone || '', memberPhone: order.customer?.memberPhone || '', buyerName: order.customer?.buyerName || '',
    fulfillmentType: order.fulfillment.type as InformationDraft['fulfillmentType'], address: order.fulfillment.address || '', requestedReceiveDate: pickupDate(order.fulfillment),
    requestedReceiveAt: localStoreTime(pickupInstant(order.fulfillment)) || pickupDate(order.fulfillment),
    plannedHandoffAt: localStoreTime(order.fulfillment.plannedHandoffAt), plannedFinishAt: localStoreTime(order.fulfillment.plannedFinishAt), finishTimeMode: order.fulfillment.plannedFinishAt ? 'MANUAL' : 'AUTO',
    memberAmount: order.memberAmountCents === undefined ? undefined : order.memberAmountCents === null ? '' : exactYuan(order.memberAmountCents),
    totalAmount: cents == null ? '' : `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`, creditedEmployeeId: order.creditedEmployee?.accountId || '' };
}
export function informationRequest(original: Detail, draft: InformationDraft, baseline = original): { request: InformationRequest | null; errors: Record<string, string> } {
  const initial = informationDraft(original), current = informationDraft(baseline);
  const changes: InformationChanges = {}, errors: Record<string, string> = {};
  const methodError = orderingMethodError(draft);
  if (methodError) errors.orderingMethod = methodError;
  if (draft.creditedEmployeeId !== initial.creditedEmployeeId && draft.creditedEmployeeId !== current.creditedEmployeeId) {
    if (!draft.creditedEmployeeId || !/^[a-f\d-]{36}$/i.test(draft.creditedEmployeeId)) errors.creditedEmployeeId = '请选择下单员工。';
    else changes.creditedEmployeeId = draft.creditedEmployeeId;
  }
  for (const [field, label, maximum] of [['orderingMethod', '下单方式', 80], ['customerName', '客户姓名', 80], ['phone', '联系电话', 32], ['memberPhone', '会员手机', 32], ['buyerName', '订购人姓名', 80], ['address', '地址', 2147483647]] as const) {
    const value = (draft[field] || '').trim() || null;
    if ((field === 'orderingMethod' ? (draft[field] || '').trim() : draft[field] || '').length > maximum) errors[field] = `${label}最多填写 ${maximum} 个字符。`;
    if (field === 'phone' && !value) errors.phone = '请填写联系电话。';
    if (value !== (initial[field] || null) && value !== (current[field] || null)) {
      if (field === 'phone') changes.phone = value || '';
      else changes[field] = value;
    }
  }
  if (!['DELIVERY', 'PICKUP'].includes(draft.fulfillmentType)) errors.fulfillmentType = '请选择配送或自提。';
  else if (draft.fulfillmentType !== initial.fulfillmentType && draft.fulfillmentType !== current.fulfillmentType) changes.fulfillmentType = draft.fulfillmentType;
  const receiveDateChanged = draft.requestedReceiveDate !== initial.requestedReceiveDate && draft.requestedReceiveDate !== current.requestedReceiveDate;
  const receiveTimeChanged = draft.requestedReceiveAt !== initial.requestedReceiveAt && draft.requestedReceiveAt !== current.requestedReceiveAt;
  if (receiveTimeChanged || receiveDateChanged) {
    try {
      changes.requestedReceiveAt = receiptInstant(draft.requestedReceiveAt, draft.requestedReceiveDate);
      changes.plannedHandoffAt = changes.requestedReceiveAt;
      changes.requestedReceiveDate = draft.requestedReceiveDate;
    } catch (error) { errors.requestedReceiveAt = (error as Error).message; }
  }
  for (const field of ['plannedFinishAt'] as const) {
    // 未改动的分钟输入不回写，保留服务端秒与微秒精度。
    if (draft[field] === initial[field] || draft[field] === current[field]) continue;
    if (!draft[field]) changes[field] = null;
    else {
      try { changes[field] = storeTime(draft[field]); }
      catch (error) { errors[field] = (error as Error).message; }
    }
  }
  if (draft.memberAmount !== undefined || original.memberAmountCents !== undefined) {
    for (const [field, key] of [['totalAmount', 'originalAmountCents'], ['memberAmount', 'memberAmountCents']] as const) {
      if ((draft[field] || '') === (initial[field] || '')) continue;
      try { const cents = moneyToCents(draft[field] || ''); if (cents !== moneyToCents(current[field] || '')) changes[key] = cents; }
      catch (error) { errors[field] = (error as Error).message; }
    }
  } else if (draft.totalAmount !== initial.totalAmount) {
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

export function amountInformationRequest(original: Detail, amount: string, baseline = original, memberAmount?: string): { request: InformationRequest | null; errors: Record<string, string> } {
  if (memberAmount !== undefined || original.memberAmountCents !== undefined) {
    return informationRequest(original, { ...informationDraft(original), totalAmount: amount, memberAmount: memberAmount ?? informationDraft(original).memberAmount ?? '' }, baseline);
  }
  if (amount === informationDraft(original).totalAmount) return { request: null, errors: {} };
  try {
    const cents = moneyToCents(amount);
    return { request: cents === original.totalAmountCents || cents === baseline.totalAmountCents ? null
      : { expectedVersion: baseline.version, changes: { totalAmountCents: cents } }, errors: {} };
  } catch (error) { return { request: null, errors: { totalAmount: (error as Error).message } }; }
}
