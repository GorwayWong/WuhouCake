import test from 'node:test';
import assert from 'node:assert/strict';
import { allCalendarFilters, calendarStatusOptions, matchesCalendarFilters } from '../src/calendarFilters.ts';

test('工作台筛选固定展示完整订单状态和制作阶段', () => {
  assert.deepEqual(calendarStatusOptions(), [
    ['WAITING_PRODUCTION', '待制作'], ['PROCESSING', '生胚中'], ['LAYER_DONE', '已夹层'],
    ['FROSTING_DONE', '已抹面'], ['OTHER_DONE', '其他已确认'], ['WAITING_DELIVERY', '待配送'],
    ['WAITING_PICKUP', '待自提'], ['DELIVERING', '配送中'], ['COMPLETED', '已完成'], ['CANCELLED', '已取消'],
  ]);
});
test('筛选语义与卡片显示相同，付款状态仍独立生效', () => {
  const layer = { status: 'PROCESSING', currentStageCode: 'LAYER_DONE', paymentStatus: 'PAID' };
  assert.equal(matchesCalendarFilters(layer, { status: 'LAYER_DONE', paymentStatus: 'PAID' }), true);
  assert.equal(matchesCalendarFilters(layer, { status: 'PROCESSING', paymentStatus: '' }), false);
  assert.equal(matchesCalendarFilters(layer, { status: 'FROSTING_DONE', paymentStatus: '' }), false);
  assert.equal(matchesCalendarFilters(layer, { status: '', paymentStatus: 'UNPAID' }), false);
  assert.equal(matchesCalendarFilters({ ...layer, status: 'COMPLETED' }, { status: 'LAYER_DONE', paymentStatus: '' }), false);
});
test('筛选默认全部，合法筛选状态与显示状态一致', () => {
  assert.deepEqual(allCalendarFilters, { status: '', paymentStatus: '' });
  for (const [code] of calendarStatusOptions()) {
    const stage = ['LAYER_DONE', 'FROSTING_DONE', 'OTHER_DONE'].includes(code);
    assert.equal(matchesCalendarFilters({ status: stage ? 'PROCESSING' : code, currentStageCode: stage ? code : null, paymentStatus: 'UNPAID' }, { status: code, paymentStatus: '' }), true);
  }
});
