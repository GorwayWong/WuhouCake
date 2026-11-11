import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changeItemDraft, itemInput, createOrderRequest, moneyToCents, newDraft, newItem, storeTime, validDate } from '../src/orderForm.ts';

test('切换分类保留参考报价，普通商品字段保持独立', () => {
  const cake = { ...newItem(), name: '生日蛋糕', unitPrice: '10.29', memberPrice: '0.00' };
  const other = changeItemDraft(cake, { productType: 'OTHER' });
  assert.equal(other.unitPrice, '10.29'); assert.equal(other.memberPrice, '0.00');
  assert.equal(itemInput(other).item?.unitPriceCents, null);
  assert.equal(changeItemDraft(other, { productType: 'CAKE' }).memberPrice, '0.00');
});

test('蛋糕空规格提交使用三个默认值，手工规格保持，非蛋糕不补齐', () => {
  const draft = newItem(); draft.name = '蛋糕';
  assert.equal(draft.attributes.flavor, '');
  for (const blank of ['', ' \t\n']) {
    draft.attributes.base = blank; draft.attributes.filling = blank; draft.attributes.flavor = blank;
    assert.deepEqual(itemInput(draft).item?.attributes, { base: '原味', filling: '芒果', flavor: '原味奶油' });
  }
  Object.assign(draft.attributes, { base: '巧克力', filling: '草莓', flavor: '巧克力奶油' });
  assert.deepEqual(itemInput(draft).item?.attributes, { base: '巧克力', filling: '草莓', flavor: '巧克力奶油' });
  const bread = changeItemDraft(newItem(), { productType: 'BREAD', name: '面包' });
  assert.deepEqual(itemInput(bread).item?.attributes, {});
});

test('收货日期必填、时刻可留空，取货同步旧字段并默认提前一小时出品', () => {
  const draft = newDraft('2026-10-25');
  draft.phone = '13800000000'; draft.address = '自提'; draft.items[0].name = '测试蛋糕';
  assert.equal(createOrderRequest(draft).request?.fulfillment.requestedReceiveAt, null);
  draft.requestedReceiveAt = '2026-10-25T18:30';
  assert.equal(createOrderRequest(draft).request?.fulfillment.requestedReceiveAt, '2026-10-25T18:30:00+08:00');
  assert.equal(createOrderRequest(draft).request?.fulfillment.plannedHandoffAt, '2026-10-25T18:30:00+08:00');
  assert.equal(createOrderRequest(draft).request?.fulfillment.plannedFinishAt, '2026-10-25T17:30:00+08:00');
  draft.requestedReceiveAt = '2026-10-25T18:';
  assert.ok(createOrderRequest(draft).errors.requestedReceiveAt);
});

test('手工新建请求不指定下单员工，由服务端使用当前登录员工', () => {
  const draft = newDraft('2026-11-03');
  draft.phone = '13800000000'; draft.address = '自提'; draft.items[0].name = '测试蛋糕';
  draft.creditedEmployeeId = '00000000-0000-0000-0000-000000000003';
  const { request, errors } = createOrderRequest(draft);
  assert.deepEqual(errors, {});
  assert.ok(request);
  assert.equal('creditedEmployeeId' in request, false);
});

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
  assert.equal(request.fulfillment.plannedHandoffAt, null);
  assert.equal(request.fulfillment.plannedFinishAt, null);
  assert.deepEqual(request.items.map(item => item.attributes), [{ size: '6', flavor: '芒果', base: '原味', filling: '芒果' }, { size: '8', flavor: '巧克力', base: '原味', filling: '芒果' }]);
  assert.equal(request.items[0].unitPriceCents, null);
  assert.equal(request.items[1].memberPriceCents, null);
  assert.equal(request.items[1].quantity, 2);
  assert.equal('key' in request.items[0], false);
  assert.equal('status' in request, false);
  assert.equal('paymentStatus' in request, false);
  draft.address = '';
  assert.ok(createOrderRequest(draft).errors.address);
  draft.address = '  自提  '; draft.totalAmount = '0';
  assert.equal(createOrderRequest(draft).request?.fulfillment.address, '自提');
  assert.equal(createOrderRequest(draft).request?.fulfillment.type, 'PICKUP');
  assert.equal(createOrderRequest(draft).request?.totalAmountCents, 0);
  draft.totalAmount = '320.50';
  assert.equal(createOrderRequest(draft).request?.totalAmountCents, 32050);
  draft.plannedHandoffAt = '';
  assert.deepEqual(createOrderRequest(draft).errors, {});
  assert.equal(createOrderRequest(draft).request?.fulfillment.plannedHandoffAt, null);
});

test('仅地址恰好为自提时使用自提方式，其他非空内容为配送，空白地址不可提交', () => {
  const draft = newDraft('2026-12-31');
  draft.phone = '13800000000'; draft.items[0].name = '测试蛋糕';
  for (const [address, type] of [['自提', 'PICKUP'], [' 自提 ', 'PICKUP'], ['合成路 1 号', 'DELIVERY'], ['不自提，送到公司', 'DELIVERY']]) {
    draft.address = address;
    assert.equal(createOrderRequest(draft).request?.fulfillment.type, type);
  }
  draft.address = '  ';
  assert.ok(createOrderRequest(draft).errors.address);
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

test('订购方式创建时选填、裁剪首尾空白及长度验证', () => {
  const draft = newDraft('2026-11-05');
  draft.phone = '13800000000'; draft.address = '自提'; draft.items[0].name = '蛋糕';
  assert.equal(createOrderRequest(draft).request?.orderingMethod, null);
  draft.orderingMethod = '  微信  ';
  assert.equal(createOrderRequest(draft).request?.orderingMethod, '微信');
  draft.orderingMethod = '长'.repeat(80);
  assert.equal(createOrderRequest(draft).request?.orderingMethod, draft.orderingMethod);
  draft.orderingMethod += '长'; assert.ok(createOrderRequest(draft).errors.orderingMethod);
});
