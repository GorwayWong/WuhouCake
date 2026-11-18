import test from 'node:test';
import assert from 'node:assert/strict';
import { itemRequirement } from '../src/orderingRequirements.ts';

test('当前商品的特殊要求保留换行，兼容历史字段，清空后不恢复旧值', () => {
  assert.equal(itemRequirement({ requirements: ' 少糖\n不放坚果 ', otherRequirements: '旧要求' }), '少糖\n不放坚果');
  assert.equal(itemRequirement({ otherRequirements: '单独包装' }), '单独包装');
  assert.equal(itemRequirement({ requirements: '', otherRequirements: '旧要求' }), '');
  assert.equal(itemRequirement({ requirements: '  \n' }), '');
  assert.equal(itemRequirement({}), '');
});
