import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createRequire } from 'node:module';
import { createOrderFixture, orderId } from './orderBrowserFixture.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DRAFT_TEST_URL || 'http://127.0.0.1:5197';
let browser;
before(async () => { browser = await chromium.launch({ headless: true, channel: 'chrome' }); });
after(async () => { await browser?.close(); });

test('前台订单分区、下单方式草稿和编辑、商品联动及桌面手机布局', async () => {
  const { context, page, model, complete, errors } = await createOrderFixture(browser, base);
  try {
    await context.route(`**/api/orders/${orderId}/customer-origin`, route => route.fulfill({ json: { success: true, data: null } }));
    model.permissions.push('ORDER_EDIT', 'ORDER_PRODUCTION_UPDATE', 'ORDER_PAYMENT_UPDATE');
    await complete(); await page.locator('#orderingMethod').click();
    await page.getByRole('option', { name: '到店', exact: true }).click();
    await page.locator('#orderingMethod').click(); await page.getByRole('option', { name: '其他', exact: true }).click();
    await page.getByRole('button', { name: '创建订单', exact: true }).click();
    await page.getByText('请填写具体下单方式。', { exact: true }).waitFor();
    assert.equal(model.createCalls.length, 0);
    await page.locator('#orderingMethod-custom').fill('微信');
    await page.getByRole('button', { name: '添加商品', exact: true }).click();
    await page.locator('[id="items.1.name"]').fill('蛋糕B');
    await page.reload(); await page.getByRole('button', { name: '继续填写', exact: true }).click();
    assert.equal(await page.locator('#orderingMethod-custom').inputValue(), '微信');
    assert.match(await page.locator('#orderingMethod').innerText(), /其他/);
    await page.getByRole('button', { name: '创建订单', exact: true }).click();
    await page.waitForURL('**/#/?date=*');
    await page.goto(`${base}/#/orders/${orderId}`);
    assert.equal(model.createCalls[0].input.orderingMethod, '微信');
    assert.equal(model.createCalls[0].input.orderingMethodCustom, undefined);
    model.order.items[0].name = '生日蛋糕（草莓与芒果双拼）'.repeat(5);
    model.order.items[0].attributes.requirements = '不要坚果\n需要10份叉碟';
    model.order.items[1].attributes.requirements = ''; model.order.items[1].attributes.otherRequirements = '不应恢复旧要求';
    model.order.customer.customerName = '测试客户';
    model.order.fulfillment.address = '长地址'.repeat(50);
    model.images = model.order.items.map((item, i) => ({ imageId: `image-${i}`, orderId, itemId: item.itemId, filename: `${i}.png`, uploadedAt: model.order.createdAt, uploaderNameSnapshot: '测试员工' }));
    await page.reload(); await page.locator('.front-order-grid').waitFor();
    const panel = page.locator('.front-order-information');
    assert.equal(await page.locator('.order-supplement').evaluate(el => el.open), false);
    assert.equal(await panel.locator('a[href="tel:13800000000"]').count(), 1);
    await page.locator('.front-order-requirements').getByText('需要10份叉碟', { exact: false }).waitFor();
    await panel.getByRole('button', { name: '查看大图：0.png', exact: true }).waitFor();
    await panel.getByRole('button', { name: '查看大图：0.png', exact: true }).click(); await page.getByRole('dialog').waitFor();
    await page.getByRole('button', { name: '关闭大图' }).click();
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 1000 });
      const rows = await page.locator('.front-order-grid > div').evaluateAll(elements => elements.map(el => ({ x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y })));
      assert.equal(rows[0].y, rows[1].y); assert.ok(rows[1].x > rows[0].x);
      assert.equal(rows[2].y, rows[3].y); assert.equal(rows[4].y, rows[5].y);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await panel.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `/private/tmp/wuhou-detail-${width}.png`, fullPage: true });
    }
    await page.getByRole('button', { name: '下一个商品', exact: true }).click();
    assert.equal(await panel.locator('.front-order-grid dd').first().innerText(), '蛋糕B');
    assert.equal(await panel.locator('.front-order-requirements p').innerText(), '无');
    await panel.getByRole('button', { name: '查看大图：1.png', exact: true }).waitFor(); assert.equal(await panel.getByAltText('0.png', { exact: true }).count(), 0);
    await page.getByRole('button', { name: '编辑资料', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '上一个商品', exact: true }).isDisabled(), true);
    assert.match(await page.locator('#edit-orderingMethod').innerText(), /其他/);
    assert.equal(await page.locator('#edit-orderingMethod-custom').inputValue(), '微信');
    await page.locator('#edit-orderingMethod-custom').fill('电话');
    await context.route(`**/api/orders/${orderId}/information`, async route => {
      const input = route.request().postDataJSON(); assert.deepEqual(input.changes, { orderingMethod: '电话' });
      model.order.orderingMethod = input.changes.orderingMethod; model.order.version++;
      await route.fulfill({ json: { success: true, data: model.order } });
    });
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await panel.locator('.front-order-grid').waitFor(); assert.equal(await panel.locator('.front-order-grid dd').nth(1).innerText(), '电话');
    await page.getByText('补充资料', { exact: true }).click(); await page.getByRole('heading', { name: '全部商品', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '编辑', exact: true }).isVisible(), true);
    assert.equal(await page.getByRole('button', { name: '确认已付款', exact: true }).isVisible(), true);
    assert.deepEqual(errors, []);
    model.permissions = ['ORDER_READ', 'ORDER_PHONE_READ', 'ORDER_PRODUCTION_UPDATE'];
    await page.reload(); await page.locator('.production-detail').waitFor();
    assert.equal(await page.locator('.front-order-information').count(), 0);
    assert.equal(await page.locator('.production-times').isVisible(), true);
    assert.equal(await page.locator('.payment-panel').count(), 0);
  } finally { await context.close(); }
});

