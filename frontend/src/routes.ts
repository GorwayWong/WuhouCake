import { calendarHref, readCalendarView } from './calendarView.ts';
import { readPaymentList } from './paymentListRoute.ts';
import type { CalendarView } from './calendarView.ts';

export function workspaceRoute(hash: string, systemRole?: string): { kind: string; id?: string; type?: string; returnToCalendar?: string } {
  const submission = /^#\/customer-submissions\/([a-f\d-]{36})$/i.exec(hash);
  if (submission) return { kind: 'submission', id: submission[1] };
  if (hash === '#/customer-submissions') return { kind: 'submissions' };
  const [path, query] = hash.split('?');
  const order = /^#\/orders\/([a-f\d-]{36})(\/activities)?$/i.exec(path);
  if (order) {
    const params = new URLSearchParams(query);
    const from = params.get('from');
    const view = from ? readCalendarView(from) : null;
    const payment = from ? readPaymentList(from) : null;
    return { kind: order[2] ? 'history' : 'order', id: order[1], type: params.get('type') || undefined,
      ...(view ? { returnToCalendar: calendarHref(view) } : payment ? { returnToCalendar: from! } : {}) };
  }
  const paymentList = readPaymentList(hash);
  if (paymentList) return { kind: 'payment-orders', returnToCalendar: paymentList.from };
  if (hash === '#/orders/new') return { kind: 'create' };
  if (hash === '#/admin/orders') return { kind: 'orders' };
  if (hash === '#/admin/order-packages') return { kind: 'packages' };
  if (hash === '#/admin/employees' && systemRole === 'SUPER_ADMIN') return { kind: 'employees' };
  return { kind: 'calendar' };
}

export function calendarOrderHref(view: CalendarView, orderId: string): string {
  return orderHref(orderId, calendarHref(view));
}
export function orderHref(orderId: string, from?: string, type?: string, history = false): string {
  const params = new URLSearchParams();
  if (type) params.set('type', type);
  if (from && (readCalendarView(from) || readPaymentList(from))) params.set('from', from);
  return `#/orders/${orderId}${history ? '/activities' : ''}${params.size ? `?${params}` : ''}`;
}
