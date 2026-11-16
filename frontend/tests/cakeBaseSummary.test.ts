import test from 'node:test';
import assert from 'node:assert/strict';
import { groupCakeBases } from '../src/cakeBaseSummary.ts';
test('按数值尺寸合计并保留口味、小数尺寸与未填尺寸', () => {
  const groups = groupCakeBases([
    { size: '8', flavor: '抹茶', quantity: 3 }, { size: '6.00', flavor: '原味', quantity: 2 },
    { size: '8.00', flavor: '原味', quantity: 2 }, { size: null, flavor: '原味', quantity: 1 },
    { size: '6.5', flavor: '巧克力', quantity: 4 },
  ]);
  assert.deepEqual(groups.map(g => [g.size, g.quantity]), [['6', 2], ['6.5', 4], ['8', 5], [null, 1]]);
  assert.deepEqual(groups[2].flavors.map(r => [r.flavor, r.quantity]), [['抹茶', 3], ['原味', 2]]);
  for (const group of groups) assert.equal(group.quantity, group.flavors.reduce((sum, row) => sum + row.quantity, 0));
  assert.deepEqual(groupCakeBases([]), []);
});
