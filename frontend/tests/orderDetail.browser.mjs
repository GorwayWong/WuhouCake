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
    await page.reload(); await page.getByText('已恢复上次填写', { exact: true }).waitFor();
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
    const productPanel = page.getByRole('region', { name: '商品资料', exact: true });
    assert.equal(await page.locator('.order-supplement').evaluate(el => el.open), false);
    assert.equal(await panel.locator('a[href="tel:13800000000"]').count(), 1);
    await page.locator('.front-order-requirements').getByText('需要10份叉碟', { exact: false }).waitFor();
    await productPanel.getByRole('button', { name: '查看大图：0.png', exact: true }).waitFor();
    await productPanel.getByRole('button', { name: '查看大图：0.png', exact: true }).click(); await page.getByRole('dialog').waitFor();
    await page.getByRole('button', { name: '关闭大图' }).click();
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 1000 });
      const rows = await page.locator('.front-order-grid > div').evaluateAll(elements => elements.map(el => ({ x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y })));
      assert.equal(rows[0].y, rows[1].y); assert.ok(rows[1].x > rows[0].x);
      assert.equal(rows[2].y, rows[3].y);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await panel.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `/private/tmp/wuhou-detail-${width}.png`, fullPage: true });
    }
    await page.getByRole('button', { name: '下一个商品', exact: true }).click();
    assert.equal(await productPanel.locator('.front-product-heading strong').innerText(), '蛋糕B');
    assert.equal(await productPanel.locator('.front-order-requirements p').innerText(), '无');
    assert.doesNotMatch(await panel.innerText(), /蛋糕B|特殊要求/);
    await productPanel.getByRole('button', { name: '查看大图：1.png', exact: true }).waitFor(); assert.equal(await productPanel.getByAltText('0.png', { exact: true }).count(), 0);
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
    await panel.getByText('下单方式', { exact: true }).locator('..').getByText('电话', { exact: true }).waitFor();
    await page.getByText('补充资料', { exact: true }).click(); await page.getByRole('heading', { name: '商品资料', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '编辑', exact: true }).isVisible(), true);
    assert.equal(await page.locator('.payment-panel').isVisible(), true);
    assert.deepEqual(errors, []);
    model.order.items[0].attributes.size = '8';
    model.order.items[0].attributes.specification = '切成 12 份\n分开包装';
    model.permissions = ['ORDER_READ', 'ORDER_PHONE_READ', 'ORDER_PRODUCTION_UPDATE'];
    await page.reload(); await page.locator('.production-detail').waitFor();
    const production = page.locator('.production-product-fields');
    assert.equal(await production.getByText('尺寸', { exact: true }).locator('..').locator('dd').innerText(), '8');
    const remark = production.getByText('商品备注', { exact: true }).locator('..').locator('dd');
    assert.equal(await remark.innerText(), '切成 12 份\n分开包装');
    assert.equal(await remark.evaluate(node => getComputedStyle(node).whiteSpace), 'pre-wrap');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('.front-order-information').count(), 0);
    assert.equal(await page.locator('.payment-panel').count(), 0);
  } finally { await context.close(); }
});

