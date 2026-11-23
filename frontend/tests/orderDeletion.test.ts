import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { receiveEvent, synchronize } from '../src/realtime.ts';
import { displayedStatusCode } from '../src/orderStates.ts';
import { canEditItems } from '../src/orderForm.ts';

test('删除通知在REST重新读取前锁住旧详情并刷新日历摘要并移出待办，不覆盖编辑基线', async () => {
  const client = new QueryClient();
  const id = '12345678-1234-4234-8234-123456789abc';
  const original = { orderId: id, orderNo: '0000001', status: 'LAYER', version: 3 };
  const draft = { ...original, name: '尚未保存的蛋糕' };
  client.setQueryData(['order', id, 'detail'], original);
  const calendarKey = ['calendar', 'days', '2026-10-25', '2026-10-26'];
  client.setQueryData(calendarKey, [{ calendarDate: '2026-10-25', firstOrderId: id, orderCount: 1 }]);
  client.setQueryData(['workbench', '2026-10-25'], { pendingOrders: [original] });
  receiveEvent(client, { event: 'order.changed', data: JSON.stringify({ orderId: id, changeType: 'ORDER_DELETED', version: 4 }) });
  await new Promise(resolve => setTimeout(resolve, 0));
  const latest = client.getQueryData<typeof original & { deleted: boolean }>(['order', id, 'detail'])!;
  assert.equal(latest.deleted, true); assert.equal(latest.version, 3);
  assert.equal(displayedStatusCode(latest), 'DELETED'); assert.equal(canEditItems(latest), false);
  assert.deepEqual(client.getQueryData(calendarKey), []);
  assert.deepEqual(client.getQueryData(['workbench', '2026-10-25']), { pendingOrders: [] });
  assert.equal(draft.name, '尚未保存的蛋糕'); assert.equal(draft.version, 3);
  client.clear();
});

test('较旧的删除通知不移除已恢复订单或分页工作台卡片', async () => {
  const client = new QueryClient();
  const id = '12345678-1234-4234-8234-123456789abc';
  const event = (changeType: string, version: number) => receiveEvent(client, {
    event: 'order.changed', data: JSON.stringify({ orderId: id, changeType, version }),
  });
  const card = { orderId: id, status: 'LAYER' };
  const key = ['workbench', 'cards', '2026-10-25'];
  client.setQueryData(key, { pages: [{ orders: [card], focusedOrder: card }], pageParams: [null] });
  event('ORDER_RESTORED', 5);
  event('ORDER_DELETED', 4);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(client.getQueryData(key), { pages: [{ orders: [card], focusedOrder: card }], pageParams: [null] });
  event('ORDER_DELETED', 6);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(client.getQueryData(key), { pages: [{ orders: [], focusedOrder: null }], pageParams: [null] });
  client.clear();
});

test('首单删除后补读失败仍隐藏预览，其他日期可用，重试后显示新的首单', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const key = ['calendar', 'days', '2026-10-25', '2026-11-01'];
  const first = { calendarDate: '2026-10-25', firstOrderId: 'a', orderCount: 2, unfinishedCount: 1,
    firstItemName: '旧首单', customerPhoneLast4: '0123' };
  const other = { ...first, calendarDate: '2026-10-26', firstOrderId: 'b' };
  const next = { ...first, firstOrderId: 'c', orderCount: 1, unfinishedCount: 0, firstItemName: '新首单', customerPhoneLast4: '4567' };
  client.setQueryData(key, [first, other]);
  let offline = true;
  const observer = new QueryObserver(client, { queryKey: key, queryFn: async () => {
    if (offline) throw new Error('offline');
    return [next, other];
  } });
  const stop = observer.subscribe(() => {});
  try {
    await synchronize(client, 'a', true, 4);
    assert.equal(observer.getCurrentResult().status, 'error');
    assert.deepEqual(observer.getCurrentResult().data, [{ ...first, orderCount: 1, unfinishedCount: null,
      firstOrderId: null, firstItemName: null, customerPhoneLast4: null }, other]);
    offline = false;
    assert.deepEqual((await observer.refetch()).data, [next, other]);
  } finally { stop(); client.clear(); }
});
