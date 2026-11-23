import test from 'node:test';
import assert from 'node:assert/strict';
import { allCalendarFilters, calendarStatusCriteria, calendarStatusOptions, deliveryCalendarFilter, matchesCalendarFilters } from '../src/calendarFilters.ts';

test('工作台筛选展示六节点流程及取消状态', () => {
  assert.deepEqual(calendarStatusOptions(true), [
    [deliveryCalendarFilter, '今日需配送'],
    ['CAKE_BASE', '出胚'], ['LAYER', '夹层'], ['FROSTING', '抹面'], ['DECORATING', '装饰'],
    ['WAITING_DELIVERY:DELIVERY', '待配送'], ['WAITING_DELIVERY:PICKUP', '待自提'],
    ['COMPLETED:DELIVERY', '已送达'], ['COMPLETED:PICKUP', '已自提'], ['CANCELLED', '已取消'],
  ]);
  assert.deepEqual(calendarStatusOptions(false)[0], [deliveryCalendarFilter, '当日需配送']);
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
  for (const [code] of calendarStatusOptions(true).filter(([code]) => code !== deliveryCalendarFilter)) {
    const [status, fulfillmentType] = code.split(':');
    for (const type of ['DELIVERY', 'PICKUP']) {
      const order = { status, fulfillmentType: type, paymentStatus: 'UNPAID' };
      assert.equal(matchesCalendarFilters(order, { status: code, paymentStatus: 'UNPAID' }), !fulfillmentType || fulfillmentType === type);
    }
  }
});

test('需配送筛选包含制作中、待配送和已送达的配送单，并可叠加付款状态', () => {
  assert.deepEqual(calendarStatusCriteria(deliveryCalendarFilter), { view: 'delivery' });
  const filters = { status: deliveryCalendarFilter, paymentStatus: 'UNPAID' };
  const order = { status: 'CAKE_BASE', fulfillmentType: 'DELIVERY', paymentStatus: 'UNPAID' };
  for (const status of ['CAKE_BASE', 'LAYER', 'FROSTING', 'DECORATING', 'WAITING_DELIVERY', 'COMPLETED']) {
    assert.equal(matchesCalendarFilters({ ...order, status }, filters), true);
  }
  assert.equal(matchesCalendarFilters({ ...order, status: 'CANCELLED' }, filters), false);
  assert.equal(matchesCalendarFilters({ ...order, fulfillmentType: 'PICKUP' }, filters), false);
  assert.equal(matchesCalendarFilters({ ...order, paymentStatus: 'PAID' }, filters), false);
});
