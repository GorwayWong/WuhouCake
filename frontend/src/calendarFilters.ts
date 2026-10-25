import type { OrderStatus } from './types.ts';
import { displayedStatusCode, statusNames } from './orderStates.ts';

export interface CalendarFilters { status: string; paymentStatus: string }
export const allCalendarFilters: CalendarFilters = { status: '', paymentStatus: '' };
export function calendarStatusOptions(): [string, string][] {
  return ['WAITING_PRODUCTION', 'PROCESSING', 'LAYER_DONE', 'FROSTING_DONE', 'OTHER_DONE', 'WAITING_DELIVERY', 'WAITING_PICKUP', 'DELIVERING', 'COMPLETED', 'CANCELLED']
    .map(code => [code, statusNames[code]]);
}
export function matchesCalendarFilters(order: Pick<OrderStatus, 'status' | 'paymentStatus'> & Partial<Pick<OrderStatus, 'currentStageCode'>>, filters: CalendarFilters): boolean {
  return (!filters.status || displayedStatusCode(order) === filters.status) && (!filters.paymentStatus || order.paymentStatus === filters.paymentStatus);
}