test('商品资料直接展开，其他商品统一展示规格，历史价格按权限显示', async () => {
  const { context, page, model, complete, errors } = await createOrderFixture(browser, base);
  let releasePayment = () => {};
  try {
    await complete(); await page.getByRole('button', { name: '创建订单', exact: true }).click();
    await page.waitForURL('**/#/?date=*');
    model.permissions.push('ORDER_EDIT', 'ORDER_PAYMENT_UPDATE', 'ORDER_NOTE_CREATE');
    const cake = model.order.items[0];
    cake.attributes = { size: '8', cakeBase: '巧克力内胚'.repeat(8), filling: '芒果夹馅'.repeat(8), flavor: '原味奶油'.repeat(8), greeting: '生日快乐', requirements: '不要坚果', specification: ['个', '块'] };
    cake.unitPriceCents = 0;
    model.order.items.push({ ...cake, itemId: '20000000-0000-4000-8000-000000000002', name: '果茶', productType: 'OTHER', quantity: 12,
      attributes: { specification: '500ml\n少冰\n内胚：历史原味内胚\n祝福语：聚会愉快' }, unitPriceCents: 1280, memberPriceCents: 1000 });
    model.order.totalAmountCents = 16800;
    model.order.pricingMode = 'MANUAL';
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
      await gate; model.order.paymentMethod = input.paymentMethod; model.order.paymentStatus = 'PAID'; model.order.paidAt = '2026-11-05T04:00:00Z'; model.order.version++;
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
    assert.equal(await page.evaluate(() => {
      const selectors = ['.front-order-created', '.order-products', '.payment-panel', '.note-panel', '.order-supplement'];
      return selectors.every((selector, i) => !i || Boolean(document.querySelector(selectors[i - 1]).compareDocumentPosition(document.querySelector(selector)) & Node.DOCUMENT_POSITION_FOLLOWING));
    }), true);
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await product.locator('.front-product-pair').first().evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 2);
      assert.equal(await product.locator('.front-product-triple').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 3);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await product.getByText('商品说明', { exact: true }).count(), 0);
      const price = product.getByText('原商品单价', { exact: true }).locator('..');
      await price.getByText('¥0.00（仅供参考）', { exact: true }).waitFor();
      await product.scrollIntoViewIfNeeded(); await page.screenshot({ path: `/private/tmp/wuhou-product-detail-${width}.png`, fullPage: true });
    }
    await page.getByText('生日快乐', { exact: true }).waitFor();
    assert.equal(await page.getByText('商品补充资料', { exact: true }).count(), 0);
    await product.getByRole('button', { name: '编辑', exact: true }).click();
    assert.equal(await product.getByText('个、块', { exact: true }).count(), 0);
    await page.locator('#item-quantity').fill('2');
    const itemUrl = new URL(`/api/orders/${orderId}`, base).href;
    const nextVersion = model.order.version + 1;
    const [patch, reread] = await Promise.all([
      page.waitForResponse(response => response.url() === itemUrl && response.request().method() === 'PATCH'),
      page.waitForResponse(async response => {
        if (response.url() !== itemUrl || response.request().method() !== 'GET' || !response.ok()) return false;
        const { data } = await response.json();
        return data.version === nextVersion;
      }),
      product.getByRole('button', { name: '保存', exact: true }).click(),
    ]);
    assert.equal(patch.ok(), true);
    assert.deepEqual(patch.request().postDataJSON().changes, { quantity: 2 });
    assert.match(reread.request().headers().authorization ?? '', /^Bearer \S+$/);
    await product.locator('.front-product-pair dd').first().getByText('2', { exact: true }).waitFor();
    const { data: savedOrder } = await reread.json();
    const savedCake = savedOrder.items.find(item => item.itemId === cake.itemId);
    assert.equal(savedCake.quantity, 2);
    assert.deepEqual(savedCake.attributes.specification, ['个', '块']);
    await page.getByRole('button', { name: '下一个商品', exact: true }).click();
    assert.equal(await product.locator('.front-product-triple').count(), 0);
    const spec = product.getByText('商品说明', { exact: true }).locator('..').locator('dd');
    assert.match(await spec.innerText(), /^500ml\n少冰\n内胚：历史原味内胚/);
    assert.doesNotMatch(await spec.innerText(), /单价/);
    await product.getByText('¥12.80（仅供参考）', { exact: true }).waitFor();
    await product.getByText('¥10.00（仅供参考）', { exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 1000 });
    assert.equal(await spec.evaluate(el => getComputedStyle(el).whiteSpace), 'pre-wrap');
    await product.scrollIntoViewIfNeeded(); await page.screenshot({ path: '/private/tmp/wuhou-product-spec-390.png', fullPage: true });
    model.permissions = model.permissions.filter(value => value !== 'ORDER_AMOUNT_READ');
    await page.reload(); await product.waitFor(); await page.getByRole('button', { name: '下一个商品', exact: true }).click();
    assert.doesNotMatch(await product.innerText(), /原商品单价|原会员单价|¥12\.80|¥10\.00/);
    assert.equal(await page.locator('.payment-panel').count(), 0);
    model.permissions.push('ORDER_AMOUNT_READ');
    await page.reload(); await product.waitFor(); await page.getByRole('button', { name: '下一个商品', exact: true }).click();

    assert.equal(await page.locator('.order-amount').innerText(), '¥168.00');
    await page.locator('.order-payment-editor .choice-trigger').click(); await page.getByRole('option', { name: '现金', exact: true }).click();
    const paymentRequest = page.waitForRequest(request => request.url().endsWith('/payment-status'));
    await page.getByRole('button', { name: '确认已付款', exact: true }).click(); await paymentRequest;
    await page.locator('button[aria-label="上一个商品"]:disabled').waitFor();
    releasePayment(); await page.getByText('支付方式：现金', { exact: true }).waitFor();
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


