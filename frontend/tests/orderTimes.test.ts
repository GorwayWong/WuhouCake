import test from 'node:test';
import assert from 'node:assert/strict';
import { changePickupTime, changeFinishTime, defaultFinishTime, restoreAutomaticFinish, pickupDate, pickupInstant, hasLegacyTimeConflict } from '../src/orderTimes.ts';
import { newDraft, informationDraft, informationRequest } from '../src/orderForm.ts';
import { setCandidate, undoRecognition } from '../src/recognition.ts';
import { freshOrderDraft, decodeOrderDraft } from '../src/orderDraftStorage.ts';
import type { Detail } from '../src/types.ts';

test('默认出品使用北京时间，支持跨日、跨月、跨年，拒绝不完整和非法日期', () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    for (const [pickup, finish] of [['2026-11-04T17:00', '2026-11-04T16:00'], ['2026-11-04T00:30', '2026-11-03T23:30'],
      ['2026-03-01T00:00', '2026-02-28T23:00'], ['2028-03-01T00:30', '2028-02-29T23:30'], ['2027-01-01T00:30', '2026-12-31T23:30']]) {
      assert.equal(defaultFinishTime(pickup), finish);
    }
    for (const value of ['', '2026-11-04', '2026-11-04T17:', '2026-02-30T17:00', '2026-11-04T25:00', '0000-01-01T00:00']) assert.equal(defaultFinishTime(value), '');
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
test('自动值随取货时间变化和清空，手动值保留，恢复自动后继续随动', () => {
  let draft = changePickupTime(newDraft('2026-11-04'), '2026-11-04T17:00');
  assert.equal(draft.plannedFinishAt, '2026-11-04T16:00');
  draft = changePickupTime(draft, '2026-11-05'); assert.equal(draft.plannedFinishAt, '');
  draft = changeFinishTime(draft, '2026-11-04T15:00');
  draft = changePickupTime(draft, '2026-11-05T18:00'); assert.equal(draft.plannedFinishAt, '2026-11-04T15:00');
  draft = changePickupTime(draft, ''); assert.equal(draft.plannedFinishAt, '2026-11-04T15:00');
  draft = changePickupTime(restoreAutomaticFinish(draft), '2026-11-05T18:00'); assert.equal(draft.plannedFinishAt, '2026-11-05T17:00');
  draft = changeFinishTime(draft, ''); draft = changePickupTime(draft, '2026-11-05T19:00'); assert.equal(draft.plannedFinishAt, '');
});
test('识别明确出品视为手动，撤销恢复原模式并保留后续手动修改', () => {
  const before = changePickupTime(newDraft('2026-11-04'), '2026-11-04T17:00');
  const after = setCandidate(before, 'plannedFinishAt', '2026-11-04T14:00');
  assert.equal(after.finishTimeMode, 'MANUAL');
  assert.equal(changePickupTime(after, '2026-11-04T18:00').plannedFinishAt, '2026-11-04T14:00');
  const restored = undoRecognition(after, before, after);
  assert.equal(restored.finishTimeMode, 'AUTO'); assert.equal(restored.plannedFinishAt, before.plannedFinishAt);
  const edited = changeFinishTime(after, '2026-11-04T13:00');
  const kept = undoRecognition(edited, before, after);
  assert.equal(kept.finishTimeMode, 'MANUAL'); assert.equal(kept.plannedFinishAt, edited.plannedFinishAt);
  const automaticFill = setCandidate(before, 'requestedReceiveAt', '2026-11-04T18:00');
  const explicitlyKept = changeFinishTime(automaticFill, automaticFill.plannedFinishAt);
  const undone = undoRecognition(explicitlyKept, before, automaticFill);
  assert.equal(undone.finishTimeMode, 'MANUAL'); assert.equal(undone.plannedFinishAt, automaticFill.plannedFinishAt);
});
test('草稿序列化保留模式，老草稿未标记的非空出品按已有手动值处理', () => {
  const record = freshOrderDraft('alice', '2026-11-04'); record.revision = 'revision'; record.updatedAt = new Date().toISOString();
  record.value = changeFinishTime(changePickupTime(record.value, '2026-11-04T17:00'), '2026-11-04T14:00');
  const restored = decodeOrderDraft(JSON.stringify(record), 'alice')!;
  assert.equal(restored.value.finishTimeMode, 'MANUAL');
  assert.equal(changePickupTime(restored.value, '2026-11-04T18:00').plannedFinishAt, '2026-11-04T14:00');
  delete restored.value.finishTimeMode;
  assert.equal(changePickupTime(restored.value, '2026-11-04T19:00').plannedFinishAt, '2026-11-04T14:00');
});
test('历史安排优先取货，不改时间的编辑不写回旧字段或秒精度', () => {
  const plan = { type: 'DELIVERY', address: '测试地址', requestedReceiveDate: '2026-11-05', requestedReceiveAt: '2026-11-05T02:00:00Z',
    plannedHandoffAt: '2026-11-04T16:30:27.123456Z', plannedFinishAt: '2026-11-04T15:30:27Z' };
  assert.equal(pickupInstant(plan), plan.plannedHandoffAt); assert.equal(pickupDate(plan), '2026-11-05'); assert.ok(hasLegacyTimeConflict(plan));
  assert.equal(pickupInstant({ ...plan, plannedHandoffAt: null }), plan.requestedReceiveAt);
  assert.equal(pickupDate({ ...plan, plannedHandoffAt: null, requestedReceiveAt: null }), plan.requestedReceiveDate);
  const order = { version: 1, customer: { phone: '13800000000' }, fulfillment: plan, totalAmountCents: null } as Detail;
  const draft = informationDraft(order); assert.equal(draft.requestedReceiveAt, '2026-11-05T00:30'); assert.equal(draft.finishTimeMode, 'MANUAL');
  assert.equal(informationRequest(order, draft).request, null);
  draft.phone = '13900000000'; assert.deepEqual(informationRequest(order, draft).request?.changes, { phone: draft.phone });
  const changed = { ...changePickupTime(draft, '2026-11-06T00:30'), requestedReceiveDate: '2026-11-06' };
  assert.equal(changed.plannedFinishAt, draft.plannedFinishAt);
  assert.deepEqual(informationRequest(order, changed).request?.changes, { phone: draft.phone, requestedReceiveAt: '2026-11-06T00:30:00+08:00',
    requestedReceiveDate: '2026-11-06', plannedHandoffAt: '2026-11-06T00:30:00+08:00' });
});
