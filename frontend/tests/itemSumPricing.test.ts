import assert from 'node:assert/strict';
import test from 'node:test';
import { itemTotals } from '../src/itemPricing.ts';
import { createOrderRequest, draftTotals, newDraft, newItem } from '../src/orderForm.ts';
import { freshOrderDraft, decodeOrderDraft } from '../src/orderDraftStorage.ts';
import { newPackageItem, packageRequest, previewPackage } from '../src/orderPackages.ts';
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
test('新订单采用手填总价，保留商品报价，缺成交金额只能录为未付', () => {
  const draft = newDraft('2026-11-14');
  draft.phone = '13800000000'; draft.fulfillmentType = 'PICKUP'; draft.items[0].name = '蛋糕';
  assert.equal(createOrderRequest(draft).request?.totalAmountCents, null);
  assert.ok(createOrderRequest({ ...draft, paymentMethod: 'CASH' }).errors.paymentMethod);
  draft.items[0].unitPrice = '10.01'; draft.items[0].quantity = '3';
  draft.totalAmount = '25'; draft.memberAmount = '0';
  const request = createOrderRequest({ ...draft, paymentMethod: 'CASH' }).request;
  assert.equal(request?.pricingMode, 'MANUAL');
  assert.equal(request?.originalAmountCents, 2500);
  assert.equal(request?.totalAmountCents, 0);
  assert.equal(request?.items[0].referenceUnitPriceCents, 1001);
  draft.items[0].memberPrice = '0.001'; assert.ok(createOrderRequest(draft).errors['items.0.memberPrice']);
  assert.equal(draftTotals([{ ...newItem(), unitPrice: '1.11', quantity: '2' }]).total, 222);
});
test('草稿保留手填金额；旧自动计价草稿恢复时将参考合计转为可编辑金额', () => {
  const record = freshOrderDraft('a', '2026-11-14');
  record.revision = 'r'; record.updatedAt = '2026-11-13T08:00:00Z';
  record.value.items[0].unitPrice = '199.';
  assert.equal(decodeOrderDraft(JSON.stringify(record), 'a')?.value.items[0].unitPrice, '199.');
  record.value.pricingMode = 'ITEM_SUM';
  record.value.items[0].unitPrice = '10.50';
  record.value.items[0].quantity = '2';
  const restored = decodeOrderDraft(JSON.stringify(record), 'a')!;
  assert.equal(restored.value.pricingMode, 'MANUAL');
  assert.equal(restored.value.totalAmount, '21.00');
  delete record.value.pricingMode; delete record.initial.pricingMode;
  record.value.totalAmount = '88'; record.value.memberAmount = '0';
  const legacy = decodeOrderDraft(JSON.stringify(record), 'a')!;
  assert.equal(legacy.value.totalAmount, '88'); assert.equal(legacy.value.memberAmount, '0');
});
test('套餐售价与明细独立，合并保留单价和备注，缺报价仍带入', () => {
  const row = { ...newPackageItem(), name: '点心', specification: '少糖\n独立包装', quantity: '2', unitPrice: '10', memberPrice: '8' };
  const result = packageRequest('茶歇', [row], '18', '15');
  assert.deepEqual(result.errors, {});
  assert.equal(result.body?.originalAmountCents, 1800); assert.equal(result.body?.memberAmountCents, 1500);
  const value: OrderPackage = { ...result.body!, id: 'p', version: 1, updatedAt: '' };
  const first = previewPackage(newDraft('2026-11-14'), value).next;
  assert.equal(first.items[0].attributes.requirements, row.specification); assert.equal(first.totalAmount, '18.00');
  const twice = previewPackage(first, value).next;
  assert.equal(twice.items[0].quantity, '4'); assert.equal(twice.memberAmount, '30.00');
  const retained = previewPackage(first, value, false).next;
  assert.equal(retained.items[0].quantity, '4'); assert.equal(retained.memberAmount, '15.00');
  const changed = { ...value, items: [{ ...value.items[0], unitPriceCents: 1100 }] };
  assert.equal(previewPackage(first, changed).next.items.length, 2);
  const missing = { ...value, originalAmountCents: null, memberAmountCents: null,
    items: [{ ...value.items[0], unitPriceCents: null, memberPriceCents: null }] };
  const unpriced = previewPackage(newDraft('2026-11-14'), missing).next;
  assert.equal(unpriced.items[0].name, '点心');
  assert.equal(unpriced.totalAmount, ''); assert.equal(unpriced.memberAmount, '');
});
