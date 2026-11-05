import test from 'node:test';
import assert from 'node:assert/strict';
import { orderingMethods, customOrderingMethod, orderingMethodError } from '../src/orderingMethod.ts';
import { defaultManagementDraft, managementQuery } from '../src/management.ts';
import { createOrderRequest, newDraft } from '../src/orderForm.ts';

test('下单方式常用值、自定义值和历史值保持原文，其他空白不能提交', () => {
  for (const orderingMethod of orderingMethods) assert.equal(customOrderingMethod({ orderingMethod }), false);
  assert.equal(customOrderingMethod({ orderingMethod: ' 微信 ' }), true);
  assert.equal(customOrderingMethod({ orderingMethod: '', orderingMethodCustom: true }), true);
  assert.ok(orderingMethodError({ orderingMethodCustom: true, orderingMethod: '　 ' }));
  assert.equal(orderingMethodError({ orderingMethod: '长'.repeat(80) }), undefined);
  assert.ok(orderingMethodError({ orderingMethod: '长'.repeat(81) }));
  const draft = { ...newDraft('2026-11-05'), orderingMethodCustom: true };
  assert.ok(createOrderRequest(draft).errors.orderingMethod);
});
test('查询方式与其他条件独立、兼容旧视图，快捷模式忽略该条件', () => {
  const draft = defaultManagementDraft('2026-11-05');
  assert.equal(new URLSearchParams(managementQuery(draft)).has('orderingMethod'), false);
  for (const orderingMethod of [...orderingMethods, " 微信%_'\\ "]) {
    const query = new URLSearchParams(managementQuery({ ...draft, orderingMethod, productName: '蛋糕', keyword: '139' }));
    assert.equal(query.get('orderingMethod'), orderingMethod.trim());
    assert.equal(query.get('productName'), '蛋糕'); assert.equal(query.get('keyword'), '139');
    assert.equal(query.has('orderingMethodCustom'), false);
  }
  assert.throws(() => managementQuery({ ...draft, orderingMethodCustom: true }));
  assert.throws(() => managementQuery({ ...draft, orderingMethod: '长'.repeat(81) }));
  assert.equal(managementQuery({ ...draft, orderingMethodCustom: true, allUnpaid: true }), 'allUnpaid=true');
});
