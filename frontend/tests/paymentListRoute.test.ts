import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentListHref, readPaymentList } from '../src/paymentListRoute.ts';
import { orderHref, workspaceRoute } from '../src/routes.ts';
test('付款列表保存来源和页码，详情和日志逐级返回', () => {
  const from = '#/?date=2026-10-23&view=month&month=2026-10&expanded=1';
  const list = paymentListHref('2026-10-23', 'RECEIPT', from, 3);
  assert.deepEqual(readPaymentList(list), { date: '2026-10-23', kind: 'RECEIPT', page: 3, from });
  assert.equal(workspaceRoute(list).kind, 'payment-orders');
  const id = '11111111-1111-4111-8111-111111111111';
  assert.equal(workspaceRoute(orderHref(id, list)).returnToCalendar, list);
  assert.equal(workspaceRoute(orderHref(id, list, 'NOTE', true)).returnToCalendar, list);
});
test('付款列表只接受有效日期、类别、页码和内部来源', () => {
  for (const [date, kind, page] of [['2026-02-30', 'RECEIPT', '1'], ['2026-10-23', 'BAD', '1'], ['2026-10-23', 'RECEIPT', '0']]) {
    assert.equal(readPaymentList(`#/payment-orders?date=${date}&kind=${kind}&page=${page}`), null);
  }
  assert.equal(readPaymentList('#/payment-orders?date=2026-10-23&kind=SHIPPING_PAID&from=https://example.com')?.from, '#/?date=2026-10-23');
});
