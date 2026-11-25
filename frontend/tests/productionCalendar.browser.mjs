import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createRequire } from 'node:module';
import { calendarDays, createOrderFixture, orderId, workbenchCards } from './orderBrowserFixture.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DRAFT_TEST_URL || 'http://127.0.0.1:5197';
const date = '2026-11-05';
let browser;
before(async () => { browser = await chromium.launch({ headless: true, channel: 'chrome' }); });
after(async () => { await browser?.close(); });

const recoverNetwork = page => page.evaluate(() => {
  window.dispatchEvent(new Event('offline'));
  window.dispatchEvent(new Event('online'));
});

test('手机日历配送筛选按约定时间排列并分隔已送达订单', async () => {
  const { context, page, errors } = await createOrderFixture(browser, base);
  try {
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format();
    const tomorrow = new Date(Date.parse(today) + 86_400_000).toISOString().slice(0, 10);
    const order = (orderNo, time, status, extras = {}) => ({
      orderId: crypto.randomUUID(), orderNo, status, calendarDate: today, fulfillmentType: 'DELIVERY',
      paymentStatus: 'UNPAID', plannedHandoffAt: `${today}T${time}:00+08:00`,
      plannedFinishAt: `${today}T08:00:00+08:00`, items: [], ...extras,
    });
    const delivered = order('送达', '08:30', 'COMPLETED');
    const frosting = order('抹面', '09:00', 'FROSTING', { plannedFinishAt: `${today}T08:45:00+08:00` });
    const ready = order('待送', '10:00', 'WAITING_DELIVERY', { address: '测试街道'.repeat(32), customer: { phone: '13800000000' } });
    const paid = order('已付款制作', '11:00', 'CAKE_BASE', { paymentStatus: 'PAID' });
    const nextDay = order('次日送达', '11:00', 'COMPLETED', {
      calendarDate: tomorrow, plannedHandoffAt: `${tomorrow}T11:00:00+08:00`,
    });
    const rows = [delivered, paid, ready, frosting, nextDay,
      order('自提', '08:00', 'WAITING_DELIVERY', { fulfillmentType: 'PICKUP' }),
      order('取消', '08:00', 'CANCELLED')];
    await context.route('**/api/orders/workbench/cards?**', route => {
      const selected = new URL(route.request().url()).searchParams.get('date');
      return route.fulfill({ json: { success: true, data: workbenchCards(route.request(), rows.filter(row => row.calendarDate === selected)) } });
    });
    await page.goto(`${base}/#/?date=${today}`);
    const select = async (label, name) => {
      await page.locator(`[data-control-label="${label}"] button`).click();
      await page.getByRole('option', { name, exact: true }).click();
    };
    await select('订单状态', '今日需配送');
    const cards = page.locator('.order-timeline .order-summary-card');
    const readyCard = page.locator(`[data-order-id="${ready.orderId}"]`);
    const separator = page.getByRole('heading', { name: '已送达', exact: true });
    await readyCard.locator('xpath=ancestor::section[@aria-label="' + today + ' 配送时间 10:00"]').waitFor();
    assert.deepEqual(await cards.locator('h3').allTextContents(), ['订单 #抹面', '订单 #待送', '订单 #已付款制作', '订单 #送达']);
    const highlighted = page.locator('.order-summary-card.is-ready-for-delivery');
    assert.equal(await highlighted.count(), 1);
    assert.match(await readyCard.locator('.calendar-address-preview').innerText(), /^配送地址.*测试街道/u);
    assert.equal(await page.locator(`[data-order-id="${paid.orderId}"] .calendar-address-preview`).innerText(), '配送地址未填写');
    assert.equal(await highlighted.getAttribute('data-order-id'), ready.orderId);
    assert.equal(await highlighted.evaluate(node => getComputedStyle(node).borderTopWidth), '2px');
    assert.equal(await separator.evaluate(node => getComputedStyle(node).borderTopWidth), '1px');
    assert.equal(await separator.locator('..').locator('.order-summary-card').getAttribute('data-order-id'), delivered.orderId);
    assert.match(await readyCard.getAttribute('href'), new RegExp(ready.orderId));
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const address = readyCard.locator('.calendar-address-preview');
      assert.ok(await address.evaluate(node => node.scrollHeight > node.clientHeight
        && node.clientHeight <= 2 * parseFloat(getComputedStyle(node).lineHeight) + 1));
      assert.ok(await readyCard.getByText('13800000000').isVisible());
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    if (process.env.PRODUCTION_SCREENSHOT_DIR) {
      await page.locator('.order-timeline').screenshot({ path: `${process.env.PRODUCTION_SCREENSHOT_DIR}/delivery-calendar-390.png` });
    }

    await select('付款状态', '已付款');
    await expectCardNames(['订单 #已付款制作']);
    assert.equal(await separator.count(), 0);
    await select('付款状态', '全部');
    await highlighted.waitFor();
    ready.status = 'COMPLETED';
    await recoverNetwork(page);
    await highlighted.waitFor({ state: 'detached' });
    await expectCardNames(['订单 #抹面', '订单 #已付款制作', '订单 #送达', '订单 #待送']);

    await page.evaluate(date => { location.hash = `#/?date=${date}&view=month&expanded=1`; }, tomorrow);
    await expectCardNames(['订单 #次日送达']);
    assert.ok(await page.locator('[data-control-label="订单状态"] button').getByText('当日需配送').isVisible());
    assert.ok(await separator.isVisible());
    assert.deepEqual(errors, []);

    async function expectCardNames(names) {
      await page.waitForFunction(expected => {
        const names = [...document.querySelectorAll('.order-timeline .order-summary-card h3')].map(node => node.textContent);
        return JSON.stringify(names) === JSON.stringify(expected);
      }, names);
    }
  } finally {
    await context.close();
  }
});

