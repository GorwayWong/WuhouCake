import assert from 'node:assert/strict';
import test from 'node:test';
import { itemKeyForField, selectItemAfterChange } from '../src/orderItemView.ts';

const items = (...keys: string[]) => keys.map(key => ({ key }));
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
