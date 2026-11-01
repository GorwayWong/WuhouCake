import assert from 'node:assert/strict';
import test from 'node:test';
import { itemKeyForField, selectItemAfterChange, summarizeItemPrices } from '../src/orderItemView.ts';
import { exactYuan } from '../src/money.ts';

const items = (...keys: string[]) => keys.map(key => ({ key }));
const price = (quantity: string, unitPrice: string, memberPrice: string) => ({ quantity, unitPrice, memberPrice });

test('保留当前商品；手工新增和套餐追加选中首个新商品', () => {
  assert.equal(selectItemAfterChange(items('a','b'), items('a','b'), 'b'), 'b');
  assert.equal(selectItemAfterChange(items('a','b'), items('a','b','c'), 'a'), 'c');
  assert.equal(selectItemAfterChange(items('a','b'), items('a','b','c','d'), 'b'), 'c');
});
test('删除中间项选择下一项，删除末项选择前一项，识别替换与撤销不留下失效key', () => {
  assert.equal(selectItemAfterChange(items('a','b','c'), items('a','c'), 'b'), 'c');
  assert.equal(selectItemAfterChange(items('a','b','c'), items('a','b'), 'c'), 'b');
  assert.equal(selectItemAfterChange(items('a','b'), items('x','y'), 'b'), 'x');
  assert.equal(selectItemAfterChange(items('x','y'), items('a','b'), 'y', false), 'a');
  assert.equal(selectItemAfterChange(items('x'), items('a','x'), 'x', false), 'x');
});
test('错误与识别字段定位到实际商品，非商品字段不改变选择', () => {
  assert.equal(itemKeyForField(items('a','b','c'), 'items.2.quantity'), 'c');
  assert.equal(itemKeyForField(items('a','c'), 'items.1.name'), 'c');
  assert.equal(itemKeyForField(items('a'), 'items.2.name'), undefined);
  assert.equal(itemKeyForField(items('a'), 'phone'), undefined);
});
test('详情刷新保持稳定商品ID，协作新增不抢当前项，当前项删除选择邻项', () => {
  assert.equal(selectItemAfterChange(items('a','b'), items('b','a'), 'b', false), 'b');
  assert.equal(selectItemAfterChange(items('a','b'), items('a','b','c'), 'b', false), 'b');
  assert.equal(selectItemAfterChange(items('a','b','c'), items('a','c'), 'b', false), 'c');
  assert.equal(selectItemAfterChange(items('a','b','c'), items('a','b'), 'c', false), 'b');
  assert.equal(selectItemAfterChange(items('a','b'), items('a','b','c'), 'c', false), 'c');
});
test('两类单价独立乘以数量求和，输入不被修改', () => {
  const draft = [price('3','20','18'), price('2','0.10','0.09')];
  const original = structuredClone(draft), result = summarizeItemPrices(draft);
  assert.equal(result.regular.cents, 6020n); assert.equal(result.member.cents, 5418n);
  assert.equal(exactYuan(String(result.regular.cents)), '60.20');
  assert.deepEqual(draft, original);
});
test('缺失价格独立提示并计算已填写部分，会员价不回退普通价', () => {
  const result = summarizeItemPrices([price('2','20',''), price('3','','10')]);
  assert.deepEqual(result.regular, { cents:4000n,included:1,missing:1,invalid:0 });
  assert.deepEqual(result.member, { cents:3000n,included:1,missing:1,invalid:0 });
});
test('全空价格与明确零元区分，空商品列表没有可展示合计', () => {
  assert.equal(summarizeItemPrices([price('1','','')]).regular.included, 0);
  assert.deepEqual(summarizeItemPrices([price('3','0','0.00')]).member, { cents:0n,included:1,missing:0,invalid:0 });
  assert.equal(summarizeItemPrices([]).regular.included, 0);
});
test('编辑中的无效数量或价格暂不计入，合法的另一种价格仍参与计算', () => {
  const result = summarizeItemPrices([price('','20','18'),price('2','1.','1.25'),price('0','2',''),price('2','3','4')]);
  assert.deepEqual(result.regular, { cents:600n,included:1,missing:0,invalid:3 });
  assert.deepEqual(result.member, { cents:1050n,included:2,missing:1,invalid:2 });
  for(const quantity of ['-1','1.5','2147483648','abc']) assert.equal(summarizeItemPrices([price(quantity,'1','1')]).regular.invalid, 1);
});
test('大数量和多项合计超过安全整数时保持精确，非法单价独立排除', () => {
  const result = summarizeItemPrices([price('2147483647','90071992547409.91','0'),price('2147483647','90071992547409.91','')]);
  assert.equal(result.regular.cents, 9007199254740991n * 2147483647n * 2n);
  assert.equal(exactYuan(String(result.regular.cents)), '386856262096537307861483.54');
  assert.equal(summarizeItemPrices([price('1','90071992547409.92','0')]).regular.invalid, 1);
});
