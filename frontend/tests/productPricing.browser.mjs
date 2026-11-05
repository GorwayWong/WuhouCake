import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createRequire } from 'node:module';
import { createOrderFixture, orderId } from './orderBrowserFixture.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DRAFT_TEST_URL || 'http://127.0.0.1:5197';
let browser;
before(async () => { browser = await chromium.launch({ headless: true, channel: process.env.DRAFT_BROWSER_CHANNEL || 'chrome' }); });
after(async () => { await browser?.close(); });
async function until(check) {
  for (let n = 0; n < 200; n++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error('等待价格状态超时');
}
async function chooseType(page, type) {
  await page.locator('.create-item button.choice-trigger').last().click();
  await page.getByRole('option', { name: type, exact: true }).click();
}
test('蛋糕恢复后没有单价或合计，混合订单只计算其他商品，详情和商品编辑按类型显示', async () => {
  const { context, page, model, saved, complete, errors } = await createOrderFixture(browser, base);
  try {
    await complete(); await page.locator('#totalAmount').fill('120.29');
    assert.equal(await page.locator('[id="items.0.unitPrice"], [id="items.0.memberPrice"], .item-price-summary').count(), 0);
    await page.evaluate(() => {
      const key = 'wuhou:order-draft:v1:alice', record = JSON.parse(localStorage.getItem(key));
      record.value.items[0].unitPrice = '120'; record.value.items[0].memberPrice = '未完成'; localStorage.setItem(key, JSON.stringify(record));
    });
    await page.reload(); await page.getByRole('button', { name: '继续填写', exact: true }).click();
    assert.equal(await page.locator('[id="items.0.unitPrice"], [id="items.0.memberPrice"], .item-price-summary').count(), 0);
    assert.equal(await page.locator('#totalAmount').inputValue(), '120.29');
    if (process.env.PRICING_SCREENSHOT_DIR) { await page.locator('.create-item-heading').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.PRICING_SCREENSHOT_DIR}/cake-no-unit-price-mobile.png` }); }
    await page.getByRole('button', { name: '添加商品', exact: true }).click(); await chooseType(page, '饮品');
    await page.locator('[id="items.1.name"]').fill('茶饮'); await page.locator('[id="items.1.quantity"]').fill('2');
    await page.locator('[id="items.1.unitPrice"]').fill('10.29'); await page.locator('[id="items.1.memberPrice"]').fill('0');
    assert.match(await page.locator('.item-price-summary').innerText(), /其他商品普通价小计[\s\S]*20.58/);
    assert.match(await page.locator('.item-price-summary').innerText(), /其他商品会员价小计[\s\S]*0.00/);
    assert.equal(await page.locator('#totalAmount').inputValue(), '120.29');
    if (process.env.PRICING_SCREENSHOT_DIR) {
      await page.locator('[id="items.1.unitPrice"]').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.PRICING_SCREENSHOT_DIR}/mixed-unit-price-mobile.png` });
      await page.setViewportSize({ width: 1440, height: 1000 }); await page.screenshot({ path: `${process.env.PRICING_SCREENSHOT_DIR}/mixed-unit-price-desktop.png` });
    }
    await chooseType(page, '蛋糕'); assert.equal(await page.locator('.item-price-summary').count(), 0);
    await chooseType(page, '饮品'); assert.equal(await page.locator('[id="items.1.unitPrice"]').inputValue(), ''); assert.equal(await page.locator('[id="items.1.memberPrice"]').inputValue(), '');
    await page.locator('[id="items.1.unitPrice"]').fill('10.29'); await page.locator('[id="items.1.memberPrice"]').fill('0');
    await page.getByRole('button', { name: '创建订单', exact: true }).click(); await until(() => Boolean(model.order));
    const request = model.createCalls[0].input; assert.equal(request.items[0].unitPriceCents, null); assert.equal(request.items[0].memberPriceCents, null);
    assert.equal(request.items[1].unitPriceCents, 1029); assert.equal(request.items[1].memberPriceCents, 0); assert.equal(request.totalAmountCents, 12029);
    model.order.items[0].unitPriceCents = 99999; model.order.items[0].memberPriceCents = 88888;
    await page.goto(`${base}/#/orders/${orderId}`); await page.locator('.front-product-details').waitFor();
    assert.equal(await page.locator('.front-product-details dt').getByText('价格', { exact: true }).count(), 0);
    await page.locator('.front-product-details').getByRole('button', { name: '编辑', exact: true }).click();
    assert.equal(await page.locator('#item-unitPrice, #item-memberPrice').count(), 0);
    await page.locator('.item-form').getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '下一个商品', exact: true }).click();
    await page.locator('.front-product-details dt').getByText('价格', { exact: true }).waitFor();
    await page.locator('.front-product-details').getByRole('button', { name: '编辑', exact: true }).click();
    assert.equal(await page.locator('#item-unitPrice').inputValue(), '10.29'); assert.equal(await page.locator('#item-memberPrice').inputValue(), '0.00');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.deepEqual(errors, []);
    assert.equal(await saved(), null);
  } finally { await context.close(); }
});

test('客户填单核对隐藏蛋糕历史价格，非蛋糕单价选填且整单总额保留', async () => {
  const { context, page, model, errors } = await createOrderFixture(browser, base);
  try {
    model.permissions.push('CUSTOMER_SUBMISSION_PROCESS');
    const id = '20000000-0000-4000-8000-000000000002';
    const content = { phone: '13800000000', memberPhone: '', fulfillmentType: 'PICKUP', address: null, requestedReceiveAt: '2026-11-05T10:00:00Z', items: [
      { name: '蛋糕', productType: 'CAKE', quantity: 1, attributes: { size: '8', base: '原味', filling: '芒果', flavor: '原味奶油' } },
      { name: '饮品', productType: 'DRINK', quantity: 2, attributes: { specification: '小杯' } },
    ] };
    const submission = { id, original: content, reviewed: { content, prices: [{ unitPriceCents: 12000, memberPriceCents: 10000 }, { unitPriceCents: 1029, memberPriceCents: 0 }], totalAmountCents: 15029, creditedEmployeeId: 'alice', plannedHandoffAt: content.requestedReceiveAt, plannedFinishAt: null }, status: 'PENDING', ownerName: 'alice', version: 0, createdAt: '2026-11-04T08:00:00Z', orderId: null };
    let savedReview;
    await context.route(`**/api/customer-submissions/${id}`, async route => {
      if (route.request().method() === 'PATCH') { savedReview = route.request().postDataJSON().review; submission.reviewed = savedReview; submission.version++; }
      await route.fulfill({ json: { success: true, data: { submission, duplicates: [], activities: [], duplicateCheckToken: 'test' } } });
    });
    await page.goto(`${base}/#/customer-submissions/${id}`); await page.reload(); await page.locator('#totalAmount').waitFor();
    assert.equal(await page.locator('[id="items.0.unitPrice"], [id="items.0.memberPrice"]').count(), 0);
    assert.equal(await page.locator('[id="items.1.unitPrice"]').inputValue(), '10.29'); assert.equal(await page.locator('#totalAmount').inputValue(), '150.29');
    await page.locator('[id="items.1.unitPrice"]').fill(''); await page.locator('[id="items.1.memberPrice"]').fill('');
    await page.getByRole('button', { name: '保存核对结果', exact: true }).click(); await until(() => Boolean(savedReview));
    assert.deepEqual(savedReview.prices, [{ unitPriceCents: null, memberPriceCents: null }, { unitPriceCents: null, memberPriceCents: null }]);
    assert.equal(savedReview.totalAmountCents, 15029); assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
