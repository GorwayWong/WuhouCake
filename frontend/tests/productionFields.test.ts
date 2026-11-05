import test from 'node:test';
import assert from 'node:assert/strict';
import { productionCardFields } from '../src/productionFields.ts';

test('制作卡片只取传入商品规格，数字尺寸补寸，缺失字段明确待确认', () => {
  assert.deepEqual(productionCardFields({ productType: 'CAKE', attributes: { size: '6.5', base: '巧克力' } }), [['尺寸', '6.5 寸'], ['蛋糕胚', '巧克力']]);
  assert.deepEqual(productionCardFields({ productType: null, attributes: { size: ' ', base: null } }), [['尺寸', '尺寸待确认'], ['蛋糕胚', '蛋糕胚待确认']]);
  assert.deepEqual(productionCardFields(undefined), []);
});
test('历史规格可读展示且不覆写，非蛋糕仅展示自身规格', () => {
  const attributes = { size: '6寸/8寸双层', cakeBase: ['原味', '巧克力'] };
  assert.deepEqual(productionCardFields({ productType: 'CAKE', attributes }), [['尺寸', '6寸/8寸双层'], ['蛋糕胚', '原味、巧克力']]);
  assert.deepEqual(productionCardFields({ productType: 'CAKE', attributes: { size: 8, base: { 上层: '原味' } } }), [['尺寸', '8 寸'], ['蛋糕胚', '上层：原味']]);
  assert.deepEqual(attributes, { size: '6寸/8寸双层', cakeBase: ['原味', '巧克力'] });
  assert.deepEqual(productionCardFields({ productType: 'COOKIE', attributes: { specification: '12片装', base: '不展示', size: '6' } }), [['规格', '12片装']]);
  assert.deepEqual(productionCardFields({ productType: 'COOKIE', attributes: {} }), [['规格', '规格待确认']]);
});
