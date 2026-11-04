import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DRAFT_TEST_URL || 'http://127.0.0.1:5197';
const key = 'wuhou:order-draft:v1:alice';
let browser;
before(async () => { browser = await chromium.launch({ headless: true, channel: process.env.DRAFT_BROWSER_CHANNEL || 'chrome' }); });
after(async () => { await browser?.close(); });

async function fixture() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
  context.setDefaultTimeout(10000);
  const model = { account: 'alice', permitted: true, loseResponse: false, reject: false, orders: new Map(), requests: [] };
  await context.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    const ok = data => route.fulfill({ json: { success: true, data } });
    if (path === '/api/auth/csrf') return route.fulfill({ headers: { 'set-cookie': 'XSRF-TOKEN=test; Path=/' }, json: { success: true, data: { headerName: 'X-XSRF-TOKEN' } } });
    if (path === '/api/auth/refresh' || path === '/api/auth/login') return ok({ accessToken: 'test-token', expiresIn: 3600, passwordChangeRequired: false });
    if (path === '/api/auth/logout') return ok(null);
    if (path === '/api/me') return ok({ accountId: model.account, nickname: model.account, employeeNumber: model.account, jobRoles: ['FRONT_DESK'], access: { permissions: model.permitted ? ['ORDER_CREATE', 'ORDER_CUSTOMER_READ', 'ORDER_AMOUNT_READ'] : [], uiCapabilities: [] } });
    if (path === '/api/orders/stream') return route.fulfill({ status: 503 });
    if (path === '/api/orders/calendar') return ok([]);
    if (path === '/api/orders/workbench') return ok({ date: '2026-11-04', metrics: null, pendingOrders: [] });
    if (path === '/api/orders/workbench/payment-summary') return ok({ date: '2026-11-04', totalOrderCount: 0, waitingDeliveryOrderCount: 0, paidWithoutDateOrderCount: 0,
      paid: { orderCount: 0, amountCents: '0', missingAmountOrderCount: 0 }, unpaid: { orderCount: 0, amountCents: '0', missingAmountOrderCount: 0 } });
    if (path === '/api/orders/workbench/receipt-summary') return ok({ date: '2026-11-04', orderCount: 0, amountCents: '0', missingAmountOrderCount: 0 });
    if (path === '/api/orders/workbench/cake-bases') return ok({ date: '2026-11-04', items: [] });
    if (path === '/api/orders/recognition/parse') return ok({
      fields: { customerName: { value: '识别姓名', source: 'RULE', needsReview: false, evidence: [], issues: [] }, phone: { value: '13900000000', source: 'RULE', needsReview: true, evidence: [], issues: [] } },
      items: [], issues: [], fragments: [], unmappedText: [], assistAvailable: false,
    });
    if (path === '/api/order-packages') return ok({ items: [], total: 0, page: 1, size: 20 });
    if (path === '/api/orders' && req.method() === 'POST') {
      const id = req.headers()['idempotency-key'], body = req.postDataJSON();
      model.requests.push({ id, body });
      if (model.reject) return route.fulfill({ status: 400, json: { success: false, code: 'VALIDATION_FAILED' } });
      if (!model.orders.has(id)) model.orders.set(id, { ...body, orderId: 'order-one', orderNo: 'TEST-001', version: 1, status: 'WAITING_PRODUCTION', currentStageCode: null, paymentStatus: 'UNPAID' });
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
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: '放弃草稿', exact: true }).click();
    assert.ok(await saved(page));
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '放弃草稿', exact: true }).click();
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
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '放弃并新建' }).click();
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
    const original = await saved(page);
    assert.ok(Object.keys(original.editor.feedback).length);
    await page.reload();
    await page.getByRole('button', { name: '继续填写' }).click();
    assert.equal(await page.locator('#customerName').inputValue(), '手工姓名');
    assert.deepEqual((await saved(page)).editor.feedback, original.editor.feedback);
    await page.getByText('粘贴下单信息', { exact: true }).click();
    await page.getByRole('button', { name: '识别并填入', exact: true }).click();
    await waitFor(async () => await page.getByText('已填入', { exact: false }).count() > 0);
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
