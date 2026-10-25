import test from 'node:test';
import assert from 'node:assert/strict';
import { draftFromSubmission, localTime, newSubmissionDraft, submissionRequest, submissionDirty } from '../src/customerSubmission.ts';
import { changeItemDraft } from '../src/orderForm.ts';
import type { Submission } from '../src/customerSubmission.ts';

function complete() {
  const draft = newSubmissionDraft(); draft.phone = '13800000000'; draft.memberPhone = '13800000088'; draft.address = '合成地址';
  draft.requestedReceiveAt = '2026-11-02T18:00'; draft.items[0].attributes.size = '8'; return draft;
}
test('核对草稿的总额、单价和会员价经过展示与保存仍逐分一致', () => {
  const draft = complete();
  draft.totalAmount = '90071992547409.90';
  draft.items[0].unitPrice = '90071992547409.71';
  draft.items[0].memberPrice = '0.29';
  const saved = submissionRequest(draft, true);
  assert.deepEqual(saved.errors, {});
  const reopened = draftFromSubmission({ original: saved.content, reviewed: saved.review } as Submission);
  assert.equal(reopened.totalAmount, draft.totalAmount);
  assert.equal(reopened.items[0].unitPrice, draft.items[0].unitPrice);
  assert.equal(reopened.items[0].memberPrice, draft.items[0].memberPrice);
  assert.deepEqual(submissionRequest(reopened, true).review, saved.review);
});
test('客户请求不含价格、归属和内部交接时间，蛋糕默认规格映射正确', () => {
  const draft = complete(); draft.totalAmount = '123'; draft.creditedEmployeeId = 'employee'; draft.plannedHandoffAt = '2026-11-02T16:00'; draft.items[0].unitPrice = '123';
  const result = submissionRequest(draft);
  assert.deepEqual(result.errors, {}); assert.equal(result.content.items[0].attributes.base, '原味'); assert.equal(result.content.items[0].attributes.filling, '芒果');
  assert.equal(result.content.requestedReceiveAt, '2026-11-02T10:00:00.000Z'); assert.notEqual(result.content.phone, result.content.memberPhone);
  assert.equal('unitPriceCents' in result.content.items[0], false); assert.equal('creditedEmployeeId' in result.content, false); assert.equal('totalAmountCents' in result.content, false);
});
test('日期和时刻、配送地址及蛋糕尺寸必填，自提和非蛋糕不强制这些规格', () => {
  const empty = newSubmissionDraft(); assert.ok(submissionRequest(empty).errors.requestedReceiveAt); assert.ok(submissionRequest(empty).errors['items.0.size']);
  const draft = complete(); draft.fulfillmentType = 'PICKUP'; draft.address = '';
  draft.items[0] = changeItemDraft(draft.items[0], { productType: 'DONUT', name: '甜甜圈', quantity: '6', attributes: { ...draft.items[0].attributes, size: '' } });
  const result = submissionRequest(draft); assert.deepEqual(result.errors, {}); assert.equal(result.content.items[0].attributes.base, undefined); assert.equal(result.content.items[0].attributes.filling, undefined);
  draft.requestedReceiveAt = '2026-02-30T18:00'; assert.ok(submissionRequest(draft).errors.requestedReceiveAt);
});
test('核对信息保留客户期望时间和内部时间，空报价与零元有区别', () => {
  const draft = complete(); let result = submissionRequest(draft, true); assert.equal(result.review.totalAmountCents, null); assert.equal(result.review.creditedEmployeeId, null);
  assert.deepEqual(result.errors, {}); assert.equal(result.review.plannedHandoffAt, null);
  draft.plannedHandoffAt = '2026-11-02T16:';
  assert.ok(submissionRequest(draft, true).errors.plannedHandoffAt);
  draft.totalAmount = '0'; draft.plannedHandoffAt = '2026-11-02T16:00'; draft.plannedFinishAt = '2026-11-02T15:00'; draft.creditedEmployeeId = 'employee';
  result = submissionRequest(draft, true); assert.equal(result.review.totalAmountCents, 0); assert.notEqual(result.content.requestedReceiveAt, result.review.plannedHandoffAt);
  const roundtrip = draftFromSubmission({ original: result.content, reviewed: result.review } as Submission);
  assert.equal(roundtrip.totalAmount, '0.00'); assert.equal(roundtrip.requestedReceiveAt, draft.requestedReceiveAt); assert.equal(roundtrip.plannedHandoffAt, draft.plannedHandoffAt); assert.equal(roundtrip.plannedFinishAt, draft.plannedFinishAt);
  assert.equal(localTime('2026-11-01T16:30:00Z'), '2026-11-02T00:30');
});
test('仅改会员电话、商品数量或祝福语也属于未提交输入，电话格式与服务端一致', () => {
  const initial = newSubmissionDraft(); assert.equal(submissionDirty(initial, initial), false);
  assert.equal(submissionDirty({ ...initial, memberPhone: '13800000000' }, initial), true);
  assert.equal(submissionDirty({ ...initial, items: [{ ...initial.items[0], quantity: '2' }] }, initial), true);
  assert.equal(submissionDirty({ ...initial, items: [{ ...initial.items[0], attributes: { ...initial.items[0].attributes, message: '生日快乐' } }] }, initial), true);
  const draft = complete(); draft.phone = '138 0000-0000'; assert.equal(submissionRequest(draft).content.phone, '13800000000');
  draft.phone = 'abc'; assert.ok(submissionRequest(draft).errors.phone);
});
