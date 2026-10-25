import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import { receiveEvent } from '../src/realtime.ts';
import { displayedStatusCode } from '../src/orderStates.ts';
import { canEditItems } from '../src/orderForm.ts';

test('删除通知在REST重新读取前锁住旧详情并移出日历及待办，不覆盖编辑基线', () => {
  const client = new QueryClient();
  const id = '12345678-1234-4234-8234-123456789abc';
  const original = { orderId: id, orderNo: '0000001', status: 'PROCESSING', version: 3 };
  const draft = { ...original, name: '尚未保存的蛋糕' };
  client.setQueryData(['order', id, 'detail'], original);
  client.setQueryData(['calendar', '2026-10-25'], [original]);
  client.setQueryData(['workbench', '2026-10-25'], { pendingOrders: [original] });
  receiveEvent(client, { event: 'order.changed', data: JSON.stringify({ orderId: id, changeType: 'ORDER_DELETED', version: 4 }) });
  const latest = client.getQueryData<typeof original & { deleted: boolean }>(['order', id, 'detail'])!;
  assert.equal(latest.deleted, true); assert.equal(latest.version, 3);
  assert.equal(displayedStatusCode(latest), 'DELETED'); assert.equal(canEditItems(latest), false);
  assert.deepEqual(client.getQueryData(['calendar', '2026-10-25']), []);
  assert.deepEqual(client.getQueryData(['workbench', '2026-10-25']), { pendingOrders: [] });
  assert.equal(draft.name, '尚未保存的蛋糕'); assert.equal(draft.version, 3);
  client.clear();
});
