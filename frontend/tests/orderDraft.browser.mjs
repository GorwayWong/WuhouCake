import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRequire } from 'node:module';

const engines = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.DRAFT_BROWSER_ENGINE || 'chromium';
const base = process.env.DRAFT_TEST_URL || 'http://127.0.0.1:5197';
const key = 'wuhou:order-draft:v1:alice';
let browser;
before(async () => { browser = await engines[engine].launch({ headless: true, ...(engine === 'chromium' ? { channel: process.env.DRAFT_BROWSER_CHANNEL || 'chrome' } : {}) }); });
after(async () => { await browser?.close(); });

async function fixture() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
  context.setDefaultTimeout(10000);
  await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  const model = { account: 'alice', permitted: true, loseResponse: false, reject: false, orders: new Map(), requests: [],
    recognitionFields: {}, recognitionRequests: [], recognitionFailures: 0, recognitionInvalid: 0, extraPermissions: [] };
  await context.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    const ok = data => route.fulfill({ json: { success: true, data } });
    if (path === '/api/auth/csrf') return route.fulfill({ headers: { 'set-cookie': 'XSRF-TOKEN=test; Path=/' }, json: { success: true, data: { headerName: 'X-XSRF-TOKEN' } } });
    if (path === '/api/auth/refresh' || path === '/api/auth/login') return ok({ accessToken: 'test-token', expiresIn: 3600, passwordChangeRequired: false });
    if (path === '/api/auth/logout') return ok(null);
    if (path === '/api/me') return ok({ accountId: model.account, nickname: model.account, employeeNumber: model.account, jobRoles: ['FRONT_DESK'], access: { permissions: model.permitted ? ['ORDER_CREATE', 'ORDER_CUSTOMER_READ', 'ORDER_AMOUNT_READ', ...model.extraPermissions] : [], uiCapabilities: [] } });
    if (path === '/api/orders/stream') return route.fulfill({ status: 503 });
    if (path === '/api/orders/calendar') return ok([]);
    if (path === '/api/orders/workbench') return ok({ date: '2026-11-04', metrics: null, pendingOrders: [] });
    if (path === '/api/orders/workbench/payment-summary') return ok({ date: '2026-11-04', totalOrderCount: 0, waitingDeliveryOrderCount: 0, paidWithoutDateOrderCount: 0,
      paid: { orderCount: 0, amountCents: '0', missingAmountOrderCount: 0 }, unpaid: { orderCount: 0, amountCents: '0', missingAmountOrderCount: 0 } });
    if (path === '/api/orders/workbench/receipt-summary') return ok({ date: '2026-11-04', orderCount: 0, amountCents: '0', missingAmountOrderCount: 0 });
    if (path === '/api/orders/workbench/cake-bases') return ok({ date: '2026-11-04', items: [] });
    if (path === '/api/orders/recognition/parse') {
      model.recognitionRequests.push(req.postDataJSON().text);
      if (model.recognitionFailures > 0) { model.recognitionFailures--; return route.abort('failed'); }
      if (model.recognitionInvalid > 0) { model.recognitionInvalid--; return ok({ fields: {}, items: null }); }
      return ok({
        fields: { customerName: { value: '识别姓名', source: 'RULE', needsReview: false, evidence: [], issues: [] }, phone: { value: '13900000000', source: 'RULE', needsReview: true, evidence: [], issues: [] }, ...model.recognitionFields },
        items: [], issues: ['请核对原文'], fragments: [{ itemId: 'item-1', text: '合成片段' }], unmappedText: ['其他客户备注'], assistAvailable: true,
      });
    }
    if (path === '/api/order-packages') return ok({ items: [], total: 0, page: 1, size: 20 });
    if (path === '/api/orders' && req.method() === 'POST') {
      const id = req.headers()['idempotency-key'], body = req.postDataJSON();
      model.requests.push({ id, body });
      if (model.reject) return route.fulfill({ status: 400, json: { success: false, code: 'VALIDATION_FAILED' } });
      if (!model.orders.has(id)) model.orders.set(id, { ...body, orderId: 'order-one', orderNo: 'TEST-001', version: 1, status: 'CAKE_BASE', currentStageCode: null, paymentStatus: 'UNPAID' });
      if (model.loseResponse) { model.loseResponse = false; return route.abort('failed'); }
      assert.deepEqual(body, model.requests[0].body);
      return ok(model.orders.get(id));
    }
    return route.fulfill({ status: 404, json: { success: false, code: 'NOT_FOUND' } });
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/#/orders/new`);
  await page.locator('#customerName').waitFor();
  return { context, page, model, errors };
}
async function saved(page, account = 'alice') {
  return page.evaluate(account => JSON.parse(localStorage.getItem(`wuhou:order-draft:v1:${account}`)), account);
}
async function waitFor(check) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error('Timed out waiting for draft state');
}
async function complete(page) {
  await page.locator('#phone').fill('13800000000');
  await page.locator('#address').fill('自提');
  await page.locator('[id="items.0.name"]').fill('生日蛋糕');
}
test('只粘贴原文也同步保存，刷新询问恢复，关闭弹窗保留，重新进入可恢复', async () => {
  const { context, page, errors } = await fixture();
  try {
    assert.equal(await saved(page), null);
    await page.getByText('粘贴下单信息', { exact: true }).click();
    await page.locator('#recognition-text').fill('微信原文：王女士生日蛋糕 🎂');
    assert.equal((await saved(page)).editor.text, '微信原文：王女士生日蛋糕 🎂');
    await page.reload();
    await page.getByRole('dialog').waitFor();
    if (process.env.DRAFT_SCREENSHOT) await page.screenshot({ path: process.env.DRAFT_SCREENSHOT });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole('button', { name: '关闭草稿恢复弹窗' }).click();
    await page.getByRole('link', { name: '新建订单', exact: true }).waitFor();
    assert.ok(await saved(page));
    await page.getByRole('link', { name: '新建订单', exact: true }).click();
    await page.getByRole('button', { name: '继续填写' }).click();
    assert.equal(await page.locator('#recognition-text').inputValue(), '微信原文：王女士生日蛋糕 🎂');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
test('多商品、未完成金额、当前商品及手工标记跨刷新恢复，离开后重入再次询问', async () => {
  const { context, page } = await fixture();
  try {
    await page.locator('#customerName').fill('王女士');
    await page.locator('#totalAmount').fill('199.');
    await page.getByRole('button', { name: '添加商品', exact: true }).click();
    await page.locator('[id="items.1.name"]').fill('第二个蛋糕');
    const original = await saved(page);
    await page.evaluate(() => window.scrollTo(0, 500));
    await waitFor(async () => (await saved(page)).editor.scrollY > 0);
    await page.reload();
    await page.getByRole('button', { name: '继续填写' }).click();
    assert.equal(await page.locator('#customerName').inputValue(), '王女士');
    assert.equal(await page.locator('#totalAmount').inputValue(), '199.');
    assert.equal(await page.locator('[id="items.1.name"]').inputValue(), '第二个蛋糕');
    const restored = await saved(page);
    assert.deepEqual(restored.value.items, original.value.items);
    assert.ok(restored.editor.manualFields.includes('customerName'));
    await page.evaluate(() => { location.hash = '#'; });
    await waitFor(() => page.locator('#customerName').count().then(n => n === 0));
    await page.evaluate(() => { location.hash = '#/orders/new'; });
    await page.getByRole('dialog').waitFor();
  } finally { await context.close(); }
});
test('响应丢失后重载，用原始载荷及相同标识重试，仅产生一单，成功清除草稿', async () => {
  const { context, page, model, errors } = await fixture();
  try {
    await complete(page); model.loseResponse = true;
    await page.getByRole('button', { name: '创建订单', exact: true }).click();
    await page.getByRole('button', { name: '重试确认原订单' }).waitFor();
    const original = await saved(page);
    assert.ok(original.pending);
    await page.reload();
    await page.getByRole('button', { name: '继续填写' }).click();
    assert.equal(await page.locator('#phone').isDisabled(), true);
    assert.equal(model.requests.length, 1);
    await page.getByRole('button', { name: '重试确认原订单' }).click();
    await waitFor(async () => (await saved(page)) === null);
    assert.equal(model.orders.size, 1);
    assert.deepEqual(model.requests.map(request => request.id), [original.requestId, original.requestId]);
    assert.deepEqual(model.requests[1].body, original.pending);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
test('明确拒绝后解锁表单，草稿保持可编辑', async () => {
  const { context, page, model } = await fixture();
  try {
    await complete(page); model.reject = true;
    await page.getByRole('button', { name: '创建订单', exact: true }).click();
    await waitFor(async () => (await saved(page))?.pending === undefined);
    await page.locator('#customerName').fill('拒绝后继续修改');
    assert.equal((await saved(page)).value.customerName, '拒绝后继续修改');
  } finally { await context.close(); }
});
test('其他标签页更新后暂停旧页保存，不覆盖新内容', async () => {
  const { context, page } = await fixture();
  try {
    await page.locator('#customerName').fill('旧内容');
    const second = await context.newPage();
    await second.goto(`${base}/#/orders/new`);
    await second.getByRole('button', { name: '继续填写' }).click();
    await second.locator('#customerName').fill('新标签页更新');
    await page.getByText('其他标签页已更新或清除了草稿', { exact: false }).waitFor();
    assert.equal(await page.locator('#customerName').isDisabled(), true);
    assert.equal((await saved(page)).value.customerName, '新标签页更新');
  } finally { await context.close(); }
});
test('存储不可用时继续保留输入，恢复写权限后可重试，放弃草稿需确认', async () => {
  const { context, page } = await fixture();
  try {
    await page.evaluate(() => { window.originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); }; });
    await page.locator('#customerName').fill('仍在页面的内容');
    await page.getByText('本机保存失败，请暂勿关闭页面。', { exact: false }).waitFor();
    assert.equal(await page.locator('#customerName').inputValue(), '仍在页面的内容');
    await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
    await page.getByRole('button', { name: '重试保存' }).click();
    assert.equal((await saved(page)).value.customerName, '仍在页面的内容');
    await page.getByRole('button', { name: '放弃草稿', exact: true }).click();
    await page.getByRole('button', { name: '返回', exact: true }).click();
    assert.ok(await saved(page));
    await page.getByRole('button', { name: '放弃草稿', exact: true }).click();
    await page.getByRole('button', { name: '确认放弃', exact: true }).click();
    assert.equal(await saved(page), null);
    assert.equal(await page.locator('#customerName').inputValue(), '');
  } finally { await context.close(); }
});
test('登录自动过期保留，原员工恢复，主动退出取消保留、确认后清除', async () => {
  const { context, page } = await fixture();
  try {
    await page.locator('#customerName').fill('过期前内容');
    await page.evaluate(async () => { (await import('/src/api.ts')).forgetSession(); });
    await page.getByRole('heading', { name: '员工登录' }).waitFor();
    assert.ok(await saved(page));
    await page.locator('[name="employeeNumber"]').fill('alice');
    await page.locator('[name="password"]').fill('test-password');
    await page.getByRole('button', { name: '登录工作台' }).click();
    await page.getByRole('button', { name: '继续填写' }).click();
    assert.equal(await page.locator('#customerName').inputValue(), '过期前内容');
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    assert.ok(await saved(page));
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await page.getByRole('heading', { name: '员工登录' }).waitFor();
    assert.equal(await saved(page), null);
  } finally { await context.close(); }
});
test('不同员工及失去录单权限时不展示原账号草稿', async () => {
  const { context, page, model } = await fixture();
  try {
    await page.locator('#customerName').fill('alice 私有草稿');
    model.account = 'bob'; await page.reload();
    await page.locator('#customerName').waitFor();
    assert.equal(await page.locator('#customerName').inputValue(), '');
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal((await saved(page)).value.customerName, 'alice 私有草稿');
    model.account = 'alice'; model.permitted = false; await page.reload();
    await page.getByText('当前岗位不显示接单信息。').waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal((await saved(page)).value.customerName, 'alice 私有草稿');
  } finally { await context.close(); }
});
test('恢复弹窗期间登录过期，其他员工登录时不挂载旧员工弹窗', async () => {
  const { context, page, model } = await fixture();
  try {
    await page.locator('#customerName').fill('Alice-private-customer');
    await page.reload();
    await page.getByRole('dialog').waitFor();
    await page.evaluate(async () => { (await import('/src/api.ts')).forgetSession(); });
    await page.getByRole('heading', { name: '员工登录' }).waitFor();
    await page.evaluate(() => {
      window.oldAccountDialogs = [];
      new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
          if (node instanceof Element && (node.matches('dialog') || node.querySelector('dialog')) && node.textContent.includes('Alice-private-customer')) window.oldAccountDialogs.push(node.textContent);
        }
      }).observe(document.body, { childList: true, subtree: true });
    });
    model.account = 'bob';
    await page.locator('[name="employeeNumber"]').fill('bob');
    await page.locator('[name="password"]').fill('test-password');
    await page.getByRole('button', { name: '登录工作台' }).click();
    await page.locator('#customerName').waitFor();
    assert.equal(await page.locator('#customerName').inputValue(), '');
    assert.deepEqual(await page.evaluate(() => window.oldAccountDialogs), []);
    assert.equal((await saved(page)).value.customerName, 'Alice-private-customer');
  } finally { await context.close(); }
});
test('损坏草稿不会被默认表单覆盖，明确放弃后才清除', async () => {
  const { context, page } = await fixture();
  try {
    await page.evaluate(key => localStorage.setItem(key, '{broken'), key);
    await page.reload();
    await page.getByRole('heading', { name: '草稿暂时无法恢复' }).waitFor();
    assert.equal(await page.evaluate(key => localStorage.getItem(key), key), '{broken');
    await page.getByRole('button', { name: '放弃并新建' }).click();
    await page.getByRole('button', { name: '确认放弃', exact: true }).click();
    await page.locator('#customerName').waitFor();
    assert.equal(await saved(page), null);
  } finally { await context.close(); }
});
test('识别核对标记及手工字段保护跨恢复保留，再次识别不覆盖手工姓名', async () => {
  const { context, page } = await fixture();
  try {
    await page.locator('#customerName').fill('手工姓名');
    await page.getByText('粘贴下单信息', { exact: true }).click();
    await page.locator('#recognition-text').fill('识别姓名 13900000000');
    await page.getByRole('button', { name: '识别并填入', exact: true }).click();
    await waitFor(async () => (await page.locator('#phone').inputValue()) === '13900000000');
    assert.equal(await page.getByText('未识别内容', { exact: true }).count(), 0);
    assert.equal(await page.locator('.recognition-receipt').innerText(), '撤销本次填入');
    if (process.env.DRAFT_SCREENSHOT) {
      await page.locator('.recognition-section').scrollIntoViewIfNeeded();
      await page.screenshot({ path: process.env.DRAFT_SCREENSHOT.replace(/\.png$/, '-recognition.png') });
    }
    const original = await saved(page);
    assert.ok(Object.keys(original.editor.feedback).length);
    await page.reload();
    await page.getByRole('button', { name: '继续填写' }).click();
    assert.equal(await page.locator('#customerName').inputValue(), '手工姓名');
    assert.deepEqual((await saved(page)).editor.feedback, original.editor.feedback);
    await page.getByText('粘贴下单信息', { exact: true }).click();
    await page.getByRole('button', { name: '识别并填入', exact: true }).click();
    await waitFor(async () => !(await page.getByRole('button', { name: '识别并填入', exact: true }).isDisabled()));
    assert.equal(await page.locator('#customerName').inputValue(), '手工姓名');
  } finally { await context.close(); }
});
test('切后台及 pagehide 补存最新滚动位置，不触发恢复弹窗或清空输入', async () => {
  const { context, page } = await fixture();
  try {
    await page.locator('#customerName').fill('切后台内容');
    const id = (await saved(page)).requestId;
    await page.evaluate(() => {
      window.scrollTo(0, 420);
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new PageTransitionEvent('pagehide'));
    });
    assert.equal((await saved(page)).editor.scrollY, 420);
    assert.equal((await saved(page)).requestId, id);
    assert.equal(await page.locator('#customerName').inputValue(), '切后台内容');
    assert.equal(await page.getByRole('dialog').count(), 0);
  } finally { await context.close(); }
});

