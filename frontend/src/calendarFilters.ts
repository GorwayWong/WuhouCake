import type { OrderStatus } from './types.ts';
import { displayedStatusCode, fulfillmentStatusName, productionStatuses } from './orderStates.ts';

export interface CalendarFilters { status: string; paymentStatus: string }
export const allCalendarFilters: CalendarFilters = { status: '', paymentStatus: '' };
export function calendarStatusOptions(): [string, string][] {
  const options: [string, string][] = productionStatuses.map(status => [status, fulfillmentStatusName(status)]);
  for (const status of ['WAITING_DELIVERY', 'COMPLETED']) {
    for (const type of ['DELIVERY', 'PICKUP']) {
      options.push([`${status}:${type}`, fulfillmentStatusName(status, type)]);
    }
  }
  options.push(['CANCELLED', fulfillmentStatusName('CANCELLED')]);
  return options;
}
export function calendarStatusCriteria(value: string) {
  const [status, fulfillmentType] = value.split(':');
  return { status, fulfillmentType };
}
export function matchesCalendarFilters(order: Pick<OrderStatus, 'status' | 'paymentStatus'> & { fulfillmentType?: string }, filters: CalendarFilters): boolean {
  const { status, fulfillmentType } = calendarStatusCriteria(filters.status);
  return (!status || displayedStatusCode(order) === status)
    && (!fulfillmentType || order.fulfillmentType === fulfillmentType)
    && (!filters.paymentStatus || order.paymentStatus === filters.paymentStatus);
}
