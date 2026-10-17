import type { OrderStatus } from './types.ts';
import { exportOptions } from './exportFiles.ts';

export interface CalendarFilters { status: string; paymentStatus: string }
export const allCalendarFilters: CalendarFilters = { status: '', paymentStatus: '' };
type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;
export function readCalendarFilters(accountId: string, storage: PreferenceStorage): CalendarFilters {
  try {
    const value = JSON.parse(storage.getItem(`wuhou.calendar.filters.${accountId}`) || 'null');
    if (!value || typeof value !== 'object') return { ...allCalendarFilters };
    return { status: typeof value.status === 'string' && Object.hasOwn(exportOptions.status, value.status) ? value.status : '',
      paymentStatus: typeof value.paymentStatus === 'string' && Object.hasOwn(exportOptions.paymentStatus, value.paymentStatus) ? value.paymentStatus : '' };
  } catch { return { ...allCalendarFilters }; }
}
export function writeCalendarFilters(accountId: string, value: CalendarFilters, storage: PreferenceStorage) {
  try { storage.setItem(`wuhou.calendar.filters.${accountId}`, JSON.stringify(value)); } catch { /* Preference storage may be unavailable. */ }
}
export function matchesCalendarFilters(order: Pick<OrderStatus, 'status' | 'paymentStatus'>, filters: CalendarFilters): boolean {
  return (!filters.status || order.status === filters.status) && (!filters.paymentStatus || order.paymentStatus === filters.paymentStatus);
}
