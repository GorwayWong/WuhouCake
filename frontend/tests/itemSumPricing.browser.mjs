import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createRequire } from 'node:module';
import { createOrderFixture, orderId, cycleOrderDraft, seedLegacyOrderDraft, openOrderDraft, saveOrderDraftAndExit, visibleOrderFields } from './orderBrowserFixture.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DRAFT_TEST_URL || 'http://127.0.0.1:5197';
let browser;
before(async () => { browser = await chromium.launch({ headless: true, channel: 'chrome' }); });
after(async () => { await browser?.close(); });
async function until(check) { for (let i = 0; i < 150; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 30)); } throw new Error('Timed out'); }

test('新下单手填价格、参考合计、零价付款和草稿恢复', async () => {
  const { context, page, model, complete, saved, errors } = await createOrderFixture(browser, base);
  try {
    model.permissions.push('ORDER_PAYMENT_UPDATE'); await page.reload(); await complete();
    assert.equal(await page.locator('#totalAmount').getAttribute('readonly'), null);
    await page.locator('#paymentMethod').click();
    for (const name of ['现金', '抖音团购', '美团团购']) {
      assert.equal(await page.getByRole('option', { name, exact: true }).getAttribute('aria-disabled'), 'true');
    }
    await page.keyboard.press('Escape');
    await page.locator('[id="items.0.unitPrice"]').fill('10.01');
    await page.locator('[id="items.0.quantity"]').fill('3');
    assert.equal(await page.locator('#totalAmount').inputValue(), '');
    await page.getByText('商品原价合计 ¥30.03', { exact: false }).waitFor();
    await page.getByRole('button', { name: '采用商品合计' }).click();
    await page.locator('#totalAmount').fill('25');
    await page.locator('[id="items.0.memberPrice"]').fill('0');
    assert.equal(await page.locator('#memberAmount').inputValue(), '');
    await page.locator('#memberAmount').fill('0');
    await page.locator('#paymentMethod').click(); await page.getByRole('option', { name: '抖音团购', exact: true }).click();
    await cycleOrderDraft(page);
    assert.equal(await page.locator('#totalAmount').inputValue(), '25');
    assert.equal(await page.locator('#memberAmount').inputValue(), '0');
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
    assert.equal(model.createCalls[0].input.pricingMode, 'MANUAL');
    assert.equal(model.createCalls[0].input.totalAmountCents, 0);
    assert.equal(model.createCalls[0].input.paymentMethod, 'DOUYIN_GROUP_BUY');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('旧草稿恢复保持手填金额，不静默切换', async () => {
  const { context, page, complete, saved } = await createOrderFixture(browser, base);
  try {
    await complete(); await seedLegacyOrderDraft(page);
    await page.evaluate(() => { const key = 'wuhou:order-draft:v1:alice', record = JSON.parse(localStorage.getItem(key)); delete record.initial.pricingMode; delete record.value.pricingMode; record.value.totalAmount = '88.88'; record.value.memberAmount = '80'; localStorage.setItem(key, JSON.stringify(record)); });
    await openOrderDraft(page);
    assert.equal(await page.locator('#totalAmount').getAttribute('readonly'), null);
    assert.equal(await page.locator('#totalAmount').inputValue(), '88.88');
    await page.locator('#totalAmount').fill('99');
    assert.equal(await page.locator('#memberAmount').inputValue(), '80');
  } finally { await context.close(); }
});

test('套餐售价与商品明细有差额仍可带入，改商品不覆盖整单金额', async () => {
  const { context, page, saved, errors } = await createOrderFixture(browser, base);
  try {
    const value = { id: 'p', name: '茶歇', version: 1, updatedAt: '', originalAmountCents: 999, memberAmountCents: null,
      items: [{ itemId: crypto.randomUUID(), imageId: null, name: '点心', productType: 'OTHER', quantity: 2, unitPriceCents: 1000, memberPriceCents: null, attributes: { specification: '少糖\n独立包装' } }] };
    await context.route('**/api/order-packages**', route => route.fulfill({ json: { success: true, data: new URL(route.request().url()).pathname.endsWith('/p') ? value : { items: [value], total: 1, page: 1, size: 20 } } }));
    await page.getByRole('button', { name: '导入套餐', exact: true }).click();
    await page.locator('.package-picker select').selectOption('p');
    await page.getByRole('button', { name: '带入商品', exact: true }).click();
    await until(async () => await page.locator('[id="items.0.name"]').inputValue() === '点心');
    assert.equal(await page.locator('#totalAmount').inputValue(), '9.99');
    await page.getByText('商品原价合计 ¥20.00 · 将采用填写金额').waitFor();
    await page.locator('[id="items.0.quantity"]').fill('3');
    await page.getByText('商品原价合计 ¥30.00', { exact: false }).waitFor();
    assert.equal(await page.locator('#totalAmount').inputValue(), '9.99');
    assert.equal(await page.locator('[id="items.0.unitPrice"]').inputValue(), '10.00');
    assert.equal(await page.locator('[id="items.0.requirements"]').inputValue(), '少糖\n独立包装');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('未报价套餐可带入并保存未付订单', async () => {
  const { context, page, model, errors } = await createOrderFixture(browser, base);
  try {
    const value = { id: 'unpriced', name: '未报价套餐', version: 1, originalAmountCents: null, memberAmountCents: null,
      items: [{ itemId: crypto.randomUUID(), imageId: null, name: '果盘', productType: 'OTHER', quantity: 5, attributes: {} }] };
    await context.route('**/api/order-packages**', route => route.fulfill({ json: { success: true, data:
      new URL(route.request().url()).pathname.endsWith('/unpriced') ? value : { items: [value], total: 1, page: 1, size: 20 } } }));
    await page.locator('#phone').fill('13800000000');
    await page.getByRole('button', { name: /交接方式/ }).click();
    await page.getByRole('option', { name: '门店自提' }).click();
    await page.getByRole('button', { name: '导入套餐', exact: true }).click();
    await page.locator('.package-picker select').selectOption(value.id);
    await page.getByRole('button', { name: '带入商品', exact: true }).click();
    await page.getByText(/订单金额待补，可先录为未付/).waitFor();
    await page.getByRole('button', { name: '创建订单', exact: true }).click();
    await until(() => model.createCalls.length === 1);
    assert.equal(model.createCalls[0].input.paymentMethod, 'UNPAID');
    assert.equal(model.createCalls[0].input.totalAmountCents, null);
    assert.equal(model.createCalls[0].input.items[0].quantity, 5);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

for (const change of ['updated', 'deleted', 'timeout', 'cancelled', 'offline', 'redacted']) test(`确认套餐先重读详情：${change}`, async () => {
  const { context, page, complete, saved, png, errors } = await createOrderFixture(browser, base);
  const pending = Promise.withResolvers();
  const sendEvent = Promise.withResolvers();
  try {
    await complete();
    await page.locator('[id="items.0.unitPrice"]').fill('100');
    await page.locator('#totalAmount').fill('100');
    const before = await visibleOrderFields(page);
    const id = crypto.randomUUID(), itemId = crypto.randomUUID();
    let value = { id, name: '茶歇套餐', version: 1, originalAmountCents: 1000, memberAmountCents: null,
      items: [{ itemId, imageId: crypto.randomUUID(), name: '原款点心', productType: 'OTHER', quantity: 1,
        unitPriceCents: 1000, memberPriceCents: null, attributes: {} }] };
    let detailReads = 0;
    const images = [];
    await context.route('**/api/order-packages?*', route => route.fulfill({ json: { success: true,
      data: { items: value ? [value] : [], total: value ? 1 : 0, page: 1, size: 20 } } }));
    await context.route(`**/api/order-packages/${id}`, async route => {
      detailReads++;
      if (detailReads === 2 && ['timeout', 'cancelled', 'offline'].includes(change)) await pending.promise;
      await (value ? route.fulfill({ json: { success: true, data: value } })
        : route.fulfill({ status: 404, json: { success: false, code: 'PACKAGE_NOT_FOUND' } })).catch(() => {});
    });
    await context.route(`**/api/order-packages/${id}/items/*/images/*`, route => {
      images.push(route.request().url());
      return route.fulfill({ contentType: 'image/png', body: png });
    });
    if (change === 'cancelled') {
      await context.route('**/api/orders/stream', async route => {
        await sendEvent.promise;
        await route.fulfill({ contentType: 'text/event-stream',
          body: `event: package.changed\ndata: ${JSON.stringify({ packageId: id })}\n\n` }).catch(() => {});
      });
      await saveOrderDraftAndExit(page);
      await page.reload();
      await openOrderDraft(page);
    }
    await page.getByRole('button', { name: '导入套餐', exact: true }).click();
    await page.locator('.package-picker select').selectOption(id);
    await page.getByRole('button', { name: '带入商品', exact: true }).click();
    const dialog = page.getByRole('region', { name: '确认带入套餐' });
    await dialog.getByText('原款点心', { exact: true }).waitFor();
    const confirm = dialog.getByRole('button', { name: '带入并采用建议金额', exact: true });
    if (change === 'deleted') {
      value = null;
      await confirm.click();
      await dialog.waitFor({ state: 'detached' });
      await page.getByText(/所选套餐已删除或不可用/).waitFor();
    } else if (change === 'updated') {
      value = { ...value, version: 2, originalAmountCents: 2500,
        items: [{ ...value.items[0], name: '新版点心', imageId: crypto.randomUUID(), unitPriceCents: 2500 }] };
      await confirm.click();
      await dialog.getByText('新版点心', { exact: true }).waitFor();
      await dialog.getByRole('alert').filter({ hasText: '套餐已更新' }).waitFor();
    } else if (change === 'redacted') {
      value = { ...value, originalAmountCents: null, items: [{ ...value.items[0], unitPriceCents: null }] };
      await confirm.click();
      await dialog.getByRole('alert').filter({ hasText: '套餐已更新' }).waitFor();
      assert.equal(await confirm.isDisabled(), true);
      assert.equal(await dialog.getByRole('button', { name: '带入并保留金额' }).isEnabled(), true);
    } else {
      if (change === 'timeout' || change === 'offline') await page.clock.install();
      if (change === 'offline') await page.evaluate(() => window.dispatchEvent(new Event('offline')));
      await confirm.click();
      await until(() => detailReads === 2);
      if (change === 'timeout' || change === 'offline') {
        await page.clock.fastForward(30_001);
        await dialog.getByRole('alert').filter({ hasText: '读取超时' }).waitFor();
      } else {
        sendEvent.resolve();
        await dialog.getByRole('alert').filter({ hasText: '套餐读取已取消' }).waitFor();
      }
      pending.resolve();
      if (change === 'offline') {
        assert.equal(await dialog.getByRole('button', { name: '取消', exact: true }).isEnabled(), true);
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await page.clock.runFor(100);
        assert.equal(detailReads, 2);
      }
    }
    assert.deepEqual(await visibleOrderFields(page), before);
    assert.deepEqual(images, []);
    if (change !== 'deleted' && change !== 'redacted') {
      await confirm.click();
      await dialog.waitFor({ state: 'detached' });
      assert.equal(detailReads, 3);
      await cycleOrderDraft(page);
      assert.equal((await saved()).value.items.at(-1).name, value.items[0].name);
      assert.equal(await page.locator('#totalAmount').inputValue(), change === 'updated' ? '125.00' : '110.00');
      assert.equal(images.length, 1);
      assert.ok(images[0].endsWith(value.items[0].imageId));
    }
    assert.deepEqual(errors, []);
  } finally { pending.resolve(); sendEvent.resolve(); await context.close(); }
});

test('订单详情保留手填金额，改商品单价前后显示差额', async () => {
  const { context, page, model, complete, errors } = await createOrderFixture(browser, base);
  try {
    await complete(); await page.locator('[id="items.0.unitPrice"]').fill('10'); await page.locator('#totalAmount').fill('12');
    await page.getByRole('button', { name: '创建订单', exact: true }).click();
    await page.waitForURL('**/#/?date=*');
    await page.goto(base + '/#/orders/' + orderId);
    await page.locator('.payment-panel').waitFor();
    await page.getByRole('button', { name: '修改金额', exact: true }).waitFor();
    await context.route(`**/api/orders/${orderId}`, async route => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      const request = route.request().postDataJSON();
      const item = model.order.items.find(item => item.itemId === request.itemId);
      assert.equal(request.expectedVersion, model.order.version);
      item.unitPriceCents = request.changes.referenceUnitPriceCents;
      model.order.version++;
      return route.fulfill({ json: { success: true, data: model.order } });
    });
    await page.locator('.product-actions').getByRole('button', { name: '编辑', exact: true }).click();
    await page.locator('#item-unitPrice').fill('20');
    await page.locator('.item-form').getByText('商品原价合计 ¥20.00', { exact: false }).waitFor();
    await page.locator('.item-form').getByRole('button', { name: '保存', exact: true }).click();
    await until(() => model.order.version === 1);
    await page.locator('.payment-panel').getByText('商品原价合计 ¥20.00', { exact: false }).waitFor();
    assert.equal(await page.locator('.order-amount').innerText(), '¥12.00');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
