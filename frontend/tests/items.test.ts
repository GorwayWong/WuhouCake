import test from 'node:test';
import assert from 'node:assert/strict';
import { canEditItems, canRemoveItem, itemChangeRequest, itemDraft, itemInput, newItem } from '../src/orderForm.ts';
import type { Detail } from '../src/types.ts';

const order: Detail = {
  orderId: 'items-test', orderNo: '0000012', version: 2, status: 'PROCESSING', currentStageCode: 'LAYER_DONE', paymentStatus: 'PAID',
  customer: { customerName: '合成客户', phone: '13800001111', memberPhone: null, buyerName: null },
  fulfillment: { type: 'PICKUP', address: null, requestedReceiveDate: '2026-10-14', plannedHandoffAt: '2026-10-14T10:00:00Z', plannedFinishAt: null },
  totalAmountCents: 32000, createdAt: '2026-10-14T01:00:00Z', updatedAt: '2026-10-14T01:00:00Z',
  items: [
    { itemId: 'first', name: '芒果蛋糕', productType: 'CAKE', quantity: 1, unitPriceCents: 19929, memberPriceCents: 0, attributes: { size: '6 寸', flavor: ['芒果', '香草'], filling: { layers: ['布丁', '水果'] }, base: true, message: 123, requirements: '少糖', unknown: { decorations: ['花'] } }, recentNotes: [{ id: 1, itemId: 'first', actorNameSnapshot: '合成员工', createdAt: '2026-10-14T01:00:00Z', content: '独立备注' }] },
    { itemId: 'second', name: '巧克力蛋糕', productType: 'CAKE', quantity: 2, unitPriceCents: 26000, memberPriceCents: null, attributes: { size: '8 寸', unknown: ['另一份规格'] }, recentNotes: [] },
  ],
};

test('单商品仅提交差异，结构化与未知 JSONB、其他商品、备注和整单金额不回写', () => {
  const snapshot = structuredClone(order), draft = itemDraft(order.items[0]);
  assert.equal(draft.key, 'first');
  assert.equal(itemChangeRequest(order, 'first', draft).request, null);
  draft.attributes.size = '8 寸';
  // 结构化规格即使传入文本也不能由文本转换函数覆盖。
  draft.attributes.flavor = '芒果'; draft.attributes.filling = '水果'; draft.attributes.base = 'true'; draft.attributes.message = '123';
  assert.deepEqual(itemChangeRequest(order, 'first', draft).request, { expectedVersion: 2, itemId: 'first', changes: { attributes: { size: '8 寸' } } });
  assert.deepEqual(order, snapshot);
});

test('规格删除提交 null，报价清空与 0 区分，金额精确转分且无变化不提交', () => {
  const draft = itemDraft(order.items[0]);
  draft.unitPrice = '199.290';
  assert.ok(itemChangeRequest(order, 'first', draft).errors.unitPrice);
  draft.unitPrice = '199.29'; draft.memberPrice = '0';
  assert.equal(itemChangeRequest(order, 'first', draft).request, null);
  draft.attributes.requirements = ''; draft.unitPrice = '280.01'; draft.memberPrice = '';
  assert.deepEqual(itemChangeRequest(order, 'first', draft).request?.changes, { unitPriceCents: 28001, memberPriceCents: null, attributes: { requirements: null } });
  const added = newItem(); added.name = '追加蛋糕'; added.unitPrice = '199.29'; added.memberPrice = '0';
  const result = itemInput(added);
  assert.equal(result.item?.unitPriceCents, 19929); assert.equal(result.item?.memberPriceCents, 0);
  assert.equal('itemId' in result.item!, false);
});

test('数量限制与合法状态，禁止移除最后一件有效商品', () => {
  const draft = itemDraft(order.items[0]);
  for (const value of ['', '0', '-1', '1.5', '2147483648', 'abc']) { draft.quantity = value; assert.ok(itemInput(draft).errors.quantity); }
  assert.equal(canRemoveItem(order, 'first'), true);
  assert.equal(canRemoveItem({ ...order, items: [order.items[0]] }, 'first'), false);
  assert.equal(canRemoveItem(order, 'missing'), false);
  for (const status of ['WAITING_DELIVERY', 'WAITING_PICKUP', 'DELIVERING', 'COMPLETED', 'CANCELLED']) {
    assert.equal(canEditItems({ status }), false); assert.equal(canRemoveItem({ ...order, status }, 'first'), false);
  }
  assert.equal(canEditItems({ status: 'WAITING_PRODUCTION' }), true);
});

test('409 复核基线保留草稿，仅提交员工改动，不回写同事规格，已移除商品不能保存', () => {
  const draft = itemDraft(order.items[0]); draft.attributes.size = '10 寸'; draft.quantity = '3';
  const snapshot = structuredClone(draft);
  const latest = structuredClone(order); latest.version = 3; latest.items[0].attributes.requirements = '同事改为无糖'; latest.items[0].unitPriceCents = 35000; latest.items[1].attributes.size = '12 寸';
  assert.equal(itemChangeRequest(order, 'first', draft).request?.expectedVersion, 2, '后台刷新不提升未复核写入版本');
  assert.deepEqual(itemChangeRequest(order, 'first', draft, latest).request, { expectedVersion: 3, itemId: 'first', changes: { quantity: 3, attributes: { size: '10 寸' } } });
  assert.deepEqual(draft, snapshot);
  latest.items[0].attributes.size = { tiers: ['6 寸', '8 寸'] };
  assert.deepEqual(itemChangeRequest(order, 'first', draft, latest).request?.changes, { quantity: 3 });
  latest.items = [latest.items[1]];
  assert.ok(itemChangeRequest(order, 'first', draft, latest).errors.item);
  assert.deepEqual(draft, snapshot);
});
