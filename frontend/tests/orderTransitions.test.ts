import test from 'node:test';
import assert from 'node:assert/strict';
import { previousOrderStep } from '../src/orderTransitions.ts';
import type { Detail } from '../src/types.ts';

function order(status: string, currentStageCode: string | null = null, type = 'DELIVERY'): Pick<Detail, 'status' | 'currentStageCode' | 'fulfillment'> {
  return { status, currentStageCode, fulfillment: { type, address: null, requestedReceiveDate: '2026-10-23', plannedHandoffAt: null, plannedFinishAt: null } };
}
test('每个制作节点仅提供相邻后退，待制作不再后退', () => {
  assert.equal(previousOrderStep(order('WAITING_PRODUCTION')), null);
  for (const [stage, label, resetItems] of [[null, '退回待制作', true], ['LAYER_DONE', '退回生胚中', false], ['FROSTING_DONE', '退回已夹层', false], ['OTHER_DONE', '退回已抹面', false]] as const) {
    const step = previousOrderStep(order('PROCESSING', stage));
    assert.equal(step?.label, label); assert.equal(step?.resetItems, resetItems);
    assert.equal(step?.action, 'ROLLBACK_PRODUCTION'); assert.equal(step?.path, 'production-actions');
    assert.deepEqual(step?.permissions, ['ORDER_PRODUCTION_UPDATE']);
  }
});
test('交付后退依交付方式，历史无制作节点也使用统一链', () => {
  assert.equal(previousOrderStep(order('COMPLETED', null, 'DELIVERY'))?.label, '退回配送中');
  assert.equal(previousOrderStep(order('COMPLETED', null, 'PICKUP'))?.label, '退回待自提');
  assert.equal(previousOrderStep(order('DELIVERING'))?.label, '退回待配送');
  assert.deepEqual(previousOrderStep(order('COMPLETED'))?.permissions, ['ORDER_FULFILLMENT_UPDATE']);
  for (const status of ['WAITING_DELIVERY', 'WAITING_PICKUP']) {
    const step = previousOrderStep(order(status));
    assert.equal(step?.label, '退回其他已确认'); assert.equal(step?.action, 'REOPEN_PRODUCTION'); assert.equal(step?.resetItems, false);
  }
});
test('取消单恢复需双权限，且明确重置商品确认', () => {
  const step = previousOrderStep(order('CANCELLED'));
  assert.equal(step?.path, 'restart'); assert.equal(step?.action, undefined);
  assert.equal(step?.label, '恢复至待制作'); assert.equal(step?.resetItems, true);
  assert.deepEqual(step?.permissions, ['ORDER_CANCEL', 'ORDER_PRODUCTION_UPDATE']);
});