test('制作日历准确时间、首项规格、缩略图归属、统计及权限组合', async () => {
  const { context, page, model, png, errors } = await createOrderFixture(browser, base);
  try {
    model.permissions = ['ORDER_READ', 'ORDER_PHONE_READ', 'ORDER_PRODUCTION_UPDATE'];
    let roles = ['BAKER'];
    await context.route('**/api/me', route => route.fulfill({ json: { success: true, data: { accountId: model.account, nickname: '测试师傅', jobRoles: roles, access: { permissions: model.permissions, uiCapabilities: [] } } } }));
    const firstId = crypto.randomUUID(), secondId = crypto.randomUUID();
    const item = { itemId: firstId, name: '草莓蛋糕', productType: 'CAKE', quantity: 2, attributes: { size: '6', base: '原味' }, recentNotes: [] };
    const order = (orderNo, finish, patch = {}) => ({ orderId: crypto.randomUUID(), orderNo, calendarDate: date, status: 'CAKE_BASE', currentStageCode: null, paymentStatus: null,
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
    await context.route('**/api/orders/calendar/days?**', route => route.fulfill({ json: { success: true, data: calendarDays(rows.filter(row => !row.deleted).map(row => ({ ...row, customerPhoneLast4: null }))) } }));
    await context.route('**/api/orders/workbench/cards?**', route => route.fulfill({ json: { success: true, data: workbenchCards(route.request(), rows) } }));
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
    await card.scrollIntoViewIfNeeded();
    await card.locator('.production-thumbnail img').waitFor();
    assert.deepEqual(imageRequests, [firstImage]);
    assert.deepEqual(await card.locator('.production-card-specifications dd').allTextContents(), ['6', '原味']);
    assert.match(await card.locator('.order-summary-caption > span').innerText(), /2 项 · 3 件 · 另有 1 项/);
    assert.equal((await card.innerText()).includes('第二个蛋糕'), false);
    assert.equal(await card.locator('.order-summary-receive-time').count(), 0);
    assert.doesNotMatch(await card.innerText(), /取货时间|出品时间|制作订单/);
    assert.match(await card.innerText(), /装饰请参考图片/);
    assert.equal(await page.locator('.timeline-end').count(), 0);
    const exact = page.getByRole('region', { name: date + ' 出品时间 16:10', exact: true });
    assert.deepEqual(await exact.locator('.order-summary-number').allTextContents(), ['#001', '#002']);
    assert.equal(await page.getByRole('region', { name: date + ' 出品时间 16:11', exact: true }).count(), 1);
    assert.equal(await page.getByRole('region', { name: '2026-11-04 出品时间 16:10', exact: true }).locator('.timeline-date').innerText(), '11/04');
    assert.match(await page.locator(`[data-order-id="${unspecified.orderId}"]`).innerText(), /尺寸待确认[\s\S]*蛋糕胚待确认/);
    assert.equal(await page.getByRole('region', { name: '出品待定', exact: true }).count(), 1);
    assert.deepEqual(await page.locator(`[data-order-id="${nextTime.orderId}"] .production-card-specifications dt`).allTextContents(), ['规格']);
    assert.equal(await page.locator(`[data-order-id="${deleted.orderId}"]`).count(), 0);
    assert.equal(await page.locator('.calendar-workbench > .section-heading h2 span').innerText(), '7');
    const statistics = page.locator('.daily-statistics');
    assert.equal(await statistics.getAttribute('open'), null);
    await statistics.locator('summary').click();
    const cakeBases = statistics.getByRole('region', { name: '蛋糕胚统计' });
    await cakeBases.getByText('8 个', { exact: true }).first().waitFor();
    assert.deepEqual(await statistics.getByRole('heading').allTextContents(), ['11/05 蛋糕胚统计']);
    assert.doesNotMatch(await statistics.innerText(), /待配送|付款|查看明细/);
    assert.equal(requests.some(url => url.includes('payment-summary')), false);
    await page.locator('[data-control-label="订单状态"] button').click();
    await page.getByRole('option', { name: '出胚', exact: true }).click();
    assert.ok(await cakeBases.getByText('8 个', { exact: true }).first().isVisible());
    await page.getByRole('button', { name: '清除筛选', exact: true }).click();
    const originalName = item.name;
    item.name = '超长蛋糕名称'.repeat(12); item.attributes.base = '原味与巧克力混合蛋糕胚'.repeat(8);
    await recoverNetwork(page);
    await page.waitForFunction(({ name, id }) => document.querySelector(`[data-order-id="${id}"] h3`)?.textContent === name, { name: item.name, id: orderId });
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const positions = await card.locator('.production-card-specifications > div').evaluateAll(nodes => nodes.map(node => ({ x: node.getBoundingClientRect().x, y: node.getBoundingClientRect().y })));
      assert.equal(positions[0].y, positions[1].y); assert.ok(positions[1].x > positions[0].x);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}: 无横向溢出`);
      if (process.env.PRODUCTION_SCREENSHOT_DIR) { await card.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.PRODUCTION_SCREENSHOT_DIR}/production-calendar-${width}.png`, fullPage: true }); }
    }
    item.name = originalName; item.attributes.base = '原味';
    await recoverNetwork(page);
    await page.waitForFunction(id => document.querySelector(`[data-order-id="${id}"] h3`)?.textContent === '草莓蛋糕', orderId);
    if (process.env.PRODUCTION_SCREENSHOT_DIR) {
      await page.setViewportSize({ width: 390, height: 844 });
      await card.screenshot({ path: `${process.env.PRODUCTION_SCREENSHOT_DIR}/production-card-390.png` });
      await page.screenshot({ path: `${process.env.PRODUCTION_SCREENSHOT_DIR}/production-calendar-normal-390.png`, fullPage: true });
    }
    images = images.filter(image => image.itemId !== firstId); imageRequests.length = 0;
    await page.reload(); await card.scrollIntoViewIfNeeded(); await card.locator('.production-thumbnail img').waitFor(); assert.deepEqual(imageRequests, [orderImage]);
    images = images.filter(image => image.itemId !== null); imageRequests.length = 0;
    await page.reload(); await card.scrollIntoViewIfNeeded(); await card.getByText('暂无款式图片', { exact: true }).waitFor(); assert.deepEqual(imageRequests, []);
    model.permissions.push('ORDER_AMOUNT_READ'); requests.length = 0;
    await page.reload(); await card.waitFor(); await statistics.locator('summary').click();
    assert.equal(await page.locator('[data-control-label="付款状态"]').count(), 1);
    assert.equal(requests.some(url => url.includes('payment-summary')), false);
    assert.doesNotMatch(await statistics.innerText(), /订单汇总|订单总数|待配送|付款/);
    for (const jobRoles of [['BAKER', 'FRONT_DESK_CLERK'], ['STORE_MANAGER']]) {
      roles = jobRoles;
      model.permissions = ['ORDER_READ', 'ORDER_CUSTOMER_READ', 'ORDER_BUSINESS_DETAILS_READ', 'ORDER_AMOUNT_READ'];
      await page.reload(); await card.locator('.front-card-times').waitFor();
      assert.equal(await card.locator('.production-card-specifications').count(), 0);
      assert.equal(await card.locator('xpath=ancestor::section[contains(@class,"timeline-group")]').getAttribute('aria-label'), date + ' 取货时段 18:00 至 18:30');
      await statistics.locator('summary').click(); await statistics.getByRole('heading', { name: '订单汇总', exact: true }).waitFor();
      assert.match(await statistics.innerText(), /待配送/);
    }
    model.permissions = model.permissions.filter(permission => permission !== 'ORDER_AMOUNT_READ');
    await page.reload(); await card.locator('.front-card-times').waitFor();
    assert.equal(await page.locator('[data-control-label="付款状态"]').count(), 0);
    const signal = Promise.withResolvers();
    await context.route('**/api/orders/stream', async route => {
      const change = await signal.promise;
      await route.fulfill({ contentType: 'text/event-stream', body: `event: order.changed\ndata: ${JSON.stringify(change)}\n\n` }).catch(() => {});
    });
    model.order = { ...main, version: 0, fulfillment: { type: 'PICKUP', requestedReceiveDate: date }, currentStageCode: null };
    await page.reload(); await card.waitFor();
    const detailPage = await context.newPage();
    await detailPage.goto(base + '/#/orders/' + orderId);
    await detailPage.locator('[aria-current="step"]').getByText('出胚', { exact: true }).waitFor();
    await page.locator('[data-control-label="订单状态"] button').click();
    await page.getByRole('option', { name: '出胚', exact: true }).click();
    main.status = 'LAYER';
    model.order = { ...model.order, status: 'LAYER', version: 1 };
    signal.resolve({ orderId, version: 1, changeType: 'ORDER_PRODUCTION_CHANGED' });
    await detailPage.locator('[aria-current="step"]').getByText('夹层', { exact: true }).waitFor();
    await card.waitFor({ state: 'hidden' });
    await page.locator('[data-control-label="订单状态"] button').click();
    await page.getByRole('option', { name: '夹层', exact: true }).click();
    await card.locator('.badge').getByText('夹层', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
  } catch (error) { console.log('制作回归失败页面', page.url(), (await page.locator('body').innerText()).slice(0, 1800)); throw error; } finally { await context.close(); }
});

