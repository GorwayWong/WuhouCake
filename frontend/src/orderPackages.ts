import { itemTotals } from './itemPricing.ts';
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
export function samePackageContent(current: OrderPackage, body: PackageBody) {
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value;
  return JSON.stringify(stable({ name: current.name, items: current.items, originalAmountCents: current.originalAmountCents, memberAmountCents: current.memberAmountCents })) === JSON.stringify(stable({ name: body.name, items: body.items, originalAmountCents: body.originalAmountCents, memberAmountCents: body.memberAmountCents }));
}
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
export function packageRequest(name: string, rows: PackageRow[], _original = '', _member = '') {
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
  try { const totals = itemTotals(items); originalAmountCents = totals.original; memberAmountCents = totals.member; }
  catch (error) { errors.original = (error as Error).message; }
  return { errors, body: Object.keys(errors).length ? null : { name: name.trim(), items, originalAmountCents, memberAmountCents } satisfies PackageBody };
}
export function packageReferenceTotals(rows: PackageRow[]) {
  try { return { ...itemTotals(rows.map(row => ({ quantity: quantity(row.quantity), unitPriceCents: moneyToCents(row.unitPrice), memberPriceCents: moneyToCents(row.memberPrice) }))), invalid: false }; }
  catch { return { original: null, member: null, total: null, unpriced: 0, invalid: true }; }
}
export function packagePricingProblem(value: OrderPackage): string | null {
  try {
    const totals = itemTotals(value.items);
    if (totals.total === null || totals.original !== value.originalAmountCents || totals.member !== value.memberAmountCents)
      return '套餐商品报价缺失或整套售价与明细不一致，请先在套餐管理核对报价并保存。';
    return null;
  } catch { return '套餐报价或数量无效，请先在套餐管理核对并保存。'; }
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
  const automatic = draft.pricingMode === 'ITEM_SUM';
  const problem = automatic ? packagePricingProblem(value) : null;
  if (problem) throw new Error(problem);
  const before = automatic ? itemTotals((hasItems(draft) ? draft.items : []).map(item => ({ quantity: quantity(item.quantity), unitPriceCents: moneyToCents(item.unitPrice), memberPriceCents: moneyToCents(item.memberPrice) }))) : null;
  const occupied = hasItems(draft) || Boolean(draft.totalAmount.trim() || draft.memberAmount?.trim());
  const beforeOriginal = automatic ? before!.original : occupied ? moneyToCents(draft.totalAmount.trim() || missingOrder) : null;
  const beforeMember = automatic ? before!.member : occupied ? moneyToCents(draft.memberAmount || '') : null;
  const packageOriginal = value.originalAmountCents ?? moneyToCents(missingPackage);
  if (!automatic && occupied && beforeOriginal === null) throw new Error('请补填当前订单原价。');
  if (!automatic && packageOriginal === null) throw new Error('请补填此套餐原价。');
  let original: number | null = addCents(beforeOriginal ?? 0, packageOriginal ?? 0);
  let member: number | null = beforeMember === null && value.memberAmountCents === null ? null
    : addCents(beforeMember ?? beforeOriginal ?? 0, value.memberAmountCents ?? packageOriginal ?? 0);
  let resetPayment = Boolean(draft.paymentMethod && draft.paymentMethod !== 'UNPAID' &&
    effectiveOrderAmount(moneyToCents(draft.totalAmount), beforeMember) !== effectiveOrderAmount(original, member));
  const items = hasItems(draft) ? [...draft.items] : [];
  const imageSources = new Map<string, PackageItem>();
  const changes = value.items.map(source => {
    const requirements = String(source.attributes.specification ?? '').trim(), name = source.name.trim();
    const index = items.findIndex(item => normalizeProductType(item.productType) === 'OTHER' &&
      item.name.trim() === name && !item.attributes.specification.trim() && item.attributes.requirements.trim() === requirements &&
      moneyToCents(item.unitPrice) === (source.unitPriceCents ?? null) && moneyToCents(item.memberPrice) === (source.memberPriceCents ?? null) &&
      !Object.entries(item.attributes).some(([key, text]) => key !== 'requirements' && key !== 'specification' && text) &&
      !Object.entries(item.preservedAttributes || {}).some(([key, content]) => key !== 'requirements' && key !== 'specification' && content != null && content !== ''));
    const existing = items[index];
    const previousQuantity = existing ? quantity(existing.quantity) : 0;
    const count = previousQuantity + source.quantity;
    if (count > 2147483647) throw new Error(`「${name}」合并后的数量超过上限。`);
    const item: ItemDraft = existing ? { ...existing, quantity: String(count) } : asOtherDraft(newItem());
    if (!existing) Object.assign(item, { name, quantity: String(count), attributes: { ...item.attributes, requirements } });
    item.unitPrice ||= quoteText(source.unitPriceCents);
    item.memberPrice ||= quoteText(source.memberPriceCents);
    const keepImage = Boolean(item.images?.length || imageSources.has(item.key));
    if (!keepImage && source.imageId) imageSources.set(item.key, source);
    if (existing) items[index] = item; else items.push(item);
    return { name, requirements, index: existing ? index : items.length - 1, previousQuantity, count,
      image: keepImage ? '保留已有图片' : source.imageId ? '带入套餐图片' : '无图片' };
  });
  if (automatic) {
    const totals = itemTotals(items.map(item => ({ quantity: quantity(item.quantity), unitPriceCents: moneyToCents(item.unitPrice), memberPriceCents: moneyToCents(item.memberPrice) })));
    original = totals.original; member = totals.member;
    resetPayment = Boolean(draft.paymentMethod && draft.paymentMethod !== 'UNPAID' && before!.total !== totals.total);
  }
  return { beforeOriginal, beforeMember, original, member, changes, imageSources, resetPayment,
    next: { ...draft, ...(resetPayment ? { paymentMethod: 'UNPAID' } : {}), items, totalAmount: original === null ? '' : exactYuan(original), memberAmount: member === null ? '' : exactYuan(member) } };
}
