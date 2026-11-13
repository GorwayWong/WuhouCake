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

test('新下单单价自动合计、零价付款、恢复及桌面手机布局', async () => {
  const { context, page, model, complete, saved, errors } = await createOrderFixture(browser, base);
  try {
    model.permissions.push('ORDER_PAYMENT_UPDATE'); await page.reload(); await complete();
    assert.equal(await page.locator('#totalAmount').getAttribute('readonly'), '');
    await page.locator('#paymentMethod').click();
    assert.equal(await page.getByRole('option', { name: '现金', exact: true }).getAttribute('aria-disabled'), 'true');
    await page.keyboard.press('Escape');
    await page.locator('[id="items.0.unitPrice"]').fill('10.01');
    await page.locator('[id="items.0.quantity"]').fill('3');
    assert.equal(await page.locator('#totalAmount').inputValue(), '30.03');
    assert.equal(await page.locator('#memberAmount').inputValue(), '');
    await page.locator('[id="items.0.memberPrice"]').fill('0');
    assert.equal(await page.locator('#memberAmount').inputValue(), '0.00');
    await page.locator('#paymentMethod').click(); await page.getByRole('option', { name: '现金', exact: true }).click();
    await until(async () => (await saved()).value.paymentMethod === 'CASH');
    await page.reload(); await page.getByText('已恢复上次填写', { exact: true }).waitFor();
    assert.equal(await page.locator('#totalAmount').inputValue(), '30.03');
    assert.equal(await page.locator('#memberAmount').inputValue(), '0.00');
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const add = page.getByRole('button', { name: '添加商品', exact: true });
      assert.equal(await add.locator('..').locator('..').getByRole('heading', { name: '商品信息' }).count(), 1);
      await page.locator('[id="items.0.unitPrice"]').scrollIntoViewIfNeeded();
      if (process.env.PRICING_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.PRICING_SCREENSHOT_DIR}/item-sum-${width}.png` });
    }
    await page.getByRole('button', { name: '创建订单', exact: true }).click();
    await until(() => model.createCalls.length === 1);
    assert.equal(model.createCalls[0].input.pricingMode, 'ITEM_SUM');
    assert.equal(model.createCalls[0].input.totalAmountCents, 0);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('旧草稿恢复保持手填金额，不静默切换', async () => {
  const { context, page, complete, saved } = await createOrderFixture(browser, base);
  try {
    await complete(); await until(async () => Boolean((await saved())?.revision));
    await page.evaluate(() => { const key = 'wuhou:order-draft:v1:alice', record = JSON.parse(localStorage.getItem(key)); delete record.initial.pricingMode; delete record.value.pricingMode; record.value.totalAmount = '88.88'; record.value.memberAmount = '80'; localStorage.setItem(key, JSON.stringify(record)); });
    await page.reload(); await page.getByText('已恢复上次填写', { exact: true }).waitFor();
    assert.equal(await page.locator('#totalAmount').getAttribute('readonly'), null);
    assert.equal(await page.locator('#totalAmount').inputValue(), '88.88');
    await page.locator('#totalAmount').fill('99');
    assert.equal(await page.locator('#memberAmount').inputValue(), '80');
  } finally { await context.close(); }
});

test('套餐报价不一致阻止带入，修正后复制报价与备注并按数量合计', async () => {
  const { context, page, saved, errors } = await createOrderFixture(browser, base);
  try {
    const value = { id: 'p', name: '茶歇', version: 1, updatedAt: '', originalAmountCents: 999, memberAmountCents: null,
      items: [{ itemId: crypto.randomUUID(), imageId: null, name: '点心', productType: 'OTHER', quantity: 2, unitPriceCents: 1000, memberPriceCents: null, attributes: { specification: '少糖\n独立包装' } }] };
    await context.route('**/api/order-packages**', route => route.fulfill({ json: { success: true, data: new URL(route.request().url()).pathname.endsWith('/p') ? value : { items: [value], total: 1, page: 1, size: 20 } } }));
    await page.getByRole('button', { name: '导入套餐', exact: true }).click();
    await page.locator('.package-picker select').selectOption('p');
    await page.getByRole('button', { name: '带入商品', exact: true }).click();
    await page.getByText(/请先在套餐管理核对报价并保存/).waitFor();
    assert.equal((await saved())?.value.items[0].name || '', '');
    value.originalAmountCents = 2000;
    await page.getByRole('button', { name: '带入商品', exact: true }).click();
    await until(async () => (await saved())?.value.items[0].name === '点心');
    assert.equal(await page.locator('#totalAmount').inputValue(), '20.00');
    assert.equal(await page.locator('[id="items.0.unitPrice"]').inputValue(), '10.00');
    assert.equal(await page.locator('[id="items.0.requirements"]').inputValue(), '少糖\n独立包装');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('汇总订单详情隐藏手填金额入口，编辑商品单价后采用服务器金额', async () => {
  const { context, page, model, complete, errors } = await createOrderFixture(browser, base);
  try {
    await complete(); await page.locator('[id="items.0.unitPrice"]').fill('10');
    await page.getByRole('button', { name: '创建订单', exact: true }).click();
    await until(() => model.order !== null);
    await page.goto(base + '/#/orders/' + orderId);
    await page.locator('.payment-panel').waitFor();
    assert.equal(await page.getByRole('button', { name: '修改金额', exact: true }).count(), 0);
    await context.route(`**/api/orders/${orderId}`, async route => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      const request = route.request().postDataJSON();
      const item = model.order.items.find(item => item.itemId === request.itemId);
      assert.equal(request.expectedVersion, model.order.version);
      item.unitPriceCents = request.changes.referenceUnitPriceCents;
      model.order.originalAmountCents = item.unitPriceCents * item.quantity;
      model.order.totalAmountCents = model.order.originalAmountCents; model.order.version++;
      return route.fulfill({ json: { success: true, data: model.order } });
    });
    await page.locator('.product-actions').getByRole('button', { name: '编辑', exact: true }).click();
    await page.locator('#item-unitPrice').fill('20');
    await page.locator('.item-form').getByRole('button', { name: '保存', exact: true }).click();
    await until(() => model.order.version === 1);
    await until(async () => (await page.locator('.order-amount').innerText()).includes('20'));
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
