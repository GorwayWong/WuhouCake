import test from 'node:test';
import assert from 'node:assert/strict';
import { managementQuery, exactYuan } from '../src/management.ts';
import { readCalendarFilters, writeCalendarFilters, matchesCalendarFilters } from '../src/calendarFilters.ts';
import { itemInput, newItem } from '../src/orderForm.ts';

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
test('日历偏好按员工保存，坏值和存储异常回退全部，两个筛选共同生效', () => {
  const data = new Map<string, string>(); const storage = { getItem: (k: string) => data.get(k) || null, setItem: (k: string, v: string) => { data.set(k, v); } };
  writeCalendarFilters('A', { status: 'PROCESSING', paymentStatus: 'UNPAID' }, storage);
  assert.deepEqual(readCalendarFilters('A', storage), { status: 'PROCESSING', paymentStatus: 'UNPAID' });
  assert.deepEqual(readCalendarFilters('B', storage), { status: '', paymentStatus: '' });
  data.set('wuhou.calendar.filters.A', '{bad'); assert.deepEqual(readCalendarFilters('A', storage), { status: '', paymentStatus: '' });
  data.set('wuhou.calendar.filters.A', '{"status":"__proto__","paymentStatus":{}}'); assert.deepEqual(readCalendarFilters('A', storage), { status: '', paymentStatus: '' });
  assert.deepEqual(readCalendarFilters('A', { getItem: () => { throw new Error(); }, setItem: () => {} }), { status: '', paymentStatus: '' });
  assert.equal(matchesCalendarFilters({ status: 'COMPLETED', paymentStatus: 'PAID' }, { status: '', paymentStatus: '' }), true);
  assert.equal(matchesCalendarFilters({ status: 'PROCESSING', paymentStatus: 'PAID' }, { status: 'PROCESSING', paymentStatus: 'UNPAID' }), false);
});
test('手动数字尺寸和清空默认在商品提交边界统一', () => {
  const draft = newItem(); draft.name = '合成蛋糕'; draft.attributes.size = '08.00'; draft.attributes.base = ' '; draft.attributes.filling = '';
  assert.deepEqual(itemInput(draft).item?.attributes, { size: '8', base: '原味', filling: '芒果' });
  draft.attributes.size = 'abc'; assert.ok(itemInput(draft).errors.size);
});
