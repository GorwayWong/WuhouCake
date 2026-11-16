export const paymentMethods: Readonly<Record<string, string>> = {
  UNIONPAY: '银联', MEMBER_CARD: '扣卡', BANK_TRANSFER: '对公转账', SERVICE_WECHAT: '客服微信', CASH: '现金', UNPAID: '未付',
};
export function effectiveOrderAmount(original: number | null, member: number | null): number | null { return member ?? original; }
export function paymentMethodLabel(method: string | null | undefined, status: string | null): string {
  return method ? paymentMethods[method] || method : status === 'PAID' ? '已付款（方式未记录）' : '未付';
}
