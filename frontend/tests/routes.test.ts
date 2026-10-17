import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceRoute, calendarOrderHref } from '../src/routes.ts';
import { uniqueActivities } from '../src/activities.ts';
import { workbenchDate } from '../src/dates.ts';
import type { Activity } from '../src/types.ts';

test('员工共享订单统计与日志路由，员工管理仅管理员可见', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  assert.equal(workspaceRoute('#/admin/orders', 'STAFF').kind, 'orders');
  assert.equal(workspaceRoute('#/admin/employees', 'STAFF').kind, 'calendar');
  assert.equal(workspaceRoute('#/admin/employees', 'SUPER_ADMIN').kind, 'employees');
  assert.deepEqual(workspaceRoute(`#/orders/${id}/activities?type=NOTE`, 'STAFF'), { kind: 'history', id, type: 'NOTE' });
  assert.equal(workspaceRoute(`#/orders/${id}`, 'STAFF').kind, 'order');
  assert.equal(calendarOrderHref(true, '2026-10-17', id), '#/?date=2026-10-17');
  assert.equal(calendarOrderHref(false, '2026-10-17', id), `#/orders/${id}`);
  assert.equal(workbenchDate(calendarOrderHref(true, '2026-10-18', id)), '2026-10-18');
});

test('日志分页遇到新记录挤动页边界时按稳定记录 ID 去重', () => {
  const record = (id: number) => ({ id, type: 'NOTE' }) as Activity;
  assert.deepEqual(uniqueActivities([{ items: [record(5), record(4)] }, { items: [record(4), record(3)] }]).map(a => a.id), [5, 4, 3]);
});
