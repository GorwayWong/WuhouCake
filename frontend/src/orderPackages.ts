import { asOtherDraft, moneyToCents, newItem } from './orderForm.ts';
import type { ItemDraft, OrderDraft } from './orderForm.ts';
import { effectiveOrderAmount } from './orderPayment.ts';
import { exactYuan } from './money.ts';
import { normalizeProductType } from './productTypes.ts';
import { randomUUID } from './uuid.ts';

export interface PackageItem {
  itemId: string; imageId: string | null; name: string; productType: string;
  quantity: number; unitPriceCents?: number | null; memberPriceCents?: number | null; attributes: Record<string, unknown>;
}
export interface OrderPackage {
  id: string; name: string; version: number; updatedAt: string;
  originalAmountCents: number | null; memberAmountCents: number | null; items: PackageItem[];
}
export interface PackageRow {
  itemId: string; imageId: string | null; file?: File; name: string; specification: string; quantity: string; unitPrice: string; memberPrice: string;
}
export type PackageBody = Pick<OrderPackage, 'name' | 'items' | 'originalAmountCents' | 'memberAmountCents'> & { expectedVersion?: number };
export const packageImagePath = (id: string, item: Pick<PackageItem, 'itemId' | 'imageId'>) =>
  `/order-packages/${id}/items/${item.itemId}/images/${item.imageId}`;

