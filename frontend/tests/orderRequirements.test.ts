import test from 'node:test';
import assert from 'node:assert/strict';
import { orderRequirements } from '../src/orderingRequirements.ts';

test('下单备注只读取当前商品其他要求，不混入工作沟通记录', () => {
  const item = { itemId: 'a', name: '生日蛋糕', attributes: { requirements: '少糖\n不放坚果' }, recentNotes: [{ content: '交接给晚班' }] };
  assert.deepEqual(orderRequirements([item]), [{ itemId: 'a', name: '生日蛋糕', text: '少糖\n不放坚果' }]);
  assert.equal(orderRequirements([{ ...item, attributes: { requirements: '顾客已改为正常糖' } }])[0].text, '顾客已改为正常糖');
});

test('多商品分别标识，空值显示无，清空后的规范字段不回退旧要求', () => {
  const make = (itemId: string, attributes: Record<string, unknown>) => ({ itemId, name: itemId, attributes });
  assert.deepEqual(orderRequirements([make('a', {}), make('b', { requirements: '  \n' }), make('c', { otherRequirements: '单独包装' }), make('d', { requirements: '', otherRequirements: '旧要求' })]).map(item => item.text), ['无', '无', '单独包装', '无']);
  assert.deepEqual(orderRequirements([]), []);
});
