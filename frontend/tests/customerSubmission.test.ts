import test from 'node:test';
import assert from 'node:assert/strict';
import { draftFromSubmission, localTime, newSubmissionDraft, submissionRequest, submissionDirty, overdueSubmissionDate } from '../src/customerSubmission.ts';
import { changeItemDraft } from '../src/orderForm.ts';
import type { Submission } from '../src/customerSubmission.ts';

function complete() {
  const draft = newSubmissionDraft(); draft.phone = '13800000000'; draft.memberPhone = '13800000088'; draft.address = '合成地址';
  draft.requestedReceiveAt = '2026-11-02T18:00'; draft.items[0].attributes.size = '8'; return draft;
}
test('核对草稿只保存整单金额，重新打开仍逐分一致', () => {
  const draft = complete();
  draft.items[0] = changeItemDraft(draft.items[0], { productType: 'DRINK' });
  draft.totalAmount = '90071992547409.90';
  draft.items[0].unitPrice = '90071992547409.71';
  draft.items[0].memberPrice = '0.29';
  const saved = submissionRequest(draft, true);
  assert.deepEqual(saved.errors, {});
  const reopened = draftFromSubmission({ original: saved.content, reviewed: saved.review } as Submission);
  assert.equal(reopened.totalAmount, draft.totalAmount);
  assert.equal(reopened.items[0].unitPrice, '');
  assert.equal(reopened.items[0].memberPrice, '');
  assert.deepEqual(submissionRequest(reopened, true).review, saved.review);
});
test('客户请求不含价格、归属和内部交接时间，蛋糕默认规格映射正确', () => {
  const draft = complete(); draft.totalAmount = '123'; draft.creditedEmployeeId = 'employee'; draft.plannedHandoffAt = '2026-11-02T16:00'; draft.items[0].unitPrice = '123';
  const result = submissionRequest(draft);
  assert.deepEqual(result.errors, {}); assert.equal(result.content.items[0].attributes.base, '原味'); assert.equal(result.content.items[0].attributes.filling, '芒果');
  assert.equal(result.content.items[0].attributes.flavor, '原味动物奶油');
  assert.equal(result.content.requestedReceiveAt, '2026-11-02T10:00:00.000Z'); assert.notEqual(result.content.phone, result.content.memberPhone);
  assert.equal('unitPriceCents' in result.content.items[0], false); assert.equal('itemId' in result.content.items[0], false); assert.equal('creditedEmployeeId' in result.content, false); assert.equal('totalAmountCents' in result.content, false);
});
test('日期和时刻、配送地址及蛋糕尺寸必填，自提和非蛋糕不强制这些规格', () => {
  const empty = newSubmissionDraft(); assert.ok(submissionRequest(empty).errors.requestedReceiveAt); assert.ok(submissionRequest(empty).errors['items.0.size']);
  const draft = complete(); draft.fulfillmentType = 'PICKUP'; draft.address = '';
  draft.items[0] = changeItemDraft(draft.items[0], { productType: 'DONUT', name: '甜甜圈', quantity: '6', attributes: { ...draft.items[0].attributes, size: '' } });
  const result = submissionRequest(draft); assert.deepEqual(result.errors, {}); assert.equal(result.content.items[0].attributes.base, undefined); assert.equal(result.content.items[0].attributes.filling, undefined);
  draft.requestedReceiveAt = '2026-02-30T18:00'; assert.ok(submissionRequest(draft).errors.requestedReceiveAt);
});
test('核对只有一个取货时间，兼容字段同步，出品默认提前一小时', () => {
  const draft = complete(); let result = submissionRequest(draft, true);
  assert.deepEqual(result.errors, {}); assert.equal(result.review.totalAmountCents, null);
  assert.equal(result.review.plannedHandoffAt, result.content.requestedReceiveAt);
  assert.equal(result.review.plannedFinishAt, '2026-11-02T09:00:00.000Z');
  draft.totalAmount = '0'; draft.plannedFinishAt = '2026-11-02T15:00'; draft.finishTimeMode = 'MANUAL'; draft.creditedEmployeeId = 'employee';
  result = submissionRequest(draft, true); assert.equal(result.review.totalAmountCents, 0);
  const roundtrip = draftFromSubmission({ original: result.content, reviewed: result.review } as Submission);
  assert.equal(roundtrip.totalAmount, '0.00'); assert.equal(roundtrip.requestedReceiveAt, draft.requestedReceiveAt);
  assert.equal(roundtrip.plannedFinishAt, draft.plannedFinishAt); assert.equal(roundtrip.finishTimeMode, 'MANUAL');
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

test('历史核对优先取货，未修改时间时保存保留原字段，改取货才同步', () => {
  const original = submissionRequest(complete()).content;
  const review = { ...submissionRequest(complete(), true).review, plannedHandoffAt: '2026-11-01T16:30:27.123456Z' };
  const draft = draftFromSubmission({ original, reviewed: review } as Submission);
  assert.equal(draft.requestedReceiveAt, '2026-11-02T00:30');
  draft.phone = '13900000000';
  const unchanged = submissionRequest(draft, true);
  assert.equal(unchanged.review.plannedHandoffAt, review.plannedHandoffAt);
  assert.equal(unchanged.content.requestedReceiveAt, review.content.requestedReceiveAt);
  draft.requestedReceiveAt = '2026-11-03T18:00';
  const changed = submissionRequest(draft, true);
  assert.equal(changed.review.plannedHandoffAt, '2026-11-03T10:00:00.000Z');
  assert.equal(changed.content.requestedReceiveAt, changed.review.plannedHandoffAt);
});

test('待确认填单按北京时间日期提醒，核对日期优先', () => {
  const original = submissionRequest(complete()).content;
  const sample = { status: 'PENDING', original: { ...original, requestedReceiveAt: '2026-11-01T15:30:00Z' }, reviewed: null } as Submission;
  assert.equal(overdueSubmissionDate(sample, '2026-11-02'), '2026-11-01');
  assert.equal(overdueSubmissionDate(sample, '2026-11-01'), null);
  assert.equal(overdueSubmissionDate(sample, '2026-10-31'), null);
  const midnight = { ...sample, original: { ...original, requestedReceiveAt: '2026-11-01T16:30:00Z' } };
  assert.equal(overdueSubmissionDate(midnight, '2026-11-02'), null);
  const review = submissionRequest(complete(), true).review;
  assert.equal(overdueSubmissionDate({ ...sample, reviewed: review }, '2026-11-02'), null);
  assert.equal(overdueSubmissionDate({ ...midnight, reviewed: { ...review, plannedHandoffAt: null, content: sample.original } }, '2026-11-02'), '2026-11-01');
  for (const status of ['CONFIRMED', 'DELETED'] as const) assert.equal(overdueSubmissionDate({ ...sample, status }, '2026-11-02'), null);
});

test('新关键词跨状态搜索，同关键词保留所选状态，清除回到待确认并重置页码', async () => {
  const { searchSubmissionView, submissionListQuery } = await import('../src/customerSubmission.ts');
  const initial = { mine: true, status: 'PENDING' as const, keyword: '', page: 4 };
  const searched = searchSubmissionView(initial, ' 138 0000-1234 ');
  assert.deepEqual(searched, { mine: true, status: 'ALL', keyword: '138 0000-1234', page: 1 });
  assert.equal(searchSubmissionView({ ...searched, status: 'CONFIRMED' }, searched.keyword).status, 'CONFIRMED');
  assert.equal(searchSubmissionView({ ...searched, status: 'CONFIRMED' }, '4444').status, 'ALL');
  assert.deepEqual(searchSubmissionView(searched, ''), { ...initial, page: 1 });
  const params = new URLSearchParams(submissionListQuery(searched));
  assert.equal(params.get('keyword'), '138 0000-1234'); assert.equal(params.get('mine'), 'true'); assert.equal(params.get('status'), 'ALL');
});

test('客户奶油留空使用原味动物奶油，明确填写与员工核对值保留', () => {
  const draft = complete();
  draft.items[0].attributes.flavor = '   ';
  assert.equal(submissionRequest(draft).content.items[0].attributes.flavor, '原味动物奶油');
  assert.equal(submissionRequest(draft, true).content.items[0].attributes.flavor, '原味奶油');
  draft.items[0].attributes.flavor = '巧克力动物奶油';
  assert.equal(submissionRequest(draft).content.items[0].attributes.flavor, '巧克力动物奶油');
});

test('核对草稿按接口商品 ID 往返，删行改名不改变其余商品标识', () => {
  const original = submissionRequest(complete()).content;
  const first = { ...original.items[0], itemId: crypto.randomUUID() };
  const second = { ...first, itemId: crypto.randomUUID(), attributes: { ...first.attributes, specification: '分装' } };
  const draft = draftFromSubmission({ original, reviewed: {
    content: { ...original, items: [first, second] }, prices: [], totalAmountCents: 1000, creditedEmployeeId: null, plannedHandoffAt: null,
  } } as Submission);
  assert.deepEqual(draft.items.map(item => item.key), [first.itemId, second.itemId]);
  draft.items.shift();
  draft.items[0].name = '已核对商品';
  draft.items[0].quantity = '3';
  const saved = submissionRequest(draft, true);
  assert.deepEqual(saved.errors, {});
  assert.equal(saved.review.content.items[0].itemId, second.itemId);
  assert.equal(saved.review.content.items[0].name, '已核对商品');
  assert.equal(saved.review.content.items[0].quantity, 3);
});
