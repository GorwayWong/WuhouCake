import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createRequire } from 'node:module';
import { calendarDays, createOrderFixture, orderId, workbenchCards } from './orderBrowserFixture.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DRAFT_TEST_URL || 'http://127.0.0.1:5197';
let browser;
before(async () => { browser = await chromium.launch({ headless: true, channel: 'chrome' }); });
after(async () => { await browser?.close(); });

test('日期首单按实际取货时刻和订单号决定，待定排最后', () => {
  const row = (orderNo, plannedHandoffAt) => ({ orderId: orderNo, orderNo, plannedHandoffAt, calendarDate: '2026-11-20' });
  const rows = [row('00', null), row('01', '2026-11-20T01:00:00.000500Z'),
    row('03', '2026-11-20T09:00:00.000400+08:00'), row('02', '2026-11-20T01:00:00.000400Z')];
  assert.equal(calendarDays(rows)[0].firstOrderId, '02');
});

test('月历收到首单删除通知后即使刷新失败也隐藏旧预览，恢复后显示下一单', async () => {
  const { context, page } = await createOrderFixture(browser, base);
  const date = '2026-11-20';
  const day = { calendarDate: date, firstOrderId: orderId, orderCount: 2, unfinishedCount: 1,
    firstItemName: '旧首单蛋糕', customerPhoneLast4: '0123' };
  const other = { ...day, calendarDate: '2026-11-21', firstOrderId: crypto.randomUUID(), firstItemName: '次日蛋糕' };
  let phase = 'before', release;
  const gate = new Promise(resolve => { release = resolve; });
  try {
    await context.route('**/api/orders/calendar/days?**', route => {
      if (phase === 'offline') return route.fulfill({ status: 503, json: { success: false, code: 'SERVICE_UNAVAILABLE' } });
      const current = phase === 'before' ? day : { ...day, firstOrderId: crypto.randomUUID(),
        orderCount: 1, unfinishedCount: 0, firstItemName: '新首单蛋糕', customerPhoneLast4: '4567' };
      return route.fulfill({ json: { success: true, data: [current, other] } });
    });
    await context.route('**/api/orders/stream', async route => {
      await gate;
      return route.fulfill({ contentType: 'text/event-stream', body: 'event: order.changed\ndata: '
        + JSON.stringify({ orderId, changeType: 'ORDER_DELETED', version: 4 }) + '\n\n' });
    });
    await page.goto(base + '/#/?date=' + date + '&view=month&month=2026-11');
    const cell = page.locator('.date-block').filter({ hasText: '旧首单蛋糕' });
    await cell.waitFor();
    phase = 'offline';
    release();
    await page.getByText('摘要待刷新', { exact: true }).waitFor();
    await page.getByText('刷新失败，当前显示上次数据。', { exact: true }).waitFor();
    const selected = page.locator('.date-block.selected');
    assert.doesNotMatch(await selected.innerText(), /旧首单蛋糕|0123/);
    assert.ok(await page.getByText('次日蛋糕', { exact: true }).isVisible());
    phase = 'after';
    await page.locator('.calendar-panel').getByRole('button', { name: /重试/ }).click();
    await selected.getByText('新首单蛋糕', { exact: true }).waitFor();
    assert.match(await selected.innerText(), /4567/);
  } finally { release(); await context.close(); }
});

test('按详情状态切换筛选后，列表只显示同名状态的订单', async () => {
  const { context, page } = await createOrderFixture(browser, base);
  const date = '2026-11-20';
  const states = [
    ['WAITING_DELIVERY', 'DELIVERY', '待配送'], ['WAITING_DELIVERY', 'PICKUP', '待自提'],
    ['COMPLETED', 'DELIVERY', '已送达'], ['COMPLETED', 'PICKUP', '已自提'],
  ];
  const rows = states.map(([status, fulfillmentType, name], index) => ({
    orderId: `10000000-0000-4000-8000-00000000000${index}`, orderNo: String(index),
    status, fulfillmentType, paymentStatus: 'UNPAID', calendarDate: date, items: [{ name, quantity: 1 }],
  }));
  try {
    await context.route('**/api/orders/workbench/cards?**', route =>
      route.fulfill({ json: { success: true, data: workbenchCards(route.request(), rows) } }));
    await page.goto(`${base}/#/?date=${date}`);
    for (const [, , label] of states) {
      await page.locator('[data-control-label="订单状态"] .choice-trigger').click();
      await page.getByRole('option', { name: label, exact: true }).click();
      await page.locator('.order-summary-card:visible .badges').getByText(label, { exact: true }).waitFor();
      assert.equal(await page.locator('.order-summary-card').count(), 1);
      assert.match(await page.locator('.timeline-partition-toggle').innerText(), /1 单/);
    }
  } finally { await context.close(); }
});

