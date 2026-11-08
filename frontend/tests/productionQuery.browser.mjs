import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createRequire } from 'node:module';
import { createOrderFixture, orderId } from './orderBrowserFixture.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DRAFT_TEST_URL || 'http://127.0.0.1:5197';
let browser;
before(async () => { browser = await chromium.launch({ headless: true, channel: 'chrome' }); });
after(async () => { await browser?.close(); });

test('师傅可筛选待制作、返回原明细，两页随 SSE 同步，前厅入口隐藏', async () => {
  const { context, page, model, errors } = await createOrderFixture(browser, base);
  const href = '#/production-query?from=2026-10-31&through=2026-11-02';
  const delivered = new WeakMap();
  let signal = Promise.withResolvers();
  let change;
  function publish(changeType) {
    change = { orderId, version: (change?.version ?? 0) + 1, changeType };
    const previous = signal;
    signal = Promise.withResolvers();
    previous.resolve(change);
  }
  let moved = false;
  let completed = false;
  let cancelled = false;
  let latestSummary;
  try {
    assert.equal(await page.getByRole('link', { name: '待制作查询' }).count(), 0);
    await page.goto(base + '/' + href);
    await page.getByText('当前岗位不显示待制作查询。', { exact: true }).waitFor();
    model.permissions = ['ORDER_READ'];
    const finish = '2026-10-31T16:00:00Z';
    model.order = { orderId, orderNo: 'TEST-PRODUCTION', version: 0, status: 'LAYER', currentStageCode: null,
      paymentStatus: null, fulfillment: { type: 'PICKUP', requestedReceiveDate: '2026-12-01', plannedFinishAt: finish },
      items: [{ itemId: crypto.randomUUID(), name: '草莓蛋糕', productType: 'CAKE', quantity: 2, attributes: {}, recentNotes: [] }] };
    const row = { orderId, orderNo: model.order.orderNo, itemName: '草莓蛋糕', status: 'LAYER',
      plannedFinishAt: finish, pickupAt: null, pickupDate: '2026-12-01' };
    const ok = (route, data) => route.fulfill({ json: { success: true, data } });
    await context.route('**/api/orders/workbench/production-summary?**', route => {
      latestSummary = new URL(route.request().url()).searchParams;
      const date = latestSummary.get('from');
      return ok(route, { total: Number(!completed), unscheduled: Number(!cancelled), days: date === '2026-10-31'
        ? [{ date, orderCount: 0 }, { date: '2026-11-01', orderCount: Number(!moved) },
          { date: '2026-11-02', orderCount: Number(moved && !completed) }]
        : [{ date, orderCount: 0 }] });
    });
    await context.route('**/api/orders/workbench/production-orders?**', route => {
      const params = new URL(route.request().url()).searchParams;
      const unscheduled = params.get('unscheduled') === 'true';
      const count = unscheduled ? !cancelled : !completed && params.get('date') === (moved ? '2026-11-02' : '2026-11-01');
      const match = unscheduled ? { ...row, orderId: '20000000-0000-4000-8000-000000000002', orderNo: 'TEST-UNSCHEDULED', plannedFinishAt: null }
        : { ...row, plannedFinishAt: moved ? '2026-11-01T16:00:00Z' : finish };
      return ok(route, { page: 1, total: Number(count), orders: count ? [match] : [] });
    });
    await context.route('**/api/orders/stream', async route => {
      const tab = route.request().frame().page();
      const update = change && (delivered.get(tab) ?? 0) < change.version ? change : await signal.promise;
      if (!update) return route.abort().catch(() => {});
      try {
        await route.fulfill({ contentType: 'text/event-stream', body: `event: order.changed\ndata: ${JSON.stringify(update)}\n\n` });
        delivered.set(tab, update.version);
      } catch { /* 页面离开时浏览器会取消旧连接。 */ }
    });
    await page.reload();
    await page.getByRole('link', { name: '待制作查询' }).waitFor();
    await page.getByRole('link', { name: '2026-11-01 1 笔' }).waitFor();
    assert.equal(latestSummary?.get('to'), '2026-11-03');
    await page.locator('[data-control-label="制作工序"] button').click();
    await page.getByRole('option', { name: '夹层', exact: true }).click();
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await page.getByRole('link', { name: '2026-11-01 1 笔' }).click();
    await page.getByRole('link', { name: /草莓蛋糕/ }).click();
    await page.getByRole('link', { name: '返回待制作查询' }).click();
    await page.getByRole('heading', { name: '2026-11-01订单明细' }).waitFor();
    assert.equal(new URL(page.url().split('#')[1], base).searchParams.get('stage'), 'LAYER');
    const peer = await context.newPage();
    await peer.setViewportSize({ width: 1280, height: 900 });
    await peer.goto(page.url());
    await peer.getByRole('link', { name: /草莓蛋糕/ }).waitFor();
    for (const client of [page, peer]) {
      assert.ok(await client.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await client.getByRole('link', { name: '出品待定 1 笔' }).waitFor();
    }
    moved = true;
    publish('ORDER_INFORMATION_CHANGED');
    for (const client of [page, peer]) {
      await client.getByRole('link', { name: '2026-11-02 1 笔' }).waitFor();
      await client.getByText('暂无匹配订单。', { exact: true }).waitFor();
    }
    for (const client of [page, peer]) {
      await client.getByRole('link', { name: '2026-11-02 1 笔' }).click();
      await client.getByRole('link', { name: /草莓蛋糕/ }).waitFor();
    }
    completed = true;
    publish('ORDER_PRODUCTION_CHANGED');
    for (const client of [page, peer]) {
      await client.getByRole('link', { name: '2026-11-02 0 笔' }).waitFor();
      await client.getByText('暂无匹配订单。', { exact: true }).waitFor();
      await client.getByRole('link', { name: '出品待定 1 笔' }).click();
      await client.getByRole('link', { name: /TEST-UNSCHEDULED/ }).waitFor();
    }
    cancelled = true;
    publish('ORDER_CANCELLED');
    for (const client of [page, peer]) {
      await client.getByRole('link', { name: '出品待定 0 笔' }).waitFor();
      await client.getByText('暂无匹配订单。', { exact: true }).waitFor();
    }
    await page.getByRole('button', { name: '未来 30 天' }).click();
    await page.waitForURL(url => !url.hash.includes('2026-10-31'));
    assert.deepEqual(errors, []);
  } finally {
    signal.resolve();
    await context.close();
  }
});