test('待自提商品直接保存，备注丢失响应后刷新复用原发布标识', async () => {
  const { context, page, model } = await createOrderFixture(browser, base);
  try {
    model.permissions.push('ORDER_EDIT', 'ORDER_NOTE_CREATE');
    model.order = {
      orderId, orderNo: 'TEST-READY', version: 4, status: 'WAITING_DELIVERY',
      paymentStatus: 'UNPAID', totalAmountCents: 12000,
      customer: { phone: '13800000000' }, fulfillment: { type: 'PICKUP', requestedReceiveDate: '2026-11-12' },
      items: [{ itemId: crypto.randomUUID(), name: '草莓蛋糕', productType: 'CAKE', quantity: 1,
        attributes: {}, productionStatus: 'COMPLETED', recentNotes: [] }],
    };
    const revisions = [];
    await context.route(`**/api/orders/${orderId}`, route => {
      if (route.request().method() === 'PATCH') {
        revisions.push(route.request().postDataJSON());
        model.order = { ...model.order, version: 5, status: 'DECORATING',
          items: [{ ...model.order.items[0], quantity: 2, productionStatus: 'IN_PROGRESS' }] };
      }
      return route.fulfill({ json: { success: true, data: model.order } });
    });
    const attempts = [];
    await context.route(`**/api/orders/${orderId}/notes**`, route => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { success: true, data: { items: [], page: 1, total: 0 } } });
      attempts.push({ key: route.request().headers()['idempotency-key'], body: route.request().postDataJSON() });
      return attempts.length === 1 ? route.abort('failed') : route.fulfill({ json: { success: true, data: { id: 1 } } });
    });
    await page.goto(base + '/#/orders/' + orderId); await page.reload();
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.locator('#item-quantity').fill('2');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.locator('.feedback').getByText('商品已更新，已通知制作同事重新核对。').waitFor();
    assert.equal(revisions.length, 1);
    assert.equal(revisions[0].expectedVersion, 4);
    assert.deepEqual(revisions[0].changes, { quantity: 2 });
    await page.locator('.note-panel summary').click();
    await page.getByRole('textbox', { name: '备注内容' }).fill('顾客来电确认');
    await page.getByRole('button', { name: '发布备注', exact: true }).click();
    await page.getByRole('button', { name: '重试发布', exact: true }).waitFor();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    await page.locator('.note-panel summary').click();
    await page.locator('.note-panel').getByText('顾客来电确认', { exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: '备注内容' }).inputValue(), '');
    assert.equal(attempts.length, 1);
    await page.getByRole('button', { name: '重试发布', exact: true }).click();
    await page.locator('.feedback').getByText('备注已发布').waitFor();
    assert.equal(attempts.length, 2);
    assert.ok(attempts[0].key);
    assert.deepEqual(attempts[1], attempts[0]);
    assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('wuhou:pending-note:')).length), 0);
  } finally { await context.close(); }
});

