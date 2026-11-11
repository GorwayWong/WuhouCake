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
test('旧草稿报价独立提交，切换分类不改整单金额', async () => {
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
    assert.doesNotMatch(converted, /原会员单价|原商品单价/);
    await page.getByText('参考会员价：¥0.00', { exact: false }).waitFor();
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
    assert.equal(request.items[0].referenceUnitPriceCents, 1029);
    assert.equal(request.items[0].referenceMemberPriceCents, 0);
    assert.equal(request.items[0].attributes.specification, converted);
    assert.equal(request.items[0].productType, 'OTHER'); assert.equal(request.totalAmountCents, 12029);
    await page.goto(`${base}/#/orders/${orderId}`); await page.locator('.front-product-details').waitFor();
    assert.match(await page.locator('.front-product-details .product-spec-text').innerText(), /原商品单价：¥10.29（仅供参考）/);
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

test('已付款草稿加购提示重新确认收款，取消不改草稿，确认后恢复及建单均为未付', async () => {
  const { context, page, complete, saved, model, png, errors } = await createOrderFixture(browser, base);
  try {
    model.permissions.push('ORDER_PAYMENT_UPDATE');
    await complete(); await page.locator('#totalAmount').fill('100');
    await page.evaluate(() => {
      const key = 'wuhou:order-draft:v1:alice';
      const record = JSON.parse(localStorage.getItem(key));
      record.value.paymentMethod = 'CASH';
      localStorage.setItem(key, JSON.stringify(record));
    });
    const value = { id: crypto.randomUUID(), name: '加购套餐', version: 0, originalAmountCents: 9800, memberAmountCents: 8800,
      items: [{ itemId: crypto.randomUUID(), name: '果汁', imageId: crypto.randomUUID(), quantity: 1, productType: 'OTHER', attributes: {} }] };
    await context.route('**/api/order-packages**', route => route.fulfill({ json: { success: true,
      data: new URL(route.request().url()).pathname === '/api/order-packages' ? { items: [value], total: 1, page: 1, size: 20 } : value } }));
    let imageAvailable = false;
    await context.route(`**/api/order-packages/${value.id}/items/*/images/*`, route => imageAvailable
      ? route.fulfill({ contentType: 'image/png', body: png })
      : route.fulfill({ status: 404, json: { success: false, code: 'IMAGE_NOT_FOUND' } }));
    await page.reload(); await page.getByRole('button', { name: '继续填写', exact: true }).click();
    await page.getByRole('button', { name: '使用套餐', exact: true }).click();
    await page.getByRole('button', { name: /选择套餐/ }).click();
    await page.getByRole('option', { name: /加购套餐/ }).click();
    const add = page.getByRole('button', { name: '带入商品', exact: true });
    await add.click();
    const dialog = page.getByRole('dialog', { name: '确认带入套餐' });
    await dialog.getByText('成交金额变化后将改为未付，请核对收款。').waitFor();
    await dialog.getByRole('button', { name: '取消' }).click();
    assert.equal((await saved()).value.paymentMethod, 'CASH');
    assert.equal((await saved()).value.totalAmount, '100');
    await add.click();
    const confirm = dialog.getByRole('button', { name: '确认带入' });
    await confirm.click();
    await dialog.getByRole('alert').waitFor();
    assert.equal((await saved()).value.paymentMethod, 'CASH');
    assert.equal((await saved()).value.totalAmount, '100');
    imageAvailable = true;
    await page.evaluate(() => {
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'wuhou:order-draft:v1:alice' && JSON.parse(value).value.totalAmount === '198.00') {
          Storage.prototype.setItem = write;
          throw new DOMException('测试配额', 'QuotaExceededError');
        }
        return write.call(this, key, value);
      };
    });
    await confirm.click();
    await dialog.getByText('草稿已有变化或无法保存，请核对后重试。').waitFor();
    assert.equal((await saved()).value.paymentMethod, 'CASH');
    assert.equal((await saved()).value.totalAmount, '100');
    await confirm.click();
    await until(async () => (await saved()).value.totalAmount === '198.00');
    assert.equal((await saved()).value.paymentMethod, 'UNPAID');
    await page.reload(); await page.getByRole('button', { name: '继续填写', exact: true }).click();
    await page.getByRole('button', { name: '创建订单', exact: true }).click();
    await until(() => Boolean(model.createCalls.length));
    assert.equal(model.createCalls[0].input.paymentMethod, 'UNPAID');
    assert.equal(model.createCalls[0].input.totalAmountCents, 18800);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('并发改分类保留最新制作要求与重新转换前的草稿', async () => {
  const { context, page, complete, model, errors } = await createOrderFixture(browser, base);
  try {
    await complete(); await page.getByRole('button', { name: '创建订单', exact: true }).click();
    await until(() => Boolean(model.order));
    const item = model.order.items[0];
    item.attributes.requirements = '少糖';
    const patches = [];
    await context.route(`**/api/orders/${orderId}`, async route => {
      if (route.request().method() === 'PATCH') {
        const patch = route.request().postDataJSON();
        patches.push(patch);
        if (patch.expectedVersion === 0) {
          model.order.version = 1;
          item.attributes.requirements = '不要坚果';
          item.attributes.decoration = '红色';
          return route.fulfill({ status: 409, json: { success: false, code: 'CONCURRENT_MODIFICATION' } });
        }
        model.order.version++;
        Object.assign(item, patch.changes);
      }
      return route.fulfill({ json: { success: true, data: model.order } });
    });
    await page.goto(`${base}/#/orders/${orderId}`);
    await page.locator('.front-product-details').getByRole('button', { name: '编辑', exact: true }).click();
    await page.locator('#item-productType').click();
    await page.getByRole('option', { name: '其他', exact: true }).click();
    const spec = page.locator('#item-specification');
    await spec.fill('我的待核对备注');
    const save = page.locator('.item-form').getByRole('button', { name: '保存', exact: true });
    await save.click();
    const rebase = page.getByRole('button', { name: '基于最新商品重新转换' });
    await rebase.waitFor();
    assert.equal(await save.isDisabled(), true);
    assert.equal(await spec.inputValue(), '我的待核对备注');
    await rebase.click();
    assert.match(await spec.inputValue(), /不要坚果/);
    assert.match(await spec.inputValue(), /红色/);
    await page.getByText('我的待核对备注', { exact: true }).waitFor();
    await save.click();
    await until(() => patches.length === 2);
    assert.equal(patches[1].expectedVersion, 1);
    assert.match(patches[1].changes.attributes.specification, /不要坚果/);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
