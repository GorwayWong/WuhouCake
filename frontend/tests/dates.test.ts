import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarRange, shiftMonth } from '../src/dates.ts';

test('周月切换保留选中日期，跨年和闰月范围符合后端 [from,to) 且不超过 42 天', () => {
  for (const selected of ['2026-09-30', '2024-02-29', '2027-01-01']) {
    const week = calendarRange(selected, 'week');
    const month = calendarRange(selected, 'month');
    assert.equal(week.dates.length, 7);
    assert.equal(month.dates.length, 42);
    assert.ok(month.dates.includes(selected));
    assert.ok(week.dates.includes(selected));
    assert.equal(new Date(`${month.from}T12:00Z`).getUTCDay(), 1);
    assert.equal(calendarRange(selected, 'week').from, week.from);
    assert.equal((Date.parse(month.to) - Date.parse(month.from)) / 86400000, 42);
  }
  assert.equal(shiftMonth('2024-01-31', 1), '2024-02-29');
  assert.equal(shiftMonth('2026-01-31', 1), '2026-02-28');
});
