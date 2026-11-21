import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEmptyPackageDraft, newPackageItem, packageRequest, previewPackage } from '../src/orderPackages.ts';
import type { OrderPackage, PackageItem } from '../src/orderPackages.ts';
import { newDraft as newSumDraft, changeItemDraft, itemInput, migrateItemDraft, newItem } from '../src/orderForm.ts';

const newDraft = (date: string) => ({ ...newSumDraft(date), pricingMode: 'MANUAL' as const });
const product = (name = '纸杯蛋糕', specification = '香草\n六只装'): PackageItem => ({
  itemId: crypto.randomUUID(), imageId: crypto.randomUUID(), productType: 'OTHER', name, quantity: 6, attributes: { specification },
});
const template = (items = [product()]): OrderPackage => ({
  id: crypto.randomUUID(), version: 1, updatedAt: '', name: '茶歇', originalAmountCents: 20000, memberAmountCents: 18000, items,
});
test('空单带入模板金额、其他商品和图片来源，原草稿不变', () => {
  const draft = newDraft('2026-11-11'), value = template(), before = structuredClone(draft);
  assert(isEmptyPackageDraft(draft));
  const plan = previewPackage(draft, value);
  assert.equal(plan.next.items.length, 1);
  assert.equal(plan.next.items[0].productType, 'OTHER');
  assert.deepEqual(itemInput(plan.next.items[0]).item?.attributes, { requirements: '香草\n六只装' });
  assert.equal(plan.next.items[0].attributes.base, '');
  assert.equal(plan.imageSources.get(plan.next.items[0].key)?.imageId, value.items[0].imageId);
  assert.equal(plan.next.totalAmount, '200.00');
  assert.equal(plan.next.memberAmount, '180.00');
  assert.deepEqual(draft, before);
});
test('同款只合并首个其他商品，保留已有图，套餐原价及会员价按份累计', () => {
  const draft = newDraft('2026-11-11'), value = template();
  const first = previewPackage(draft, value).next.items[0];
  first.images = [{ id: 'customer', name: '客户参考图.png', type: 'image/png', size: 100 }];
  const cake = newItem();
  cake.name = first.name;
  cake.attributes.size = '6+8寸双层';
  draft.items = [first, { ...first, key: 'duplicate', quantity: '2' }, cake];
  draft.totalAmount = '100';
  const before = structuredClone(draft);
  const plan = previewPackage(draft, { ...value, items: [...value.items, product(first.name, '巧克力')] });
  assert.deepEqual(plan.next.items.map(item => item.quantity), ['12', '2', '1', '6']);
  assert.equal(plan.next.items[2].attributes.size, '6+8寸双层');
  assert.equal(plan.next.items[0].images?.[0].id, 'customer');
  assert.equal(plan.imageSources.has(first.key), false);
  assert.equal(plan.changes[0].index, 0);
  assert.equal(plan.changes[0].previousQuantity, 6);
  assert.equal(plan.next.totalAmount, '300.00');
  assert.equal(plan.next.memberAmount, '280.00');
  assert.deepEqual(draft, before);
});
test('空名称但有参考图的商品不会被替换，缺价、零价与溢出分别处理', () => {
  const draft = newDraft('2026-11-11'), value = { ...template(), originalAmountCents: null, memberAmountCents: null };
  draft.items[0].images = [{ id: 'original', name: 'reference.png', type: 'image/png', size: 10 }];
  assert(!isEmptyPackageDraft(draft));
  const filled = previewPackage(draft, value);
  assert.equal(filled.next.items[0].key, draft.items[0].key);
  assert.equal(filled.next.totalAmount, '');
  assert.equal(filled.next.memberAmount, '');
  const overflow = previewPackage({ ...draft, totalAmount: '90071992547409.91' }, template());
  assert.equal(overflow.next.totalAmount, '');
  assert.equal(overflow.next.memberAmount, '');
  const existing = filled.next.items[1];
  assert.throws(() => previewPackage({ ...filled.next, items: [{ ...existing, quantity: '2147483647' }] }, template()), /数量超过上限/);
});
test('套餐校验名称、数量和原价，套餐条目独立保存报价与备注', () => {
  const row = { ...newPackageItem(), name: '纸杯蛋糕', specification: '香草\n六只装' };
  assert.ok(packageRequest(' ', [row]).errors.name);
  assert.ok(packageRequest('套餐', []).errors.items);
  assert.ok(packageRequest('套餐', [{ ...row, name: '' }]).errors['items.0.name']);
  assert.equal(packageRequest('套餐', [row]).body?.originalAmountCents, null);
  for (const quantity of ['0', '-1', '1.2', '2147483648']) assert.ok(packageRequest('套餐', [{ ...row, quantity }], '10').errors['items.0.quantity']);
  assert.deepEqual(packageRequest(' 套餐 ', [row], '10.29', '0').body, {
    name: '套餐', originalAmountCents: 1029, memberAmountCents: 0,
    items: [{ itemId: row.itemId, imageId: null, unitPriceCents: null, memberPriceCents: null, name: '纸杯蛋糕', productType: 'OTHER', quantity: 1, attributes: { specification: '香草\n六只装' } }],
  });
});
test('旧草稿转换可重复执行，手动切换分类不会反向解析规格', () => {
  const old = { ...newItem(), productType: 'CUPCAKE', unitPrice: '10.29', memberPrice: '0',
    preservedAttributes: { decoration: { color: '粉色' } } };
  old.attributes.requirements = '少糖';
  const migrated = migrateItemDraft(old);
  assert.deepEqual(migrateItemDraft(migrated), migrated);
  assert.equal(migrated.productType, 'OTHER');
  assert.equal(migrated.attributes.requirements, '少糖');
  assert.doesNotMatch(migrated.attributes.specification, /原会员单价/);
  assert.equal(migrated.memberPrice, '0.00');
  assert.match(migrated.attributes.specification, /粉色/);
  const cake = changeItemDraft(migrated, { productType: 'CAKE' });
  assert.equal(cake.attributes.specification, migrated.attributes.specification);
  assert.equal(cake.attributes.requirements, '少糖');
});

