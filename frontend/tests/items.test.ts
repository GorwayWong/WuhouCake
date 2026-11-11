import test from 'node:test';
import assert from 'node:assert/strict';
import { canEditItems, canRemoveItem, changeItemDraft, itemChangeRequest, itemDraft, itemInput, newItem } from '../src/orderForm.ts';
import type { Detail } from '../src/types.ts';

const order: Detail = {
  orderId: 'items-test', orderNo: '0000012', version: 2, status: 'LAYER', currentStageCode: null, paymentStatus: 'PAID',
  customer: { customerName: '合成客户', phone: '13800001111', memberPhone: null, buyerName: null },
  fulfillment: { type: 'PICKUP', address: null, requestedReceiveDate: '2026-10-14', plannedHandoffAt: '2026-10-14T10:00:00Z', plannedFinishAt: null },
  totalAmountCents: 32000, createdAt: '2026-10-14T01:00:00Z', updatedAt: '2026-10-14T01:00:00Z',
  items: [
    { itemId: 'first', name: '芒果蛋糕', productType: 'CAKE', quantity: 1, unitPriceCents: 19929, memberPriceCents: 0, attributes: { size: '6', flavor: ['芒果', '香草'], filling: { layers: ['布丁', '水果'] }, base: true, message: 123, requirements: '少糖', unknown: { decorations: ['花'] } }, recentNotes: [{ id: 1, itemId: 'first', actorNameSnapshot: '合成员工', createdAt: '2026-10-14T01:00:00Z', content: '独立备注' }] },
    { itemId: 'second', name: '巧克力蛋糕', productType: 'CAKE', quantity: 2, unitPriceCents: 26000, memberPriceCents: null, attributes: { size: '8', unknown: ['另一份规格'] }, recentNotes: [] },
  ],
};

test('单商品仅提交差异，结构化与未知 JSONB、其他商品、备注和整单金额不回写', () => {
  const snapshot = structuredClone(order), draft = itemDraft(order.items[0]);
  assert.equal(draft.key, 'first');
  assert.equal(itemChangeRequest(order, 'first', draft).request, null);
  draft.attributes.size = '8';
  // 结构化规格即使传入文本也不能由文本转换函数覆盖。
  draft.attributes.flavor = '芒果'; draft.attributes.filling = '水果'; draft.attributes.base = 'true'; draft.attributes.message = '123';
  assert.deepEqual(itemChangeRequest(order, 'first', draft).request, { expectedVersion: 2, itemId: 'first', changes: { attributes: { size: '8' } } });
  assert.deepEqual(order, snapshot);
});

test('其他商品规格可清空，旧价格不可改写，新增不提交商品价格', () => {
  const pricedOrder = structuredClone(order);
  Object.assign(pricedOrder.items[0], { productType: 'OTHER', attributes: { specification: '少糖' } });
  const draft = itemDraft(pricedOrder.items[0]);
  draft.unitPrice = '199.29'; draft.memberPrice = '0';
  assert.equal(itemChangeRequest(pricedOrder, 'first', draft).request, null);
  draft.attributes.specification = '';
  assert.deepEqual(itemChangeRequest(pricedOrder, 'first', draft).request?.changes, { attributes: { specification: null } });
  const added = newItem(); added.name = '追加饮品'; added.productType = 'OTHER'; added.unitPrice = '199.29'; added.memberPrice = '0';
  const result = itemInput(added);
  assert.equal(result.item?.unitPriceCents, null); assert.equal(result.item?.memberPriceCents, null);
  assert.equal('itemId' in result.item!, false);
});

test('数量限制与合法状态，禁止移除最后一件有效商品', () => {
  const draft = itemDraft(order.items[0]);
  for (const value of ['', '0', '-1', '1.5', '2147483648', 'abc']) { draft.quantity = value; assert.ok(itemInput(draft).errors.quantity); }
  assert.equal(canRemoveItem(order, 'first'), true);
  assert.equal(canRemoveItem({ ...order, items: [order.items[0]] }, 'first'), false);
  assert.equal(canRemoveItem(order, 'missing'), false);
  for (const status of ['WAITING_DELIVERY', 'COMPLETED', 'CANCELLED']) {
    assert.equal(canEditItems({ status }), false); assert.equal(canRemoveItem({ ...order, status }, 'first'), false);
  }
  for (const status of ['CAKE_BASE', 'LAYER', 'FROSTING', 'DECORATING']) assert.equal(canEditItems({ status }), true);
});

