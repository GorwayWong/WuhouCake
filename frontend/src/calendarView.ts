import { calendarRange, shiftDate, shiftMonth, time, workbenchDate } from './dates.ts';
import type { Note, PendingOrder } from './types.ts';

export interface CalendarView { date: string; mode: 'week' | 'month'; month: string; expanded: boolean }
export function defaultCalendarView(date: string): CalendarView {
  return { date, mode: 'week', month: date.slice(0, 7), expanded: false };
}
export function readCalendarView(hash: string): CalendarView | null {
  if (!/^#\/\?/.test(hash)) return null;
  const params = new URLSearchParams(hash.slice(3));
  const date = workbenchDate(`#/?date=${params.get('date') || ''}`);
  if (!date) return null;
  const view = defaultCalendarView(date);
  if (params.get('view') !== 'month') return view;
  const month = params.get('month') || date.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month) || !workbenchDate(`#/?date=${month}-01`)) return null;
  const range = calendarRange(`${month}-01`, 'month');
  return { date, mode: 'month', month, expanded: params.get('expanded') === '1' && range.dates.includes(date) };
}
export function calendarHref(view: CalendarView): string {
  const params = new URLSearchParams({ date: view.date });
  if (view.mode === 'month') {
    params.set('view', 'month'); params.set('month', view.month);
    if (view.expanded) params.set('expanded', '1');
  }
  return `#/?${params}`;
}
export function selectCalendarDate(view: CalendarView, date: string): CalendarView {
  return { ...view, date, expanded: view.mode === 'month' && !(view.expanded && view.date === date) };
}
export function jumpCalendarDate(view: CalendarView, date: string): CalendarView {
  return { ...view, date, month: date.slice(0, 7), expanded: view.mode === 'month' };
}
export function shiftCalendarPeriod(view: CalendarView, delta: number): CalendarView {
  const date = view.mode === 'week' ? shiftDate(view.date, delta * 7)
    : shiftMonth(`${view.month}-${view.date.slice(8)}`, delta);
  return { ...view, date, month: date.slice(0, 7), expanded: false };
}
export function toggleCalendarMode(view: CalendarView): CalendarView {
  return { ...view, mode: view.mode === 'week' ? 'month' : 'week', month: view.date.slice(0, 7), expanded: false };
}
export function compareCalendarOrders(a: { plannedHandoffAt: string | null; orderNo: string }, b: { plannedHandoffAt: string | null; orderNo: string }): number {
  const first = a.plannedHandoffAt ? Date.parse(a.plannedHandoffAt) : Infinity;
  const second = b.plannedHandoffAt ? Date.parse(b.plannedHandoffAt) : Infinity;
  return first - second || a.orderNo.localeCompare(b.orderNo);
}
export function groupOrdersByTime(orders: PendingOrder[]): { key: string; time: string; orders: PendingOrder[] }[] {
  const groups = new Map<number | null, PendingOrder[]>();
  for (const order of [...orders].sort(compareCalendarOrders)) {
    const slot = order.plannedHandoffAt ? Math.floor(Date.parse(order.plannedHandoffAt) / 1_800_000) * 1_800_000 : null;
    const group = groups.get(slot) || [];
    group.push(order); groups.set(slot, group);
  }
  return Array.from(groups, ([slot, orders]) => ({ key: String(slot), time: slot === null ? '时间待定' : time(new Date(slot).toISOString()), orders }));
}
export function latestOrderNote(order: Pick<PendingOrder, 'items' | 'latestNote'>): Note | undefined {
  if (order.latestNote !== undefined) return order.latestNote || undefined;
  let latest: Note | undefined;
  for (const item of order.items) for (const note of item.recentNotes) {
    if (!latest || Date.parse(note.createdAt) > Date.parse(latest.createdAt)
      || (Date.parse(note.createdAt) === Date.parse(latest.createdAt) && note.id > latest.id)) latest = note;
  }
  return latest;
}
