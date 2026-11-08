import test from 'node:test';
import assert from 'node:assert/strict';
import { businessDate, businessTime, time } from '../src/dates.ts';

test('业务日期按上海当前年份省略年，跨年保留完整年且不改值', () => {
  const now = new Date('2026-11-08T00:00:00Z');
  assert.equal(businessDate('2026-11-09', now), '11/09');
  assert.equal(businessDate('2025-11-09', now), '2025/11/09');
  assert.equal(businessDate('2027-11-09', now), '2027/11/09');
  const value = '2026-11-09T11:30:00Z';
  assert.equal(businessTime(value, now), '11/09 19:30');
  assert.equal(value, '2026-11-09T11:30:00Z');
  assert.match(time(value, true), /2026/);
  assert.equal(businessDate(null, now), '未填写');
  assert.equal(businessTime('', now), '未填写');
  assert.equal(businessDate('not-a-date', now), '未填写');
});
test('上海跨年与设备时区独立，纯日期不发生跨日偏移', () => {
  const now = new Date('2026-12-31T16:00:00Z');
  assert.equal(businessDate('2027-01-01', now), '01/01');
  assert.equal(businessTime('2026-12-31T16:00:00Z', now), '01/01 00:00');
  assert.equal(businessTime('2026-12-31T15:59:00Z', now), '2026/12/31 23:59');
  assert.equal(businessDate('2026-12-31', now), '2026/12/31');
});
