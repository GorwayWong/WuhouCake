import test from 'node:test';
import assert from 'node:assert/strict';
import { groupCakeBases } from '../src/cakeBaseSummary.ts';
test('按尺寸文本累加并保留不同写法和未填尺寸', () => {
  const groups = groupCakeBases([
    { size: '6+8寸双层', flavor: '抹茶', quantity: 3 }, { size: '6+8寸双层', flavor: '原味', quantity: 2 },
    { size: '8', flavor: '原味', quantity: 2 }, { size: '8.00', flavor: '巧克力', quantity: 4 },
    { size: null, flavor: '原味', quantity: 1 },
  ]);
  assert.deepEqual(groups.map(g => [g.size, g.quantity]), [['6+8寸双层', 5], ['8', 2], ['8.00', 4], [null, 1]]);
  assert.deepEqual(groups[0].flavors.map(r => [r.flavor, r.quantity]), [['抹茶', 3], ['原味', 2]]);
  for (const group of groups) assert.equal(group.quantity, group.flavors.reduce((sum, row) => sum + row.quantity, 0));
  assert.deepEqual(groupCakeBases([]), []);
});