export function newPackageItem(): PackageRow {
  return { itemId: randomUUID(), imageId: null, name: '', specification: '', quantity: '1', unitPrice: '', memberPrice: '' };
}
export function packageDraft(value: Pick<OrderPackage, 'items'>): PackageRow[] {
  return value.items.map(item => ({ itemId: item.itemId, imageId: item.imageId, name: item.name,
    unitPrice: quoteText(item.unitPriceCents), memberPrice: quoteText(item.memberPriceCents),
    specification: typeof item.attributes.specification === 'string' ? item.attributes.specification : '', quantity: String(item.quantity) }));
}
const quoteText = (cents?: number | null) => cents == null ? '' : exactYuan(cents);
function quantity(value: string): number {
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 2147483647) throw new Error('数量须为 1–2147483647 之间的整数。');
  return Number(value);
}
export function packageRequest(name: string, rows: PackageRow[], original = '', member = '') {
  const errors: Record<string, string> = {};
  if (!name.trim()) errors.name = '请填写套餐名称。';
  else if (name.trim().length > 80) errors.name = '套餐名称最多填写 80 个字符。';
  if (!rows.length) errors.items = '套餐至少需要一项商品。';
  const items = rows.map((row, index): PackageItem => {
    if (!row.name.trim()) errors[`items.${index}.name`] = '请填写商品名称。';
    else if (row.name.trim().length > 128) errors[`items.${index}.name`] = '商品名称最多填写 128 个字符。';
    let count = 0;
    try { count = quantity(row.quantity); } catch (error) { errors[`items.${index}.quantity`] = (error as Error).message; }
    const price = (field: 'unitPrice' | 'memberPrice') => {
      try { return moneyToCents(row[field]); }
      catch (error) { errors[`items.${index}.${field}`] = (error as Error).message; return null; }
    };
    return { unitPriceCents: price('unitPrice'), memberPriceCents: price('memberPrice'), itemId: row.itemId, imageId: row.imageId, name: row.name.trim(), productType: 'OTHER', quantity: count,
      attributes: row.specification.trim() ? { specification: row.specification.trim() } : {} };
  });
  let originalAmountCents: number | null = null, memberAmountCents: number | null = null;
  try { originalAmountCents = moneyToCents(original); if (originalAmountCents === null) errors.original = '请填写套餐原价。'; }
  catch (error) { errors.original = (error as Error).message; }
  try { memberAmountCents = moneyToCents(member); } catch (error) { errors.member = (error as Error).message; }
  return { errors, body: Object.keys(errors).length ? null : { name: name.trim(), items, originalAmountCents, memberAmountCents } satisfies PackageBody };
}
export function packageReferenceTotals(rows: PackageRow[]) {
  let original: bigint | null = null, member: bigint | null = null, unpriced = 0;
  for (const row of rows) {
    if (!row.unitPrice.trim() && !row.memberPrice.trim()) { unpriced++; continue; }
    try {
      const count = BigInt(quantity(row.quantity));
      const regular = moneyToCents(row.unitPrice), preferred = moneyToCents(row.memberPrice) ?? regular;
      if (regular !== null) original = (original ?? 0n) + BigInt(regular) * count;
      if (preferred !== null) member = (member ?? 0n) + BigInt(preferred) * count;
    } catch { return { original: null, member: null, unpriced, invalid: true }; }
  }
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  const invalid = (original ?? 0n) > max || (member ?? 0n) > max;
  return { original: invalid || original === null ? null : Number(original),
    member: invalid || member === null ? null : Number(member), unpriced, invalid };
}
export function packageSummary(value: Pick<OrderPackage, 'items'>): string {
  return value.items.map(item => `${item.name} × ${item.quantity}`).join('、');
}
export function isEmptyPackageDraft(draft: OrderDraft): boolean {
  return !hasItems(draft) && !draft.totalAmount.trim() && !draft.memberAmount?.trim();
}
function hasItems(draft: OrderDraft) {
  return !(draft.items.length === 0 || draft.items.length === 1 && draft.items.every(item =>
    !item.name.trim() && !item.unitPrice && !item.memberPrice && item.quantity === '1' && !item.images?.length && !Object.keys(item.preservedAttributes || {}).length &&
    Object.entries(item.attributes).every(([key, text]) => !text || item.defaultSpecifications?.includes(key as never))));
}
function addCents(a: number, b: number) {
  const value = a + b;
  if (!Number.isSafeInteger(value)) throw new Error('累计金额过大，请核对后重试。');
  return value;
}
export function previewPackage(draft: OrderDraft, value: OrderPackage, missingOrder = '', missingPackage = '') {
  const occupied = hasItems(draft) || Boolean(draft.totalAmount.trim() || draft.memberAmount?.trim());
  const beforeOriginal = occupied ? moneyToCents(draft.totalAmount.trim() || missingOrder) : null;
  const beforeMember = occupied ? moneyToCents(draft.memberAmount || '') : null;
  const packageOriginal = value.originalAmountCents ?? moneyToCents(missingPackage);
  if (occupied && beforeOriginal === null) throw new Error('请补填当前订单原价。');
  if (packageOriginal === null) throw new Error('请补填此套餐原价。');
  const original = addCents(beforeOriginal ?? 0, packageOriginal);
  const member = beforeMember === null && value.memberAmountCents === null ? null
    : addCents(beforeMember ?? beforeOriginal ?? 0, value.memberAmountCents ?? packageOriginal);
  const resetPayment = Boolean(draft.paymentMethod && draft.paymentMethod !== 'UNPAID' &&
    effectiveOrderAmount(moneyToCents(draft.totalAmount), beforeMember) !== effectiveOrderAmount(original, member));
  const items = hasItems(draft) ? [...draft.items] : [];
  const imageSources = new Map<string, PackageItem>();
  const changes = value.items.map(source => {
    const spec = String(source.attributes.specification ?? '').trim(), name = source.name.trim();
    const index = items.findIndex(item => normalizeProductType(item.productType) === 'OTHER' &&
      item.name.trim() === name && item.attributes.specification.trim() === spec);
    const existing = items[index];
    const previousQuantity = existing ? quantity(existing.quantity) : 0;
    const count = previousQuantity + source.quantity;
    if (count > 2147483647) throw new Error(`「${name}」合并后的数量超过上限。`);
    const item: ItemDraft = existing ? { ...existing, quantity: String(count) } : asOtherDraft(newItem());
    if (!existing) Object.assign(item, { name, quantity: String(count), attributes: { ...item.attributes, specification: spec } });
    item.unitPrice ||= quoteText(source.unitPriceCents);
    item.memberPrice ||= quoteText(source.memberPriceCents);
    const keepImage = Boolean(item.images?.length || imageSources.has(item.key));
    if (!keepImage && source.imageId) imageSources.set(item.key, source);
    if (existing) items[index] = item; else items.push(item);
    return { name, specification: spec, index: existing ? index : items.length - 1, previousQuantity, count,
      image: keepImage ? '保留已有图片' : source.imageId ? '带入套餐图片' : '无图片' };
  });
  return { beforeOriginal, beforeMember, original, member, changes, imageSources, resetPayment,
    next: { ...draft, ...(resetPayment ? { paymentMethod: 'UNPAID' } : {}), items, totalAmount: exactYuan(original), memberAmount: member === null ? '' : exactYuan(member) } };
}
