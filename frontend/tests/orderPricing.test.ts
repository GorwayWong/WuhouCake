import assert from 'node:assert/strict';
import test from 'node:test';
import { effectiveOrderAmount, paymentMethods, paymentMethodLabel } from '../src/orderPayment.ts';
import { createOrderRequest, newDraft, informationDraft, amountInformationRequest } from '../src/orderForm.ts';
import { decodeOrderDraft, freshOrderDraft } from '../src/orderDraftStorage.ts';
import type { Detail } from '../src/types.ts';

test('整单原价与会员价精确到分，零元会员价优先，支付方式独立于商品价格', () => {
  const draft = { ...newDraft('2026-11-09'), phone: '13800000000', address: '自提', totalAmount: '158.01', memberAmount: '128.02', paymentMethod: 'MEMBER_CARD' };
  draft.items[0].name = '蛋糕';
  const result = createOrderRequest(draft);
  assert.deepEqual(result.errors, {});
  assert.equal(result.request?.originalAmountCents, 15801); assert.equal(result.request?.memberAmountCents, 12802);
  assert.equal(result.request?.totalAmountCents, 12802); assert.equal(result.request?.paymentMethod, 'MEMBER_CARD');
  assert.equal(createOrderRequest({ ...draft, memberAmount: '0' }).request?.totalAmountCents, 0);
  assert.equal(createOrderRequest({ ...draft, memberAmount: '' }).request?.totalAmountCents, 15801);
  assert.ok(createOrderRequest({ ...draft, memberAmount: '1.001' }).errors.memberAmount);
  assert.ok(createOrderRequest({ ...draft, paymentMethod: 'OTHER' }).errors.paymentMethod);
  assert.equal(effectiveOrderAmount(null, 0), 0);
  assert.equal(paymentMethodLabel(null, 'PAID'), '已付款（方式未记录）');
  assert.equal(Object.keys(paymentMethods).length, 6);
});
test('原价会员价和支付方式随草稿恢复，旧草稿与旧待确认载荷保持原状', () => {
  const record = freshOrderDraft('alice', '2026-11-09'); record.revision = 'r'; record.updatedAt = '2026-11-08T00:00:00Z';
  record.value.memberAmount = '0'; record.value.paymentMethod = 'CASH';
  const decoded = decodeOrderDraft(JSON.stringify(record), 'alice')!;
  assert.equal(decoded.value.memberAmount, '0'); assert.equal(decoded.value.paymentMethod, 'CASH');
  delete record.initial.memberAmount; delete record.initial.paymentMethod; delete record.value.memberAmount; delete record.value.paymentMethod;
  assert.ok(decodeOrderDraft(JSON.stringify(record), 'alice'));
});
test('更正原价时不覆盖未编辑的会员价，清空会员价只提交该字段', () => {
  const detail = { version: 2, customer: { phone: '13800000000' }, orderingMethod: null,
    fulfillment: { type: 'PICKUP', requestedReceiveDate: '2026-11-09' }, totalAmountCents: 12800,
    originalAmountCents: 15800, memberAmountCents: 12800 } as Detail;
  assert.equal(informationDraft(detail).totalAmount, '158.00');
  assert.deepEqual(amountInformationRequest(detail, '168', detail, '128.00').request?.changes, { originalAmountCents: 16800 });
  assert.deepEqual(amountInformationRequest(detail, '158.00', detail, '').request?.changes, { memberAmountCents: null });
});
