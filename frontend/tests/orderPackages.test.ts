import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendPackage, packageItems, newPackageItem, packageRequest } from '../src/orderPackages.ts';
import { newItem, fieldsForProduct } from '../src/orderForm.ts';
import { managementQuery, defaultManagementDraft } from '../src/management.ts';

test('fixed packages create editable independent items and preserve existing custom products', () => {
  const value = { id: 'package', name: '茶歇组合', items: [{ name: '面包', productType: 'BREAD', quantity: 6, attributes: { specification: '小份' } }, { name: '饮品', productType: 'DRINK', quantity: 6, attributes: { specification: '300ml' } }] };
  const result = appendPackage([newItem()], value);
  assert.equal(result.length, 2); assert.equal(result[0].attributes.specification, '小份');
  const second = appendPackage(result, value); assert.equal(second.length, 4);
  assert.notEqual(second[0].key, second[2].key);
  second[2].quantity = '12'; assert.equal(value.items[0].quantity, 6);
  assert.deepEqual(packageItems(result), value.items);
});
test('simple product forms expose specification without cake fields', () => {
  for (const type of ['BREAD', 'DONUT', 'CUPCAKE', 'DRINK']) assert.deepEqual(fieldsForProduct(type).map(([key]) => key), ['specification', 'requirements']);
  assert.ok(fieldsForProduct('CAKE').some(([key]) => key === 'size'));
});
test('package specifications remain optional and never include prices or customer data', () => {
  const draft = { ...newPackageItem(), name: '通用蛋糕', unitPrice: 'not a price', memberPrice: '999' };
  const result = packageRequest('  下午茶  ', [draft]);
  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.body, { name: '下午茶', items: [{ name: '通用蛋糕', productType: 'CAKE', quantity: 1, attributes: {} }] });
  draft.attributes.size = '8.00';
  assert.equal(packageItems([draft])[0].attributes.size, '8');
  draft.attributes.size = '8寸';
  assert.ok(packageRequest('下午茶', [draft]).errors['items.0.size']);
});
test('package validation identifies the exact missing or invalid field', () => {
  const item = { ...newPackageItem(), name: '蛋糕' };
  assert.ok(packageRequest(' ', [item]).errors.name);
  assert.ok(packageRequest('套餐', []).errors.items);
  assert.ok(packageRequest('套餐', [{ ...item, name: '' }]).errors['items.0.name']);
  assert.ok(packageRequest('套餐', [{ ...item, productType: '' }]).errors['items.0.productType']);
  for (const quantity of ['0', '-1', '1.2', '2147483648']) assert.ok(packageRequest('套餐', [{ ...item, quantity }]).errors['items.0.quantity']);
});
test('append preserves custom rows and quotes and creates independent copies on every application', () => {
  const value = { id: 'package', name: '蛋糕套餐', items: [{ name: '蛋糕', productType: 'CAKE', quantity: 1, attributes: { size: '8' } }] };
  const existing = { ...newItem(), name: '定制蛋糕', unitPrice: '168', memberPrice: '128' };
  const result = appendPackage([existing], value);
  assert.strictEqual(result[0], existing);
  assert.equal(result[0].unitPrice, '168'); assert.equal(result[1].unitPrice, ''); assert.equal(result[1].memberPrice, '');
  result[1].attributes.size = '10';
  assert.equal(value.items[0].attributes.size, '8');
  const repeated = appendPackage(result, value);
  assert.equal(repeated.length, 3); assert.notEqual(repeated[1].key, repeated[2].key);
  assert.equal(repeated[2].attributes.size, '8');
  assert.equal(appendPackage([{ ...newItem(), productType: 'DRINK' }], value).length, 2);
  assert.equal(appendPackage([{ ...newItem(), quantity: '2' }], value).length, 2);
});
test('all historical unpaid ignores the current date range and filters', () => {
  assert.equal(managementQuery({ ...defaultManagementDraft('2026-10-23'), from: '', keyword: '旧关键词', allUnpaid: true }), 'allUnpaid=true');
});
