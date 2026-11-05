import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createRequire } from 'node:module';
import { createOrderFixture, orderId } from './orderBrowserFixture.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DRAFT_TEST_URL || 'http://127.0.0.1:5197';
let browser;
before(async () => { browser = await chromium.launch({ headless: true, channel: 'chrome' }); });
after(async () => { await browser?.close(); });

test('前台卡片精简、时间两列、创建高亮、筛选与详情往返，以及制作岗位原展示', async () => {
  const { context, page, model, complete, errors } = await createOrderFixture(browser, base);
  const extra = [];
  const pending = () => model.order ? [{ ...model.order, calendarDate: model.order.fulfillment.requestedReceiveDate,
    plannedHandoffAt: model.order.fulfillment.plannedHandoffAt, requestedReceiveAt: model.order.fulfillment.requestedReceiveAt,
    plannedFinishAt: model.order.fulfillment.plannedFinishAt, fulfillmentType: model.order.fulfillment.type }, ...extra] : [];
  try {
    await context.route('**/api/orders/calendar?**', route => route.fulfill({ json: { success: true, data: pending().map(order => ({ ...order, customerPhoneLast4: '0000' })) } }));
    await context.route('**/api/orders/workbench?**', route => route.fulfill({ json: { success: true, data: { pendingOrders: pending(), metrics: null } } }));
    await context.route(`**/api/orders/${orderId}/customer-origin`, route => route.fulfill({ json: { success: true, data: null } }));
    await complete(); await page.getByRole('button', { name: '创建订单', exact: true }).click();
    await page.locator('.is-new-order .created-order-badge').waitFor();
    assert.equal(await page.locator('.is-new-order .created-order-badge').innerText(), '刚刚创建');
    const date = model.order.fulfillment.requestedReceiveDate;
    const prior = new Date(Date.parse(date + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
    const cake = model.order.items[0];
    cake.name = '草莓芒果生日蛋糕'.repeat(8);
    model.order.items.push({ ...cake, itemId: '20000000-0000-4000-8000-000000000002', name: '小饼干', quantity: 6 });
    model.order.fulfillment.plannedHandoffAt = date + 'T23:45:00+08:00';
    model.order.fulfillment.requestedReceiveAt = date + 'T21:00:00+08:00';
    model.order.fulfillment.plannedFinishAt = prior + 'T23:15:00+08:00';
    model.order.latestNote = { id: 1, content: '请提前联系取货', itemId: null, actorNameSnapshot: '测试员工', createdAt: date + 'T08:00:00Z' };
    extra.push({ ...pending()[0], orderId: '30000000-0000-4000-8000-000000000003', orderNo: 'TEST-PENDING', items: [{ ...cake, name: '野餐盒' }],
      status: 'PROCESSING', paymentStatus: 'PAID', plannedHandoffAt: null, requestedReceiveAt: null, plannedFinishAt: null, latestNote: null });
    extra.push({ ...pending()[0], orderId: '40000000-0000-4000-8000-000000000004', orderNo: 'TEST-COMPLETED', items: [{ ...cake, name: '历史已完成订单' }],
      status: 'COMPLETED', plannedHandoffAt: null, requestedReceiveAt: date + 'T09:10:00+08:00', plannedFinishAt: date + 'T08:00:00+08:00', latestNote: null });
    await page.reload();
    const main = page.locator(`[data-order-id="${orderId}"]`), unspecified = page.locator('[data-order-id="30000000-0000-4000-8000-000000000003"]');
    await main.locator('.front-card-times').waitFor();
    assert.equal(await main.locator('h3').innerText(), cake.name + ' · 另有 1 项');
    assert.equal(await main.locator('.order-summary-caption > span').count(), 0);
    assert.equal(await main.locator('.order-summary-meta').count(), 0);
    assert.equal(await main.locator('.order-summary-number').count(), 0);
    assert.equal((await main.innerText()).includes('13800000000'), false);
    assert.equal((await main.innerText()).includes('TEST-IMAGE'), false);
    assert.equal(await main.locator('.front-card-times dd').nth(0).innerText(), date.replaceAll('-', '/') + ' 23:45');
    assert.equal(await main.locator('.front-card-times dd').nth(1).innerText(), prior.replaceAll('-', '/') + ' 23:15');
    assert.equal(await main.locator('.order-summary-note-preview').innerText(), '备注：请提前联系取货');
    assert.equal(await main.locator('.badges').getByText('待制作', { exact: true }).count(), 1);
    assert.equal(await main.locator('.badges').getByText('未付款', { exact: true }).count(), 1);
    assert.equal(await unspecified.locator('h3').innerText(), '野餐盒');
    assert.equal(await unspecified.locator('.front-card-times dd').nth(0).innerText(), date + ' · 时刻待定');
    assert.equal(await unspecified.locator('.front-card-times dd').nth(1).innerText(), '待定');
    assert.equal(await main.locator('xpath=ancestor::section[contains(@class,"timeline-group")]').getAttribute('aria-label'), date + ' 取货时段 23:30 至次日 00:00');
    assert.equal(await page.locator('.order-partition').filter({ hasText: '已完成' }).locator('.timeline-partition-toggle').getAttribute('aria-expanded'), 'false');
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 1000 });
      const positions = await main.locator('.front-card-times > div').evaluateAll(nodes => nodes.map(node => ({ x: node.getBoundingClientRect().x, y: node.getBoundingClientRect().y })));
      assert.equal(positions[0].y, positions[1].y); assert.ok(positions[1].x > positions[0].x);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await main.scrollIntoViewIfNeeded(); await page.screenshot({ path: `/private/tmp/wuhou-calendar-cards-${width}.png`, fullPage: true });
    }
    await page.locator('[data-control-label="订单状态"] .choice-trigger').click(); await page.getByRole('option', { name: '待制作', exact: true }).click();
    await page.locator('[data-control-label="付款状态"] .choice-trigger').click(); await page.getByRole('option', { name: '未付款', exact: true }).click();
    assert.equal(await page.locator('.order-summary-card:visible').count(), 1);
    const calendarUrl = page.url();
    await main.click(); await page.locator('.front-order-information').waitFor();
    await page.getByRole('link', { name: '日历工作台', exact: true }).click();
    await main.waitFor(); assert.equal(page.url(), calendarUrl);
    assert.equal(await page.locator('.order-summary-card:visible').count(), 1);
    assert.match(await page.locator('[data-control-label="订单状态"] .choice-trigger').innerText(), /待制作/);
    assert.match(await page.locator('[data-control-label="付款状态"] .choice-trigger').innerText(), /未付款/);
    await page.getByRole('button', { name: '清除筛选', exact: true }).click();
    await page.locator('.order-partition').filter({ hasText: '已完成' }).locator('.timeline-partition-toggle').click();
    const completed = page.locator('[data-order-id="40000000-0000-4000-8000-000000000004"]'); await completed.waitFor();
    assert.equal(await completed.locator('.front-card-times dd').nth(0).innerText(), date.replaceAll('-', '/') + ' 09:10');
    model.permissions = model.permissions.filter(permission => permission !== 'ORDER_AMOUNT_READ');
    await page.reload(); await main.locator('.front-card-times').waitFor();
    assert.equal(await main.locator('.badges .badge').count(), 1);
    assert.equal(await page.locator('[data-control-label="付款状态"]').count(), 0);
    model.permissions = ['ORDER_READ', 'ORDER_PHONE_READ', 'ORDER_PRODUCTION_UPDATE'];
    await page.reload(); await main.locator('.production-thumbnail').waitFor();
    assert.equal(await main.locator('.front-card-times').count(), 0);
    assert.match(await main.locator('.order-summary-caption > span').innerText(), /2 项 · 7 件/);
    assert.equal(await main.locator('.order-summary-receive-time').count(), 0);
    assert.equal(await main.locator('.production-card-specifications').count(), 1);
    assert.match(await main.locator('.order-summary-number').innerText(), /TEST-IMAGE/);
    assert.equal(await main.locator('xpath=ancestor::section[contains(@class,"timeline-group")]').getAttribute('aria-label'), prior + ' 出品时间 23:15');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
