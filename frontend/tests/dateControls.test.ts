import test from 'node:test';
import assert from 'node:assert/strict';
import { completeDateTime, pickerDate, pickerText } from '../src/dateControls.ts';

test('日期和本地时刻保持日历值，不随设备时区偏移', () => {
  assert.equal(pickerText(pickerDate('2026-10-31', false), false), '2026-10-31');
  assert.equal(pickerText(pickerDate('2026-10-31T23:45', true), true), '2026-10-31T23:45');
  assert.equal(pickerText(pickerDate('2026-10-31T00:05:00', true), true), '2026-10-31T00:05');
});
test('空白和异常日期安全回到待填写，不补造日期或时刻', () => {
  for (const text of ['', 'abc', '2026-02-30', '2026-10-17T25:00', '2026-10-17T12:00Z']) assert.equal(pickerDate(text, text.includes('T')), null);
  assert.equal(pickerText(null, true), '');
  assert.equal(pickerText(null, false), '');
});
test('仅填日期或时分不能生成取货时刻，允许员工明确填写午夜', () => {
  assert.equal(completeDateTime('2026-10-17', ''), '');
  assert.equal(completeDateTime('', '15:30'), '');
  assert.equal(completeDateTime('2026-10-17', '25:00'), '');
  assert.equal(completeDateTime('2026-10-17', '15:30'), '2026-10-17T15:30');
  assert.equal(completeDateTime('2026-10-17', '00:00'), '2026-10-17T00:00');
});
