import { draftQuantity, asOtherDraft, draftQuoteCents, moneyToCents, newItem } from './orderForm.ts';
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
export function packageRequest(name: string, rows: PackageRow[], original = '', member = '') {
  const errors: Record<string, string> = {};
  if (!name.trim()) errors.name = '请填写套餐名称。';
  else if (name.trim().length > 80) errors.name = '套餐名称最多填写 80 个字符。';
  if (!rows.length) errors.items = '套餐至少需要一项商品。';
  const files = rows.flatMap(row => row.file ? [row.file] : []);
  if (files.length > 16 || files.reduce((total, file) => total + file.size, 0) > 64 * 1024 * 1024)
    errors.items = '每次最多上传 16 张图片，总文件大小不得超过 64 MiB。';
  const items = rows.map((row, index): PackageItem => {
    if (!row.name.trim()) errors[`items.${index}.name`] = '请填写商品名称。';
    else if (row.name.trim().length > 128) errors[`items.${index}.name`] = '商品名称最多填写 128 个字符。';
    let count = 0;
    try { count = draftQuantity(row.quantity); } catch (error) { errors[`items.${index}.quantity`] = (error as Error).message; }
    const price = (field: 'unitPrice' | 'memberPrice') => {
      try { return moneyToCents(row[field]); }
      catch (error) { errors[`items.${index}.${field}`] = (error as Error).message; return null; }
    };
    return { unitPriceCents: price('unitPrice'), memberPriceCents: price('memberPrice'), itemId: row.itemId, imageId: row.imageId, name: row.name.trim(), productType: 'OTHER', quantity: count,
      attributes: row.specification.trim() ? { specification: row.specification.trim() } : {} };
  });
  const price = (value: string, field: 'original' | 'member') => {
    try { return moneyToCents(value); }
    catch (error) { errors[field] = (error as Error).message; return null; }
  };
  const originalAmountCents = price(original, 'original'), memberAmountCents = price(member, 'member');
  return { errors, body: Object.keys(errors).length ? null : { name: name.trim(), items, originalAmountCents, memberAmountCents } satisfies PackageBody };
}
export function packageSummary(value: Pick<OrderPackage, 'items'>): string {
  return value.items.map(item => `${item.name} × ${item.quantity}`).join('、');
}
export function isEmptyPackageDraft(draft: OrderDraft): boolean {
  return !hasItems(draft) && !draft.totalAmount.trim() && !draft.memberAmount?.trim();
}
function hasItems(draft: OrderDraft) {
  return !(draft.items.length === 0 || draft.items.length === 1 && draft.items.every(item =>
    !item.name.trim() && !item.unitPrice && !item.memberPrice && (!item.quantity.trim() || item.quantity === '1') && !item.images?.length && !Object.keys(item.preservedAttributes || {}).length &&
    Object.entries(item.attributes).every(([key, text]) => !text || item.defaultSpecifications?.includes(key as never))));
}
function sumQuotes(first: number | null, second: number | null): number | null {
  if (first === null || second === null) return null;
  const sum = first + second;
  return Number.isSafeInteger(sum) ? sum : null;
}

export function previewPackage(draft: OrderDraft, value: OrderPackage, useSuggestedPrice = true) {
  const occupied = !isEmptyPackageDraft(draft);
  const beforeOriginal = draftQuoteCents(draft.totalAmount);
  const beforeMember = draftQuoteCents(draft.memberAmount || '');
  const { originalAmountCents: packageOriginal, memberAmountCents: packageMember } = value;
  const original = occupied ? sumQuotes(beforeOriginal, packageOriginal) : packageOriginal;
  const member = beforeMember === null && packageMember === null ? null
    : occupied ? sumQuotes(beforeMember ?? beforeOriginal, packageMember ?? packageOriginal) : packageMember;
  const resetPayment = useSuggestedPrice && Boolean(draft.paymentMethod && draft.paymentMethod !== 'UNPAID'
    && effectiveOrderAmount(beforeOriginal, beforeMember) !== effectiveOrderAmount(original, member));
  const items = hasItems(draft) ? [...draft.items] : [];
  const imageSources = new Map<string, PackageItem>();
  const changes = value.items.map(source => {
    const requirements = String(source.attributes.specification ?? '').trim(), name = source.name.trim();
    const index = items.findIndex(item => normalizeProductType(item.productType) === 'OTHER' &&
      item.name.trim() === name && !item.attributes.specification.trim() && item.attributes.requirements.trim() === requirements &&
      (item.unitPrice.trim() === '' || draftQuoteCents(item.unitPrice) !== null) &&
      (item.memberPrice.trim() === '' || draftQuoteCents(item.memberPrice) !== null) &&
      draftQuoteCents(item.unitPrice) === (source.unitPriceCents ?? null) && draftQuoteCents(item.memberPrice) === (source.memberPriceCents ?? null) &&
      !Object.entries(item.attributes).some(([key, text]) => key !== 'requirements' && key !== 'specification' && text) &&
      !Object.entries(item.preservedAttributes || {}).some(([key, content]) => key !== 'requirements' && key !== 'specification' && content != null && content !== ''));
    const existing = items[index];
    const previousQuantity = existing ? draftQuantity(existing.quantity) : 0;
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
  return { beforeOriginal, beforeMember, original, member, changes, imageSources, resetPayment,
    next: { ...draft, ...(resetPayment ? { paymentMethod: 'UNPAID' } : {}), items,
      ...(useSuggestedPrice ? { totalAmount: quoteText(original), memberAmount: quoteText(member) } : {}) } };
}
