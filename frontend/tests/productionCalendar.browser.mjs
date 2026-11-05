import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createRequire } from 'node:module';
import { createOrderFixture, orderId } from './orderBrowserFixture.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DRAFT_TEST_URL || 'http://127.0.0.1:5197';
const date = '2026-11-05';
let browser;
before(async () => { browser = await chromium.launch({ headless: true, channel: 'chrome' }); });
after(async () => { await browser?.close(); });

test('制作日历准确时间、首项规格、缩略图归属、统计及权限组合', async () => {
  const { context, page, model, png, errors } = await createOrderFixture(browser, base);
  try {
    model.permissions = ['ORDER_READ', 'ORDER_PHONE_READ', 'ORDER_PRODUCTION_UPDATE'];
    let roles = ['BAKER'];
    await context.route('**/api/me', route => route.fulfill({ json: { success: true, data: { accountId: model.account, nickname: '测试师傅', jobRoles: roles, access: { permissions: model.permissions, uiCapabilities: [] } } } }));
    const firstId = crypto.randomUUID(), secondId = crypto.randomUUID();
    const item = { itemId: firstId, name: '草莓蛋糕', productType: 'CAKE', quantity: 2, attributes: { size: '6', base: '原味' }, recentNotes: [] };
    const order = (orderNo, finish, patch = {}) => ({ orderId: crypto.randomUUID(), orderNo, calendarDate: date, status: 'WAITING_PRODUCTION', currentStageCode: null, paymentStatus: null,
      fulfillmentType: 'PICKUP', plannedHandoffAt: date + 'T18:00:00+08:00', requestedReceiveAt: date + 'T18:00:00+08:00', plannedFinishAt: finish,
      customer: null, address: null, items: [{ ...item }], latestNote: null, ...patch });
    const main = order('001', date + 'T16:10:35+08:00', { orderId, items: [item, { ...item, itemId: secondId, name: '第二个蛋糕', quantity: 1, attributes: { size: '12', base: '巧克力' } }],
      latestNote: { id: 1, content: '装饰请参考图片', actorNameSnapshot: '前台', createdAt: date + 'T08:00:00+08:00' } });
    const sameTime = order('002', date + 'T16:10:35+08:00');
    const nextTime = order('003', date + 'T16:11:00+08:00', { items: [{ ...item, productType: 'COOKIE', attributes: { specification: '12片装' } }] });
    const prior = order('004', '2026-11-04T16:10:00+08:00');
    const unspecified = order('005', null, { items: [{ ...item, attributes: {} }] });
    const completed = order('006', date + 'T17:00:00+08:00', { status: 'COMPLETED' });
    const cancelled = order('007', null, { status: 'CANCELLED' });
    const deleted = order('008', null, { deleted: true });
    const rows = [nextTime, main, sameTime, prior, unspecified, completed, cancelled, deleted];
    const requests = [];
    page.on('request', request => { if (request.url().includes('/api/')) requests.push(request.url()); });
    await context.route('**/api/orders/calendar?**', route => route.fulfill({ json: { success: true, data: rows.filter(row => !row.deleted).map(row => ({ ...row, customerPhoneLast4: null })) } }));
    await context.route('**/api/orders/workbench?**', route => route.fulfill({ json: { success: true, data: { date, metrics: null, pendingOrders: rows } } }));
    await context.route('**/api/orders/workbench/cake-bases?**', route => route.fulfill({ json: { success: true, data: { date, items: [{ size: '6', flavor: '原味', quantity: 8 }] } } }));
    const otherImage = crypto.randomUUID(), orderImage = crypto.randomUUID(), firstImage = crypto.randomUUID();
    let images = [{ imageId: otherImage, itemId: secondId }, { imageId: orderImage, itemId: null }, { imageId: firstImage, itemId: firstId }];
    const imageRequests = [];
    await context.route(`**/api/orders/${orderId}/images`, route => route.fulfill({ json: { success: true, data: images } }));
    await context.route(`**/api/orders/${orderId}/images/*`, route => { imageRequests.push(new URL(route.request().url()).pathname.split('/').at(-1)); return route.fulfill({ contentType: 'image/png', body: png }); });
    await page.goto('about:blank'); requests.length = 0;
    await page.goto(`${base}/#/?date=${date}`);
    const card = page.locator(`[data-order-id="${orderId}"]`);
    await card.locator('.production-card-specifications').waitFor();
    await card.locator('.production-thumbnail img').waitFor();
    assert.deepEqual(imageRequests, [firstImage]);
    assert.deepEqual(await card.locator('.production-card-specifications dd').allTextContents(), ['6 寸', '原味']);
    assert.match(await card.locator('.order-summary-caption > span').innerText(), /2 项 · 3 件 · 另有 1 项/);
    assert.equal((await card.innerText()).includes('第二个蛋糕'), false);
    assert.equal(await card.locator('.order-summary-receive-time').count(), 0);
    assert.doesNotMatch(await card.innerText(), /取货时间|出品时间|制作订单/);
    assert.match(await card.innerText(), /装饰请参考图片/);
    assert.equal(await page.locator('.timeline-heading, .timeline-end').count(), 0);
    const exact = page.getByRole('region', { name: date + ' 出品时间 16:10', exact: true });
    assert.deepEqual(await exact.locator('.order-summary-number').allTextContents(), ['#001', '#002']);
    assert.equal(await page.getByRole('region', { name: date + ' 出品时间 16:11', exact: true }).count(), 1);
    assert.equal(await page.getByRole('region', { name: '2026-11-04 出品时间 16:10', exact: true }).locator('.timeline-date').innerText(), '2026-11-04');
    assert.match(await page.locator(`[data-order-id="${unspecified.orderId}"]`).innerText(), /尺寸待确认[\s\S]*蛋糕胚待确认/);
    assert.equal(await page.getByRole('region', { name: '出品待定', exact: true }).count(), 1);
    assert.deepEqual(await page.locator(`[data-order-id="${nextTime.orderId}"] .production-card-specifications dt`).allTextContents(), ['规格']);
    assert.equal(await page.locator(`[data-order-id="${deleted.orderId}"]`).count(), 0);
    assert.equal(await page.locator('.calendar-workbench > .section-heading h2 span').innerText(), '7');
    const statistics = page.locator('.daily-statistics');
    assert.equal(await statistics.getAttribute('open'), null);
    await statistics.locator('summary').click();
    assert.equal(await statistics.locator('.production-order-count').innerText(), '6 笔');
    assert.match(await statistics.innerText(), /蛋糕胚统计/);
    assert.doesNotMatch(await statistics.innerText(), /待配送|付款|查看明细/);
    assert.equal(requests.some(url => url.includes('payment-summary')), false);
    await page.locator('[data-control-label="订单状态"] button').click();
    await page.getByRole('option', { name: '待制作', exact: true }).click();
    assert.equal(await statistics.locator('.production-order-count').innerText(), '6 笔');
    await page.getByRole('button', { name: '清除筛选', exact: true }).click();
    const originalName = item.name;
    item.name = '超长蛋糕名称'.repeat(12); item.attributes.base = '原味与巧克力混合蛋糕胚'.repeat(8);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(({ name, id }) => document.querySelector(`[data-order-id="${id}"] h3`)?.textContent === name, { name: item.name, id: orderId });
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const positions = await card.locator('.production-card-specifications > div').evaluateAll(nodes => nodes.map(node => ({ x: node.getBoundingClientRect().x, y: node.getBoundingClientRect().y })));
      assert.equal(positions[0].y, positions[1].y); assert.ok(positions[1].x > positions[0].x);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}: 无横向溢出`);
      if (process.env.PRODUCTION_SCREENSHOT_DIR) { await card.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.PRODUCTION_SCREENSHOT_DIR}/production-calendar-${width}.png`, fullPage: true }); }
    }
    item.name = originalName; item.attributes.base = '原味';
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(id => document.querySelector(`[data-order-id="${id}"] h3`)?.textContent === '草莓蛋糕', orderId);
    if (process.env.PRODUCTION_SCREENSHOT_DIR) {
      await page.setViewportSize({ width: 390, height: 844 });
      await card.screenshot({ path: `${process.env.PRODUCTION_SCREENSHOT_DIR}/production-card-390.png` });
      await page.screenshot({ path: `${process.env.PRODUCTION_SCREENSHOT_DIR}/production-calendar-normal-390.png`, fullPage: true });
    }
    images = images.filter(image => image.itemId !== firstId); imageRequests.length = 0;
    await page.reload(); await card.locator('.production-thumbnail img').waitFor(); assert.deepEqual(imageRequests, [orderImage]);
    images = images.filter(image => image.itemId !== null); imageRequests.length = 0;
    await page.reload(); await card.getByText('暂无款式图片', { exact: true }).waitFor(); assert.deepEqual(imageRequests, []);
    model.permissions.push('ORDER_AMOUNT_READ'); requests.length = 0;
    await page.reload(); await card.waitFor(); await statistics.locator('summary').click();
    assert.equal(await page.locator('[data-control-label="付款状态"]').count(), 1);
    assert.equal(requests.some(url => url.includes('payment-summary')), false);
    assert.doesNotMatch(await statistics.innerText(), /待配送|付款/);
    for (const jobRoles of [['BAKER', 'FRONT_DESK_CLERK'], ['STORE_MANAGER']]) {
      roles = jobRoles;
      model.permissions = ['ORDER_READ', 'ORDER_CUSTOMER_READ', 'ORDER_BUSINESS_DETAILS_READ', 'ORDER_AMOUNT_READ'];
      await page.reload(); await card.locator('.front-card-times').waitFor();
      assert.equal(await card.locator('.production-card-specifications').count(), 0);
      assert.equal(await page.locator('.timeline-heading').count(), 1);
      assert.equal(await card.locator('xpath=ancestor::section[contains(@class,"timeline-group")]').getAttribute('aria-label'), date + ' 取货时段 18:00 至 18:30');
      await statistics.locator('summary').click(); await statistics.getByRole('heading', { name: '订单汇总', exact: true }).waitFor();
      assert.match(await statistics.innerText(), /待配送/);
    }
    model.permissions = model.permissions.filter(permission => permission !== 'ORDER_AMOUNT_READ');
    await page.reload(); await card.locator('.front-card-times').waitFor();
    assert.equal(await page.locator('[data-control-label="付款状态"]').count(), 0);
    assert.deepEqual(errors, []);
  } catch (error) { console.log('制作回归失败页面', page.url(), (await page.locator('body').innerText()).slice(0, 1800)); throw error; } finally { await context.close(); }
});
