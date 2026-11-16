import assert from 'node:assert/strict';
import test from 'node:test';
import { orderHref, workspaceRoute } from '../src/routes.ts';
import { productionPreset, productionQueryHref, readProductionQuery, validProductionRange } from '../src/productionQueryRoute.ts';
import { shiftDate, today } from '../src/dates.ts';

test('待制作查询默认北京时间今天起七天，含首尾且最多四十二天', () => {
  const from = today();
  assert.deepEqual(readProductionQuery('#/production-query'), { from, through: shiftDate(from, 6), stage: '', bucket: '', page: 1 });
  assert.deepEqual(productionPreset(30), { from, through: shiftDate(from, 29) });
  assert.equal(validProductionRange('2026-10-31', '2026-12-11'), true);
  assert.equal(validProductionRange('2026-10-31', '2026-12-12'), false);
  assert.equal(validProductionRange('2026-02-29', '2026-03-01'), false);
});

test('待制作查询保留工序、分组和页码并校验详情返回地址', () => {
  const route = { from: '2026-10-31', through: '2026-11-02', stage: 'LAYER', bucket: 'unscheduled', page: 2 };
  const href = productionQueryHref(route);
  assert.deepEqual(readProductionQuery(href), route);
  assert.equal(workspaceRoute(orderHref('10000000-0000-4000-8000-000000000001', href)).returnToCalendar, href);
  assert.equal(readProductionQuery(href.replace('page=2', 'page=0')), null);
  for (const changes of [{ stage: 'COMPLETED' }, { bucket: '2026-11-03' }]) {
    assert.equal(readProductionQuery(productionQueryHref({ ...route, ...changes })), null);
  }
});
