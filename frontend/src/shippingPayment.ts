import type { CalendarFilters } from './calendarFilters.ts';
import type { PaymentGroup, PendingOrder } from './types.ts';
import { exactYuan } from './management.ts';

export const paymentSummaryKey = (date: string) => ['workbench', 'payment-summary', date] as const;
export function summaryAmount(group: PaymentGroup): string {
  return group.orderCount > 0 && group.missingAmountOrderCount === group.orderCount ? '待补金额' : `¥${exactYuan(group.amountCents)}`;
}
export function dailyOperationalCounts(orders: Pick<PendingOrder, 'status'>[]) {
  const valid = orders.filter(order => order.status !== 'CANCELLED');
  return { totalOrderCount: valid.length, waitingDeliveryOrderCount: valid.filter(order => order.status === 'WAITING_DELIVERY').length };
}
export function visibleCalendarFilters(filters: CalendarFilters, canReadAmounts: boolean): CalendarFilters {
  return canReadAmounts ? filters : { ...filters, paymentStatus: '' };
}
