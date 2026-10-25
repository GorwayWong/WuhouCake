import test from 'node:test';
import assert from 'node:assert/strict';
import { amountInformationRequest, informationDraft, informationRequest } from '../src/orderForm.ts';
import type { Detail } from '../src/types.ts';

const order: Detail = {
  orderId: 'information-test', orderNo: '0000011', version: 2, status: 'WAITING_DELIVERY', paymentStatus: 'PAID', currentStageCode: 'LAYER_DONE',
  customer: { customerName: '合成客户', phone: '13800001111', memberPhone: '13800002222', buyerName: '合成前台' },
  fulfillment: { type: 'DELIVERY', address: '合成配送地址', requestedReceiveDate: '2026-10-14', plannedHandoffAt: '2026-10-14T16:15:27.123456Z', plannedFinishAt: '2026-10-14T10:00:30.987654Z' },
  totalAmountCents: 16800, createdAt: '2026-10-14T01:00:00Z', updatedAt: '2026-10-14T01:00:00Z', items: [],
};

test('独立金额编辑只提交金额，资料被裁剪也可以修改，保留未报价和零元', () => {
  const projected = { ...order, customer: null, fulfillment: { ...order.fulfillment, address: null } };
  assert.deepEqual(amountInformationRequest(projected, '280'), { request: { expectedVersion: 2, changes: { totalAmountCents: 28000 } }, errors: {} });
  assert.equal(amountInformationRequest(projected, '168').request, null);
  assert.deepEqual(amountInformationRequest(projected, '').request?.changes, { totalAmountCents: null });
  assert.deepEqual(amountInformationRequest(projected, '0').request?.changes, { totalAmountCents: 0 });
  for (const value of ['-1', '1.234', 'abc']) assert.ok(amountInformationRequest(projected, value).errors.totalAmount);
});
test('独立金额编辑复核最新版本后仍只提交金额，不改付款及他人资料', () => {
  const latest = { ...order, version: 3, paymentStatus: 'UNPAID', totalAmountCents: 20000 };
  assert.deepEqual(amountInformationRequest(order, '280', latest).request, { expectedVersion: 3, changes: { totalAmountCents: 28000 } });
  assert.equal(amountInformationRequest(order, '200', latest).request, null);
  assert.equal(amountInformationRequest(order, '168', latest).request, null);
});

test('未修改不发送 PATCH，电话更正只提交电话，格式变化不制造修改', () => {
  const draft = informationDraft(order);
  assert.deepEqual(informationRequest(order, draft), { request: null, errors: {} });
  draft.totalAmount = '168'; draft.customerName = ' 合成客户 ';
  assert.equal(informationRequest(order, draft).request, null);
  draft.phone = '13900003333';
  assert.deepEqual(informationRequest(order, draft).request, { expectedVersion: 2, changes: { phone: '13900003333' } });
});

test('UTC 资料按北京时间初始化，改期可只填日期，内部交接时间独立修改', () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    const draft = informationDraft(order);
    assert.equal(draft.plannedHandoffAt, '2026-10-15T00:15');
    assert.equal(draft.plannedFinishAt, '2026-10-14T18:00');
    draft.requestedReceiveDate = '2026-10-18'; draft.requestedReceiveAt = '2026-10-18';
    assert.deepEqual(informationRequest(order, draft).request?.changes, { requestedReceiveDate: '2026-10-18', requestedReceiveAt: null });
    draft.requestedReceiveAt = '2026-10-18T19:00';
    assert.deepEqual(informationRequest(order, draft).request?.changes, { requestedReceiveDate: '2026-10-18', requestedReceiveAt: '2026-10-18T19:00:00+08:00' });
    draft.requestedReceiveDate = order.fulfillment.requestedReceiveDate;
    draft.requestedReceiveAt = order.fulfillment.requestedReceiveDate;
    draft.plannedHandoffAt = '2026-10-15T00:30';
    assert.deepEqual(informationRequest(order, draft).request?.changes, { plannedHandoffAt: '2026-10-15T00:30:00+08:00' });
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
test('已有收货时刻可显式清空，未更正的精度不回写，时间与日期冲突被拒绝', () => {
  const timed: Detail = { ...order, fulfillment: { ...order.fulfillment, requestedReceiveAt: '2026-10-14T11:00:37.123456Z' } };
  const draft = informationDraft(timed); assert.equal(draft.requestedReceiveAt, '2026-10-14T19:00');
  assert.equal(informationRequest(timed, draft).request, null);
  draft.requestedReceiveAt = timed.fulfillment.requestedReceiveDate; assert.deepEqual(informationRequest(timed, draft).request?.changes, { requestedReceiveAt: null });
  draft.requestedReceiveAt = '2026-10-15T20:00'; draft.requestedReceiveDate = '2026-10-16';
  assert.ok(informationRequest(timed, draft).errors.requestedReceiveAt);
});

test('清空可选资料与金额使用 null，0 元独立保存，交接切换遵守地址约束', () => {
  const draft = informationDraft(order);
  draft.customerName = ''; draft.memberPhone = ''; draft.buyerName = ''; draft.plannedHandoffAt = ''; draft.plannedFinishAt = ''; draft.totalAmount = '';
  draft.fulfillmentType = 'PICKUP'; draft.address = '';
  assert.deepEqual(informationRequest(order, draft).request?.changes, { customerName: null, memberPhone: null, buyerName: null, address: null, fulfillmentType: 'PICKUP', plannedHandoffAt: null, plannedFinishAt: null, totalAmountCents: null });
  draft.totalAmount = '0';
  assert.equal(informationRequest(order, draft).request?.changes.totalAmountCents, 0);
  draft.fulfillmentType = 'DELIVERY';
  assert.ok(informationRequest(order, draft).errors.address);
  draft.address = '更正后的配送地址';
  assert.deepEqual(informationRequest(order, draft).errors, {});
});

test('冲突后保留员工输入，用复核版本只提交员工改过的字段，不回写他人资料', () => {
  const draft = informationDraft(order);
  draft.phone = '13900004444'; draft.totalAmount = '280';
  const snapshot = structuredClone(draft);
  const latest: Detail = { ...order, version: 3, customer: { ...order.customer, buyerName: '另一位员工更正', memberPhone: null }, fulfillment: { ...order.fulfillment, requestedReceiveDate: '2026-10-20', plannedHandoffAt: '2026-10-20T08:00:47.654321Z' } };
  assert.deepEqual(informationRequest(order, draft, latest).request, { expectedVersion: 3, changes: { phone: '13900004444', totalAmountCents: 28000 } });
  assert.deepEqual(draft, snapshot);
  assert.equal(informationRequest(order, draft, { ...latest, totalAmountCents: 28000, customer: { ...latest.customer, phone: draft.phone } }).request, null);
});
