import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOrderRequest, moneyToCents, newDraft, newItem, storeTime, validDate } from '../src/orderForm.ts';

test('人民币元准确转换整数分，空金额与零金额不同，非法金额不截断或舍入', () => {
  for (const [input, expected] of [['', null], ['  ', null], ['0', 0], ['0.00', 0], ['0.29', 29], ['12.3', 1230], ['001.01', 101], ['90071992547409.91', Number.MAX_SAFE_INTEGER]] as const) {
    assert.equal(moneyToCents(input), expected);
  }
  for (const input of ['-1', '1.001', '1e2', 'NaN', '1,000', '.5', '90071992547409.92']) assert.throws(() => moneyToCents(input));
});

test('门店时间显式携带 +08:00，跨 UTC 日期和运行环境时区仍保持输入含义', () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Shanghai']) {
      process.env.TZ = zone;
      assert.equal(storeTime('2026-10-14T00:15'), '2026-10-14T00:15:00+08:00');
      assert.equal(new Date(storeTime('2026-10-14T00:15')).toISOString(), '2026-10-13T16:15:00.000Z');
      assert.equal(storeTime('2024-02-29T23:59'), '2024-02-29T23:59:00+08:00');
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
  for (const input of ['', '2026-02-29T12:00', '2026-10-14T24:00', '2026-10-14T12:60']) assert.throws(() => storeTime(input));
  assert.equal(validDate('2024-02-29'), true);
  assert.equal(validDate('2026-02-29'), false);
});

test('多商品规格分别提交，报价不决定总额，配送和自提遵循现有创建契约', () => {
  const draft = newDraft('2026-10-14');
  draft.phone = ' 13800000000 ';
  draft.address = '合成测试地址';
  draft.plannedHandoffAt = '2026-10-15T09:00';
  draft.items[0].name = '蛋糕 A'; draft.items[0].unitPrice = '199';
  draft.items[0].attributes.size = '6'; draft.items[0].attributes.flavor = '芒果';
  const second = newItem(); second.name = '蛋糕 B'; second.quantity = '2'; second.memberPrice = '0';
  second.attributes.size = '8'; second.attributes.flavor = '巧克力';
  draft.items.push(second);
  const { request, errors } = createOrderRequest(draft);
  assert.deepEqual(errors, {});
  assert.ok(request);
  assert.equal(request.customer.phone, '13800000000');
  assert.equal(request.totalAmountCents, null);
  assert.equal(request.fulfillment.requestedReceiveDate, '2026-10-14');
  assert.equal(request.fulfillment.plannedHandoffAt, '2026-10-15T09:00:00+08:00');
  assert.equal(request.fulfillment.plannedFinishAt, null);
  assert.deepEqual(request.items.map(item => item.attributes), [{ size: '6', flavor: '芒果', base: '原味', filling: '芒果' }, { size: '8', flavor: '巧克力', base: '原味', filling: '芒果' }]);
  assert.equal(request.items[0].unitPriceCents, 19900);
  assert.equal(request.items[1].memberPriceCents, 0);
  assert.equal(request.items[1].quantity, 2);
  assert.equal('key' in request.items[0], false);
  assert.equal('status' in request, false);
  assert.equal('paymentStatus' in request, false);
  draft.address = '';
  assert.ok(createOrderRequest(draft).errors.address);
  draft.fulfillmentType = 'PICKUP'; draft.totalAmount = '0';
  assert.equal(createOrderRequest(draft).request?.fulfillment.address, null);
  assert.equal(createOrderRequest(draft).request?.totalAmountCents, 0);
  draft.totalAmount = '320.50';
  assert.equal(createOrderRequest(draft).request?.totalAmountCents, 32050);
  draft.plannedHandoffAt = '';
  assert.deepEqual(createOrderRequest(draft).errors, {});
  assert.equal(createOrderRequest(draft).request?.fulfillment.plannedHandoffAt, null);
});

test('空白必填项、无商品、非法数量与可选出品时间在提交前被阻止', () => {
  const draft = newDraft('2026-10-14');
  assert.ok(createOrderRequest(draft).errors.phone);
  assert.ok(createOrderRequest(draft).errors['items.0.name']);
  draft.phone = '13800000000'; draft.address = '测试地址'; draft.items[0].name = '测试蛋糕';
  draft.plannedHandoffAt = '2026-10-14T10:00';
  for (const quantity of ['', '0', '-1', '1.5', '1e2', '2147483648']) {
    draft.items[0].quantity = quantity;
    assert.ok(createOrderRequest(draft).errors['items.0.quantity']);
  }
  draft.items[0].quantity = '1'; draft.plannedFinishAt = '2026-02-30T09:00';
  assert.ok(createOrderRequest(draft).errors.plannedFinishAt);
  draft.plannedFinishAt = '2026-10-13T09:00';
  assert.equal(createOrderRequest(draft).request?.fulfillment.plannedFinishAt, '2026-10-13T09:00:00+08:00');
  draft.items = [];
  assert.ok(createOrderRequest(draft).errors.items);
});
