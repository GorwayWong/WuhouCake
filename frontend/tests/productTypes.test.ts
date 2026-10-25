import test from 'node:test';
import assert from 'node:assert/strict';
import { productTypes, productTypeLabel } from '../src/productTypes.ts';
import { changeItemDraft, itemInput, newItem } from '../src/orderForm.ts';

test('中文商品类型保持后台代码，非蛋糕不套用默认胚和夹馅', () => {
  assert.deepEqual(productTypes, { CAKE: '蛋糕', TEA_BREAK: '茶歇', COOKIE: '饼干', SNACK: '小吃', DRINK: '饮品', READY_BAKERY: '现货面包甜点' });
  for (const code of Object.keys(productTypes)) {
    const draft = changeItemDraft({ ...newItem(), name: '合成商品' }, { productType: code });
    assert.equal(itemInput(draft).item?.productType, code);
    assert.equal(productTypeLabel(code), productTypes[code]);
    assert.deepEqual(itemInput(draft).item?.attributes, code === 'CAKE' ? { base: '原味', filling: '芒果' } : {});
  }
  assert.equal(productTypeLabel('cake'), '蛋糕');
  assert.equal(productTypeLabel('OTHER'), '茶歇');
  assert.equal(productTypeLabel('旧商品分类'), '旧商品分类');
  assert.equal(itemInput({ ...newItem(), name: '旧商品', productType: '旧商品分类' }).item?.productType, '旧商品分类');
});
