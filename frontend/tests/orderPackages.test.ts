import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEmptyPackageDraft, newPackageItem, packageRequest, previewPackage } from '../src/orderPackages.ts';
import type { OrderPackage, PackageItem } from '../src/orderPackages.ts';
import { newDraft, changeItemDraft, migrateItemDraft, newItem } from '../src/orderForm.ts';

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
  assert.equal(plan.next.items[0].attributes.specification, '香草\n六只装');
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
  draft.items = [first, { ...first, key: 'duplicate', quantity: '2' }, { ...newItem(), name: first.name }];
  draft.totalAmount = '100';
  const before = structuredClone(draft);
  const plan = previewPackage(draft, { ...value, items: [...value.items, product(first.name, '巧克力')] });
  assert.deepEqual(plan.next.items.map(item => item.quantity), ['12', '2', '1', '6']);
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
  assert.throws(() => previewPackage(draft, value), /当前订单原价/);
  assert.throws(() => previewPackage(draft, value, '0'), /此套餐原价/);
  const filled = previewPackage(draft, value, '0', '0');
  assert.equal(filled.next.items[0].key, draft.items[0].key);
  assert.equal(filled.next.totalAmount, '0.00');
  assert.equal(filled.next.memberAmount, '');
  assert.throws(() => previewPackage({ ...draft, totalAmount: '90071992547409.91' }, template()), /累计金额过大/);
  const existing = filled.next.items[1];
  assert.throws(() => previewPackage({ ...filled.next, items: [{ ...existing, quantity: '2147483647' }] }, template()), /数量超过上限/);
});
test('套餐校验名称、数量和原价，套餐条目无蛋糕字段或商品报价', () => {
  const row = { ...newPackageItem(), name: '纸杯蛋糕', specification: '香草\n六只装' };
  assert.ok(packageRequest(' ', [row]).errors.name);
  assert.ok(packageRequest('套餐', []).errors.items);
  assert.ok(packageRequest('套餐', [{ ...row, name: '' }]).errors['items.0.name']);
  assert.ok(packageRequest('套餐', [row]).errors.original);
  for (const quantity of ['0', '-1', '1.2', '2147483648']) assert.ok(packageRequest('套餐', [{ ...row, quantity }], '10').errors['items.0.quantity']);
  assert.deepEqual(packageRequest(' 套餐 ', [row], '10.29', '0').body, {
    name: '套餐', originalAmountCents: 1029, memberAmountCents: 0,
    items: [{ itemId: row.itemId, imageId: null, name: '纸杯蛋糕', productType: 'OTHER', quantity: 1, attributes: { specification: '香草\n六只装' } }],
  });
});
test('旧草稿转换可重复执行，手动切换分类不会反向解析规格', () => {
  const old = { ...newItem(), productType: 'CUPCAKE', unitPrice: '10.29', memberPrice: '0',
    preservedAttributes: { decoration: { color: '粉色' } } };
  old.attributes.requirements = '少糖';
  const migrated = migrateItemDraft(old);
  assert.deepEqual(migrateItemDraft(migrated), migrated);
  assert.equal(migrated.productType, 'OTHER');
  assert.match(migrated.attributes.specification, /特殊要求：少糖/);
  assert.match(migrated.attributes.specification, /原会员单价：0 元/);
  assert.match(migrated.attributes.specification, /粉色/);
  const cake = changeItemDraft(migrated, { productType: 'CAKE' });
  assert.equal(cake.attributes.specification, migrated.attributes.specification);
  assert.equal(cake.attributes.requirements, '');
});
