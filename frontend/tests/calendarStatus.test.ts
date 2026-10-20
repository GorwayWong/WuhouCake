import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarStatusOptions, matchesCalendarFilters, readCalendarFilters } from '../src/calendarFilters.ts';

test('工作台筛选只列出当前范围实际状态，区分制作节点并去重排序', () => {
  assert.deepEqual(calendarStatusOptions([]), []);
  assert.deepEqual(calendarStatusOptions([
    { status: 'COMPLETED', currentStageCode: 'FROSTING_DONE' },
    { status: 'PROCESSING', currentStageCode: 'FROSTING_DONE' },
    { status: 'PROCESSING', currentStageCode: 'LAYER_DONE' },
    { status: 'PROCESSING', currentStageCode: 'LAYER_DONE' },
    { status: 'WAITING_PRODUCTION' },
  ]), [['WAITING_PRODUCTION', '待制作'], ['LAYER_DONE', '已夹层'], ['FROSTING_DONE', '已抹面'], ['COMPLETED', '已完成']]);
  assert.deepEqual(calendarStatusOptions([{ status: 'WAITING_PICKUP' }]), [['WAITING_PICKUP', '待自提']]);
});
test('筛选语义与卡片显示相同，付款状态仍独立生效', () => {
  const layer = { status: 'PROCESSING', currentStageCode: 'LAYER_DONE', paymentStatus: 'PAID' };
  assert.equal(matchesCalendarFilters(layer, { status: 'LAYER_DONE', paymentStatus: 'PAID' }), true);
  assert.equal(matchesCalendarFilters(layer, { status: 'PROCESSING', paymentStatus: '' }), false);
  assert.equal(matchesCalendarFilters(layer, { status: 'FROSTING_DONE', paymentStatus: '' }), false);
  assert.equal(matchesCalendarFilters(layer, { status: '', paymentStatus: 'UNPAID' }), false);
  assert.equal(matchesCalendarFilters({ ...layer, status: 'COMPLETED' }, { status: 'LAYER_DONE', paymentStatus: '' }), false);
});
test('制作节点筛选可记忆，未知旧偏好仍回退全部', () => {
  const storage = { getItem: () => JSON.stringify({ status: 'LAYER_DONE', paymentStatus: 'PAID' }), setItem: () => {} };
  assert.deepEqual(readCalendarFilters('demo', storage), { status: 'LAYER_DONE', paymentStatus: 'PAID' });
  storage.getItem = () => JSON.stringify({ status: 'UNKNOWN', paymentStatus: 'UNKNOWN' });
  assert.deepEqual(readCalendarFilters('demo', storage), { status: '', paymentStatus: '' });
});