test('前台卡片精简、时间两列、创建高亮、筛选与详情往返，以及制作岗位原展示', async () => {
  const { context, page, model, complete, errors } = await createOrderFixture(browser, base);
  const extra = [];
  const pending = () => model.order ? [{ ...model.order, calendarDate: model.order.fulfillment.requestedReceiveDate,
    plannedHandoffAt: model.order.fulfillment.plannedHandoffAt, requestedReceiveAt: model.order.fulfillment.requestedReceiveAt,
    plannedFinishAt: model.order.fulfillment.plannedFinishAt, fulfillmentType: model.order.fulfillment.type }, ...extra] : [];
  try {
    await context.route('**/api/orders/calendar/days?**', route => route.fulfill({ json: { success: true, data: calendarDays(pending().map(order => ({ ...order, customerPhoneLast4: '0000' }))) } }));
    await context.route('**/api/orders/workbench/cards?**', route => route.fulfill({ json: { success: true, data: workbenchCards(route.request(), pending()) } }));
    await context.route(`**/api/orders/${orderId}/customer-origin`, route => route.fulfill({ json: { success: true, data: null } }));
    await page.evaluate(() => {
      const request = navigator.locks.request.bind(navigator.locks);
      navigator.locks.request = (name, callback) => name === 'wuhou:order-submit:alice' && localStorage.getItem('wuhou:order-draft:v1:alice')
        ? request(name, async lock => {
          await new Promise(resolve => { window.finishDraftCleanup = resolve; });
          return callback(lock);
        }) : request(name, callback);
      const scroll = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (options) {
        if (this.classList.contains('is-new-order')) window.scrolledToNewOrder = this.dataset.orderId;
        return scroll.call(this, options);
      };
    });
    await complete(); await page.getByRole('button', { name: '创建订单', exact: true }).click();
    await page.waitForFunction(() => typeof window.finishDraftCleanup === 'function');
    assert.ok(page.url().endsWith('#/orders/new'));
    await page.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      window.finishDraftCleanup();
    });
    await page.locator('.is-new-order .created-order-badge').waitFor();
    assert.equal(await page.locator('.is-new-order .created-order-badge').innerText(), '刚刚创建');
    const date = model.order.fulfillment.requestedReceiveDate;
    assert.equal(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('date'), date);
    assert.equal(await page.evaluate(() => window.scrolledToNewOrder), orderId);
    const prior = new Date(Date.parse(date + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
    const cake = model.order.items[0];
    cake.name = '草莓芒果生日蛋糕'.repeat(8);
    model.order.items.push({ ...cake, itemId: '20000000-0000-4000-8000-000000000002', name: '小饼干', quantity: 6 });
    model.order.fulfillment.plannedHandoffAt = date + 'T23:45:00+08:00';
    model.order.fulfillment.requestedReceiveAt = date + 'T21:00:00+08:00';
    model.order.fulfillment.plannedFinishAt = prior + 'T23:15:00+08:00';
    model.order.latestNote = { id: 1, content: '请提前联系取货', itemId: null, actorNameSnapshot: '测试员工', createdAt: date + 'T08:00:00Z' };
    extra.push({ ...pending()[0], orderId: '30000000-0000-4000-8000-000000000003', orderNo: 'TEST-PENDING', items: [{ ...cake, name: '野餐盒' }],
      status: 'LAYER', paymentStatus: 'PAID', plannedHandoffAt: null, requestedReceiveAt: null, plannedFinishAt: null, latestNote: null });
    extra.push({ ...pending()[0], orderId: '40000000-0000-4000-8000-000000000004', orderNo: 'TEST-COMPLETED', items: [{ ...cake, name: '历史已完成订单' }],
      status: 'COMPLETED', plannedHandoffAt: null, requestedReceiveAt: date + 'T09:10:00+08:00', plannedFinishAt: date + 'T08:00:00+08:00', latestNote: null });
    await page.reload();
    const main = page.locator(`[data-order-id="${orderId}"]`), unspecified = page.locator('[data-order-id="30000000-0000-4000-8000-000000000003"]');
    await main.locator('.front-card-times').waitFor();
    const removedCopy = /按取货日期显示订单|取货时段|准确时间见订单卡片/;
    assert.doesNotMatch(await page.locator('#week-day-orders').innerText(), removedCopy);
    assert.equal(await main.locator('h3').innerText(), cake.name + ' · 另有 1 项');
    assert.equal(await main.locator('.order-summary-caption > span').count(), 0);
    assert.equal(await main.locator('.order-summary-meta').count(), 0);
    assert.equal(await main.locator('.order-summary-number').count(), 0);
    assert.equal(await main.locator('.order-summary-heading .order-summary-phone').innerText(), '13800000000');
    assert.equal((await main.innerText()).includes('TEST-IMAGE'), false);
    assert.equal(await main.locator('.front-card-times dd').nth(0).innerText(), '23:45');
    assert.equal(await main.locator('.front-card-times dd').nth(1).innerText(), '前一天 23:15');
    assert.equal(await main.locator('.order-summary-note-preview').innerText(), '备注：请提前联系取货');
    assert.equal(await main.locator('.badges').getByText('出胚', { exact: true }).count(), 1);
    assert.equal(await main.locator('.badges').getByText('未付款', { exact: true }).count(), 1);
    assert.equal(await unspecified.locator('h3').innerText(), '野餐盒');
    assert.equal(await unspecified.locator('.front-card-times dd').nth(0).innerText(), '待定');
    assert.equal(await unspecified.locator('.front-card-times dd').nth(1).innerText(), '待定');
    assert.equal(await main.locator('xpath=ancestor::section[contains(@class,"timeline-group")]').getAttribute('aria-label'), date + ' 取货时段 23:30 至次日 00:00');
    assert.equal(await page.locator('.order-partition').filter({ hasText: '已交接' }).locator('.timeline-partition-toggle').getAttribute('aria-expanded'), 'false');
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 1000 });
      const positions = await main.locator('.front-card-times > div').evaluateAll(nodes => nodes.map(node => ({ x: node.getBoundingClientRect().x, y: node.getBoundingClientRect().y })));
      assert.equal(positions[0].y, positions[1].y); assert.ok(positions[1].x > positions[0].x);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await main.scrollIntoViewIfNeeded(); await page.screenshot({ path: `/private/tmp/wuhou-calendar-cards-${width}.png`, fullPage: true });
    }
    await page.getByRole('button', { name: '展开本月日历' }).click();
    await page.getByRole('region', { name: '月历', exact: true }).getByRole('button', { name: new RegExp(`^${date}`) }).click();
    await main.waitFor();
    const monthOrders = page.getByRole('region', { name: `${date} 当日订单`, exact: true });
    assert.doesNotMatch(await monthOrders.innerText(), removedCopy);
    assert.equal(await monthOrders.getByRole('region', { name: `${date} 取货时段 23:30 至次日 00:00`, exact: true }).locator('.order-summary-card').count(), 1);
    await page.getByRole('button', { name: '切换周历工作台' }).click();
    await main.waitFor();
    await page.locator('[data-control-label="订单状态"] .choice-trigger').click(); await page.getByRole('option', { name: '出胚', exact: true }).click();
    await page.locator('[data-control-label="付款状态"] .choice-trigger').click(); await page.getByRole('option', { name: '未付款', exact: true }).click();
    assert.equal(await page.locator('.order-summary-card:visible').count(), 1);
    const calendarUrl = page.url();
    await main.click(); await page.locator('.front-order-information').waitFor();
    await page.getByRole('link', { name: '日历工作台', exact: true }).click();
    await main.waitFor(); assert.equal(page.url(), calendarUrl);
    assert.equal(await page.locator('.order-summary-card:visible').count(), 1);
    assert.match(await page.locator('[data-control-label="订单状态"] .choice-trigger').innerText(), /出胚/);
    assert.match(await page.locator('[data-control-label="付款状态"] .choice-trigger').innerText(), /未付款/);
    await page.getByRole('button', { name: '清除筛选', exact: true }).click();
    await page.locator('.order-partition').filter({ hasText: '已交接' }).locator('.timeline-partition-toggle').click();
    const completed = page.locator('[data-order-id="40000000-0000-4000-8000-000000000004"]'); await completed.waitFor();
    assert.equal(await completed.locator('.front-card-times dd').nth(0).innerText(), '09:10');
    model.permissions = model.permissions.filter(permission => permission !== 'ORDER_AMOUNT_READ');
    await page.reload(); await main.locator('.front-card-times').waitFor();
    assert.equal(await main.locator('.badges .badge').count(), 1);
    assert.equal(await page.locator('[data-control-label="付款状态"]').count(), 0);
    model.permissions = ['ORDER_READ', 'ORDER_PHONE_READ', 'ORDER_PRODUCTION_UPDATE'];
    await page.reload(); await main.locator('.production-thumbnail').waitFor();
    assert.equal(await main.locator('.front-card-times').count(), 0);
    assert.match(await main.locator('.order-summary-caption > span').innerText(), /2 项 · 7 件/);
    assert.equal(await main.locator('.order-summary-phone').innerText(), '13800000000');
    assert.equal(await main.locator('.order-summary-receive-time').count(), 0);
    assert.equal(await main.locator('.production-card-specifications').count(), 1);
    assert.match(await main.locator('.order-summary-number').innerText(), /TEST-IMAGE/);
    assert.equal(await main.locator('xpath=ancestor::section[contains(@class,"timeline-group")]').getAttribute('aria-label'), prior + ' 出品时间 23:15');
    model.permissions = ['ORDER_READ'];
    await page.reload(); await main.locator('.production-thumbnail').waitFor();
    assert.equal(await main.locator('.order-summary-phone').count(), 0);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('高峰日滚动加载，失败可重试且首批卡片和全日数量仍可用', async () => {
  const { context, page, errors } = await createOrderFixture(browser, base);
  const date = '2026-11-05';
  const rows = Array.from({ length: 52 }, (_, i) => ({
    orderId: crypto.randomUUID(), orderNo: String(i).padStart(4, '0'), calendarDate: date,
    status: 'CAKE_BASE', paymentStatus: 'UNPAID', fulfillmentType: 'PICKUP',
    plannedHandoffAt: date + 'T16:00:00+08:00', plannedFinishAt: null,
    items: [{ itemId: crypto.randomUUID(), name: '订单商品 ' + i, productType: 'CAKE', quantity: 1, attributes: {} }],
  }));
  let attempts = 0;
  try {
    await context.route('**/api/orders/workbench/cards?**', route => {
      const cursor = new URL(route.request().url()).searchParams.get('cursor');
      if (cursor && ++attempts === 1) return route.fulfill({ status: 400, json: { success: false, code: 'VALIDATION_FAILED' } });
      return route.fulfill({ json: { success: true, data: workbenchCards(route.request(),
        cursor ? rows.slice(50) : rows.slice(0, 50), { counts: rows, nextCursor: cursor ? null : 'page-2' }) } });
    });
    await page.goto(base + '/#/?date=' + date);
    const more = page.getByRole('button', { name: '加载更多', exact: true });
    await more.waitFor();
    assert.equal(await page.locator('.order-summary-card').count(), 50);
    assert.equal(await page.locator('.calendar-workbench > .section-heading h2 span').innerText(), '52');
    assert.match(await page.locator('.timeline-partition-toggle').innerText(), /待处理 52 单/);
    assert.equal(attempts, 0);
    await more.scrollIntoViewIfNeeded();
    const retry = page.getByRole('button', { name: '重试加载更多' });
    await retry.waitFor();
    assert.equal(await page.locator('.order-summary-card').count(), 50);
    await retry.click();
    await page.getByRole('heading', { name: '订单商品 51', exact: true }).waitFor();
    assert.equal(await page.locator('.order-summary-card').count(), 52);
    assert.equal(attempts, 2);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
