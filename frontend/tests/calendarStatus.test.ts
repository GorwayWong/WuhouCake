import test from 'node:test';
import assert from 'node:assert/strict';
import { allCalendarFilters, calendarStatusOptions, matchesCalendarFilters } from '../src/calendarFilters.ts';

test('工作台筛选展示六节点流程及取消状态', () => {
  assert.deepEqual(calendarStatusOptions(), [
    ['CAKE_BASE', '出胚'], ['LAYER', '夹层'], ['FROSTING', '抹面'], ['DECORATING', '装饰'],
    ['WAITING_DELIVERY:DELIVERY', '待配送'], ['WAITING_DELIVERY:PICKUP', '待自提'],
    ['COMPLETED:DELIVERY', '已送达'], ['COMPLETED:PICKUP', '已自提'], ['CANCELLED', '已取消'],
  ]);
});
test('筛选语义与卡片显示相同，付款状态仍独立生效', () => {
  const layer = { status: 'LAYER', currentStageCode: null, paymentStatus: 'PAID' };
  assert.equal(matchesCalendarFilters(layer, { status: 'LAYER', paymentStatus: 'PAID' }), true);
  assert.equal(matchesCalendarFilters(layer, { status: 'CAKE_BASE', paymentStatus: '' }), false);
  assert.equal(matchesCalendarFilters(layer, { status: 'FROSTING', paymentStatus: '' }), false);
  assert.equal(matchesCalendarFilters(layer, { status: '', paymentStatus: 'UNPAID' }), false);
  assert.equal(matchesCalendarFilters({ ...layer, status: 'COMPLETED' }, { status: 'LAYER', paymentStatus: '' }), false);
});
test('筛选默认全部，合法筛选状态与显示状态一致', () => {
  assert.deepEqual(allCalendarFilters, { status: '', paymentStatus: '' });
  for (const [code] of calendarStatusOptions()) {
    const [status, fulfillmentType] = code.split(':');
    for (const type of ['DELIVERY', 'PICKUP']) {
      const order = { status, fulfillmentType: type, paymentStatus: 'UNPAID' };
      assert.equal(matchesCalendarFilters(order, { status: code, paymentStatus: 'UNPAID' }), !fulfillmentType || fulfillmentType === type);
    }
  }
});
