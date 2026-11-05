export const orderingMethods = ['下单人', '小程序', '到店', '客服号'] as const;
export interface OrderingMethodDraft { orderingMethod?: string; orderingMethodCustom?: boolean }
export function customOrderingMethod(draft: OrderingMethodDraft): boolean {
  return Boolean(draft.orderingMethodCustom || draft.orderingMethod?.trim() && !orderingMethods.some(method => method === draft.orderingMethod?.trim()));
}
export function orderingMethodError(draft: OrderingMethodDraft): string | undefined {
  const value = draft.orderingMethod?.trim() || '';
  if (customOrderingMethod(draft) && !value) return '请填写具体下单方式。';
  if (value.length > 80) return '下单方式最多填写 80 个字符。';
}