test('手机与桌面详情共用六节点，师傅切换商品可核对规格、要求和对应图片', async () => {
  const { context, page, model, select, errors } = await createOrderFixture(browser, base);
  try {
    const originalPermissions = model.permissions;
    let roles = ['DECORATOR'];
    await context.route('**/api/me', route => route.fulfill({ json: { success: true, data: {
      accountId: model.account, nickname: '测试裱花师', jobRoles: roles, access: { permissions: model.permissions, uiCapabilities: [] },
    } } }));
    await context.route(`**/api/orders/${orderId}/customer-origin`, route => route.fulfill({ json: { success: true, data: null } }));
    const cake = { itemId: crypto.randomUUID(), name: '草莓蛋糕', productType: 'CAKE', quantity: 1,
      attributes: { size: '8', base: '原味', filling: '芒果、奥利奥碎、黄油脆片', flavor: '动物奶油', message: '生日快乐', requirements: '请把文字写在蛋糕正中\n' + '请分开包装并准备蜡烛'.repeat(8) },
      unitPriceCents: 18800, memberPriceCents: 16900, productionStatus: 'COMPLETED', recentNotes: [] };
    const cookies = { itemId: crypto.randomUUID(), name: '手工饼干', productType: 'COOKIE', quantity: 3,
      attributes: { specification: '每盒六片', requirements: '分袋装' }, productionStatus: 'IN_PROGRESS', recentNotes: [] };
    model.order = { orderId, orderNo: 'TEST-SIX', version: 4, status: 'DECORATING', currentStageCode: null,
      customer: { customerName: '测试客户', phone: '13800000000', buyerName: '测试订购人' }, orderingMethod: '到店',
      fulfillment: { type: 'PICKUP', address: '合成取货地址', requestedReceiveDate: date, plannedFinishAt: date + 'T16:10:00+08:00' },
      createdAt: '2026-11-04T08:00:00Z',
      items: [cake, cookies], pricingMode: 'ITEM_SUM', paymentStatus: 'PAID', paymentMethod: 'CASH',
      paidAt: '2026-11-04T08:01:00Z', totalAmountCents: 16900 };
    model.images = [cake, cookies].map(item => ({ imageId: crypto.randomUUID(), orderId, itemId: item.itemId,
      filename: item.name + '.png', contentType: 'image/png' }));
    model.images.push({ ...model.images[0], imageId: crypto.randomUUID(), filename: '第二张款式.png' });
    model.images.push({ ...model.images[0], imageId: crypto.randomUUID(), itemId: null, filename: '历史款式.png' });
    model.images.push({ ...model.images[0], imageId: crypto.randomUUID(), itemId: crypto.randomUUID(), filename: '已移除商品款式.png' });
    const decoratorPermissions = ['ORDER_READ', 'ORDER_PRODUCTION_UPDATE', 'ORDER_FULFILLMENT_UPDATE',
      'ORDER_PHONE_READ', 'ORDER_ORDERING_DETAILS_READ', 'ORDER_IMAGE_UPLOAD', 'ORDER_IMAGE_DELETE',
      'ORDER_CANCEL', 'ORDER_EXPORT', 'ORDER_ACTIVITY_READ', 'ORDER_NOTE_CREATE'];
    model.permissions = decoratorPermissions;
    const open = async () => {
      await page.goto('about:blank');
      await page.goto(base + '/#/orders/' + orderId);
      await page.getByRole('list', { name: '整单状态进度' }).waitFor();
    };
    const labels = ['出胚', '夹层', '抹面', '装饰', '待自提', '已自提'];
    const checkProgress = async (compact = true) => {
      assert.deepEqual(await page.locator('.progress-label').allTextContents(), labels);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const steps = page.locator('.progress-step');
      const rows = await steps.evaluateAll(nodes => new Set(nodes.map(node => node.getBoundingClientRect().top)).size);
      assert.equal(rows, compact ? 1 : 2);
      assert.equal(await steps.nth(3).evaluate(node => getComputedStyle(node, '::after').display), compact ? 'block' : 'none');
      assert.equal(await steps.getByRole('button').count(), 0);
      const current = await steps.evaluateAll(nodes => nodes.findIndex(node => node.getAttribute('aria-current') === 'step'));
      assert.equal(await steps.locator('.progress-done-mark:visible').count(), current);
      assert.equal(await steps.locator('.progress-done-mark:not([aria-hidden="true"])').count(), 0);
      assert.equal(await page.locator('.progress-step:not(.done) .progress-done-mark').count(), 0);
    };
    const information = page.getByRole('region', { name: '订单信息', exact: true });
    const contacts = page.getByRole('region', { name: '客户与交接', exact: true });
    const checkContacts = async fields => {
      assert.deepEqual(await information.locator('dt').allTextContents(), ['到店自提时间', '出品时间']);
      const times = await information.locator('dd').allTextContents();
      assert.match(times[0], /^(?:2026年)?11月5日 · 时刻待定$/);
      assert.match(times[1], /^(?:2026年)?11月5日 16:10$/);
      assert.deepEqual(await contacts.locator('dt').allTextContents(), fields);
      assert.equal(await contacts.locator('a[href="tel:13800000000"]').count(), 1);
      assert.ok(await contacts.evaluate(section => section === section.parentElement.lastElementChild));
    };
    const products = page.getByRole('region', { name: '商品资料' });
    const images = products.getByRole('region', { name: '图片', exact: true });
    const addImage = images.getByRole('button', { name: '添加图片', exact: true });
    const uploadHelp = images.getByText(/每商品最多 5 张，JPG/);
    const removeSavedImage = images.getByRole('button', { name: /^移除图片：/ });
    const currentImageTile = images.locator('.image-grid').first().locator('.reference-image');
    const cancelOrder = page.getByRole('button', { name: '取消订单', exact: true });
    const downloadOrder = page.getByRole('button', { name: '下载 XLSX', exact: true });
    const reversePayment = page.getByRole('button', { name: '撤销付款登记', exact: true });
    const payment = page.locator('.payment-disclosure');
    const paymentSummary = payment.locator('summary');
    const supplement = page.getByText('补充资料', { exact: true });
    const checkProductFields = async editable => {
      for (const name of ['添加商品', '编辑', '移除']) {
        const action = products.getByRole('button', { name, exact: true });
        if (editable) assert.ok(await action.isEnabled());
        else assert.equal(await action.count(), 0);
      }
      const rows = [];
      for (const label of ['数量', '尺寸', '内胚', '夹馅', '奶油']) {
        const field = products.getByText(label, { exact: true }).locator('..');
        assert.ok(await field.locator('dt').evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 16));
        assert.ok(await field.locator('dd').evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 20 && el.scrollWidth <= el.clientWidth + 1));
        rows.push(await field.evaluate(el => el.getBoundingClientRect().top));
      }
      assert.deepEqual(rows.map(y => y === rows[0]), [true, true, true, false, false]);
      assert.equal(rows[3], rows[4]);
      assert.equal(await products.getByText('商品名称', { exact: true }).count(), 0);
    };
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await open();
      await checkProgress();
      assert.equal(await page.locator('[aria-current="step"] .progress-label').textContent(), '装饰');
      await checkContacts(['下单人', '订购方式', '交接方式', '客户手机号']);
      await contacts.getByText('测试订购人', { exact: true }).waitFor();
      assert.equal(await page.getByText('合成取货地址', { exact: false }).count(), 0);
      await checkProductFields(false);
      assert.ok(await products.locator('.section-heading').getByRole('checkbox', { name: '草莓蛋糕制作完成' }).isEnabled());
      const requirements = products.locator('.front-order-requirements p');
      assert.equal(await requirements.textContent(), cake.attributes.requirements);
      assert.ok(await requirements.evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 18 && el.scrollWidth <= el.clientWidth));
      await currentImageTile.first().scrollIntoViewIfNeeded();
      assert.equal(await addImage.count(), 0);
      assert.equal(await uploadHelp.count(), 0);
      assert.equal(await removeSavedImage.count(), 0);
      assert.equal(await currentImageTile.locator('.image-caption').count(), 0);
      assert.deepEqual(await images.locator('.historical-images .image-scope').allTextContents(), ['整单历史图片', '已移除商品']);
      assert.equal(await images.locator('.image-filename').count(), 0);
      assert.equal(await images.getByText(/\/ 5 张/).count(), 0);
      assert.equal(await products.getByText('原单价', { exact: true }).count(), 0);
      await images.getByRole('button', { name: '查看大图：草莓蛋糕.png' }).click();
      const preview = images.getByRole('dialog', { name: '参考图片：草莓蛋糕.png' });
      await preview.getByRole('img', { name: '草莓蛋糕.png' }).waitFor();
      await preview.getByRole('button', { name: '关闭大图' }).click();
      if (process.env.PRODUCTION_SCREENSHOT_DIR) {
        await page.screenshot({ path: `${process.env.PRODUCTION_SCREENSHOT_DIR}/production-detail-${width}.png`, fullPage: true });
      }
      await page.getByRole('button', { name: '下一个商品' }).click();
      await products.getByText('每盒六片', { exact: true }).waitFor();
      await currentImageTile.scrollIntoViewIfNeeded();
      await products.getByRole('button', { name: '查看大图：手工饼干.png' }).waitFor();
      assert.equal(await products.getByRole('button', { name: '查看大图：草莓蛋糕.png' }).count(), 0);
      const sequence = page.getByRole('textbox', { name: '商品序号（1–2）' });
      await sequence.fill('1');
      await sequence.press('Enter');
      await products.locator('.section-heading').getByRole('checkbox', { name: '草莓蛋糕制作完成' }).waitFor();
      await page.getByRole('button', { name: '完成装饰' }).click();
      const unfinished = page.getByRole('dialog', { name: '还有 1 项商品未完成' });
      await unfinished.getByRole('button', { name: '第 2 个商品 · 手工饼干' }).click();
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '手工饼干制作完成');
      assert.equal(await payment.count(), 0);
      for (const entry of [cancelOrder, downloadOrder, reversePayment, supplement]) assert.equal(await entry.count(), 0);
      await page.locator('.note-panel summary').click();
      await page.getByRole('button', { name: '发布备注', exact: true }).waitFor();
    }
    model.order.status = 'WAITING_DELIVERY';
    model.permissions = [...decoratorPermissions, 'ORDER_EDIT'];
    for (const role of ['PASTRY_SUPERVISOR', 'BAKER', 'PASTRY_CHEF']) {
      roles = [role];
      await open();
      await checkProgress();
      await checkProductFields(false);
      await addImage.waitFor();
      await page.getByRole('button', { name: '确认自提', exact: true }).waitFor();
      assert.equal(await payment.count(), 0);
    }
    model.permissions = [...originalPermissions, ...decoratorPermissions, 'ORDER_PAYMENT_UPDATE'];
    for (const [width, otherRole] of [[390, 'FRONT_DESK_CLERK'], [1280, 'STORE_MANAGER']]) {
      roles = ['DECORATOR', otherRole];
      await page.setViewportSize({ width, height: 900 });
      await open();
      await checkProgress();
      await checkProductFields(true);
      await checkContacts(['客户', '电话', '下单方式', '交接方式', '地址', '下单时间']);
      await contacts.getByText('门店自提 · 合成取货地址', { exact: true }).waitFor();
      assert.equal(await information.getByRole('button', { name: '编辑资料', exact: true }).isEnabled(), true);
      assert.equal(await page.locator('[aria-current="step"] .progress-label').textContent(), '待自提');
      await page.getByRole('button', { name: '确认自提' }).waitFor();
      assert.equal(await payment.evaluate(el => el.open), false);
      assert.equal(await payment.getByText('成交金额', { exact: true }).isVisible(), false);
      await paymentSummary.press('Enter');
      await payment.getByText('成交金额', { exact: true }).waitFor();
      await supplement.waitFor();
      for (const entry of [cancelOrder, reversePayment]) assert.ok(await entry.isEnabled());
      if (otherRole === 'STORE_MANAGER') assert.ok(await downloadOrder.isEnabled());
      else assert.equal(await downloadOrder.count(), 0);
      await products.getByText('原单价', { exact: true }).waitFor();
      await uploadHelp.waitFor();
      await images.getByRole('button', { name: '移除图片：历史款式.png' }).waitFor();
      for (const button of await removeSavedImage.all()) assert.ok(await button.isEnabled());
      await addImage.waitFor();
    }
    roles = ['FRONT_DESK_CLERK'];
    await page.setViewportSize({ width: 390, height: 900 });
    await open();
    await checkProgress(false);
    assert.equal(await payment.count(), 0);
    await page.getByRole('heading', { name: '金额与付款' }).waitFor();

    roles = ['DECORATOR', 'FRONT_DESK_CLERK'];
    model.order.pricingMode = 'MANUAL';
    model.order.paymentStatus = 'UNPAID';
    model.order.items = [cake];
    cake.name = '很长的定制商品名'.repeat(12);
    await open();
    assert.equal(await products.getByText('商品名称', { exact: true }).count(), 0);
    const caption = page.locator('.detail-item-navigation strong');
    assert.equal(await caption.textContent(), cake.name);
    assert.ok(await caption.evaluate(el => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight));
    assert.equal(await page.getByRole('button', { name: '下一个商品' }).count(), 0);
    await paymentSummary.click();
    const editAmount = payment.getByRole('button', { name: '修改金额' });
    assert.equal(await editAmount.evaluate(el => getComputedStyle(el).whiteSpace), 'nowrap');
    await editAmount.click();
    const price = payment.getByRole('textbox', { name: '原价（元）' });
    await price.fill('188.50');
    await paymentSummary.click();
    assert.equal(await payment.evaluate(el => el.open), true);
    await context.route(`**/api/orders/${orderId}/information`, route =>
      route.fulfill({ status: 503, json: { success: false, code: 'SERVICE_UNAVAILABLE' } }));
    await payment.getByRole('button', { name: '保存修改' }).click();
    await payment.getByRole('alert').filter({ hasText: /服务|稍后/ }).first().waitFor();
    assert.equal(await price.inputValue(), '188.50');
    await payment.getByRole('button', { name: '取消', exact: true }).click();
    await paymentSummary.click();
    assert.equal(await payment.evaluate(el => el.open), false);

    model.failNames.add('retry.png');
    model.failNames.add('discard.png');
    await select(['retry.png', 'discard.png']);
    await images.getByText('仍有图片上传未完成', { exact: false }).waitFor();
    model.failNames.clear();
    roles = ['DECORATOR'];
    model.permissions = decoratorPermissions;
    await open();
    await images.locator('.reference-image').filter({ hasText: 'discard.png' }).getByRole('button', { name: '移除待上传图片' }).click();
    await images.getByText('discard.png', { exact: true }).waitFor({ state: 'detached' });
    await images.getByRole('button', { name: '重试上传', exact: true }).click();
    await images.getByText('图片已上传。', { exact: true }).waitFor();
    assert.ok(model.images.some(image => image.filename === 'retry.png'));
    assert.ok(!model.images.some(image => image.filename === 'discard.png'));
    assert.equal(await removeSavedImage.count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('前厅改价期间兼任制作岗位，原编辑器继续显示，取消后应用折叠布局', async () => {
  const { context, page, model, errors } = await createOrderFixture(browser, base);
  try {
    let roles = ['FRONT_DESK_CLERK'];
    await context.route('**/api/me', route => route.fulfill({ json: { success: true, data: {
      accountId: model.account, nickname: '测试前厅', jobRoles: roles, access: { permissions: model.permissions, uiCapabilities: [] },
    } } }));
    await context.route(`**/api/orders/${orderId}/customer-origin`, route => route.fulfill({ json: { success: true, data: null } }));
    model.order = { orderId, orderNo: 'TEST-PAYMENT-LAYOUT', version: 1, status: 'CAKE_BASE', pricingMode: 'MANUAL',
      originalAmountCents: 12000, totalAmountCents: 12000, paymentStatus: 'UNPAID', paymentMethod: 'UNPAID',
      customer: {}, fulfillment: { type: 'PICKUP', requestedReceiveDate: date },
      items: [{ itemId: crypto.randomUUID(), name: '测试蛋糕', productType: 'CAKE', quantity: 1,
        attributes: {}, productionStatus: 'NOT_STARTED', recentNotes: [] }],
    };
    await page.goto(base + '/#/orders/' + orderId);
    await page.getByRole('button', { name: '修改金额' }).click();
    const price = page.getByRole('textbox', { name: '原价（元）' });
    await price.fill('188.50');
    await page.getByText('草稿已保存在本机。', { exact: true }).waitFor();

    roles = ['FRONT_DESK_CLERK', 'DECORATOR'];
    model.permissions.push('ORDER_PRODUCTION_UPDATE');
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    await page.locator('.compact-production-detail').waitFor();
    assert.equal(await price.inputValue(), '188.50');
    assert.ok(await page.getByRole('button', { name: '保存修改' }).isEnabled());
    await page.getByRole('button', { name: '取消', exact: true }).click();
    const payment = page.locator('.payment-disclosure');
    await payment.waitFor();
    assert.equal(await payment.evaluate(el => el.open), false);
    await payment.locator('summary').click();
    await payment.getByRole('button', { name: '修改金额' }).waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('单岗裱花师完成装饰后回原工作台，有未发布备注时留在详情，兼岗继续交接', async () => {
  const { context, page, model, errors } = await createOrderFixture(browser, base);
  try {
    const businessPermissions = model.permissions;
    const decoratorPermissions = ['ORDER_READ', 'ORDER_PRODUCTION_UPDATE', 'ORDER_FULFILLMENT_UPDATE', 'ORDER_NOTE_CREATE'];
    let roles = ['DECORATOR'];
    model.permissions = decoratorPermissions;
    await context.route('**/api/me', route => route.fulfill({ json: { success: true, data: {
      accountId: model.account, nickname: '测试裱花师', jobRoles: roles, access: { permissions: model.permissions, uiCapabilities: [] },
    } } }));
    await context.route(`**/api/orders/${orderId}/customer-origin`, route => route.fulfill({ json: { success: true, data: null } }));
    model.order = { orderId, orderNo: 'TEST-RETURN', version: 0, status: 'DECORATING',
      fulfillment: { type: 'DELIVERY', requestedReceiveDate: date, address: '合成配送地址' },
      createdAt: '2026-11-04T08:00:00Z', paymentStatus: 'UNPAID',
      items: [{ itemId: crypto.randomUUID(), name: '草莓蛋糕', productType: 'CAKE', quantity: 1,
        attributes: {}, productionStatus: 'COMPLETED', recentNotes: [] }],
    };
    let fail = true;
    await context.route(`**/api/orders/${orderId}/production-actions`, route => {
      const { action, expectedVersion } = route.request().postDataJSON();
      assert.ok(['COMPLETE_DECORATION', 'REOPEN_PRODUCTION'].includes(action));
      assert.equal(expectedVersion, model.order.version);
      if (fail) return route.fulfill({ status: 503, json: { success: false, code: 'SERVICE_UNAVAILABLE' } });
      const status = action === 'COMPLETE_DECORATION' ? 'WAITING_DELIVERY' : 'DECORATING';
      model.order = { ...model.order, status, version: expectedVersion + 1 };
      return route.fulfill({ json: { success: true, data: model.order } });
    });
    await context.route(`**/api/orders/${orderId}/fulfillment-actions`, route => {
      const { action, expectedVersion } = route.request().postDataJSON();
      assert.equal(action, 'ROLLBACK_FULFILLMENT');
      assert.equal(expectedVersion, model.order.version);
      model.order = { ...model.order, status: 'WAITING_DELIVERY', version: expectedVersion + 1 };
      return route.fulfill({ json: { success: true, data: model.order } });
    });
    const calendar = '#/?date=2026-11-04&view=month&month=2026-11&expanded=1';
    const detail = `#/orders/${orderId}?${new URLSearchParams({ from: calendar })}`;
    const open = async () => {
      await page.goto('about:blank');
      await page.goto(base + detail);
      await page.getByRole('list', { name: '整单状态进度' }).waitFor();
    };
    const finish = page.getByRole('button', { name: '完成装饰', exact: true });
    const reopen = page.getByRole('button', { name: '退回装饰', exact: true });
    await open();
    await finish.click();
    await page.getByRole('alert').filter({ hasText: /服务|稍后/ }).waitFor();
    assert.equal(new URL(page.url()).hash, detail);
    fail = false;
    await page.locator('.note-panel summary').click();
    const note = page.getByRole('textbox', { name: '备注内容' });
    await note.fill('还没发布的工作备注');
    await finish.click();
    await page.getByText('完成装饰已确认').waitFor();
    await reopen.waitFor();
    assert.equal(new URL(page.url()).hash, detail);
    assert.equal(await note.inputValue(), '还没发布的工作备注');
    assert.equal(await page.getByRole('button', { name: '确认送达', exact: true }).count(), 0);
    await note.fill('');
    model.order.status = 'DECORATING';
    await open();
    await finish.click();
    await page.waitForURL(url => url.hash === calendar);

    for (const [type, confirmation, rollback] of [
      ['DELIVERY', '确认送达', '退回待配送'], ['PICKUP', '确认自提', '退回待自提'],
    ]) {
      model.order.fulfillment.type = type;
      model.order.status = 'WAITING_DELIVERY';
      await open();
      await reopen.waitFor();
      assert.equal(await page.getByRole('button', { name: confirmation, exact: true }).count(), 0);
      page.once('dialog', dialog => dialog.accept());
      await reopen.click();
      await finish.waitFor();
      model.order.status = 'COMPLETED';
      await open();
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('button', { name: rollback, exact: true }).click();
      await reopen.waitFor();
    }
    model.permissions = [...businessPermissions, ...decoratorPermissions];
    for (const [otherRole, type, confirmation] of [
      ['FRONT_DESK_CLERK', 'DELIVERY', '确认送达'], ['STORE_MANAGER', 'PICKUP', '确认自提'],
    ]) {
      roles = ['DECORATOR', otherRole];
      model.order.fulfillment.type = type;
      model.order.status = 'DECORATING';
      await open();
      await finish.click();
      await page.getByRole('button', { name: confirmation, exact: true }).waitFor();
      assert.equal(new URL(page.url()).hash, detail);
    }
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
