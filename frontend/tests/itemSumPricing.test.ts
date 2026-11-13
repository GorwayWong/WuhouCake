import assert from 'node:assert/strict';
import test from 'node:test';
import { itemTotals } from '../src/itemPricing.ts';
import { createOrderRequest, draftTotals, newDraft, newItem } from '../src/orderForm.ts';
import { freshOrderDraft, decodeOrderDraft } from '../src/orderDraftStorage.ts';
import { newPackageItem, packageRequest, packagePricingProblem, previewPackage } from '../src/orderPackages.ts';
import type { OrderPackage } from '../src/orderPackages.ts';

test('混合商品按整数分汇总，会员单价逐项回退，空价不产生部分合计', () => {
  const items = [{ quantity: 2, unitPriceCents: 1001, memberPriceCents: 900 }, { quantity: 3, unitPriceCents: 301 }];
  assert.deepEqual(itemTotals(items), { original: 2905, member: 2703, total: 2703, unpriced: 0 });
  assert.deepEqual(itemTotals([...items, { quantity: 1 }]), { original: null, member: null, total: null, unpriced: 1 });
  assert.deepEqual(itemTotals([{ quantity: 1, unitPriceCents: 0 }]), { original: 0, member: null, total: 0, unpriced: 0 });
  assert.deepEqual(itemTotals([{ quantity: 1, memberPriceCents: 0 }]), { original: null, member: 0, total: 0, unpriced: 0 });
  for (const quantity of [0, -1, 1.1, 2147483648]) assert.throws(() => itemTotals([{ quantity, unitPriceCents: 1 }]));
  assert.throws(() => itemTotals([{ quantity: 2, unitPriceCents: Number.MAX_SAFE_INTEGER }]));
  assert.throws(() => itemTotals([{ quantity: 1, unitPriceCents: 1.5 }]));
});
test('新录单使用商品汇总，缺报价可录单但不能付款，单价精度和总额溢出明确报错', () => {
  const draft = newDraft('2026-11-14'); draft.phone = '13800000000'; draft.fulfillmentType = 'PICKUP'; draft.items[0].name = '蛋糕';
  draft.totalAmount = '999';
  assert.equal(createOrderRequest(draft).request?.totalAmountCents, null);
  assert.equal(createOrderRequest({ ...draft, paymentMethod: 'CASH' }).request, null);
  draft.items[0].unitPrice = '10.01'; draft.items[0].quantity = '3';
  assert.equal(createOrderRequest(draft).request?.totalAmountCents, 3003);
  assert.equal(createOrderRequest(draft).request?.pricingMode, 'ITEM_SUM');
  assert.equal(createOrderRequest(draft).request?.memberAmountCents, null);
  draft.items[0].memberPrice = '0'; assert.equal(createOrderRequest({ ...draft, paymentMethod: 'CASH' }).request?.totalAmountCents, 0);
  draft.items[0].memberPrice = '0.001'; assert.ok(createOrderRequest(draft).errors['items.0.memberPrice']);
  draft.items[0].memberPrice = ''; draft.items[0].unitPrice = '90071992547409.91'; assert.ok(createOrderRequest(draft).errors.totalAmount);
  assert.equal(draftTotals([{ ...newItem(), unitPrice: '1.11', quantity: '2' }]).total, 222);
});
test('旧草稿与待确认请求不切换计价模式，新草稿持久化汇总模式', () => {
  const record = freshOrderDraft('a', '2026-11-14'); record.revision = 'r'; record.updatedAt = '2026-11-13T08:00:00Z';
  record.value.items[0].unitPrice = '199.';
  assert.equal(decodeOrderDraft(JSON.stringify(record), 'a')?.value.pricingMode, 'ITEM_SUM');
  assert.equal(decodeOrderDraft(JSON.stringify(record), 'a')?.value.items[0].unitPrice, '199.');
  record.value = structuredClone(record.value); delete record.value.pricingMode; delete record.initial.pricingMode;
  record.value.totalAmount = '88'; record.value.memberAmount = '0';
  const restored = decodeOrderDraft(JSON.stringify(record), 'a')!;
  assert.equal(restored.value.pricingMode, undefined); assert.equal(restored.value.totalAmount, '88'); assert.equal(restored.value.memberAmount, '0');
});
test('套餐自动合计、备注保留、重复添加合并；不同报价不合并；历史价差阻止带入', () => {
  const row = { ...newPackageItem(), name: '点心', specification: '少糖\n独立包装', quantity: '2', unitPrice: '10', memberPrice: '8' };
  const result = packageRequest('茶歇', [row], '999', '999'); assert.deepEqual(result.errors, {});
  assert.equal(result.body?.originalAmountCents, 2000); assert.equal(result.body?.memberAmountCents, 1600);
  const value: OrderPackage = { ...result.body!, id: 'p', version: 1, updatedAt: '' };
  const first = previewPackage(newDraft('2026-11-14'), value).next;
  assert.equal(first.items[0].attributes.requirements, row.specification); assert.equal(first.totalAmount, '20.00');
  const twice = previewPackage(first, value).next; assert.equal(twice.items.length, 1); assert.equal(twice.items[0].quantity, '4'); assert.equal(twice.memberAmount, '32.00');
  const changed: OrderPackage = { ...value, originalAmountCents: 2200, items: [{ ...value.items[0], unitPriceCents: 1100 }] };
  assert.equal(previewPackage(first, changed).next.items.length, 2);
  assert.ok(packagePricingProblem({ ...value, originalAmountCents: 999 }));
  assert.throws(() => previewPackage(first, { ...value, originalAmountCents: 999 }), /套餐管理/);
  const missing = { ...value, items: [{ ...value.items[0], unitPriceCents: null, memberPriceCents: null }] };
  assert.throws(() => previewPackage(first, missing), /套餐管理/);
});
