import assert from 'node:assert/strict';
import test from 'node:test';
import { firstItemFormError, firstProductFormError, productFormLabels, productFormRows } from '../src/productFormLayout.ts';

test('蛋糕字段按行排列，显示名称映射原字段，不混用文字规格', () => {
  assert.deepEqual(productFormRows('CAKE', true), [['name'], ['size', 'quantity'], ['unitPrice', 'memberPrice'], ['base', 'flavor'], ['filling'], ['message'], ['requirements'], ['specification']]);
  assert.equal(productFormLabels.size, '尺寸（寸）'); assert.equal(productFormLabels.base, '蛋糕胚');
  assert.deepEqual(productFormRows('DRINK', true), [['name'], ['quantity'], ['unitPrice', 'memberPrice'], ['specification'], ['requirements']]);
  assert.deepEqual(productFormRows('DRINK'), [['name'], ['quantity'], ['specification'], ['requirements']]);
});
test('错误定位按表单视觉顺序，商品分类和根字段保持优先', () => {
  assert.equal(firstItemFormError({ quantity: '数量错误', size: '规格错误' }, 'CAKE'), 'size');
  assert.equal(firstItemFormError({ size: '规格错误', name: '名称错误', productType: '分类错误' }, 'CAKE'), 'productType');
  const items = [{ productType: 'CAKE' }, { productType: 'DRINK' }];
  assert.equal(firstProductFormError({ 'items.1.unitPrice': '价格错误', 'items.0.quantity': '数量错误', 'items.0.size': '规格错误' }, items), 'items.0.size');
  assert.equal(firstProductFormError({ phone: '电话错误', 'items.0.size': '规格错误' }, items), 'phone');
  assert.equal(firstProductFormError({ 'items.0.quantity': '数量错误', 'items.0.size': '规格错误', totalAmount: '总额错误' }, items), 'items.0.size');
  assert.equal(firstProductFormError({}, items), undefined);
});
