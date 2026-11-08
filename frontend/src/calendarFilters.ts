import type { OrderStatus } from './types.ts';
import { displayedStatusCode, orderStatusNames } from './orderStates.ts';

export interface CalendarFilters { status: string; paymentStatus: string }
export const allCalendarFilters: CalendarFilters = { status: '', paymentStatus: '' };
export function calendarStatusOptions(): [string, string][] {
  return Object.entries(orderStatusNames);
}
export function matchesCalendarFilters(order: Pick<OrderStatus, 'status' | 'paymentStatus'> & Partial<Pick<OrderStatus, 'currentStageCode'>>, filters: CalendarFilters): boolean {
  return (!filters.status || displayedStatusCode(order) === filters.status) && (!filters.paymentStatus || order.paymentStatus === filters.paymentStatus);
}
