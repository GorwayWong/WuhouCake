import { fieldsForProduct, itemInput, newItem } from './orderForm.ts';
import { normalizeProductType } from './productTypes.ts';
import type { ItemDraft } from './orderForm.ts';

export interface OrderPackage {
  id: string; name: string; version: number; updatedAt: string;
  items: { name: string; productType: string; quantity: number; attributes: Record<string, unknown> }[];
}
export function packageItems(items: ItemDraft[]): OrderPackage['items'] {
  return items.map((draft, index) => {
    const result = itemInput({ ...draft, unitPrice: '', memberPrice: '', requiresTypeConfirmation: true });
    if (!result.item) throw new Error(`商品 ${index + 1}：${Object.values(result.errors)[0]}`);
    const { name, productType, quantity } = result.item;
    const attributes = { ...Object.fromEntries(Object.entries(draft.preservedAttributes || {}).filter(([key]) => !fieldsForProduct(draft.productType).some(([visible]) => visible === key))), ...Object.fromEntries(fieldsForProduct(draft.productType).flatMap(([key]) => {
      const text = draft.attributes[key].trim();
      return text ? [[key, key === 'size' ? result.item!.attributes.size : text]] : [];
    })) };
    return { name, productType: productType!, quantity, attributes };
  });
}
export function newPackageItem(): ItemDraft {
  const draft = newItem();
  return { ...draft, defaultSpecifications: [], attributes: Object.fromEntries(Object.keys(draft.attributes).map(key => [key, ''])) as ItemDraft['attributes'] };
}
export function packageDraft(value: Pick<OrderPackage, 'items'>): ItemDraft[] {
  return value.items.map(item => {
    const draft = newPackageItem();
    return { ...draft, name: item.name, productType: normalizeProductType(item.productType), preservedAttributes: item.attributes, quantity: String(item.quantity),
      attributes: Object.fromEntries(Object.keys(draft.attributes).map(key => [key, typeof item.attributes[key] === 'string' ? item.attributes[key] : ''])) as ItemDraft['attributes'] };
  });
}
export function packageRequest(name: string, items: ItemDraft[]) {
  const errors: Record<string, string> = {};
  if (!name.trim()) errors.name = '请填写套餐名称。';
  else if (name.trim().length > 80) errors.name = '套餐名称最多填写 80 个字符。';
  if (!items.length) errors.items = '套餐至少需要一项商品。';
  items.forEach((item, index) => {
    const result = itemInput({ ...item, unitPrice: '', memberPrice: '', requiresTypeConfirmation: true });
    for (const [field, error] of Object.entries(result.errors)) errors[`items.${index}.${field}`] = error;
  });
  return { errors, body: Object.keys(errors).length ? null : { name: name.trim(), items: packageItems(items) } };
}
export function packageSummary(value: Pick<OrderPackage, 'items'>): string {
  return value.items.map(item => `${item.name} × ${item.quantity}`).join('、');
}
export function appendPackage(current: ItemDraft[], value: Pick<OrderPackage, 'items'>): ItemDraft[] {
  const incoming = packageDraft(value);
  const empty = current.length === 1 && current[0].productType === 'CAKE' && !current[0].requiresTypeConfirmation && !current[0].name.trim() && current[0].quantity === '1'
    && !current[0].unitPrice && !current[0].memberPrice
    && Object.entries(current[0].attributes).every(([key, text]) => !text || current[0].defaultSpecifications?.includes(key as 'base' | 'filling'));
  return [...(empty ? [] : current), ...incoming];
}
