import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createRequire } from 'node:module';
import { createOrderFixture, orderId } from './orderBrowserFixture.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DRAFT_TEST_URL || 'http://127.0.0.1:5197';
let browser;
before(async () => { browser = await chromium.launch({ headless: true, channel: 'chrome' }); });
after(async () => { await browser?.close(); });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const eventually = async condition => {
  for (let i = 0; i < 150; i++) { if (await condition()) return; await wait(20); }
  assert.fail('Expected browser state was not reached');
};

for (const kind of ['submissions', 'payment', 'production', 'reminders']) test(`${kind} 缩页后增长可重访末页，过期缓存和迟到响应不回退`, async () => {
  const { context, page, model, errors } = await createOrderFixture(browser, base);
  try {
    if (kind === 'submissions') model.permissions.push('CUSTOMER_SUBMISSION_PROCESS');
    if (['production', 'reminders'].includes(kind)) model.permissions = ['ORDER_READ'];
    const size = kind === 'payment' ? 10 : 20;
    let total = size * 2 + 1;
    const responses = [];
    const prefix = kind === 'submissions' ? '/api/customer-submissions' : '/api/orders/workbench/' +
      ({ payment: 'payment-orders', production: 'production-orders', reminders: 'production-reminder-orders' })[kind];
    await context.route(`**${prefix}?*`, async route => {
      const requested = Number(new URL(route.request().url()).searchParams.get('page') || 1);
      const current = Math.min(requested, Math.max(1, Math.ceil(total / size))), count = total;
      const rows = Array.from({ length: Math.min(size, count - (current - 1) * size) }, (_, i) => ({
        orderId: `id-${current}-${i}`, orderNo: `PAGE-${current}-${i}`, itemName: '蛋糕', status: 'CAKE_BASE', currentStageCode: null,
        calendarDate: '2026-11-13', fulfillmentType: 'PICKUP', paymentStatus: 'UNPAID', amountCents: '10000',
        plannedFinishAt: '2026-11-13T08:00:00Z', plannedHandoffAt: '2026-11-13T09:00:00Z', pickupDate: '2026-11-13',
        customer: null, items: [{ itemId: 'item', name: '蛋糕', quantity: 1, productType: 'CAKE', attributes: {}, recentNotes: [] }],
      }));
      const items = rows.map(row => ({ submission: { id: row.orderId, status: 'PENDING', ownerName: '客服', createdAt: '2026-11-13T01:00:00Z',
        original: { phone: '13800000000', fulfillmentType: 'PICKUP', requestedReceiveAt: '2026-11-14T10:00:00Z', items: [] } }, duplicates: [] }));
      await wait(150);
      responses.push({ requested, current, total: count });
      await route.fulfill({ json: { success: true, data: { page: current, total: count, size, items, orders: rows, date: '2026-11-13' } } }).catch(() => {});
    });
    await context.route('**/api/orders/workbench/production-summary?*', route => route.fulfill({ json: { success: true,
      data: { total, unscheduled: total, days: [] } } }));
    await context.route('**/api/orders/workbench/production-reminders', route => route.fulfill({ json: { success: true,
      data: { date: '2026-11-13', today: total, overdue: 0 } } }));
    const href = { submissions: '#/customer-submissions', payment: '#/payment-orders?date=2026-11-13&kind=SHIPPING_UNPAID',
      production: '#/production-query?from=2026-11-13&through=2026-11-19&bucket=unscheduled&page=1', reminders: '#/?date=2026-11-13' }[kind];
    await page.clock.install();
    await page.goto(base + '/' + href); await page.reload();
    if (kind === 'reminders') await page.getByRole('button', { name: /今日出品/ }).click();
    const paging = kind === 'reminders' ? page.locator('.reminder-pages') : page.locator('.pagination');
    const next = paging.getByRole(kind === 'submissions' || kind === 'reminders' ? 'button' : 'link', { name: '下一页', exact: true });
    const refreshPage = () => kind === 'submissions'
      ? page.getByRole('button', { name: '刷新列表', exact: true }).click()
      : page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await next.click(); await eventually(async () => /第 2/.test(await paging.innerText()));
    await next.click(); await eventually(async () => /第 3/.test(await paging.innerText()));
    for (const elapsed of [0, 16_000]) {
      total = size * 2; await refreshPage();
      await eventually(async () => /第 2/.test(await paging.innerText()) && responses.at(-1)?.total === total);
      await page.clock.fastForward(elapsed); await wait(200);
      total = size * 2 + 1; await refreshPage();
      await eventually(() => responses.at(-1)?.total === total);
      await next.click();
      await eventually(async () => /第 3/.test(await paging.innerText()) && responses.at(-1)?.current === 3);
      await wait(200); assert.match(await paging.innerText(), /第 3/);
    }
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('远端付款锁住金额草稿，普通资料只提交非金额，撤销付款后可核对继续', async () => {
  const { context, page, model, complete, errors } = await createOrderFixture(browser, base);
  try {
    await complete(); await page.getByRole('button', { name: '创建订单', exact: true }).click(); await page.waitForURL('**/#/?date=*');
    model.order = { ...model.order, totalAmountCents: 10000, originalAmountCents: 10000, memberAmountCents: null };
    const writes = [];
    await context.route(`**/api/orders/${orderId}/customer-origin`, route => route.fulfill({ json: { success: true, data: null } }));
    await context.route(`**/api/orders/${orderId}/information`, route => {
      const body = route.request().postDataJSON(); writes.push(body);
      model.order = { ...model.order, version: model.order.version + 1, customer: { ...model.order.customer, phone: body.changes.phone || model.order.customer.phone } };
      return route.fulfill({ json: { success: true, data: model.order } });
    });
    await page.clock.install(); await page.goto(`${base}/#/orders/${orderId}`);
    await page.getByRole('button', { name: '编辑资料', exact: true }).click();
    await page.locator('#edit-totalAmount').fill('not-money');
    await page.locator('#edit-phone').fill('13900001111');
    model.order = { ...model.order, version: 1, paymentStatus: 'PAID', paymentMethod: 'CASH' };
    await page.clock.fastForward(31_000);
    await page.getByRole('button', { name: '核对后继续编辑', exact: true }).click();
    assert.equal(await page.locator('#edit-totalAmount').isDisabled(), true);
    assert.equal(await page.locator('#edit-totalAmount').inputValue(), 'not-money');
    await page.getByRole('button', { name: '仅保存其他资料', exact: true }).click();
    await eventually(() => writes.length === 1);
    assert.deepEqual(writes[0].changes, { phone: '13900001111' });
    assert.equal(writes[0].expectedVersion, 1);
    model.order = { ...model.order, version: 3, paymentStatus: 'UNPAID', paymentMethod: 'UNPAID' };
    await page.clock.fastForward(31_000);
    await page.getByRole('button', { name: '修改金额', exact: true }).click();
    await page.locator('#edit-totalAmount').fill('150');
    model.order = { ...model.order, version: 4, paymentStatus: 'PAID', paymentMethod: 'CASH' };
    await page.clock.fastForward(31_000); await page.getByRole('button', { name: '核对后继续编辑', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '保存修改', exact: true }).isDisabled(), true);
    model.order = { ...model.order, version: 5, paymentStatus: 'UNPAID', paymentMethod: 'UNPAID' };
    await page.clock.fastForward(31_000);
    assert.equal(await page.getByRole('button', { name: '保存修改', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: '核对后继续编辑', exact: true }).click();
    assert.equal(await page.locator('#edit-totalAmount').inputValue(), '150');
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await eventually(() => writes.length === 2);
    assert.equal(writes[1].expectedVersion, 5); assert.equal(writes[1].changes.originalAmountCents, 15000);
    model.order = { ...model.order, version: 7, paymentStatus: 'PAID' };
    await page.clock.fastForward(31_000);
    await page.getByRole('button', { name: '编辑资料', exact: true }).click();
    model.order = { ...model.order, version: 8, paymentStatus: 'UNPAID' };
    await page.clock.fastForward(31_000); await page.getByRole('button', { name: '核对后继续编辑', exact: true }).click();
    await page.locator('#edit-totalAmount').fill('170');
    model.order = { ...model.order, version: 9, paymentStatus: 'PAID' };
    await page.clock.fastForward(31_000);
    await eventually(() => page.locator('#edit-totalAmount').isDisabled());
    assert.equal(await page.locator('#edit-totalAmount').inputValue(), '170');
    assert.equal(writes.length, 2);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('同事付款后只保存图片，失败在编辑器内用原幂等键重试并保留金额', async () => {
  const { context, page, model, select, complete } = await createOrderFixture(browser, base);
  try {
    await complete(); await page.getByRole('button', { name: '创建订单', exact: true }).click(); await page.waitForURL('**/#/?date=*');
    model.order = { ...model.order, originalAmountCents: 10000, totalAmountCents: 10000, memberAmountCents: null };
    const writes = [];
    await context.route(`**/api/orders/${orderId}/information`, route => {
      writes.push(route.request().postDataJSON());
      return route.fulfill({ json: { success: true, data: model.order } });
    });
    await page.clock.install(); await page.goto(`${base}/#/orders/${orderId}`);
    await page.getByRole('button', { name: '编辑资料', exact: true }).click();
    const amount = page.locator('#edit-totalAmount');
    await amount.fill('153');
    model.order = { ...model.order, version: 1, paymentStatus: 'PAID', paymentMethod: 'CASH' };
    await page.clock.fastForward(31_000);
    await page.getByRole('button', { name: '核对后继续编辑', exact: true }).click();
    assert.equal(await page.locator('.information-form button.primary').isDisabled(), true);
    assert.equal(await amount.inputValue(), '153');
    await page.getByRole('button', { name: '添加图片', exact: true }).waitFor();
    await select(['retry.png']);
    await page.getByText('retry.png', { exact: true }).waitFor();
    model.failNames.add('retry.png');
    await page.getByRole('button', { name: '仅保存图片', exact: true }).click();
    const retry = page.getByRole('button', { name: '重试上传', exact: true });
    await eventually(() => retry.isEnabled());
    assert.equal(await amount.inputValue(), '153');
    assert.equal(model.uploads.length, 1);
    model.failNames.delete('retry.png');
    await retry.click();
    await page.getByRole('button', { name: '查看大图：retry.png' }).waitFor();
    assert.equal(model.uploads.length, 2);
    assert.equal(model.uploads[1].key, model.uploads[0].key);
    assert.deepEqual(writes, []);
    assert.equal(await amount.inputValue(), '153');
    assert.equal(await amount.isDisabled(), true);
  } finally { await context.close(); }
});

test('页面读取挂起能超时提示，恢复网络后重试取得最新数据', async () => {
  const { context, page, model, complete, errors } = await createOrderFixture(browser, base);
  let release; const held = new Promise(resolve => { release = resolve; });
  try {
    await complete(); await page.getByRole('button', { name: '创建订单', exact: true }).click(); await page.waitForURL('**/#/?date=*');
    let hang = false, reads = 0;
    await context.route(`**/api/orders/${orderId}/customer-origin`, route => route.fulfill({ json: { success: true, data: null } }));
    await context.route(`**/api/orders/${orderId}`, async route => {
      reads++; if (hang) await held;
      await route.fulfill({ json: { success: true, data: model.order } }).catch(() => {});
    });
    await page.clock.install(); await page.goto(`${base}/#/orders/${orderId}`);
    await page.getByText('13800000000', { exact: true }).first().waitFor();
    hang = true;
    model.order = { ...model.order, version: 1, customer: { ...model.order.customer, phone: '13900009999' } };
    await page.clock.fastForward(31_000); await wait(150); const firstStalled = reads;
    for (let i = 0; i < 6 && !await page.locator('.notice.error').filter({ hasText: '读取超时' }).count(); i++) {
      await page.clock.fastForward(31_000); await wait(150);
    }
    await page.locator('.notice.error').filter({ hasText: '读取超时' }).waitFor();
    assert.ok(reads > firstStalled, '超时后恢复到可重试状态');
    assert.ok(reads <= firstStalled + 3, '失败不会不断发起并发读取');
    hang = false;
    await page.locator('.notice.error').filter({ hasText: '读取超时' }).getByRole('button', { name: '重试', exact: true }).click();
    await page.getByText('13900009999', { exact: true }).first().waitFor();
    assert.deepEqual(errors, []);
  } finally { release(); await context.close(); }
});
