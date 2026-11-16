import test from 'node:test';
import assert from 'node:assert/strict';
import { productTypes, productTypeLabel } from '../src/productTypes.ts';
import { changeItemDraft, itemInput, newItem } from '../src/orderForm.ts';

test('中文商品类型保持后台代码，非蛋糕不套用默认胚和夹馅', () => {
  assert.deepEqual(productTypes, { CAKE: '蛋糕', OTHER: '其他' });
  for (const code of Object.keys(productTypes)) {
    const draft = changeItemDraft({ ...newItem(), name: '合成商品' }, { productType: code });
    assert.equal(itemInput(draft).item?.productType, code);
    assert.equal(productTypeLabel(code), productTypes[code]);
    assert.deepEqual(itemInput(draft).item?.attributes, code === 'CAKE' ? { base: '原味', filling: '芒果', flavor: '原味奶油' } : {});
  }
  assert.equal(productTypeLabel('cake'), '蛋糕');
  assert.equal(productTypeLabel('OTHER'), '其他');
  assert.equal(productTypeLabel('旧商品分类'), '旧商品分类');
  assert.equal(itemInput({ ...newItem(), name: '旧商品', productType: '旧商品分类' }).item?.productType, '旧商品分类');
});