test('409 复核基线保留草稿，仅提交员工改动，不回写同事规格，已移除商品不能保存', () => {
  const draft = itemDraft(order.items[0]); draft.attributes.size = '10'; draft.quantity = '3';
  const snapshot = structuredClone(draft);
  const latest = structuredClone(order); latest.version = 3; latest.items[0].attributes.requirements = '同事改为无糖'; latest.items[0].unitPriceCents = 35000; latest.items[1].attributes.size = '12';
  assert.equal(itemChangeRequest(order, 'first', draft).request?.expectedVersion, 2, '后台刷新不提升未复核写入版本');
  assert.deepEqual(itemChangeRequest(order, 'first', draft, latest).request, { expectedVersion: 3, itemId: 'first', changes: { quantity: 3, attributes: { size: '10' } } });
  assert.deepEqual(draft, snapshot);
  latest.items[0].attributes.size = { tiers: ['6', '8'] };
  assert.deepEqual(itemChangeRequest(order, 'first', draft, latest).request?.changes, { quantity: 3 });
  latest.items = [latest.items[1]];
  assert.ok(itemChangeRequest(order, 'first', draft, latest).errors.item);
  assert.deepEqual(draft, snapshot);
});

test('重新制作复核后使用响应版本，只提交原草稿差异并保留同事字段', () => {
  const draft = itemDraft(order.items[0]); draft.attributes.size = '10';
  const snapshot = structuredClone(draft);
  const reopened = structuredClone(order); reopened.version = 5; reopened.currentStageCode = null;
  reopened.items[0].quantity = 3; reopened.items[1].attributes.size = '12';
  const newer = structuredClone(reopened); newer.version = 6; newer.items[0].attributes.requirements = '同事补充少糖';
  assert.deepEqual(itemChangeRequest(order, 'first', draft, reopened).request, { expectedVersion: 5, itemId: 'first', changes: { attributes: { size: '10' } } });
  assert.deepEqual(itemChangeRequest(order, 'first', draft, newer).request, { expectedVersion: 6, itemId: 'first', changes: { attributes: { size: '10' } } });
  assert.deepEqual(draft, snapshot);
});

test('蛋糕改其他必须使用最新属性，重转保留同事新增要求及结构化属性', () => {
  const latest = structuredClone(order); latest.version++;
  latest.items[0].attributes.requirements = '不要坚果';
  latest.items[0].attributes.decoration = { color: '红色' };
  const old = changeItemDraft(itemDraft(order.items[0]), { productType: 'OTHER' });
  const blocked = itemChangeRequest(order, 'first', old, latest);
  assert.equal(blocked.request, null);
  assert.match(blocked.errors.specification, /重新转换/);
  const fresh = changeItemDraft(itemDraft(latest.items[0]), { productType: 'OTHER' });
  const retry = itemChangeRequest(order, 'first', fresh, latest, latest.items[0]).request!;
  assert.equal(retry.expectedVersion, latest.version);
  assert.match(String(retry.changes.attributes?.specification), /不要坚果/);
  assert.match(String(retry.changes.attributes?.specification), /红色/);
  assert.doesNotMatch(String(retry.changes.attributes?.specification), /少糖/);
  const newer = structuredClone(latest); newer.version++;
  newer.items[0].attributes.requirements = '不要牛奶';
  assert.equal(itemChangeRequest(order, 'first', fresh, newer, latest.items[0]).request, null);
  const convertedByPeer = structuredClone(latest); convertedByPeer.version++;
  convertedByPeer.items[0].productType = 'OTHER';
  convertedByPeer.items[0].attributes = { specification: '不要坚果' };
  const reviewed = changeItemDraft(itemDraft(convertedByPeer.items[0]), { productType: 'OTHER' });
  const subsequent = structuredClone(convertedByPeer); subsequent.version++;
  subsequent.items[0].attributes.specification = '不要坚果\n不要牛奶';
  assert.equal(itemChangeRequest(order, 'first', reviewed, subsequent, convertedByPeer.items[0]).request, null);
});
