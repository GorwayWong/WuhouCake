import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, creationResultUnknown } from '../src/api.ts';
import { workbenchDate, calendarRange } from '../src/dates.ts';

test('明确拒绝与创建结果未知分别提示，服务端异常不能承诺未创建', () => {
  for (const status of [400, 401, 403, 409, 429]) assert.equal(creationResultUnknown(new ApiError(status, 'REJECTED')), false);
  for (const status of [408, 500, 502, 503, 504, 200]) assert.equal(creationResultUnknown(new ApiError(status, 'HTTP_ERROR')), true);
  assert.equal(creationResultUnknown(new TypeError('Failed to fetch')), true);
  assert.equal(creationResultUnknown(null), false);
});

test('核对入口定位收货日期及现有周历，拒绝无效日期', () => {
  const date = workbenchDate('#/?date=2026-11-02');
  assert.equal(date, '2026-11-02');
  assert.ok(calendarRange(date!, 'week').dates.includes(date!));
  for (const hash of ['#', '#/orders/new', '#/?date=2026-02-30', '#/?date=invalid', '#/?date=2026-13-02']) assert.equal(workbenchDate(hash), null);
});