async function selectTime(page, field, unit, value) {
  await page.locator(`.date-time-field[data-field-name="${field}"] .time-field .choice-trigger`).nth(unit === 'hour' ? 0 : 1).click();
  await page.getByRole('option', { name: new RegExp('^' + value + '(?: [时分])?$') }).click();
}
test('时间字段位于客户信息前，手机两列、窄屏单列，日期和时分分行且日历不溢出', async () => {
  const { context, page } = await fixture();
  try {
    for (const width of [320, 360, 390, 430, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const geometry = await page.evaluate(() => {
        const grid = document.querySelector('.create-time-grid');
        const labels = [...grid.children];
        const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, bottom: r.bottom }; };
        return { fields: labels.map(rect), grid: rect(grid), customers: rect(document.querySelector('.create-customer-grid')),
          parts: labels.map(label => ({ date: rect(label.querySelector('.date-control')), hour: rect(label.querySelector('.time-field .choice-trigger')) })),
          overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.equal(geometry.overflow, false, `page overflow at ${width}`);
      assert.ok(geometry.customers.y >= geometry.grid.bottom);
      if (width >= 360) {
        assert.ok(Math.abs(geometry.fields[0].y - geometry.fields[1].y) < 1);
        assert.ok(Math.abs(geometry.fields[0].width - geometry.fields[1].width) < 1);
        assert.ok(geometry.fields[1].x > geometry.fields[0].x);
      } else assert.ok(geometry.fields[1].y >= geometry.fields[0].bottom);
      for (const part of geometry.parts) {
        assert.ok(part.hour.y >= part.date.bottom);
        assert.ok(part.hour.width >= 44);
      }
      for (const field of ['requestedReceiveAt', 'plannedFinishAt']) {
        assert.equal(await page.locator('#' + field).count(), 1);
        if (field === 'plannedFinishAt') await page.locator(`.date-time-field[data-field-name="${field}"] .date-month-day`).click();
        else await page.locator('#' + field).click();
        const popup = page.getByRole('dialog'); await popup.waitFor();
        const box = await popup.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width + 1, `calendar overflow at ${width}`);
        await page.keyboard.press('Escape');
      }
      if (process.env.DRAFT_SCREENSHOT && [360, 390, 1280].includes(width)) {
        await page.evaluate(() => document.activeElement?.blur());
        await page.locator('.create-order-info').scrollIntoViewIfNeeded();
        await page.screenshot({ path: process.env.DRAFT_SCREENSHOT.replace(/\.png$/, `-times-${width}.png`) });
      }
    }
  } finally { await context.close(); }
});
test('取货日期、时刻和出品输入沿用原规则，恢复后同步提交，改日期清时刻并定位错误', async () => {
  const { context, page, model } = await fixture();
  const value = field => page.locator(`input[name="${field}"]`).inputValue();
  try {
    await complete(page); model.reject = true;
    await page.getByRole('button', { name: '创建订单', exact: true }).click();
    await waitFor(() => Promise.resolve(model.requests.length === 1));
    await waitFor(async () => (await saved(page)).pending === undefined);
    assert.equal(model.requests[0].body.fulfillment.requestedReceiveAt, null);
    assert.equal(model.requests[0].body.fulfillment.plannedHandoffAt, null);
    const date = await value('requestedReceiveAt');
    await selectTime(page, 'requestedReceiveAt', 'hour', '09');
    assert.equal(await value('requestedReceiveAt'), date + 'T09:00');
    await selectTime(page, 'requestedReceiveAt', 'minute', '15');
    await page.locator('#plannedFinishAt').click();
    await page.getByRole('button', { name: '今天', exact: true }).click();
    await selectTime(page, 'plannedFinishAt', 'hour', '08');
    const production = await value('plannedFinishAt');
    const id = (await saved(page)).requestId;
    await page.reload();
    await page.getByRole('button', { name: '继续填写', exact: true }).click();
    assert.equal(await value('requestedReceiveAt'), date + 'T09:15');
    assert.equal(await value('plannedFinishAt'), production);
    assert.equal((await saved(page)).requestId, id);
    await page.getByRole('button', { name: '创建订单', exact: true }).click();
    await waitFor(() => Promise.resolve(model.requests.length === 2));
    await waitFor(async () => (await saved(page)).pending === undefined);
    const fulfillment = model.requests[1].body.fulfillment;
    assert.equal(fulfillment.requestedReceiveAt, fulfillment.plannedHandoffAt);
    assert.equal(fulfillment.requestedReceiveAt, date + 'T09:15:00+08:00');
    assert.equal(fulfillment.plannedFinishAt, production + ':00+08:00');
    await page.getByRole('button', { name: '清除时刻', exact: true }).click();
    assert.equal(await value('requestedReceiveAt'), date);
    await selectTime(page, 'requestedReceiveAt', 'hour', '10');
    await page.locator('#requestedReceiveAt').click();
    await page.locator('.date-calendar [role="button"]:not([data-selected]):not([data-outside-month]):not([data-disabled])').first().click();
    const changed = await value('requestedReceiveAt');
    assert.match(changed, /^\d{4}-\d{2}-\d{2}$/);
    assert.notEqual(changed, date);
    await page.locator('#requestedReceiveAt').click();
    await page.getByRole('button', { name: '清空', exact: true }).click();
    await page.getByRole('button', { name: '创建订单', exact: true }).click();
    await page.locator('#requestedReceiveAt-error').waitFor();
    assert.equal(model.requests.length, 2);
    assert.equal(await page.locator('.date-time-field[data-field-name="requestedReceiveAt"]').evaluate(element => element.contains(document.activeElement)), true);
    assert.equal(await page.locator('.create-time-grid [data-invalid]').count() > 0, true);
  } finally { await context.close(); }
});
test('识别带入的取货和出品时间在顶部显示，草稿恢复保留时间及核对标记', async () => {
  const { context, page, model } = await fixture();
  try {
    const candidate = value => ({ value, source: 'RULE', needsReview: true, evidence: [], issues: [] });
    model.recognitionFields = { requestedReceiveAt: candidate('2026-11-08T15:30'), plannedFinishAt: candidate('2026-11-08T13:00') };
    await page.getByText('粘贴下单信息', { exact: true }).click();
    await page.locator('#recognition-text').fill('11月8日15:30取货，13:00出品');
    await page.getByRole('button', { name: '识别并填入', exact: true }).click();
    await waitFor(async () => (await saved(page))?.value.requestedReceiveAt === '2026-11-08T15:30');
    assert.equal(await page.locator('.create-time-grid > label[data-recognition="true"]').count(), 2);
    await page.reload();
    await page.getByRole('button', { name: '继续填写', exact: true }).click();
    assert.equal(await page.locator('input[name="requestedReceiveAt"]').inputValue(), '2026-11-08T15:30');
    assert.equal(await page.locator('input[name="plannedFinishAt"]').inputValue(), '2026-11-08T13:00');
    assert.equal(await page.locator('.create-time-grid > label[data-recognition="true"]').count(), 2);
  } finally { await context.close(); }
});

test('移动端字段显示补年与时刻异常，同一原文在手改、撤销和换原文后均不重放', async () => {
  const { context, page, model, errors } = await fixture();
  try {
    const candidate = (value, issue) => ({ value, source: 'RULE', needsReview: true, evidence: [], issues: [issue] });
    model.recognitionFields = {
      requestedReceiveDate: candidate('2027-11-02', '原文未写年份，已按最近日期补为2027年。'),
      plannedHandoffAt: candidate(null, '时段与时刻冲突，请核对'),
    };
    const panel = page.locator('.recognition-panel');
    const parse = page.getByRole('button', { name: '识别并填入', exact: true });
    const enter = async text => {
      if (await panel.getAttribute('open') === null) await panel.locator('summary').click();
      await page.locator('#recognition-text').fill(text);
    };
    const original = '取货时间：11月2号上午17:00\n电话：13900000000';
    await enter(original);
    await page.evaluate(() => {
      const button = document.querySelector('.recognition-panel button.primary');
      button.click();
      button.click();
    });
    const pickup = page.locator('.create-time-grid > label').first();
    await pickup.getByText('原文未写年份，已按最近日期补为2027年。').waitFor();
    await pickup.getByText('时段与时刻冲突，请核对').waitFor();
    assert.equal(model.recognitionRequests.length, 1);
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(await page.getByText('AI 补充（可选）', { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal((await saved(page)).value.requestedReceiveAt, '2027-11-02');
    await page.locator('#phone').fill('13800000012');
    await enter('  ' + original + '  ');
    await parse.click();
    assert.equal(await page.locator('#phone').inputValue(), '13800000012');
    await page.getByRole('button', { name: '撤销本次填入', exact: true }).click();
    const undone = (await saved(page)).value;
    await parse.click();
    assert.deepEqual((await saved(page)).value, undone);

    model.recognitionFailures = 1;
    model.recognitionInvalid = 1;
    await enter('另一张合成原文');
    for (let i = 0; i < 2; i++) {
      await parse.click();
      await page.getByText(/识别暂不可用，原文和表单已保留/).waitFor();
      assert.deepEqual((await saved(page)).value, undone);
    }
    await parse.click();
    await pickup.getByText('原文未写年份，已按最近日期补为2027年。').waitFor();
    await enter(original);
    await parse.click();
    assert.deepEqual(model.recognitionRequests, [original, '另一张合成原文', '另一张合成原文', '另一张合成原文']);

    await page.getByRole('button', { name: '放弃草稿', exact: true }).click();
    await page.getByRole('button', { name: '确认放弃', exact: true }).click();
    await enter(original);
    await parse.click();
    await pickup.getByText('原文未写年份，已按最近日期补为2027年。').waitFor();
    assert.equal(model.recognitionRequests.length, 5);
    assert.equal(model.recognitionRequests.at(-1), original);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('移动端取货优先，同日仅日期清除自动时刻，撤销恢复且相同原文不重放', async () => {
  const { context, page, model, errors } = await fixture();
  try {
    const field = value => ({ value, source: 'RULE', needsReview: false, evidence: [], issues: [] });
    const panel = page.locator('.recognition-panel');
    const button = page.getByRole('button', { name: '识别并填入', exact: true });
    const paste = async text => {
      if (await panel.getAttribute('open') === null) await panel.locator('summary').click();
      await page.locator('#recognition-text').fill(text);
      await button.click();
    };
    model.recognitionFields = {
      requestedReceiveAt: field('2026-11-13T18:00'),
      plannedHandoffAt: field('2026-11-12T17:00'),
    };
    await paste('收货时间：2026-11-13 18:00\n取货时间：2026-11-12 17:00');
    await waitFor(async () => (await saved(page))?.value.requestedReceiveAt === '2026-11-12T17:00');
    assert.equal((await saved(page)).value.plannedFinishAt, '2026-11-12T16:00');

    const dateOnly = '取货日期：2026-11-12';
    model.recognitionFields = {
      requestedReceiveDate: field('2026-11-12'),
      requestedReceiveAt: field('2026-11-13T18:00'),
      plannedHandoffAt: field(null),
    };
    await paste(dateOnly);
    await waitFor(async () => (await saved(page))?.value.requestedReceiveAt === '2026-11-12');
    assert.equal((await saved(page)).value.plannedFinishAt, '');
    await page.getByRole('button', { name: '撤销本次填入', exact: true }).click();
    assert.equal((await saved(page)).value.requestedReceiveAt, '2026-11-12T17:00');
    assert.equal((await saved(page)).value.plannedFinishAt, '2026-11-12T16:00');
    await paste(dateOnly);
    assert.equal(model.recognitionRequests.length, 2);
    assert.equal((await saved(page)).value.requestedReceiveAt, '2026-11-12T17:00');
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('出品自动随动、手动保留、刷新恢复及恢复自动，移动端无溢出', async () => {
  const { context, page, errors } = await fixture();
  const value = field => page.locator(`input[name="${field}"]`).inputValue();
  try {
    const date = await value('requestedReceiveAt');
    await selectTime(page, 'requestedReceiveAt', 'hour', '17');
    await selectTime(page, 'requestedReceiveAt', 'minute', '30');
    assert.equal(await value('plannedFinishAt'), date + 'T16:30');
    assert.equal((await saved(page)).value.finishTimeMode, 'AUTO');
    await selectTime(page, 'plannedFinishAt', 'hour', '14');
    await selectTime(page, 'requestedReceiveAt', 'hour', '18');
    assert.equal(await value('plannedFinishAt'), date + 'T14:30');
    assert.equal((await saved(page)).value.finishTimeMode, 'MANUAL');
    await page.reload(); await page.getByRole('button', { name: '继续填写', exact: true }).click();
    assert.equal(await value('plannedFinishAt'), date + 'T14:30');
    if (process.env.TIME_SCREENSHOT) await page.screenshot({ path: process.env.TIME_SCREENSHOT });
    const restore = page.getByRole('button', { name: '恢复自动计算', exact: true });
    await restore.click();
    assert.equal(await value('plannedFinishAt'), date + 'T17:30');
    assert.equal((await saved(page)).value.finishTimeMode, 'AUTO');
    assert.equal(await restore.count(), 0);
    await selectTime(page, 'requestedReceiveAt', 'hour', '19');
    assert.equal(await value('plannedFinishAt'), date + 'T18:30');
    await page.getByRole('button', { name: '清除时刻', exact: true }).click();
    assert.equal(await value('plannedFinishAt'), '');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('历史订单编辑只展示取货和出品，保留原始差异，不改时间只提交电话', async () => {
  const { context, page, model, errors } = await fixture();
  const patches = [];
  const detail = { orderId: '00000000-0000-4000-8000-000000000001', orderNo: 'TEST-LEGACY', version: 1, status: 'CAKE_BASE', paymentStatus: 'UNPAID', currentStageCode: null,
    customer: { phone: '13800000000', customerName: '测试客户', memberPhone: null, buyerName: null },
    fulfillment: { type: 'DELIVERY', address: '测试地址', requestedReceiveDate: '2026-11-05', requestedReceiveAt: '2026-11-05T10:00:00Z',
      plannedHandoffAt: '2026-11-04T16:30:00Z', plannedFinishAt: '2026-11-04T14:00:00Z' },
    totalAmountCents: null, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', items: [] };
  try {
    model.extraPermissions = ['ORDER_READ', 'ORDER_BUSINESS_DETAILS_READ', 'ORDER_INFORMATION_UPDATE'];
    await context.route('**/api/employees/options?*', route => route.fulfill({ json: { success: true, data: [] } }));
    await context.route('**/api/orders/00000000-0000-4000-8000-000000000001**', route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      let data = detail;
      if (path.endsWith('/information')) { patches.push(req.postDataJSON()); detail.version++; detail.customer.phone = patches.at(-1).changes.phone; }
      else if (path.endsWith('/customer-origin')) data = null;
      else if (path.endsWith('/images')) data = [];
      else if (path.endsWith('/activities') || path.endsWith('/notes')) data = { items: [], total: 0, page: 1, size: 20 };
      return route.fulfill({ json: { success: true, data } });
    });
    await page.reload(); await page.locator('#customerName').waitFor();
    await page.goto(`${base}/#/orders/00000000-0000-4000-8000-000000000001`);
    await page.getByRole('button', { name: '编辑资料', exact: true }).click();
    assert.equal(await page.locator('input[name="requestedReceiveAt"]').inputValue(), '2026-11-05T00:30');
    assert.equal(await page.locator('input[name="plannedFinishAt"]').inputValue(), '2026-11-04T22:00');
    assert.equal(await page.locator('.information-form input[name="plannedHandoffAt"]').count(), 0);
    assert.equal(await page.getByText('历史时间不同，请核对：', { exact: false }).count(), 1);
    assert.equal(patches.length, 0);
    await page.locator('#edit-phone').fill('13900000000');
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await waitFor(() => Promise.resolve(patches.length === 1));
    assert.deepEqual(patches[0], { expectedVersion: 1, changes: { phone: '13900000000' } });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
test('客户扫码只填取货时间，员工核对出品提前一小时并同步取货字段', async () => {
  const { context, page, model, errors } = await fixture();
  let posted, savedReview;
  try {
    await context.route('**/api/public/order-entries/test**', route => {
      if (route.request().method() === 'POST') { posted = route.request().postDataJSON(); return route.fulfill({ json: { success: true, data: { submissionNo: 'FTEST' } } }); }
      return route.fulfill({ json: { success: true, data: { ownerName: '测试客服' } } });
    });
    await page.goto(`${base}/#/fill/test`);
    await page.locator('#phone').fill('13800000000'); await page.locator('#address').fill('测试地址');
    await page.locator('#requestedReceiveAt').click(); await page.getByRole('button', { name: '今天', exact: true }).click();
    await selectTime(page, 'requestedReceiveAt', 'hour', '17'); await selectTime(page, 'requestedReceiveAt', 'minute', '30');
    await page.locator('[id="items.0.size"]').fill('8');
    assert.equal(await page.locator('input[name="plannedHandoffAt"], input[name="plannedFinishAt"]').count(), 0);
    await page.getByRole('button', { name: '提交预订', exact: true }).click();
    await page.getByRole('heading', { name: '已提交，待客服确认' }).waitFor();
    assert.ok(posted.requestedReceiveAt); assert.equal('plannedFinishAt' in posted, false);
    model.extraPermissions = ['CUSTOMER_SUBMISSION_PROCESS', 'ORDER_BUSINESS_DETAILS_READ'];
    const submission = { id: '00000000-0000-4000-8000-000000000002', original: posted, reviewed: null, status: 'PENDING', ownerName: '测试客服', version: 0, createdAt: new Date().toISOString(), orderId: null };
    await context.route('**/api/customer-submissions/00000000-0000-4000-8000-000000000002', route => {
      if (route.request().method() === 'PATCH') { savedReview = route.request().postDataJSON().review; submission.reviewed = savedReview; submission.version++; }
      return route.fulfill({ json: { success: true, data: { submission, duplicates: [], activities: [], duplicateCheckToken: 'test' } } });
    });
    await context.route('**/api/employees/options?*', route => route.fulfill({ json: { success: true, data: [] } }));
    await page.goto(`${base}/#/customer-submissions/00000000-0000-4000-8000-000000000002`); await page.reload();
    await page.locator('#plannedFinishAt').waitFor();
    const value = await page.locator('input[name="plannedFinishAt"]').inputValue(); assert.ok(value.endsWith('T16:30'), value);
    assert.equal(await page.locator('input[name="plannedHandoffAt"]').count(), 0);
    await page.getByRole('button', { name: '保存核对结果', exact: true }).click();
    await waitFor(() => Promise.resolve(Boolean(savedReview)));
    assert.equal(savedReview.plannedHandoffAt, savedReview.content.requestedReceiveAt);
    assert.equal(Date.parse(savedReview.plannedHandoffAt) - Date.parse(savedReview.plannedFinishAt), 3600000);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});


test('恢复弹窗就地确认，删除失败可见且重试闭环，不调用系统确认框', async () => {
  const { context, page } = await fixture();
  try {
    await page.locator('#customerName').fill('保留客户');
    const original = await saved(page);
    await page.reload();
    const modal = page.locator('dialog[open]');
    await modal.waitFor();
    await page.evaluate(() => { window.confirm = () => { throw new Error('unexpected native confirm'); }; });
    await modal.getByRole('button', { name: '放弃并新建' }).click();
    assert.equal(await modal.getByRole('button', { name: '返回', exact: true }).evaluate(el => el === document.activeElement), true);
    await modal.getByRole('button', { name: '返回', exact: true }).click();
    assert.equal((await saved(page)).requestId, original.requestId);
    await modal.getByRole('button', { name: '放弃并新建' }).click();
    await page.evaluate(() => { window.originalRemove = Storage.prototype.removeItem; Storage.prototype.removeItem = () => { throw new DOMException('denied', 'SecurityError'); }; });
    await modal.getByRole('button', { name: '确认放弃', exact: true }).click();
    await modal.getByRole('alert').filter({ hasText: '草稿未能删除' }).waitFor();
    assert.equal((await saved(page)).requestId, original.requestId);
    assert.equal(await page.locator('#customerName').count(), 0);
    await page.evaluate(() => { Storage.prototype.removeItem = window.originalRemove; });
    await modal.getByRole('button', { name: '重试删除' }).click();
    await page.locator('#customerName').waitFor();
    assert.equal(await saved(page), null);
    assert.equal(await page.locator('#customerName').inputValue(), '');
    assert.equal(await page.locator('dialog[open]').count(), 0);
  } finally { await context.close(); }
});

test('恢复确认期间其他标签页更新，禁止删除新版本', async () => {
  const { context, page } = await fixture();
  try {
    await page.locator('#customerName').fill('原草稿');
    await page.reload();
    const modal = page.locator('dialog[open]');
    await modal.getByRole('button', { name: '放弃并新建' }).click();
    const peer = await context.newPage();
    await peer.goto(base);
    await peer.evaluate(key => { const value = JSON.parse(localStorage.getItem(key)); value.revision = 'peer-new'; value.value.customerName = '其他标签页'; localStorage.setItem(key, JSON.stringify(value)); }, key);
    await modal.getByText('其他标签页已修改草稿', { exact: false }).waitFor();
    assert.equal(await modal.getByRole('button', { name: '确认放弃', exact: true }).isDisabled(), true);
    assert.equal((await saved(page)).value.customerName, '其他标签页');
  } finally { await context.close(); }
});

test('已创建及结果未知草稿放弃仅清本机，关闭重入不沿用确认状态', async () => {
  const { context, page, model } = await fixture();
  try {
    await page.locator('#customerName').fill('待核对');
    const initial = await saved(page);
    const pending = { customer: { phone: '13800000000', customerName: null, memberPhone: null, buyerName: null }, fulfillment: { type: 'PICKUP', requestedReceiveDate: initial.value.requestedReceiveDate, address: null, plannedHandoffAt: null, plannedFinishAt: null }, totalAmountCents: null, items: [{ name: '蛋糕', productType: 'CAKE', quantity: 1, unitPriceCents: null, memberPriceCents: null, attributes: {} }] };
    for (const extra of [{ pending }, { createdOrderId: '10000000-0000-4000-8000-000000000001' }]) {
      await page.evaluate(({ key, record }) => localStorage.setItem(key, JSON.stringify(record)), { key, record: { ...initial, ...extra } });
      await page.reload();
      const modal = page.locator('dialog[open]');
      await modal.getByRole('button', { name: '放弃并新建' }).click();
      await modal.getByText('删除本机草稿不会撤销订单', { exact: false }).waitFor();
      await modal.getByRole('button', { name: '关闭草稿恢复弹窗' }).click();
      await page.goto(base + '/#/orders/new');
      await modal.getByRole('button', { name: '放弃并新建' }).waitFor();
      assert.equal(await modal.getByRole('button', { name: '确认放弃', exact: true }).count(), 0);
      await modal.getByRole('button', { name: '放弃并新建' }).click();
      await modal.getByRole('button', { name: '确认放弃', exact: true }).click();
      await page.locator('#customerName').waitFor();
      assert.equal(await saved(page), null);
      assert.equal(model.requests.length, 0);
    }
  } finally { await context.close(); }
});

test('旧草稿图片清理延迟失败，不污染新草稿保存状态', async () => {
  const { context, page } = await fixture();
  try {
    await page.locator('#customerName').fill('旧草稿');
    await page.evaluate(key => { const record = JSON.parse(localStorage.getItem(key)); record.imageStorageUsed = true; localStorage.setItem(key, JSON.stringify(record)); }, key);
    await page.reload();
    await page.evaluate(() => { indexedDB.open = () => { const request = {}; window.failOldCleanup = () => { request.error = new DOMException('denied', 'SecurityError'); request.onerror(); }; return request; }; });
    const modal = page.locator('dialog[open]');
    await modal.getByRole('button', { name: '放弃并新建' }).click();
    await modal.getByRole('button', { name: '确认放弃', exact: true }).click();
    await page.locator('#customerName').fill('新草稿');
    await page.evaluate(() => window.failOldCleanup());
    await page.getByText('旧草稿的本机图片未能清理', { exact: false }).waitFor();
    assert.equal((await saved(page)).value.customerName, '新草稿');
    assert.equal(await page.getByRole('button', { name: '重试保存' }).count(), 0);
    await page.getByText('草稿已保存在本机', { exact: false }).waitFor();
  } finally { await context.close(); }
});
