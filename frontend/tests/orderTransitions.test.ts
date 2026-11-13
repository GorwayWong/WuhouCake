import test from 'node:test';
import assert from 'node:assert/strict';
import { nextProductionAction, previousOrderStep } from '../src/orderTransitions.ts';
import type { Detail } from '../src/types.ts';

function order(status: string, type = 'DELIVERY'): Pick<Detail, 'status' | 'currentStageCode' | 'fulfillment'> {
  return { status, currentStageCode: null, fulfillment: { type, address: null, requestedReceiveDate: '2026-10-23', plannedHandoffAt: null, plannedFinishAt: null } };
}
test('六个业务状态使用直接节点码，制作节点只允许相邻后退', () => {
  assert.deepEqual(Object.keys(nextProductionAction), ['CAKE_BASE', 'LAYER', 'FROSTING', 'DECORATING']);
  assert.deepEqual(Object.values(nextProductionAction), ['COMPLETE_BASE', 'COMPLETE_LAYER', 'COMPLETE_FROSTING', 'COMPLETE_DECORATION']);
  assert.equal(previousOrderStep(order('CAKE_BASE')), null);
  for (const [status, label, resetItems] of [['LAYER', '退回出胚', true], ['FROSTING', '退回夹层', false], ['DECORATING', '退回抹面', false]] as const) {
    const step = previousOrderStep(order(status));
    assert.equal(step?.label, label); assert.equal(step?.resetItems, resetItems);
    assert.equal(step?.action, 'ROLLBACK_PRODUCTION'); assert.equal(step?.path, 'production-actions');
    assert.deepEqual(step?.permissions, ['ORDER_PRODUCTION_UPDATE']);
  }
});
test('配送和自提共用交接状态，回退按钮按交接方式命名', () => {
  for (const type of ['DELIVERY', 'PICKUP']) {
    const step = previousOrderStep(order('COMPLETED', type));
    assert.equal(step?.label, type === 'PICKUP' ? '退回待自提' : '退回待配送');
    assert.equal(step?.action, 'ROLLBACK_FULFILLMENT');
    assert.equal(step?.path, 'fulfillment-actions');
    assert.equal(step?.resetItems, false);
    assert.deepEqual(step?.permissions, ['ORDER_FULFILLMENT_UPDATE']);
  }
  const step = previousOrderStep(order('WAITING_DELIVERY'));
  assert.equal(step?.label, '退回装饰'); assert.equal(step?.action, 'REOPEN_PRODUCTION'); assert.equal(step?.resetItems, false);
  assert.equal(step?.path, 'production-actions');
});
test('取消单恢复需双权限，且明确重置商品确认', () => {
  const step = previousOrderStep(order('CANCELLED'));
  assert.equal(step?.path, 'restart'); assert.equal(step?.action, undefined);
  assert.equal(step?.label, '恢复至出胚'); assert.equal(step?.resetItems, true);
  assert.deepEqual(step?.permissions, ['ORDER_CANCEL', 'ORDER_PRODUCTION_UPDATE']);
});
