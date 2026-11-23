import type { OrderStatus } from './types.ts';
import { displayedStatusCode, fulfillmentStatusName, productionStatuses } from './orderStates.ts';

export interface CalendarFilters { status: string; paymentStatus: string }
export const allCalendarFilters: CalendarFilters = { status: '', paymentStatus: '' };
export const deliveryCalendarFilter = 'delivery';
export function calendarStatusOptions(isToday: boolean): [string, string][] {
  const options: [string, string][] = [
    [deliveryCalendarFilter, isToday ? '今日需配送' : '当日需配送'],
    ...productionStatuses.map<[string, string]>(status => [status, fulfillmentStatusName(status)]),
  ];
  for (const status of ['WAITING_DELIVERY', 'COMPLETED']) {
    for (const type of ['DELIVERY', 'PICKUP']) {
      options.push([`${status}:${type}`, fulfillmentStatusName(status, type)]);
    }
  }
  options.push(['CANCELLED', fulfillmentStatusName('CANCELLED')]);
  return options;
}
export function calendarStatusCriteria(value: string): { status?: string; fulfillmentType?: string; view?: string } {
  if (value === deliveryCalendarFilter) return { view: deliveryCalendarFilter };
  const [status, fulfillmentType] = value.split(':');
  return { status, fulfillmentType };
}
export function matchesCalendarFilters(order: Pick<OrderStatus, 'status' | 'paymentStatus'> & { fulfillmentType?: string }, filters: CalendarFilters): boolean {
  const { status, fulfillmentType, view } = calendarStatusCriteria(filters.status);
  return (!view || order.fulfillmentType === 'DELIVERY'
    && (productionStatuses.includes(order.status) || order.status === 'WAITING_DELIVERY' || order.status === 'COMPLETED'))
    && (!status || displayedStatusCode(order) === status)
    && (!fulfillmentType || order.fulfillmentType === fulfillmentType)
    && (!filters.paymentStatus || order.paymentStatus === filters.paymentStatus);
}
