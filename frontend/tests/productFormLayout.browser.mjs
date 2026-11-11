import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createRequire } from 'node:module';
import { createOrderFixture, orderId } from './orderBrowserFixture.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DRAFT_TEST_URL || 'http://127.0.0.1:5197';
const rows = ['name', 'size,quantity', 'base,flavor', 'filling', 'message', 'requirements', 'specification'];
let browser;
before(async () => { browser = await chromium.launch({ headless: true, channel: process.env.DRAFT_BROWSER_CHANNEL || 'chrome' }); });
after(async () => { await browser?.close(); });
async function until(check) {
  for (let n = 0; n < 200; n++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error('等待商品表单状态超时');
}
async function checkLayout(page, width, grid = page.locator('.product-form-fields').first(), expectedRows = rows) {
  await page.setViewportSize({ width, height: 1000 });
  assert.deepEqual(await grid.locator('[data-product-row]').evaluateAll(elements => elements.map(element => element.dataset.productRow)), expectedRows);
  const bounds = await grid.boundingBox();
  for (const keys of expectedRows) {
    const group = grid.locator(`[data-product-row="${keys}"]`);
    const controls = group.locator('input:not([type=hidden]), textarea, .preserved-specification');
    const one = await controls.nth(0).boundingBox();
    assert.ok(one && one.width > 0, `${width}: ${keys} 有可见控件`);
    if (!keys.includes(',')) assert.ok(Math.abs(one.width - bounds.width) < 2, `${width}: ${keys} 占整行`);
    else {
      const two = await controls.nth(1).boundingBox();
      if (width < 360) { assert.ok(Math.abs(one.x - two.x) < 2); assert.ok(two.y > one.y); }
      else { assert.ok(two.x > one.x); assert.ok(Math.abs(one.y - two.y) < 2, `${width}: ${keys} 输入顶边对齐 ${one.y}/${two.y}`); }
    }
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}: 无横向溢出`);
}
async function screenshot(page, name) {
  if (process.env.LAYOUT_SCREENSHOT_DIR) {
    await page.locator('.product-form-fields').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${process.env.LAYOUT_SCREENSHOT_DIR}/${name}.png`, fullPage: false });
  }
}

