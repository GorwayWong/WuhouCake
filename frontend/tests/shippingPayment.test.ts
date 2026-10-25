import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { dailyOperationalCounts, paymentSummaryKey, summaryAmount, visibleCalendarFilters } from '../src/shippingPayment.ts';
import { matchesCalendarFilters } from '../src/calendarFilters.ts';
import { receiveEvent } from '../src/realtime.ts';

test('付款筛选只影响列表，全日统计包含完成单且排除取消单', () => {
  const orders = [{ status: 'WAITING_DELIVERY', paymentStatus: 'UNPAID' }, { status: 'COMPLETED', paymentStatus: 'PAID' }, { status: 'CANCELLED', paymentStatus: 'PAID' }];
  const expected = { totalOrderCount: 2, waitingDeliveryOrderCount: 1 };
  for (const status of ['', 'COMPLETED', 'WAITING_DELIVERY', 'CANCELLED']) for (const paymentStatus of ['', 'PAID', 'UNPAID']) {
    const filtered = orders.filter(order => matchesCalendarFilters(order, { status, paymentStatus }));
    assert.ok(filtered.length <= orders.length);
    assert.deepEqual(dailyOperationalCounts(orders), expected);
  }
  assert.deepEqual(visibleCalendarFilters({ status: 'COMPLETED', paymentStatus: 'UNPAID' }, false), { status: 'COMPLETED', paymentStatus: '' });
});

test('金额精确保留分位，空报价与真实零元明确区分', () => {
  assert.equal(summaryAmount({ orderCount: 0, amountCents: '0', missingAmountOrderCount: 0 }), '¥0.00');
  assert.equal(summaryAmount({ orderCount: 1, amountCents: '0', missingAmountOrderCount: 0 }), '¥0.00');
  assert.equal(summaryAmount({ orderCount: 1, amountCents: '0', missingAmountOrderCount: 1 }), '待补金额');
  assert.equal(summaryAmount({ orderCount: 2, amountCents: '9223372036854782596', missingAmountOrderCount: 1 }), '¥92233720368547825.96');
});

test('汇总缓存按日期隔离，付款改动和订单迁日通知触发刷新', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const calls = [0, 0];
  const stops = ['2026-10-23', '2026-10-24'].map((date, i) => new QueryObserver(client, {
    queryKey: paymentSummaryKey(date), queryFn: async () => ({ date, revision: ++calls[i] }),
  }).subscribe(() => {}));
  const wait = async (expected: number) => { for (let i = 0; i < 50 && calls.some(count => count < expected); i++) await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(calls.every(count => count >= expected)); };
  try {
    await wait(1);
    for (const [index, changeType] of ['PAYMENT_STATUS_CHANGED', 'ORDER_INFORMATION_CHANGED', 'ORDER_CANCELLED'].entries()) {
      await new Promise(resolve => setTimeout(resolve, 5));
      receiveEvent(client, { event: 'order.changed', data: JSON.stringify({ orderId: 'order-a', version: index, changeType }) });
      await wait(index + 2);
    }
    assert.equal(client.getQueryData<{ date: string }>(paymentSummaryKey('2026-10-23'))?.date, '2026-10-23');
  } finally { stops.forEach(stop => stop()); client.clear(); }
});
