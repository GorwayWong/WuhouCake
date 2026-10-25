import { calendarHref, defaultCalendarView, readCalendarView } from './calendarView.ts';
export const paymentKinds = { RECEIPT: '当日付款订单', SHIPPING_PAID: '当天出货已付款订单', SHIPPING_UNPAID: '当天出货未付款订单' } as const;
export type PaymentKind = keyof typeof paymentKinds;
export interface PaymentListRoute { date: string; kind: PaymentKind; page: number; from: string }
export function readPaymentList(hash: string): PaymentListRoute | null {
  const [path, search] = hash.split('?');
  if (path !== '#/payment-orders') return null;
  const p = new URLSearchParams(search);
  const date = p.get('date') || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !readCalendarView(`#/?date=${date}`)) return null;
  const kind = p.get('kind') || '';
  if (!Object.hasOwn(paymentKinds, kind)) return null;
  const page = Number(p.get('page') || '1');
  if (!Number.isSafeInteger(page) || page < 1) return null;
  const view = readCalendarView(p.get('from') || '');
  return { date, kind: kind as PaymentKind, page, from: calendarHref(view || defaultCalendarView(date)) };
}
export function paymentListHref(date: string, kind: PaymentKind, from: string, page = 1): string {
  return `#/payment-orders?${new URLSearchParams({ date, kind, page: String(page), from })}`;
}