test('同账号双标签页分别发布，丢失的响应及旧版记录按各自幂等键重试', async () => {
  const { context, page, model } = await createOrderFixture(browser, base);
  const held = Promise.withResolvers();
  try {
    model.permissions.push('ORDER_NOTE_CREATE');
    const itemId = crypto.randomUUID();
    model.order = { orderId, orderNo: 'NOTE-PEER', version: 0, status: 'CAKE_BASE',
      paymentStatus: 'UNPAID', customer: { phone: '13800000000' },
      fulfillment: { type: 'PICKUP', requestedReceiveDate: '2026-11-12' },
      items: [{ itemId, name: '蛋糕', productType: 'CAKE', quantity: 1, attributes: {}, recentNotes: [] }] };
    const attempts = [];
    const received = Promise.withResolvers();
    await context.route(`**/api/orders/${orderId}/notes**`, async route => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { success: true, data: { items: [], page: 1, total: 0 } } });
      attempts.push({ key: route.request().headers()['idempotency-key'], body: route.request().postDataJSON() });
      if (attempts.length === 1) { received.resolve(); await held.promise; return route.abort('failed'); }
      if (attempts.length === 5) return route.abort('failed');
      if (attempts.length === 6) return route.fulfill({ status: 400, json: { success: false, code: 'VALIDATION_FAILED' } });
      return route.fulfill({ json: { success: true, data: { id: attempts.length } } });
    });
    const href = base + '/#/orders/' + orderId;
    const peer = await context.newPage();
    await peer.goto(href);
    await page.goto(href); await page.reload();
    for (const [tab, content] of [[page, '先冷藏'], [peer, '提前取货']]) {
      await tab.locator('.note-panel summary').click();
      await tab.getByRole('textbox', { name: '备注内容' }).fill(content);
    }
    await peer.locator('[data-control-label="备注对象"] .choice-trigger').click();
    await peer.getByRole('option', { name: '蛋糕', exact: true }).click();
    await page.getByRole('button', { name: '发布备注', exact: true }).click();
    await received.promise;
    await peer.getByRole('button', { name: '发布备注', exact: true }).click();
    await peer.locator('.feedback').getByText('备注已发布').waitFor();
    assert.deepEqual(attempts.map(a => a.body), [{ content: '先冷藏', itemId: null }, { content: '提前取货', itemId }]);
    assert.notEqual(attempts[0].key, attempts[1].key);
    held.resolve();
    await page.getByText('发布结果待确认', { exact: false }).waitFor();
    const legacy = { requestId: crypto.randomUUID(), content: '旧版备注', itemId };
    await page.evaluate(([scope, legacy]) => {
      localStorage.setItem(scope, JSON.stringify(legacy));
      localStorage.setItem(scope + ':' + legacy.requestId, JSON.stringify(legacy));
    }, [`wuhou:pending-note:${model.account}:${orderId}`, legacy]);
    await page.reload(); await page.locator('.note-panel summary').click();
    const retry = page.getByRole('button', { name: '重试发布', exact: true });
    await page.locator('.note-panel').getByText('先冷藏', { exact: true }).waitFor();
    assert.equal(await retry.count(), 2);
    const draft = page.getByRole('textbox', { name: '备注内容' });
    await draft.fill('正在写的备注');
    assert.ok((await retry.all()).length === 2 && await retry.first().isDisabled() && await retry.last().isDisabled());
    await draft.clear();
    await page.locator('li').filter({ hasText: '先冷藏' }).getByRole('button', { name: '重试发布' }).click();
    await page.locator('.feedback').getByText('备注已发布').waitFor();
    assert.deepEqual(attempts[2], attempts[0]);
    await retry.click();
    await retry.waitFor({ state: 'hidden' });
    assert.deepEqual(attempts[3], { key: legacy.requestId, body: { content: legacy.content, itemId } });
    assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('wuhou:pending-note:')).length), 0);
    await page.evaluate(() => {
      const save = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith('wuhou:pending-note:')) throw new DOMException('Quota', 'QuotaExceededError');
        save.call(this, key, value);
      };
    });
    await draft.fill('仅内存保留的备注');
    await page.getByRole('button', { name: '发布备注', exact: true }).click();
    await page.getByText('部分备注未能保存在本机，请在关闭页面前重试。').waitFor();
    await retry.click();
    await retry.waitFor({ state: 'hidden' });
    assert.deepEqual(attempts[5], attempts[4]);
    assert.equal(await draft.inputValue(), '仅内存保留的备注');
  } finally { held.resolve(); await context.close(); }
});

