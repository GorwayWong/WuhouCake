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
test('旧草稿单价并入规格，其他商品无报价字段，切换分类不改整单金额', async () => {
  const { context, page, model, saved, complete, errors } = await createOrderFixture(browser, base);
  try {
    await complete(); await page.locator('#totalAmount').fill('120.29');
    await page.evaluate(() => {
      const key = 'wuhou:order-draft:v1:alice', record = JSON.parse(localStorage.getItem(key));
      Object.assign(record.value.items[0], { name: '茶饮', productType: 'DRINK', unitPrice: '10.29', memberPrice: '0' });
      record.value.items[0].attributes.requirements = '少冰';
      localStorage.setItem(key, JSON.stringify(record));
    });
    await page.reload(); await page.getByRole('button', { name: '继续填写', exact: true }).click();
    const spec = page.locator('[id="items.0.specification"]');
    const converted = await spec.inputValue();
    assert.match(converted, /特殊要求：少冰/);
    assert.match(converted, /原会员单价：0 元（仅供参考）/);
    assert.equal(await page.locator('[id="items.0.unitPrice"], [id="items.0.memberPrice"], [id="items.0.size"]').count(), 0);
    await chooseType(page, '蛋糕');
    assert.equal(await spec.inputValue(), converted);
    assert.equal(await page.locator('[id="items.0.size"]').count(), 1);
    await chooseType(page, '其他'); assert.equal(await spec.inputValue(), converted);
    await page.locator('[id="items.0.quantity"]').fill('2');
    assert.equal(await page.locator('#totalAmount').inputValue(), '120.29');
    await page.getByRole('button', { name: '创建订单', exact: true }).click(); await until(() => Boolean(model.order));
    const request = model.createCalls[0].input;
    assert.equal(request.items[0].unitPriceCents, null); assert.equal(request.items[0].memberPriceCents, null);
    assert.equal(request.items[0].productType, 'OTHER'); assert.equal(request.totalAmountCents, 12029);
    await page.goto(`${base}/#/orders/${orderId}`); await page.locator('.front-product-details').waitFor();
    assert.match(await page.locator('.front-product-details .product-spec-text').innerText(), /原商品单价：10.29 元（仅供参考）/);
    await page.locator('.front-product-details').getByRole('button', { name: '编辑', exact: true }).click();
    assert.equal(await page.locator('#item-unitPrice, #item-memberPrice, #item-size').count(), 0);
    assert.equal(await page.locator('#item-specification').inputValue(), converted);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []); assert.equal(await saved(), null);
  } finally { await context.close(); }
});

test('客户填单核对不再编辑商品报价，规格和整单金额仍可修改', async () => {
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
    assert.equal(await page.locator('[id="items.1.unitPrice"], [id="items.1.memberPrice"]').count(), 0); assert.equal(await page.locator('#totalAmount').inputValue(), '150.29');
    await page.locator('[id="items.1.specification"]').fill('小杯\n去冰');
    await page.getByRole('button', { name: '保存核对结果', exact: true }).click(); await until(() => Boolean(savedReview));
    assert.deepEqual(savedReview.prices, [{ unitPriceCents: null, memberPriceCents: null }, { unitPriceCents: null, memberPriceCents: null }]);
    assert.equal(savedReview.totalAmountCents, 15029); assert.equal(savedReview.content.items[1].attributes.specification, '小杯\n去冰'); assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
