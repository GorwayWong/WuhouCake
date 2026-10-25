import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarHref, defaultCalendarView, readCalendarView, selectCalendarDate, jumpCalendarDate, shiftCalendarPeriod, toggleCalendarMode, groupOrdersByTime, latestOrderNote, compareCalendarOrders } from '../src/calendarView.ts';
import { calendarOrderHref, orderHref, workspaceRoute } from '../src/routes.ts';
import type { PendingOrder, Item, Note } from '../src/types.ts';

const order = (orderNo: string, at: string | null) => ({ orderNo, plannedHandoffAt: at, items: [] }) as unknown as PendingOrder;
test('未安排交接时间的订单列在时间待定分组，排序稳定且不生成虚假时刻', () => {
  const groups = groupOrdersByTime([order('003', null), order('002', '2026-10-20T01:00:00Z'), order('001', null)]);
  assert.deepEqual(groups.map(group => group.time), ['09:00', '时间待定']);
  assert.deepEqual(groups[1].orders.map(order => order.orderNo), ['001', '003']);
  assert.equal(groupOrdersByTime([order('001', null)])[0].time, '时间待定');
});
test('半小时时间轴仅包含有订单的时段，按上海时区处理边界和同刻排序', () => {
  const orders = [order('003', '2026-10-19T17:30:00Z'), order('002', '2026-10-19T17:29:59Z'), order('004', '2026-10-19T17:00:00Z'), order('001', '2026-10-19T17:00:00Z')];
  const groups = groupOrdersByTime(orders);
  assert.deepEqual(groups.map(g => g.time), ['01:00', '01:30']);
  assert.deepEqual(groups[0].orders.map(o => o.orderNo), ['001', '004', '002']);
  assert.equal(groups[1].orders[0].plannedHandoffAt, '2026-10-19T17:30:00Z');
  assert.deepEqual(groupOrdersByTime([]), []);
  assert.equal(orders[0].orderNo, '003');
});
test('卡片展示服务端选出的整单最新备注，空值不显示备注', () => {
  const note = { id: 5, itemId: null, createdAt: '2026-10-20T02:00:00Z', content: '送到前请先联系' } as Note;
  assert.equal(latestOrderNote({ items: [], latestNote: note }), note);
  assert.equal(latestOrderNote({ items: [], latestNote: null }), undefined);
});
test('最新备注遍历所有商品且同时间取较大ID，不依赖商品和备注顺序', () => {
  const note = (id: number, createdAt: string) => ({ id, createdAt, content: `备注${id}` }) as Note;
  const items = [{ recentNotes: [note(1, '2026-10-20T01:00:00Z')] }, { recentNotes: [note(4, '2026-10-20T02:00:00Z'), note(3, '2026-10-20T02:00:00Z')] }] as Item[];
  assert.equal(latestOrderNote({ items })?.id, 4);
  assert.equal(latestOrderNote({ items: [...items].reverse() })?.id, 4);
  assert.equal(latestOrderNote({ items: [{ recentNotes: [] }] as unknown as Item[] }), undefined);
});
test('交货日期与收货日期不一致时，不合并不同日期的同钟点而打乱交货顺序', () => {
  const groups = groupOrdersByTime([order('003', '2026-10-21T01:00:00Z'), order('002', '2026-10-20T02:00:00Z'), order('001', '2026-10-20T01:00:00Z')]);
  assert.deepEqual(groups.map(g => g.time), ['09:00', '10:00', '09:00']);
  assert.equal(new Set(groups.map(g => g.key)).size, 3);
  assert.deepEqual(groups.flatMap(g => g.orders.map(o => o.orderNo)), ['001', '002', '003']);
});
test('月历同日收起、同周和跨周切换，跨月日期保持原显示月份', () => {
  const month = { ...defaultCalendarView('2026-10-20'), mode: 'month' as const };
  const open = selectCalendarDate(month, '2026-10-21');
  assert.equal(open.expanded, true);
  assert.equal(selectCalendarDate(open, '2026-10-21').expanded, false);
  assert.equal(selectCalendarDate(open, '2026-10-22').expanded, true);
  assert.equal(selectCalendarDate(open, '2026-10-28').date, '2026-10-28');
  const outside = selectCalendarDate(open, '2026-11-01');
  assert.equal(outside.month, '2026-10');
  assert.deepEqual(readCalendarView(calendarHref(outside)), outside);
  assert.equal(shiftCalendarPeriod(outside, 1).expanded, false);
  assert.equal(shiftCalendarPeriod(outside, 1).month, '2026-11');
  assert.equal(jumpCalendarDate(open, '2026-11-15').month, '2026-11');
  assert.equal(toggleCalendarMode(open).mode, 'week');
  assert.equal(toggleCalendarMode(toggleCalendarMode(open)).expanded, false);
});
test('日历URL和详情来源往返可恢复，旧日期链接和日志参数兼容', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const view = { ...defaultCalendarView('2026-11-01'), mode: 'month' as const, month: '2026-10', expanded: true };
  assert.deepEqual(readCalendarView('#/?date=2026-10-20'), defaultCalendarView('2026-10-20'));
  assert.equal(readCalendarView('#/?date=2026-02-30'), null);
  assert.equal(readCalendarView('#/?date=2026-10-20&view=month&month=2026-13'), null);
  const route = workspaceRoute(calendarOrderHref(view, id));
  assert.deepEqual(readCalendarView(route.returnToCalendar!), view);
  const history = workspaceRoute(orderHref(id, route.returnToCalendar, 'NOTE', true));
  assert.equal(history.type, 'NOTE');
  assert.equal(history.returnToCalendar, route.returnToCalendar);
  assert.equal(workspaceRoute(orderHref(id, 'https://example.com')).returnToCalendar, undefined);
});
test('日期概览的首单排序不依赖查询返回顺序', () => {
  const orders = [order('002', '2026-10-20T02:00:00Z'), order('003', '2026-10-20T01:00:00Z'), order('001', '2026-10-20T01:00:00Z')];
  assert.equal([...orders].sort(compareCalendarOrders)[0].orderNo, '001');
});
