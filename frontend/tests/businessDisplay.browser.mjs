import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createRequire } from 'node:module';
import { createOrderFixture, orderId } from './orderBrowserFixture.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DRAFT_TEST_URL || 'http://127.0.0.1:5197';
let browser;
before(async () => { browser = await chromium.launch({ headless: true, channel: 'chrome' }); });
after(async () => { await browser?.close(); });

test('跨年日期控件保留完整值与日历年份，夹馅多行保存不交换奶油字段', async () => {
  const { context, page, saved, errors } = await createOrderFixture(browser, base);
  try {
    await page.clock.setFixedTime(new Date('2026-11-08T04:00:00Z'));
    await page.locator('#customerName').fill('跨年客户');
    const filling = page.locator('[id="items.0.filling"]');
    assert.equal(await filling.evaluate(el => el.tagName), 'TEXTAREA');
    assert.equal(await filling.getAttribute('rows'), '2');
    await filling.fill('第一层草莓、芒果和脆片\n第二层蓝莓加奶酪');
    await page.locator('[id="items.0.flavor"]').fill('巧克力奶油');
    await page.evaluate(() => { const key = 'wuhou:order-draft:v1:alice'; const r = JSON.parse(localStorage.getItem(key)); r.value.requestedReceiveDate = '2027-01-01'; r.value.requestedReceiveAt = '2027-01-01T10:00'; r.value.plannedFinishAt = '2027-01-01T09:00'; r.value.finishTimeMode = 'MANUAL'; localStorage.setItem(key, JSON.stringify(r)); });
    await page.reload(); await page.getByRole('button', { name: '继续填写', exact: true }).click();
    const pickup = page.locator('.date-time-field[data-field-name="requestedReceiveAt"]');
    assert.equal(await pickup.locator('.date-month-day').innerText(), '2027/01/01');
    assert.match(await pickup.locator('.date-month-day').getAttribute('aria-label'), /2027-01-01/);
    assert.equal(await page.locator('input[type=hidden][name=requestedReceiveAt]').inputValue(), '2027-01-01T10:00');
    for (const width of [320, 390, 430, 1280]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await pickup.locator('.date-month-day').click();
      const popup = page.getByRole('dialog', { name: '选择取货时间日期', exact: true });
      await popup.waitFor();
      assert.match(await popup.getByRole('heading').innerText(), /2027/);
      const bounds = await popup.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
      await page.keyboard.press('Escape');
      if (width === 390 && process.env.DISPLAY_SCREENSHOT_DIR) { await filling.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.DISPLAY_SCREENSHOT_DIR}/business-filling-390.png` }); }
    }
    const draft = await saved();
    assert.equal(draft.value.requestedReceiveDate, '2027-01-01');
    assert.equal(draft.value.items[0].attributes.flavor, '巧克力奶油');
    assert.equal(draft.value.items[0].attributes.filling, '第一层草莓、芒果和脆片\n第二层蓝莓加奶酪');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('前厅详情放大时间和联系信息，隐藏制作操作并保留交接，兼岗可制作', async () => {
  const { context, page, model, errors } = await createOrderFixture(browser, base);
  try {
    await page.clock.setFixedTime(new Date('2026-11-08T04:00:00Z'));
    model.permissions.push('ORDER_BUSINESS_DETAILS_READ', 'ORDER_FULFILLMENT_UPDATE', 'ORDER_PAYMENT_UPDATE', 'ORDER_CANCEL');
    model.order = { orderId, orderNo: 'DISPLAY', version: 0, status: 'CAKE_BASE', currentStageCode: null, paymentStatus: 'UNPAID', totalAmountCents: 10000,
      createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', customer: { phone: '13800000000', customerName: '客户' },
      fulfillment: { type: 'DELIVERY', address: '很长的配送地址'.repeat(12), requestedReceiveDate: '2026-11-09', plannedHandoffAt: '2026-11-09T11:30:00Z', plannedFinishAt: '2026-11-09T10:30:00Z' },
      items: [{ itemId: crypto.randomUUID(), name: '蛋糕', productType: 'CAKE', quantity: 1, attributes: { filling: '长夹馅'.repeat(20) }, productionStatus: 'NOT_STARTED', recentNotes: [] }] };
    await page.goto(base + '/#/orders/' + orderId); await page.reload();
    const info = page.locator('.front-order-information'); await info.waitFor();
    assert.equal(await info.locator('.detail-business-time dd').first().innerText(), '11/09 19:30');
    assert.equal(await page.getByRole('checkbox', { name: '蛋糕制作完成' }).count(), 0);
    assert.equal(await page.locator('.next-step').count(), 0);
    for (const width of [320, 390, 430, 1280]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await info.locator('.detail-business-time dd').first().evaluate(el => getComputedStyle(el).fontSize), '20px');
      assert.equal(await info.locator('.detail-contact-phone dd').evaluate(el => getComputedStyle(el).fontSize), '18px');
      if (width === 390 && process.env.DISPLAY_SCREENSHOT_DIR) { await info.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.DISPLAY_SCREENSHOT_DIR}/business-detail-390.png` }); }
    }
    assert.equal(await info.getByRole('link', { name: '13800000000', exact: true }).getAttribute('href'), 'tel:13800000000');
    model.order.status = 'WAITING_DELIVERY'; await page.reload();
    await page.getByRole('button', { name: '确认送达', exact: true }).waitFor();
    model.order.status = 'CANCELLED'; await page.reload();
    assert.equal(await page.getByRole('button', { name: '恢复至出胚', exact: true }).count(), 0);
    model.order.status = 'CAKE_BASE'; model.permissions.push('ORDER_PRODUCTION_UPDATE'); await page.reload();
    await page.locator('details.order-supplement > summary').click();
    await page.getByRole('checkbox', { name: '蛋糕制作完成' }).waitFor();
    assert.equal(await page.getByRole('checkbox', { name: '蛋糕制作完成' }).isEnabled(), true);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});


test('客户填单处理记录的时间和更正快照保留完整年份', async () => {
  const { context, page } = await createOrderFixture(browser, base);
  try {
    await page.clock.setFixedTime(new Date('2026-11-08T04:00:00Z'));
    await page.evaluate(async () => {
      const reactModule = await import('/node_modules/.vite/deps/react.js');
      const React = reactModule.default || reactModule;
      const client = await import('/node_modules/.vite/deps/react-dom_client.js');
      const createRoot = client.createRoot || client.default.createRoot;
      const { SubmissionHistory } = await import('/src/CustomerSubmissions.tsx');
      const content = { phone: '13800000000', requestedReceiveAt: '2026-11-09T11:30:00Z', fulfillmentType: 'PICKUP', items: [] };
      const host = document.createElement('div'); host.id = 'history-regression'; document.body.append(host);
      createRoot(host).render(React.createElement(SubmissionHistory, { data: { activities: [{ id: 'history', type: 'REVIEWED', actorName: '员工', createdAt: '2026-11-08T04:00:00Z', details: { before: { content }, after: { content, plannedFinishAt: '2026-11-09T10:30:00Z' } } }] } }));
    });
    const history = page.locator('#history-regression');
    await history.getByText('查看更正前后内容', { exact: true }).click();
    assert.match(await history.innerText(), /2026\/11\/08 12:00/);
    assert.match(await history.innerText(), /2026\/11\/09 19:30/);
    assert.match(await history.innerText(), /2026\/11\/09 18:30/);
  } finally { await context.close(); }
});
