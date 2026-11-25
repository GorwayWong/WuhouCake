import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createRequire } from 'node:module';
import { createOrderFixture, orderId } from './orderBrowserFixture.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DRAFT_TEST_URL || 'http://127.0.0.1:5197';
let browser;
before(async () => { browser = await chromium.launch({ headless: true, channel: 'chrome' }); });
after(async () => { await browser?.close(); });
const eventually = async condition => {
  for (let i = 0; i < 100; i++) {
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  assert.fail('Expected browser state was not reached');
};

test('二维码归属员工失去接单资格后，管理页停止提供发放入口', async () => {
  const { context, page, model, errors } = await createOrderFixture(browser, base);
  try {
    model.permissions.push('CUSTOMER_SUBMISSION_PROCESS', 'CUSTOMER_ENTRY_MANAGE');
    await context.route('**/api/customer-submissions?*', route =>
      route.fulfill({ json: { success: true, data: { items: [], total: 0, page: 1, size: 20 } } }));
    let entry = { ownerId: model.account, ownerName: '客服甲', url: `${base}/#/fill/qr-token`, enabled: true, ownerEligible: true };
    await context.route('**/api/customer-submissions/entry?*', route => {
      if (route.request().method() === 'POST') {
        const { action } = route.request().postDataJSON();
        entry = { ...entry, enabled: action === 'ENABLE' };
      }
      return route.fulfill({ json: { success: true, data: entry } });
    });
    await page.goto(`${base}/#/customer-submissions`);
    await page.reload();
    const settings = page.getByText('填单二维码管理', { exact: true });
    await settings.click();
    const download = page.getByRole('link', { name: '下载二维码', exact: true });
    const open = page.getByRole('link', { name: '打开客户填写页面', exact: true });
    await download.waitFor();
    await open.waitFor();
    await settings.click();
    entry = { ...entry, ownerEligible: false };
    await settings.click();
    const unavailable = page.getByRole('heading', { name: '客服甲 · 已启用 · 归属员工暂无接单资格' });
    await unavailable.waitFor();
    assert.equal(await download.count(), 0);
    assert.equal(await open.count(), 0);
    await page.getByRole('button', { name: '停用', exact: true }).click();
    await page.getByRole('heading', { name: '客服甲 · 已停用 · 归属员工暂无接单资格' }).waitFor();
    await page.getByRole('button', { name: '重新启用', exact: true }).click();
    await unavailable.waitFor();
    assert.equal(await download.count(), 0);
    assert.equal(await open.count(), 0);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('两个独立会话在 SSE 故障时补读订单，后台暂停且编辑草稿保留', async () => {
  const writer = await createOrderFixture(browser, base), reader = await createOrderFixture(browser, base);
  try {
    await writer.complete(); await writer.page.getByRole('button', { name: '创建订单', exact: true }).click();
    await writer.page.waitForURL('**/#/?date=*');
    let shared = structuredClone(writer.model.order), reads = 0;
    for (const fixture of [writer, reader]) {
      fixture.model.permissions.push('ORDER_EDIT');
      await fixture.context.route(`**/api/orders/${orderId}/customer-origin`, route => route.fulfill({ json: { success: true, data: null } }));
      await fixture.context.route(`**/api/orders/${orderId}/information`, async route => {
        const body = route.request().postDataJSON();
        assert.equal(body.expectedVersion, shared.version);
        shared = { ...shared, version: shared.version + 1, customer: { ...shared.customer, phone: body.changes.phone } };
        await route.fulfill({ json: { success: true, data: shared } });
      });
      await fixture.context.route(`**/api/orders/${orderId}`, route => {
        if (fixture === reader) reads++;
        return route.fulfill({ json: { success: true, data: shared } });
      });
    }
    await reader.page.clock.install();
    await reader.page.goto(`${base}/#/orders/${orderId}`);
    await writer.page.goto(`${base}/#/orders/${orderId}`);
    await reader.page.getByText('13800000000', { exact: true }).first().waitFor();
    await writer.page.getByRole('button', { name: '编辑资料', exact: true }).click();
    await writer.page.locator('#edit-phone').fill('13900001111');
    await writer.page.getByRole('button', { name: '保存修改', exact: true }).click();
    await eventually(() => shared.customer.phone === '13900001111');
    // 无 SSE，轮询负责补齐另一会话的已提交变更。
    const before = reads;
    await reader.page.clock.fastForward(30_000);
    await eventually(() => reads > before);
    await reader.page.getByText('13900001111', { exact: true }).first().waitFor();
    await reader.page.getByRole('button', { name: '编辑资料', exact: true }).click();
    await reader.page.locator('#edit-phone').fill('13700002222');
    shared = { ...shared, version: shared.version + 1, customer: { ...shared.customer, phone: '13600003333' } };
    await reader.page.clock.fastForward(30_000);
    await reader.page.getByText(/订单已更新，输入已保留/).waitFor();
    assert.equal(await reader.page.locator('#edit-phone').inputValue(), '13700002222');
    await reader.page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    const hiddenReads = reads;
    await reader.page.clock.fastForward(60_000);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(reads, hiddenReads, '隐藏时停止周期补读');
    await reader.page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    });
    await eventually(() => reads > hiddenReads);
    assert.equal(await reader.page.locator('#edit-phone').inputValue(), '13700002222');
    assert.deepEqual(writer.errors, []); assert.deepEqual(reader.errors, []);
  } finally { await writer.context.close(); await reader.context.close(); }
});

test('回到工作台补读一次，健康推送仍收到备注并保留正在编辑的输入', async () => {
  const { context, page, model, complete } = await createOrderFixture(browser, base);
  try {
    await complete();
    await page.getByRole('button', { name: '创建订单', exact: true }).click();
    await page.waitForURL('**/#/?date=*');
    await context.addInitScript(() => {
      const fetch = window.fetch.bind(window);
      const encode = new TextEncoder();
      window.testStream = { connections: 0, publish: undefined };
      window.fetch = (input, init) => {
        if (!String(input).endsWith('/api/orders/stream')) return fetch(input, init);
        window.testStream.connections++;
        return Promise.resolve(new Response(new ReadableStream({
          start(controller) {
            window.testStream.publish = (event, data) =>
              controller.enqueue(encode.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
            window.testStream.publish('ready', {});
            init.signal.addEventListener('abort', () => controller.error(init.signal.reason), { once: true });
          },
        }), { headers: { 'Content-Type': 'text/event-stream' } }));
      };
    });
    let phone = '13800000000', version = 0, reads = 0;
    await context.route(`**/api/orders/${orderId}`, route => {
      reads++;
      return route.fulfill({ json: { success: true, data: { ...model.order, version, customer: { ...model.order.customer, phone } } } });
    });
    await page.goto(`${base}/#/orders/${orderId}`);
    await page.reload();
    await page.getByRole('button', { name: '编辑资料', exact: true }).click();
    await page.locator('#edit-phone').fill('13700002222');
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    });
    const before = reads;
    phone = '13900001111'; version++;
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    });
    await page.getByText('13900001111', { exact: true }).first().waitFor();
    assert.equal(reads - before, 1);
    assert.equal(await page.evaluate(() => window.testStream.connections), 1);
    await page.evaluate(orderId => window.testStream.publish('order.changed', { orderId, changeType: 'NOTE', version: 1 }), orderId);
    await page.getByLabel('订单更新，1 张订单待查看').click();
    await page.getByText('新增协作备注', { exact: false }).waitFor();
    assert.equal(await page.locator('#edit-phone').inputValue(), '13700002222');
  } finally { await context.close(); }
});

