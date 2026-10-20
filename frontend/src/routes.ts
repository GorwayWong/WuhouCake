export function workspaceRoute(hash: string, systemRole?: string) {
  const submission = /^#\/customer-submissions\/([a-f\d-]{36})$/i.exec(hash);
  if (submission) return { kind: 'submission', id: submission[1] };
  if (hash === '#/customer-submissions') return { kind: 'submissions' };
  const order = /^#\/orders\/([a-f\d-]{36})(\/activities)?(?:\?type=([A-Z_]+))?$/i.exec(hash);
  if (order) return { kind: order[2] ? 'history' : 'order', id: order[1], type: order[3] };
  if (hash === '#/orders/new') return { kind: 'create' };
  if (hash === '#/admin/orders') return { kind: 'orders' };
  if (hash === '#/admin/employees' && systemRole === 'SUPER_ADMIN') return { kind: 'employees' };
  return { kind: 'calendar' };
}

export function calendarOrderHref(month: boolean, date: string, orderId: string): string {
  return month ? `#/?date=${date}` : `#/orders/${orderId}`;
}
