import { isCake } from './productTypes.ts';
import type { ItemDraft } from './orderForm.ts';

export type ProductFormField = 'name' | 'quantity' | 'unitPrice' | 'memberPrice' | keyof ItemDraft['attributes'];
export const productFormLabels: Record<ProductFormField, string> = {
  name: '商品名称', quantity: '数量', size: '尺寸（寸）', base: '蛋糕胚', filling: '夹馅', flavor: '奶油',
  message: '祝福语', requirements: '特殊要求', specification: '商品说明', unitPrice: '原单价（元）', memberPrice: '会员单价（元）',
};
export function productFormRows(type: string, prices = false): ProductFormField[][] {
  if (isCake(type)) return [['name'], ['size', 'quantity'], ...(prices ? [['unitPrice', 'memberPrice'] as ProductFormField[]] : []), ['base', 'flavor'], ['filling'], ['message'], ['requirements'], ['specification']];
  return [['name'], ['quantity'], ...(prices ? [['unitPrice', 'memberPrice'] as ProductFormField[]] : []), ['specification'], ['requirements']];
}
export function firstItemFormError(errors: Record<string, unknown>, type: string, prices = false): string | undefined {
  return ['productType', ...productFormRows(type, prices).flat()].find(field => Object.hasOwn(errors, field)) || Object.keys(errors)[0];
}
export function firstProductFormError(errors: Record<string, unknown>, items: Pick<ItemDraft, 'productType'>[]): string | undefined {
  const first = Object.keys(errors)[0];
  if (!first || !/^items\.\d+\./.test(first)) return first;
  for (const [index, item] of items.entries()) {
    const prefix = `items.${index}.`, local = Object.fromEntries(Object.entries(errors).filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key.slice(prefix.length), value]));
    const field = firstItemFormError(local, item.productType, true);
    if (field) return prefix + field;
  }
  return Object.keys(errors)[0];
}