test('填单末页缩短后跟随服务端有效页，异常空页保留返回入口', async () => {
  const fixture = await createOrderFixture(browser, base);
  const { context, page, model, errors } = fixture;
  try {
    model.permissions.push('CUSTOMER_SUBMISSION_PROCESS');
    let total = 21, unexpectedEmpty = false, legacy = false;
    const requestedPages = [];
    await context.route('**/api/customer-submissions?*', route => {
      const params = new URL(route.request().url()).searchParams, requested = Number(params.get('page') || 1);
      assert.equal(params.get('view'), 'summary');
      requestedPages.push(requested);
      const current = Math.min(requested, Math.max(1, Math.ceil(total / 20)));
      const items = unexpectedEmpty ? [] : Array.from({ length: Math.min(20, total - (current - 1) * 20) }, (_, i) => ({
        submission: { id: `submission-${(current - 1) * 20 + i}`, status: 'PENDING', ownerName: '客服', createdAt: '2026-11-13T01:00:00Z',
          original: { phone: '13800000000', fulfillmentType: 'PICKUP', requestedReceiveAt: '2026-11-14T10:00:00Z', items: [] } },
        ...(legacy ? { duplicates: i === 0 ? [{ requiresAcknowledgement: true }] : [] } : { requiresAcknowledgement: i === 0 }),
      }));
      return route.fulfill({ json: { success: true, data: { items, total, page: current, size: 20 } } });
    });
    await page.goto(`${base}/#/customer-submissions`); await page.reload();
    await page.getByText('有疑似重复记录，请核对。', { exact: true }).waitFor();
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await eventually(() => requestedPages.at(-1) === 2);
    total = 20; legacy = true;
    await page.getByRole('button', { name: '刷新列表', exact: true }).click();
    await eventually(() => requestedPages.at(-1) === 1);
    await page.getByText('有疑似重复记录，请核对。', { exact: true }).waitFor();
    assert.equal(await page.locator('.submission-list > li').count(), 20);
    assert.equal(await page.getByText('暂无待确认填单。', { exact: true }).count(), 0);
    unexpectedEmpty = true;
    await page.getByRole('button', { name: '刷新列表', exact: true }).click();
    await page.getByText('当前页暂无记录，请刷新', { exact: true }).waitFor();
    await page.getByRole('button', { name: '返回第一页', exact: true }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