test('套餐加购只在成交额改变时撤销付款，匹配商品的已有零价保留', () => {
  const value = template([{ ...product(), unitPriceCents: 1230, memberPriceCents: 900 }]);
  const draft = previewPackage(newDraft('2026-11-11'), value).next;
  draft.items[0].unitPrice = '0.00';
  draft.items[0].memberPrice = '';
  for (const method of ['UNIONPAY', 'MEMBER_CARD', 'BANK_TRANSFER', 'SERVICE_WECHAT', 'CASH', 'UNPAID']) {
    draft.paymentMethod = method;
    const add = previewPackage(draft, value);
    assert.equal(add.next.paymentMethod, 'UNPAID');
    assert.equal(add.resetPayment, method !== 'UNPAID');
    assert.equal(add.next.memberAmount, '360.00');
    assert.equal(add.next.items[0].unitPrice, '0.00');
    assert.equal(add.next.items[0].memberPrice, '');
    assert.equal(add.next.items.length, 2);
    assert.equal(add.next.items[1].memberPrice, '9.00');
    assert.equal(draft.paymentMethod, method);
    const free = previewPackage(draft, { ...value, originalAmountCents: 0, memberAmountCents: null });
    assert.equal(free.next.paymentMethod, method);
  }
});

test('缺少套餐总价时保留空白，缺数量在保存和带入合并时按一件', () => {
  const row = { ...newPackageItem(), name: '小卷', quantity: '', unitPrice: '6', memberPrice: '4' };
  const saved = packageRequest('茶歇', [row]);
  assert.equal(saved.body?.items[0].quantity, 1);
  const value = { ...template(saved.body!.items), originalAmountCents: null, memberAmountCents: null };
  const first = previewPackage(newDraft('2026-11-20'), value);
  assert.equal(first.next.totalAmount, '');
  assert.equal(first.next.memberAmount, '');
  first.next.items[0].quantity = '';
  const second = previewPackage(first.next, value, false);
  assert.equal(second.next.items[0].quantity, '2');
});
