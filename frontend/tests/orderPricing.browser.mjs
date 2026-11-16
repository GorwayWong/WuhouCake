import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createRequire } from 'node:module';
import { createOrderFixture, orderId } from './orderBrowserFixture.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DRAFT_TEST_URL || 'http://127.0.0.1:5197';
let browser;
before(async () => { browser = await chromium.launch({ headless: true, channel: 'chrome' }); });
after(async () => { await browser?.close(); });
async function until(check) { for (let i = 0; i < 150; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 30)); } throw new Error('Timed out'); }

async function restoreLegacy(page) {
  await page.evaluate(() => { const key = 'wuhou:order-draft:v1:alice'; const record = JSON.parse(localStorage.getItem(key)); delete record.value.pricingMode; delete record.initial.pricingMode; localStorage.setItem(key, JSON.stringify(record)); });
  await page.reload(); await page.getByText('已恢复上次填写', { exact: true }).waitFor();
}

test('整单双报价和支付方式跨草稿恢复，响应丢失仍使用相同载荷与幂等标识', async () => {
  const { context, page, model, complete, saved, errors } = await createOrderFixture(browser, base);
  try {
    model.permissions.push('ORDER_PAYMENT_UPDATE'); await page.reload(); await complete(); await restoreLegacy(page);
    await page.locator('#totalAmount').fill('158.01'); await page.locator('#memberAmount').fill('128.02');
    await page.locator('#paymentMethod').click(); await page.getByRole('option', { name: '现金', exact: true }).click();
    await until(async () => (await saved()).value.paymentMethod === 'CASH');
    await page.reload(); await page.getByText('已恢复上次填写', { exact: true }).waitFor();
    assert.equal(await page.locator('#totalAmount').inputValue(), '158.01');
    assert.equal(await page.locator('#memberAmount').inputValue(), '128.02');
    assert.match(await page.locator('#paymentMethod').innerText(), /现金/);
    for (const width of [320, 390, 430, 1280]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const original = await page.locator('#totalAmount').boundingBox(), member = await page.locator('#memberAmount').boundingBox();
      if (width >= 360) { assert.ok(member.x > original.x); assert.equal(member.y, original.y); } else assert.equal(member.x, original.x);
      if (width === 390 && process.env.PRICING_SCREENSHOT_DIR) { await page.locator('#memberAmount').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.PRICING_SCREENSHOT_DIR}/order-pricing-390.png` }); }
    }
    model.loseCreate = true;
    await page.getByRole('button', { name: '创建订单', exact: true }).click();
    await page.getByRole('button', { name: '重试提交', exact: true }).waitFor();
    const pending = (await saved()).pending;
    assert.equal(pending.originalAmountCents, 15801); assert.equal(pending.memberAmountCents, 12802);
    assert.equal(pending.totalAmountCents, 12802); assert.equal(pending.paymentMethod, 'CASH');
    await page.reload(); await page.getByText('已恢复上次填写', { exact: true }).waitFor();
    assert.equal(await page.locator('#memberAmount').isDisabled(), true);
    await page.getByRole('button', { name: '重试提交', exact: true }).click();
    await until(() => model.createCalls.length === 2);
    assert.equal(model.createCalls[0].key, model.createCalls[1].key);
    assert.deepEqual(model.createCalls[0].input, model.createCalls[1].input);
    assert.equal(model.orders.size, 1);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('详情先撤销付款才能改价，重新登记使用新金额和时间', async () => {
  const { context, page, model, errors } = await createOrderFixture(browser, base);
  try {
    model.permissions.push('ORDER_BUSINESS_DETAILS_READ', 'ORDER_EDIT', 'ORDER_PAYMENT_UPDATE');
    const paidAt = '2026-11-08T04:00:00Z';
    model.order = { orderId, orderNo: 'PRICES', version: 0, status: 'CAKE_BASE', paymentStatus: 'PAID', paymentMethod: 'CASH', paidAt,
      originalAmountCents: 15800, memberAmountCents: 12800, totalAmountCents: 12800,
      createdAt: paidAt, updatedAt: paidAt, customer: { phone: '13800000000' }, fulfillment: { type: 'PICKUP', requestedReceiveDate: '2026-11-09' },
      items: [{ itemId: crypto.randomUUID(), name: '蛋糕', productType: 'CAKE', quantity: 1, attributes: {}, productionStatus: 'NOT_STARTED', recentNotes: [] }] };
    const patches = [];
    await context.route(`**/api/orders/${orderId}/information`, async route => {
      const request = route.request().postDataJSON(); patches.push(request);
      assert.equal(request.expectedVersion, model.order.version);
      Object.assign(model.order, request.changes);
      model.order.totalAmountCents = model.order.memberAmountCents ?? model.order.originalAmountCents; model.order.version++;
      return route.fulfill({ json: { success: true, data: model.order } });
    });
    await context.route(`**/api/orders/${orderId}/payment-status`, async route => {
      const request = route.request().postDataJSON(); patches.push(request);
      assert.equal(request.expectedVersion, model.order.version);
      if (request.paymentStatus !== model.order.paymentStatus) {
        model.order.paidAt = request.paymentStatus === 'PAID' ? '2026-11-09T04:00:00Z' : null;
      }
      Object.assign(model.order, { paymentMethod: request.paymentMethod, paymentStatus: request.paymentStatus }); model.order.version++;
      return route.fulfill({ json: { success: true, data: model.order } });
    });
    await page.goto(base + '/#/orders/' + orderId); await page.reload();
    assert.equal(await page.getByRole('button', { name: '修改金额', exact: true }).count(), 0);
    await page.locator('.order-payment-editor button[aria-haspopup=listbox]').click();
    await page.getByRole('option', { name: '对公转账', exact: true }).click();
    await page.getByRole('button', { name: '保存支付方式', exact: true }).click();
    await until(() => model.order.version === 1);
    assert.equal(patches[0].paymentMethod, 'BANK_TRANSFER');
    assert.equal(model.order.paidAt, paidAt);
    page.once('dialog', async dialog => {
      assert.match(dialog.message(), /改为未付款.*付款时间会清除/);
      await dialog.accept();
    });
    await page.getByRole('button', { name: '撤销付款登记', exact: true }).click();
    await until(() => model.order.version === 2);
    assert.equal(model.order.paidAt, null);
    await page.getByRole('button', { name: '修改金额', exact: true }).click();
    await page.locator('#edit-memberAmount').fill('');
    await page.locator('.amount-editor').getByRole('button', { name: '保存修改', exact: true }).click();
    await until(() => model.order.version === 3);
    assert.deepEqual(patches[2].changes, { memberAmountCents: null });
    assert.equal(model.order.totalAmountCents, 15800);
    await page.locator('.order-payment-editor button[aria-haspopup=listbox]').click();
    await page.getByRole('option', { name: '现金', exact: true }).click();
    await page.getByRole('button', { name: '确认已付款', exact: true }).click();
    await until(() => model.order.version === 4);
    assert.equal(patches[3].paymentStatus, 'PAID');
    assert.equal(model.order.paidAt, '2026-11-09T04:00:00Z');
    assert.equal(model.order.totalAmountCents, 15800);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('无付款登记权限只能选择未付，新订单默认未付', async () => {
  const { context, page } = await createOrderFixture(browser, base);
  try {
    assert.match(await page.locator('#paymentMethod').innerText(), /未付/);
    await page.locator('#paymentMethod').click();
    for (const label of ['银联', '扣卡', '对公转账', '客服微信', '现金']) assert.equal(await page.getByRole('option', { name: label, exact: true }).getAttribute('aria-disabled'), 'true');
    assert.notEqual(await page.getByRole('option', { name: '未付', exact: true }).getAttribute('aria-disabled'), 'true');
  } finally { await context.close(); }
});