test('完成装饰列出同名缺项、定位高亮、保留失败状态并重新核对协作冲突', async () => {
  const { context, page, model, errors } = await createOrderFixture(browser, base);
  try {
    model.permissions.push('ORDER_PRODUCTION_UPDATE');
    const items = [
      { name: '同名蛋糕', productType: 'CAKE', attributes: { size: '8', specification: '多行规格\n'.repeat(10) } },
      { name: '同名蛋糕', productType: 'CAKE', attributes: { requirements: '请分装' } },
      { name: '饮品', productType: 'DRINK', attributes: { specification: '少冰' } },
    ].map((item, index) => ({
      ...item, itemId: crypto.randomUUID(), quantity: index + 1, recentNotes: [],
      productionStatus: index === 0 ? 'COMPLETED' : 'IN_PROGRESS',
    }));
    model.order = {
      orderId, orderNo: 'PRODUCTION', version: 7, status: 'DECORATING', paymentStatus: 'UNPAID',
      customer: { customerName: '核对客户', phone: '13800000000' }, orderingMethod: '到店',
      fulfillment: { type: 'PICKUP', requestedReceiveDate: '2026-11-20' },
      items,
    };
    model.images = [0, 1].map(index => ({
      orderId, itemId: items[0].itemId, imageId: `cake-${index}`, filename: `蛋糕${index}.png`,
      uploadedAt: '2026-11-13T08:00:00Z', uploaderNameSnapshot: '测试员工',
    }));
    const respond = (route, data) => route.fulfill({ json: { success: true, data } });
    await context.route(`**/api/orders/${orderId}/customer-origin`, route => respond(route, null));
    const fail = (route, code) => route.fulfill({ status: 409, json: { success: false, code } });
    let rejectCheck = true, productionAttempts = 0;
    await context.route(`**/api/orders/${orderId}/items/*/production-status`, route => {
      const id = new URL(route.request().url()).pathname.split('/').at(-2);
      const item = items.find(candidate => candidate.itemId === id);
      const { expectedVersion, completed } = route.request().postDataJSON();
      assert.equal(route.request().method(), 'PATCH');
      assert.equal(expectedVersion, model.order.version);
      assert.ok(item);
      if (rejectCheck) {
        rejectCheck = false;
        return fail(route, 'CONCURRENT_MODIFICATION');
      }
      item.productionStatus = completed ? 'COMPLETED' : 'IN_PROGRESS';
      model.order.version++;
      return respond(route, model.order);
    });
    await context.route(`**/api/orders/${orderId}/production-actions`, route => {
      const { expectedVersion, action } = route.request().postDataJSON();
      assert.equal(expectedVersion, model.order.version);
      assert.equal(action, 'COMPLETE_DECORATION');
      assert.ok(items.every(item => item.productionStatus === 'COMPLETED'));
      productionAttempts++;
      model.order.version++;
      if (productionAttempts === 1) {
        items[0].productionStatus = 'IN_PROGRESS';
        return fail(route, 'CONCURRENT_MODIFICATION');
      }
      model.order.status = 'WAITING_DELIVERY';
      return respond(route, model.order);
    });

    await page.goto(`${base}/#/orders/${orderId}`);
    const selector = page.getByRole('group', { name: '商品切换', exact: true });
    const pageNumber = selector.getByRole('textbox', { name: /商品序号/ });
    const jump = selector.getByRole('button', { name: '跳转', exact: true });
    const next = selector.getByRole('button', { name: '下一个商品' });
    const previous = selector.getByRole('button', { name: '上一个商品' });
    const detail = page.getByRole('region', { name: '订单信息', exact: true });
    const product = page.getByRole('region', { name: '商品资料', exact: true });
    await selector.waitFor();

    for (const productionOnly of [true, false]) {
      if (productionOnly) {
        model.permissions = ['ORDER_READ', 'ORDER_PHONE_READ', 'ORDER_PRODUCTION_UPDATE'];
      } else {
        model.permissions.push('ORDER_CUSTOMER_READ', 'ORDER_BUSINESS_DETAILS_READ', 'ORDER_EDIT');
      }
      await page.reload();
      await selector.waitFor();
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        await selector.scrollIntoViewIfNeeded();
        await product.getByRole('button', { name: '查看大图：蛋糕0.png' }).waitFor();
        await next.focus();
        const orderInfo = await detail.boundingBox();
        const navigation = await selector.boundingBox();
        assert.ok(orderInfo.y + orderInfo.height <= navigation.y);
        assert.ok(navigation.y + navigation.height <= (await product.boundingBox()).y);
        const scroll = await page.evaluate(() => window.scrollY);
        await page.keyboard.press('Enter');
        await selector.getByText('第 2 / 3 个商品').waitFor();
        assert.equal(await page.evaluate(() => window.scrollY), scroll);
        assert.equal((await detail.boundingBox()).y, orderInfo.y);
        assert.equal(await next.evaluate(button => button === document.activeElement), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await product.getByText('请分装', { exact: true }).waitFor();
        await product.getByText('该商品暂无款式图片。', { exact: true }).waitFor();
        await page.keyboard.press('Enter');
        await selector.getByText('第 3 / 3 个商品').waitFor();
        assert.equal(await next.evaluate(button => button === document.activeElement), true);
        assert.equal(await next.getAttribute('aria-disabled'), 'true');
        await previous.click();
        await previous.click();
      }
      const initialColor = await product.evaluate(element => getComputedStyle(element).backgroundColor);
      await pageNumber.fill('4');
      assert.equal(await pageNumber.getAttribute('aria-invalid'), 'true');
      assert.equal(await jump.count(), 0);
      await pageNumber.fill('3');
      await jump.click();
      await product.getByText('饮品', { exact: true }).waitFor();
      assert.notEqual(await product.evaluate(element => getComputedStyle(element).backgroundColor), initialColor);
      assert.equal(await jump.count(), 0);
      await pageNumber.fill('1');
      await pageNumber.press('Enter');
      await selector.getByText('第 1 / 3 个商品').waitFor();
    }

    await page.setViewportSize({ width: 390, height: 844 });
    const advance = page.getByRole('button', { name: '完成装饰', exact: true });
    await advance.click();
    const dialog = page.getByRole('dialog', { name: '还有 2 项商品未完成' });
    await dialog.waitFor();
    await selector.getByText('第 2 / 3 个商品').waitFor();
    assert.deepEqual(await dialog.locator('li button').allTextContents(), ['第 2 个商品 · 同名蛋糕', '第 3 个商品 · 饮品']);
    assert.equal(productionAttempts, 0);
    await page.screenshot({ path: '/private/tmp/wuhou-detail-incomplete-390.png' });
    await dialog.getByRole('button', { name: '第 3 个商品 · 饮品' }).click();
    const drink = product.getByRole('checkbox', { name: '饮品制作完成' });
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '饮品制作完成');
    assert.equal(await drink.getAttribute('aria-invalid'), 'true');
    await page.screenshot({ path: '/private/tmp/wuhou-detail-completion-390.png' });
    await drink.click();
    await page.getByText('资料已更新，输入已保留。核对后再保存。', { exact: true }).waitFor();
    assert.equal(await drink.isChecked(), false);
    assert.equal(await drink.getAttribute('aria-invalid'), 'true');
    await drink.click();
    await product.getByText('已完成', { exact: true }).waitFor();
    assert.equal(await drink.getAttribute('aria-invalid'), null);
    await previous.click();
    await product.getByRole('checkbox', { name: '同名蛋糕制作完成' }).click();
    await product.getByText('已完成', { exact: true }).waitFor();

    await advance.click();
    const refreshed = page.getByRole('dialog', { name: '还有 1 项商品未完成' });
    await refreshed.getByRole('button', { name: '第 1 个商品 · 同名蛋糕' }).click();
    const cake = product.getByRole('checkbox', { name: '同名蛋糕制作完成' });
    assert.equal(await cake.getAttribute('aria-invalid'), 'true');
    await cake.click();
    await product.getByText('已完成', { exact: true }).waitFor();
    await advance.click();
    await page.locator('.order-progress [aria-current="step"]').getByText('待自提', { exact: true }).waitFor();
    assert.equal(productionAttempts, 2);
    assert.equal(model.order.status, 'WAITING_DELIVERY');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