test('商品资料直接展开，蛋糕三列、非蛋糕价格两列，付款备注和商品操作保留', async () => {
  const { context, page, model, complete, errors } = await createOrderFixture(browser, base);
  let releasePayment = () => {};
  try {
    await complete(); await page.getByRole('button', { name: '创建订单', exact: true }).click();
    await page.waitForURL('**/#/?date=*');
    model.permissions.push('ORDER_EDIT', 'ORDER_PAYMENT_UPDATE', 'ORDER_NOTE_CREATE');
    const cake = model.order.items[0];
    cake.attributes = { size: '8', cakeBase: '巧克力内胚'.repeat(8), filling: '芒果夹馅'.repeat(8), flavor: '原味奶油'.repeat(8), greeting: '生日快乐', requirements: '不要坚果' };
    model.order.items.push({ ...cake, itemId: '20000000-0000-4000-8000-000000000002', name: '果茶', productType: 'DRINK', quantity: 12,
      attributes: { specification: '500ml\n少冰', base: '历史原味内胚', message: '聚会愉快' }, unitPriceCents: 1280, memberPriceCents: 1000 });
    model.order.totalAmountCents = 16800;
    await context.route(`**/api/orders/${orderId}/customer-origin`, route => route.fulfill({ json: { success: true, data: null } }));
    await context.route(`**/api/orders/${orderId}`, async route => {
      if (route.request().method() === 'PATCH') {
        const input = route.request().postDataJSON(); assert.equal(input.expectedVersion, model.order.version);
        Object.assign(model.order.items.find(item => item.itemId === input.itemId), input.changes); model.order.version++;
      }
      await route.fulfill({ json: { success: true, data: model.order } });
    });
    await context.route(`**/api/orders/${orderId}/items`, async route => {
      const input = route.request().postDataJSON(); assert.equal(input.expectedVersion, model.order.version);
      model.order.items.push({ ...input.item, itemId: input.item.itemId || '30000000-0000-4000-8000-000000000003', recentNotes: [], productionStatus: 'NOT_STARTED' }); model.order.version++;
      await route.fulfill({ json: { success: true, data: model.order } });
    });
    await context.route(`**/api/orders/${orderId}/items/*/remove`, async route => {
      const input = route.request().postDataJSON(); assert.equal(input.expectedVersion, model.order.version);
      const removed = new URL(route.request().url()).pathname.split('/').at(-2);
      model.order.items = model.order.items.filter(item => item.itemId !== removed); model.order.version++;
      await route.fulfill({ json: { success: true, data: model.order } });
    });
    const gate = new Promise(resolve => { releasePayment = resolve; });
    await context.route(`**/api/orders/${orderId}/payment-status`, async route => {
      const input = route.request().postDataJSON(); assert.equal(input.expectedVersion, model.order.version);
      assert.equal(input.paymentStatus, 'PAID'); assert.equal(Object.hasOwn(input, 'itemId'), false);
      await gate; model.order.paymentStatus = 'PAID'; model.order.paidAt = '2026-11-05T04:00:00Z'; model.order.version++;
      await route.fulfill({ json: { success: true, data: model.order } });
    });
    const notes = [];
    await context.route(`**/api/orders/${orderId}/notes**`, async route => {
      if (route.request().method() === 'POST') {
        const input = route.request().postDataJSON();
        notes.unshift({ ...input, id: notes.length + 1, actorNameSnapshot: '测试员工', type: 'NOTE', details: {}, createdAt: '2026-11-05T04:00:00Z' });
      }
      await route.fulfill({ json: { success: true, data: { items: notes, page: 1, size: 3, total: notes.length } } });
    });
    await page.goto(`${base}/#/orders/${orderId}`);
    await page.reload();
    const product = page.locator('.front-product-details'); await product.waitFor();
    assert.equal(await page.locator('.order-supplement').evaluate(el => el.open), false);
    assert.equal(await page.locator('.note-panel').evaluate(el => el.open), false);
    assert.equal(await product.locator('.front-product-triple dd').nth(0).innerText(), cake.attributes.cakeBase);
    assert.equal(await product.locator('.front-product-prices').count(), 0);
    assert.equal(await page.evaluate(() => {
      const selectors = ['.front-order-created', '.order-products', '.payment-panel', '.note-panel', '.order-supplement'];
      return selectors.every((selector, i) => !i || Boolean(document.querySelector(selectors[i - 1]).compareDocumentPosition(document.querySelector(selector)) & Node.DOCUMENT_POSITION_FOLLOWING));
    }), true);
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await product.locator('.front-product-pair').first().evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 2);
      assert.equal(await product.locator('.front-product-triple').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 3);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await product.scrollIntoViewIfNeeded(); await page.screenshot({ path: `/private/tmp/wuhou-product-detail-${width}.png`, fullPage: true });
    }
    await page.getByText('补充资料', { exact: true }).click();
    await page.locator('.front-product-supplement').getByText('生日快乐', { exact: true }).waitFor();
    await page.getByText('补充资料', { exact: true }).click();
    await page.getByRole('button', { name: '下一项', exact: true }).click();
    assert.equal(await product.locator('.front-product-triple').count(), 0);
    assert.equal(await product.locator('.front-product-pair dd').nth(1).innerText(), '500ml\n少冰');
    assert.equal(await product.locator('.front-product-prices dd').nth(0).innerText(), '¥12.80');
    assert.equal(await product.locator('.front-product-prices dd').nth(1).innerText(), '¥10.00');
    await page.setViewportSize({ width: 390, height: 1000 });
    assert.equal(await product.locator('.front-product-prices').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 2);
    await product.scrollIntoViewIfNeeded(); await page.screenshot({ path: '/private/tmp/wuhou-product-prices-390.png', fullPage: true });
    model.permissions = model.permissions.filter(value => value !== 'ORDER_AMOUNT_READ');
    await page.reload(); await product.waitFor(); await page.getByRole('button', { name: '下一项', exact: true }).click();
    assert.equal(await product.locator('.front-product-prices').count(), 0); assert.equal(await page.locator('.payment-panel').count(), 0);
    model.permissions.push('ORDER_AMOUNT_READ');
    await page.reload(); await product.waitFor(); await page.getByRole('button', { name: '下一项', exact: true }).click();

    await page.getByText('补充资料', { exact: true }).click();
    await page.locator('.front-product-supplement').getByText('历史原味内胚', { exact: true }).waitFor();
    await page.getByText('补充资料', { exact: true }).click();
    assert.equal(await page.locator('.order-amount').innerText(), '¥168.00');
    const paymentRequest = page.waitForRequest(request => request.url().endsWith('/payment-status'));
    await page.getByRole('button', { name: '确认已付款', exact: true }).click(); await paymentRequest;
    assert.equal(await page.getByRole('button', { name: '上一个商品', exact: true }).isDisabled(), true);
    releasePayment(); await page.getByRole('button', { name: '改为未付款', exact: true }).waitFor();
    assert.equal(await page.locator('.order-amount').innerText(), '¥168.00');
    await product.getByRole('button', { name: '编辑', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '上一个商品', exact: true }).isDisabled(), true);
    await page.locator('#item-name').fill('改名果茶'); await page.getByRole('button', { name: '保存', exact: true }).click();
    await product.getByText('改名果茶', { exact: true }).waitFor();
    await page.getByRole('button', { name: '添加商品', exact: true }).click();
    await page.locator('#item-name').fill('新增蛋糕'); await page.getByRole('button', { name: '保存', exact: true }).click();
    await product.getByText('新增蛋糕', { exact: true }).waitFor();
    assert.equal(await product.locator('.front-product-pair dd').nth(1).innerText(), '未填写');
    page.on('dialog', dialog => dialog.accept());
    await product.getByRole('button', { name: '移除', exact: true }).click();
    await product.getByText('改名果茶', { exact: true }).waitFor();
    await product.getByRole('button', { name: '移除', exact: true }).click();
    await product.getByText('蛋糕A', { exact: true }).waitFor();
    assert.equal(await product.getByRole('button', { name: '移除', exact: true }).isDisabled(), true);
    await page.locator('.note-panel > summary').click();
    await page.getByRole('textbox', { name: '备注内容' }).fill('整单交接备注');
    await page.getByRole('button', { name: '发布备注', exact: true }).click();
    await page.locator('.note-panel .activity-feed').getByText('整单交接备注', { exact: true }).waitFor(); assert.equal(notes[0].itemId, null);
    await page.locator('[data-control-label="备注对象"] .choice-trigger').click(); await page.getByRole('option', { name: '蛋糕A', exact: true }).click();
    await page.getByRole('textbox', { name: '备注内容' }).fill('当前商品备注');
    await page.getByRole('button', { name: '发布备注', exact: true }).click();
    await page.locator('.note-panel .activity-feed').getByText('当前商品备注', { exact: true }).waitFor(); assert.equal(notes[0].itemId, cake.itemId);
    assert.equal(model.order.totalAmountCents, 16800); assert.equal(model.order.paymentStatus, 'PAID');
    assert.deepEqual(errors, []);
  } finally { releasePayment(); await context.close(); }
});