test('录单排布覆盖四种宽度，识别标记保留，多商品错误按规格优先定位', async () => {
  const { context, page, model, complete, saved, errors } = await createOrderFixture(browser, base);
  try {
    const duplicateKeys = []; page.on('console', message => { if (message.text().includes('same key')) duplicateKeys.push(message.text()); });
    await complete(); const date = (await saved()).value.requestedReceiveDate;
    const field = (value, source = 'RULE') => ({ value, source, evidence: source === 'RULE' ? ['合成原文'] : [], needsReview: source === 'RULE', issues: [] });
    model.recognitionDraft = { fields: { requestedReceiveDate: field(date) }, items: [{ id: 'cake', fields: { name: field('识别蛋糕'), productType: field('CAKE'), size: field('6'), quantity: field('1'), base: field('原味', 'DEFAULT'), filling: field('芒果', 'DEFAULT'), flavor: field('原味奶油', 'DEFAULT') } }], issues: [], fragments: [], unmappedText: [], assistAvailable: false };
    await page.getByText('粘贴下单信息', { exact: true }).click(); await page.locator('#recognition-text').fill('合成蛋糕');
    await page.getByRole('button', { name: '识别并填入', exact: true }).click();
    await until(async () => await page.locator('[id="items.0.size"]').count() === 1 && await page.locator('[id="items.0.size"]').inputValue() === '6');
    await page.locator('[id="items.0.quantity"]').fill('2');
    for (const width of [320, 360, 390, 1440]) {
      await checkLayout(page, width);
      if (width === 390 || width === 1440) await screenshot(page, `product-layout-create-${width}`);
    }
    assert.equal(await page.locator('.create-item-heading [id="items.0.productType"]').count(), 1);
    assert.equal(await page.locator('.product-form-fields [id="items.0.productType"]').count(), 0);
    assert.equal(await page.locator('[id="items.0.size"]').getAttribute('required'), null);
    await page.locator('[id="items.0.size"]').focus(); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'items.0.quantity');
    await page.getByRole('button', { name: '添加商品', exact: true }).click();
    await page.locator('[id="items.1.name"]').fill('第二蛋糕'); await page.locator('[id="items.1.quantity"]').fill('0'); await page.locator('[id="items.1.size"]').fill('0');
    await page.getByRole('button', { name: '上一个商品', exact: true }).click();
    await page.getByRole('button', { name: '创建订单', exact: true }).click();
    await until(async () => await page.evaluate(() => document.activeElement.id) === 'items.1.size');
    await checkLayout(page, 390); assert.equal(model.createCalls.length, 0); assert.equal(await page.locator('.create-item').count(), 1); assert.deepEqual(duplicateKeys, []); assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('商品编辑保留结构化规格和未改动的异常旧尺寸，追加商品使用相同排布', async () => {
  const { context, page, model, errors } = await createOrderFixture(browser, base);
  try {
    const itemId = crypto.randomUUID(); let patch;
    model.order = { orderId, orderNo: 'LEGACY', version: 0, status: 'CAKE_BASE', paymentStatus: 'UNPAID', currentStageCode: null, customer: { customerName: '客户', phone: '13800000000', memberPhone: null, buyerName: null }, fulfillment: { type: 'PICKUP', address: null, requestedReceiveDate: '2026-11-05', plannedHandoffAt: null, plannedFinishAt: null }, totalAmountCents: 12000, createdAt: '2026-11-04T08:00:00Z', updatedAt: '2026-11-04T08:00:00Z', items: [{ itemId, name: '旧蛋糕', productType: 'CAKE', quantity: 1, unitPriceCents: 12000, memberPriceCents: null, recentNotes: [], attributes: { size: '旧尺寸待确认', base: ['原味', '巧克力'], filling: { layers: ['草莓'] }, flavor: ['动物奶油'], message: '生日快乐', requirements: '少糖' } }] };
    await context.route(`**/api/orders/${orderId}`, async route => {
      if (route.request().method() === 'PATCH') { patch = route.request().postDataJSON(); model.order.version++; Object.assign(model.order.items[0], patch.changes); }
      await route.fulfill({ json: { success: true, data: model.order } });
    });
    await page.goto(`${base}/#/orders/${orderId}`); await page.locator('.order-products').getByRole('button', { name: '编辑', exact: true }).click();
    for (const width of [320, 360, 390, 1440]) await checkLayout(page, width, page.locator('.item-form .product-form-fields'));
    assert.equal(await page.locator('.item-form .preserved-specification').count(), 3);
    assert.equal(await page.locator('#item-size').inputValue(), '旧尺寸待确认');
    await page.locator('#item-quantity').fill('2'); await page.locator('.item-form').getByRole('button', { name: '保存', exact: true }).click();
    await until(() => Boolean(patch)); assert.deepEqual(patch, { expectedVersion: 0, itemId, changes: { quantity: 2 } });
    await until(async () => await page.locator('.item-form').count() === 0);
    await page.getByRole('button', { name: '添加商品', exact: true }).click(); await checkLayout(page, 390, page.locator('.item-form .product-form-fields'));
    assert.equal(await page.locator('#item-size').getAttribute('required'), null); assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('客户扫码填单的尺寸仍必填，手机两列不影响收货表单且不增加图片或价格', async () => {
  const { context, page, errors } = await createOrderFixture(browser, base);
  try {
    let posted;
    await context.route('**/api/public/order-entries/layout/submissions', async route => { posted = route.request().postDataJSON(); await route.fulfill({ json: { success: true, data: { submissionNo: 'F-TEST' } } }); });
    await context.route('**/api/public/order-entries/layout', route => route.fulfill({ json: { success: true, data: { ownerName: '测试客服' } } }));
    await page.goto(`${base}/#/fill/layout`); await page.locator('[id="items.0.size"]').waitFor();
    for (const width of [320, 360, 390, 1440]) {
      await checkLayout(page, width, undefined, ['size,quantity', 'base,flavor', 'filling', 'message', 'requirements']); if (width === 390) await screenshot(page, 'product-layout-public-390');
    }
    assert.notEqual(await page.locator('[id="items.0.size"]').getAttribute('required'), null);
    assert.equal(await page.locator('input[type=file], [id="items.0.unitPrice"], [id="items.0.memberPrice"]').count(), 0);
    assert.equal(await page.locator('.create-item-heading [id="items.0.productType"]').count(), 0);
    assert.equal(await page.locator('[id="items.0.name"]').count(), 0);
    assert.equal(await page.getByRole('heading', { name: '订购需知' }).count(), 1);
    await page.getByRole('button', { name: '提交预订', exact: true }).click();
    assert.equal(await page.locator('#phone').getAttribute('aria-invalid'), 'true');
    await page.locator('#phone').fill('13800000000');
    await page.locator('#address').fill('测试地址');
    await page.getByRole('button', { name: '提交预订', exact: true }).click();
    assert.equal(await page.locator('[id="items.0.size"]').getAttribute('aria-invalid'), 'true');
    await page.getByRole('button', { name: '添加商品', exact: true }).click();
    assert.equal(await page.locator('[id="items.1.size"]').count(), 1);
    assert.equal(await page.locator('[id="items.1.name"]').count(), 0);
    await page.getByRole('button', { name: '移除商品 2' }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    const phone = await page.locator('#phone').boundingBox(), member = await page.locator('#memberPhone').boundingBox();
    assert.ok(member.y > phone.y);
    await page.locator('[id="items.0.size"]').fill('6');
    await page.locator('[id="items.0.message"]').fill('生日快乐');
    await page.locator('#requestedReceiveAt').click();
    await page.getByRole('button', { name: '今天', exact: true }).click();
    await page.locator('[data-control-label="取货时间小时"] button').click();
    await page.getByRole('option', { name: '18 时', exact: true }).click();
    if (process.env.LAYOUT_SCREENSHOT_DIR) await page.locator('.customer-order-notice').screenshot({ path: `${process.env.LAYOUT_SCREENSHOT_DIR}/customer-order-notice-390.png` });
    await page.getByRole('button', { name: '提交预订', exact: true }).click();
    await until(() => Boolean(posted));
    assert.equal(posted.items[0].name, '蛋糕'); assert.equal(posted.items[0].productType, 'CAKE');
    assert.equal(posted.items[0].attributes.flavor, '原味动物奶油');
    assert.equal(posted.items[0].attributes.message, '生日快乐');
    assert.equal('images' in posted.items[0], false);
    await page.getByRole('heading', { name: '已提交，待客服确认' }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('员工核对采用相同排布并保留尺寸必填和原始字段名', async () => {
  const { context, page, model, errors } = await createOrderFixture(browser, base);
  try {
    model.permissions.push('CUSTOMER_SUBMISSION_PROCESS'); const id = crypto.randomUUID();
    const content = { phone: '13800000000', memberPhone: null, fulfillmentType: 'PICKUP', address: null, requestedReceiveAt: '2026-11-05T10:00:00Z', items: [{ name: '蛋糕', productType: 'CAKE', quantity: 1, attributes: { size: '6', base: '原味', filling: '芒果', flavor: '原味奶油', message: '生日快乐', requirements: '' } }] };
    const submission = { id, version: 0, status: 'PENDING', ownerName: 'alice', createdAt: '2026-11-04T08:00:00Z', original: content, reviewed: null, orderId: null };
    await context.route(`**/api/customer-submissions/${id}`, route => route.fulfill({ json: { success: true, data: { submission, duplicates: [], activities: [], duplicateCheckToken: 'test' } } }));
    await page.goto(`${base}/#/customer-submissions/${id}`); await page.reload(); await page.locator('[id="items.0.size"]').waitFor();
    for (const width of [320, 360, 390, 1440]) await checkLayout(page, width);
    assert.notEqual(await page.locator('[id="items.0.size"]').getAttribute('required'), null);
    assert.equal(await page.locator('[id="items.0.base"]').inputValue(), '原味'); assert.equal(await page.locator('[id="items.0.specification"]').count(), 1);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('套餐表格在手机和桌面保持四列，多行规格可取消、确认，价格作为套餐字段', async () => {
  const { context, page, errors } = await createOrderFixture(browser, base);
  try {
    let body;
    await context.route('**/api/me', route => route.fulfill({ json: { success: true, data: { accountId: 'alice', nickname: '店长', employeeNumber: 'TEST', jobRoles: ['STORE_MANAGER'], access: { permissions: ['ORDER_READ', 'ORDER_CREATE', 'ORDER_CUSTOMER_READ', 'ORDER_AMOUNT_READ', 'ORDER_BUSINESS_DETAILS_READ'], uiCapabilities: [] } } } }));
    await context.route('**/api/order-packages**', route => {
      if (route.request().method() === 'POST') { body = route.request().postDataJSON(); return route.fulfill({ status: 201, json: { success: true, data: { ...body, id: crypto.randomUUID(), version: 0 } } }); }
      return route.fulfill({ json: { success: true, data: { items: [], total: 0, page: 1, size: 20 } } });
    });
    await page.goto(`${base}/#/admin/order-packages`); await page.reload(); await page.getByRole('button', { name: '新建套餐', exact: true }).first().click();
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      assert.deepEqual(await page.locator('th').allTextContents(), ['图片', '名称', '规格', '数量']);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}: 无横向溢出`);
      if (width === 390 && process.env.LAYOUT_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.LAYOUT_SCREENSHOT_DIR}/wuhou-package-table-390.png` });
    }
    const spec = page.getByRole('button', { name: '编辑商品 1 的规格' });
    await spec.click(); await page.getByLabel('规格说明').fill('临时内容');
    await page.getByRole('dialog').getByRole('button', { name: '取消' }).click();
    assert.equal(await spec.innerText(), '填写');
    await spec.click(); await page.getByLabel('规格说明').fill('香草\n六只装');
    await page.getByRole('button', { name: '确认规格' }).click();
    await page.locator('#package-name').fill('通用套餐'); await page.getByLabel('商品 1 的名称').fill('纸杯蛋糕');
    await page.locator('#package-original').fill('200'); await page.locator('#package-member').fill('180');
    await page.getByRole('button', { name: '保存套餐', exact: true }).click(); await until(() => Boolean(body));
    assert.deepEqual(body.items[0].attributes, { specification: '香草\n六只装' });
    assert.equal(body.items[0].productType, 'OTHER'); assert.equal(body.items[0].imageId, null);
    assert.equal(body.originalAmountCents, 20000); assert.equal(body.memberAmountCents, 18000);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('套餐图读取失败不改变草稿，确认后保存图片快照并在订单详情保留规格和图', async () => {
  const { context, page, png, saved, errors, model } = await createOrderFixture(browser, base);
  try {
    const item = { itemId: crypto.randomUUID(), imageId: crypto.randomUUID(), name: '纸杯蛋糕', productType: 'OTHER', quantity: 6, attributes: { specification: '香草\n六只装' } };
    const value = { id: crypto.randomUUID(), name: '纸杯蛋糕套餐', version: 0, updatedAt: '2026-11-04T08:00:00Z', originalAmountCents: 20000, memberAmountCents: 18000, items: [item] };
    let imageAvailable = false;
    await context.route('**/api/order-packages**', route => route.fulfill({ json: { success: true, data: new URL(route.request().url()).pathname === '/api/order-packages' ? { items: [value], total: 1, page: 1, size: 20 } : value } }));
    await context.route(`**/items/${item.itemId}/images/${item.imageId}`, route => imageAvailable ?
      route.fulfill({ contentType: 'image/png', body: png }) : route.fulfill({ status: 404, json: { success: false, code: 'IMAGE_NOT_FOUND' } }));
    await page.locator('#phone').fill('13800000000'); await page.locator('#address').fill('自提');
    const before = (await saved()).value;
    await page.getByRole('button', { name: '使用套餐', exact: true }).click();
    await page.getByRole('button', { name: /选择套餐/ }).click(); await page.getByRole('option', { name: /纸杯蛋糕套餐/ }).click();
    await page.getByRole('button', { name: '带入商品', exact: true }).click();
    await page.locator('.package-picker').getByRole('alert').waitFor();
    assert.deepEqual((await saved()).value, before);
    imageAvailable = true;
    await page.getByRole('button', { name: '带入商品', exact: true }).click();
    await until(async () => Boolean((await saved())?.value.items[0].images?.length));
    const next = await saved();
    assert.equal(next.value.items[0].productType, 'OTHER');
    assert.equal(next.value.items[0].attributes.specification, '香草\n六只装');
    assert.equal(await page.locator('[id="items.0.size"]').count(), 0);
    assert.equal(next.value.totalAmount, '200.00'); assert.equal(next.value.memberAmount, '180.00');
    await page.reload(); await page.getByRole('button', { name: '继续填写', exact: true }).click();
    await page.getByAltText('纸杯蛋糕.png', { exact: true }).waitFor();
    imageAvailable = false;
    await page.getByRole('button', { name: '创建订单', exact: true }).click();
    await page.locator('#order-reference-images').waitFor();
    await until(() => model.images.length === 1);
    assert.equal(model.order.items[0].productType, 'OTHER');
    assert.equal(model.order.items[0].attributes.specification, '香草\n六只装');
    const detailSpec = page.getByText('香草 六只装', { exact: true }).first();
    await detailSpec.waitFor();
    assert.equal(await detailSpec.evaluate(element => getComputedStyle(element).whiteSpace), 'pre-wrap');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('未确认分类的识别商品在标题区提示并聚焦，选择类型后保留正常字段', async () => {
  const { context, page, model, complete, saved, errors } = await createOrderFixture(browser, base);
  try {
    await complete(); const date = (await saved()).value.requestedReceiveDate;
    const field = value => ({ value, source: value === null ? null : 'RULE', evidence: [], needsReview: false, issues: [] });
    model.recognitionDraft = { fields: { requestedReceiveDate: field(date) }, items: [{ id: 'unknown', fields: { name: field('待确认商品'), productType: field(null), quantity: field('1'), size: field('6') } }], issues: [], fragments: [], unmappedText: [], assistAvailable: false };
    await page.getByText('粘贴下单信息', { exact: true }).click(); await page.locator('#recognition-text').fill('合成商品');
    await page.getByRole('button', { name: '识别并填入', exact: true }).click();
    await until(async () => (await saved()).value.items[0].requiresTypeConfirmation === true);
    await page.getByRole('button', { name: '创建订单', exact: true }).click();
    await until(async () => await page.evaluate(() => document.activeElement.id) === 'items.0.productType');
    assert.notEqual(await page.locator('.product-type-field .choice-field').getAttribute('data-invalid'), null);
    await page.locator('[id="items.0.productType"]').click(); await page.getByRole('option', { name: '蛋糕', exact: true }).click();
    await checkLayout(page, 390);
    assert.equal((await saved()).value.items[0].requiresTypeConfirmation, false); assert.equal(await page.locator('[id="items.0.size"]').inputValue(), '6');
    assert.equal(model.createCalls.length, 0); assert.deepEqual(errors, []);
  } finally { await context.close(); }
});


test('录单顶部紧凑且套餐默认不加载，四种宽度无溢出', async () => {
  const { context, page, saved, errors, model } = await createOrderFixture(browser, base);
  try {
    model.permissions.push('ORDER_MANAGEMENT_READ', 'ORDER_BUSINESS_DETAILS_READ', 'CUSTOMER_SUBMISSION_PROCESS');
    let requests = 0;
    await context.route('**/api/orders/stream', () => {});
    await context.route('**/api/order-packages?**', route => { requests++; return route.fulfill({ json: { success: true, data: { items: [], total: 0, page: 1, size: 20 } } }); });
    await page.reload();
    await page.locator('#customerName').fill('布局客户');
    await until(async () => Boolean((await saved())?.updatedAt));
    for (const width of [320, 390, 430, 1280]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => window.scrollTo(0, 0));
      const layout = await page.evaluate(() => {
        const nav = document.querySelector('.app-nav').getBoundingClientRect();
        const bar = document.querySelector('.draft-toolbar').getBoundingClientRect();
        const recognition = document.querySelector('.recognition-section').getBoundingClientRect();
        const status = document.querySelector('.draft-save-status').getBoundingClientRect();
        const discard = document.querySelector('.draft-toolbar button').getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth > innerWidth, navGap: bar.top - nav.bottom, barGap: recognition.top - bar.bottom, statusTop: status.top, discardBottom: discard.bottom, height: discard.height };
      });
      assert.equal(layout.overflow, false); assert.ok(layout.navGap >= 12 && layout.navGap <= 16, JSON.stringify(layout));
      assert.ok(layout.barGap >= 12 && layout.barGap <= 16, JSON.stringify(layout));
      assert.ok(layout.statusTop < layout.discardBottom); assert.ok(layout.height >= 44);
      if (process.env.LAYOUT_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.LAYOUT_SCREENSHOT_DIR}/entry-compact-top-${width}.png`, fullPage: false });
    }
    assert.equal(requests, 0);
    assert.equal(await page.getByRole('button', { name: '使用套餐', exact: true }).getAttribute('aria-expanded'), 'false');
    assert.equal(await page.getByRole('textbox', { name: '搜索套餐' }).count(), 0);
    await page.getByRole('button', { name: '放弃草稿', exact: true }).click();
    await page.getByRole('button', { name: '确认放弃', exact: true }).waitFor();
    assert.ok(await saved());
    await page.getByRole('button', { name: '返回', exact: true }).click();
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('套餐按需加载、收起保留搜索与选择，带入时不能收起，失败后可重试和重复添加', async () => {
  const { context, page, saved, errors } = await createOrderFixture(browser, base);
  try {
    const value = { id: crypto.randomUUID(), name: '测试套餐', version: 0, updatedAt: '2026-11-08T08:00:00Z', originalAmountCents: 10000, memberAmountCents: 9000, items: [{ itemId: crypto.randomUUID(), imageId: null, name: '套餐商品', productType: 'OTHER', quantity: 2, attributes: {} }] };
    let listCalls = 0, detailCalls = 0, fail = true;
    let pending;
    await context.route('**/api/order-packages**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/order-packages') { listCalls++; return route.fulfill({ json: { success: true, data: { items: [value], total: 21, page: Number(url.searchParams.get('page') || 1), size: 20 } } }); }
      detailCalls++;
      await new Promise(resolve => { pending = resolve; });
      return route.fulfill(fail ? { status: 404, json: { success: false, code: 'NOT_FOUND' } } : { json: { success: true, data: value } });
    });
    await page.reload();
    assert.equal(listCalls, 0);
    await page.getByRole('button', { name: '使用套餐', exact: true }).click();
    await page.getByRole('textbox', { name: '搜索套餐' }).fill('测试');
    await page.locator('.package-picker').getByRole('button', { name: '搜索', exact: true }).click();
    await page.getByRole('button', { name: /选择套餐/ }).click();
    await page.getByRole('option', { name: /测试套餐/ }).click();
    await page.getByRole('button', { name: '收起套餐', exact: true }).click();
    const closedCalls = listCalls;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    assert.equal(listCalls, closedCalls);
    await page.getByRole('button', { name: '使用套餐', exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: '搜索套餐' }).inputValue(), '测试');
    await page.getByRole('button', { name: '带入商品', exact: true }).click();
    await until(() => Boolean(pending));
    assert.equal(await page.getByRole('button', { name: '收起套餐', exact: true }).isDisabled(), true);
    pending(); pending = undefined;
    await page.locator('.package-picker').getByRole('alert').waitFor();
    assert.equal((await saved())?.value.items.length || 1, 1);
    fail = false;
    await page.getByRole('button', { name: '带入商品', exact: true }).click();
    await until(() => Boolean(pending)); pending(); pending = undefined;
    await until(async () => (await saved())?.value.items.some(item => item.name === '套餐商品'));
    const count = (await saved()).value.items.length;
    await page.getByRole('button', { name: '再添加一份', exact: true }).click();
    await until(() => Boolean(pending)); pending(); pending = undefined;
    await page.getByRole('dialog', { name: '确认带入套餐' }).getByText('合并到商品 1：2 → 4', { exact: false }).waitFor();
    await page.getByRole('dialog').getByRole('button', { name: '取消' }).click();
    assert.equal((await saved()).value.items[0].quantity, '2');
    await page.getByRole('button', { name: '再添加一份', exact: true }).click();
    await until(() => Boolean(pending)); pending(); pending = undefined;
    await page.getByRole('button', { name: '确认带入', exact: true }).click();
    await until(async () => (await saved()).value.items[0].quantity === '4');
    assert.equal((await saved()).value.totalAmount, '200.00');
    assert.equal((await saved()).value.memberAmount, '180.00');
    await page.getByRole('button', { name: '收起套餐', exact: true }).click();
    assert.equal((await saved()).value.items.length, count);
    await page.getByRole('button', { name: '使用套餐', exact: true }).click();
    await page.locator('.package-picker').getByRole('button', { name: '下一页', exact: true }).click();
    await page.locator('.package-picker').getByText('第 2 页', { exact: false }).waitFor();
    assert.equal(detailCalls, 4);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});


test('新常用方式提交老板，历史下单人经恢复仍保留原文', async () => {
  for (const method of ['老板', '下单人']) {
    const { context, page, complete, saved, model, errors } = await createOrderFixture(browser, base);
    try {
      await complete();
      if (method === '老板') {
        await page.locator('.ordering-method-input button').click();
        await page.getByRole('option', { name: '老板', exact: true }).click();
        assert.equal(await page.getByRole('option', { name: '下单人', exact: true }).count(), 0);
      } else {
        await page.evaluate(() => { const key = 'wuhou:order-draft:v1:alice'; const draft = JSON.parse(localStorage.getItem(key)); draft.value.orderingMethod = '下单人'; localStorage.setItem(key, JSON.stringify(draft)); });
        await page.reload();
        await page.getByRole('button', { name: '继续填写', exact: true }).click();
        assert.equal(await page.getByRole('textbox', { name: '具体下单方式', exact: true }).inputValue(), '下单人');
      }
      await until(async () => (await saved()).value.orderingMethod === method);
      await page.getByRole('button', { name: '创建订单', exact: true }).click();
      await until(() => model.createCalls.length === 1);
      assert.equal(model.createCalls[0].input.orderingMethod, method);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});
