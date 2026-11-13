import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DRAFT_TEST_URL || 'http://127.0.0.1:5197';

test('首次登录拦截录单页面，改密失败可修正，成功后必须重新登录', { timeout: 45000 }, async t => {
  const browser = await chromium.launch({ headless: true, channel: process.env.DRAFT_BROWSER_CHANNEL || 'chrome' });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
  page.setDefaultTimeout(10000);
  const initialPassword = 'Sample-Old-008';
  const newPassword = 'Sample-New-009';
  let changed = false;
  const logins = [];
  const prematureOrderRequests = [];
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const ok = data => route.fulfill({ json: { success: true, data } });
    const fail = (status, code) => route.fulfill({ status, json: { success: false, code } });
    if (path === '/api/auth/csrf') return route.fulfill({
      headers: { 'set-cookie': 'XSRF-TOKEN=test; Path=/' },
      json: { success: true, data: { headerName: 'X-XSRF-TOKEN' } },
    });
    if (path === '/api/auth/refresh') return fail(401, 'AUTHENTICATION_FAILED');
    if (path === '/api/auth/login') {
      const { employeeNumber, password } = request.postDataJSON();
      logins.push({ employeeNumber, password });
      if (employeeNumber !== '0002' || password !== (changed ? newPassword : initialPassword)) return fail(401, 'AUTHENTICATION_FAILED');
      return ok({ accessToken: changed ? 'normal-token' : 'restricted-token', expiresIn: 3600, passwordChangeRequired: !changed });
    }
    if (path === '/api/me/password') {
      const { currentPassword, newPassword: submitted } = request.postDataJSON();
      if (currentPassword !== initialPassword) return fail(400, 'CURRENT_PASSWORD_INCORRECT');
      if (submitted !== newPassword) return fail(400, 'BAD_REQUEST');
      changed = true;
      return ok(null);
    }
    if (path === '/api/me') return ok({
      accountId: 'staff-sample', employeeNumber: '0002', nickname: '测试前台', systemRole: 'STAFF', jobRoles: ['FRONT_DESK'],
      access: { permissions: ['ORDER_CREATE', 'ORDER_CUSTOMER_READ', 'ORDER_AMOUNT_READ'], uiCapabilities: [] },
    });
    if (request.headers().authorization !== 'Bearer normal-token') prematureOrderRequests.push(path);
    if (path === '/api/orders/stream') return route.fulfill({ contentType: 'text/event-stream', body: 'event: ready\ndata: {}\n\n' });
    if (path === '/api/order-packages') return ok({ items: [], total: 0, page: 1, size: 20 });
    if (path === '/api/employees/options') return ok([]);
    return fail(404, 'NOT_FOUND');
  });

  await page.goto(base + '/#/orders/new');
  const login = page.getByRole('heading', { name: '员工登录' });
  const loginButton = page.getByRole('button', { name: '登录工作台' });
  const orderForm = page.getByRole('heading', { name: '订单信息' });
  await login.waitFor();
  await page.getByLabel('员工工号').fill('0002');
  await page.getByLabel('登录密码').fill(initialPassword);
  await loginButton.click();

  await page.getByRole('heading', { name: '设置新密码' }).waitFor();
  assert.equal(await orderForm.isVisible(), false);
  await page.getByLabel('当前密码', { exact: true }).fill('incorrect');
  await page.getByLabel('新密码', { exact: true }).fill(newPassword);
  await page.getByLabel('确认新密码').fill(newPassword);
  const save = page.getByRole('button', { name: '保存新密码' });
  await save.click();
  await page.getByRole('alert').filter({ hasText: '当前密码不正确' }).waitFor();
  assert.equal(await orderForm.isVisible(), false);
  await page.getByLabel('当前密码', { exact: true }).fill(initialPassword);
  await save.click();

  await login.waitFor();
  await page.getByRole('status').filter({ hasText: '请使用新密码重新登录' }).waitFor();
  assert.equal(await orderForm.isVisible(), false);
  assert.equal(logins.length, 1);
  await page.getByLabel('员工工号').fill('0002');
  await page.getByLabel('登录密码').fill(newPassword);
  await loginButton.click();
  await orderForm.waitFor();
  assert.deepEqual(logins, [{ employeeNumber: '0002', password: initialPassword }, { employeeNumber: '0002', password: newPassword }]);
  assert.deepEqual(prematureOrderRequests, []);
});
