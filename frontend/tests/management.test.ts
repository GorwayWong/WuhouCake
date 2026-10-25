import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultManagementDraft, managementQuery, exactYuan, orderPagination } from '../src/management.ts';
import { allCalendarFilters, matchesCalendarFilters } from '../src/calendarFilters.ts';
import { itemInput, newItem } from '../src/orderForm.ts';

test('管理默认查询本月录单日期，未来收货的预约单不被收货范围排除', () => {
  const draft = defaultManagementDraft('2026-10-17');
  const q = new URLSearchParams(managementQuery(draft));
  assert.equal(q.get('dateBasis'), 'CREATED');
  assert.equal(q.get('from'), '2026-10-01'); assert.equal(q.get('to'), '2026-10-18');
  assert.equal(q.get('includeCancelled'), 'false'); assert.equal(q.has('status'), false);
  assert.equal(new URLSearchParams(managementQuery({ ...draft, dateBasis: 'RECEIVE', through: '2026-11-01' })).get('dateBasis'), 'RECEIVE');
});

test('经营条件规范化数字、日期、员工与金额，拒绝非法条件', () => {
  const draft = { from: '2026-10-01', through: '2026-10-31', status: '', paymentStatus: '', fulfillmentType: '', sizeInches: '8.00', creditedEmployeeId: '', unassigned: false, includeCancelled: false, keyword: ' 合成 ', dateBasis: 'RECEIVE' };
  const q = new URLSearchParams(managementQuery(draft));
  assert.equal(q.get('to'), '2026-11-01'); assert.equal(q.get('sizeInches'), '8'); assert.equal(q.get('includeCancelled'), 'false'); assert.equal(q.get('keyword'), '合成');
  for (const sizeInches of ['abc', '8寸', '-1', '0', '8.001', '1e2']) assert.throws(() => managementQuery({ ...draft, sizeInches }));
  assert.throws(() => managementQuery({ ...draft, through: '2026-02-30' })); assert.throws(() => managementQuery({ ...draft, status: 'bad' }));
  assert.equal(exactYuan('900719925474099100'), '9007199254740991.00');
  assert.equal(q.get('dateBasis'), 'RECEIVE');
  assert.equal(new URLSearchParams(managementQuery({ ...draft, dateBasis: 'CREATED' })).get('dateBasis'), 'CREATED');
  assert.throws(() => managementQuery({ ...draft, dateBasis: 'bad' }));
});
test('日历默认全部，两个筛选共同生效', () => {
  assert.deepEqual(allCalendarFilters, { status: '', paymentStatus: '' });
  assert.equal(matchesCalendarFilters({ status: 'COMPLETED', paymentStatus: 'PAID' }, { status: '', paymentStatus: '' }), true);
  assert.equal(matchesCalendarFilters({ status: 'PROCESSING', paymentStatus: 'PAID' }, { status: 'PROCESSING', paymentStatus: 'UNPAID' }), false);
});
test('手动数字尺寸和清空默认在商品提交边界统一', () => {
  const draft = newItem(); draft.name = '合成蛋糕'; draft.attributes.size = '08.00'; draft.attributes.base = ' '; draft.attributes.filling = '';
  assert.deepEqual(itemInput(draft).item?.attributes, { size: '8', base: '原味', filling: '芒果' });
  draft.attributes.size = 'abc'; assert.ok(itemInput(draft).errors.size);
});

test('订单分页覆盖空结果、末页、页码窗口及结果减少后的回退', () => {
  assert.deepEqual(orderPagination(0, 1), { total: 0, size: 10, last: 1, current: 1, from: 0, through: 0, pages: [1] });
  const last = orderPagination(53, 6);
  assert.equal(last.from, 51); assert.equal(last.through, 53); assert.deepEqual(last.pages, [1, 2, 3, 4, 5, 6]);
  assert.equal(orderPagination(53, 7).current, 6);
  assert.equal(orderPagination(12, 3).current, 2);
  assert.deepEqual(orderPagination(310, 10).pages, [1, 'gap', 9, 10, 11, 'gap', 31]);
  assert.deepEqual(orderPagination(310, 1).pages, [1, 2, 3, 4, 5, 'gap', 31]);
  assert.deepEqual(orderPagination(310, 31).pages, [1, 'gap', 27, 28, 29, 30, 31]);
});
test('已删除模式独立于所有历史未付款，日期半开区间及原状态筛选保留', () => {
  const draft = { ...defaultManagementDraft('2026-10-25'), deleted: true, allUnpaid: true, status: 'CANCELLED' };
  const query = new URLSearchParams(managementQuery(draft));
  assert.equal(query.get('deleted'), 'true'); assert.equal(query.get('status'), 'CANCELLED');
  assert.equal(query.get('from'), '2026-10-01'); assert.equal(query.get('to'), '2026-10-26');
  assert.equal(query.has('allUnpaid'), false);
});
