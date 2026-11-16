import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { createOrderFixture, orderId } from './orderBrowserFixture.mjs';
import { testJwt } from './testJwt.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DRAFT_TEST_URL || 'http://127.0.0.1:5197';
const ok = (route, data) => route.fulfill({ json: { success: true, data } });
const fail = (route, status, code) => route.fulfill({ status, json: { success: false, code } });
let browser;
before(async () => { browser = await chromium.launch({ headless: true, channel: 'chrome' }); });
after(async () => { await browser?.close(); });

test('共享 Cookie 换员工后旧标签页不重发订单修改且必须重新登录', async () => {
  const fixture = await createOrderFixture(browser, base);
  const { context, page, model, errors } = fixture;
  try {
    await fixture.complete();
    await page.getByRole('button', { name: '创建订单', exact: true }).click();
    await page.waitForURL('**/#/?date=*');
    await page.evaluate(() => { location.hash = '#/orders/new'; });
    await page.locator('#customerName').fill('员工 A 的录单草稿');
    const alice = testJwt('test', { sub: 'alice' });
    const bob = testJwt('login', { sub: 'bob', sid: 'bob-session' });
    const formerWrites = [], refreshes = [];
    let expireAlice = false;
    await context.addCookies([{ name: 'wuhoucake_refresh', value: 'alice', domain: new URL(base).hostname, path: '/api/auth', httpOnly: true }]);
    await context.route('**/api/auth/refresh', async route => {
      const cookie = await route.request().headerValue('cookie') ?? '';
      refreshes.push(cookie);
      return cookie.includes('wuhoucake_refresh=bob') ? ok(route, { accessToken: bob, expiresIn: 3600 }) : fail(route, 401, 'AUTHENTICATION_FAILED');
    });
    await context.route('**/api/auth/login', route => {
      assert.equal(route.request().postDataJSON().employeeNumber, 'BOB');
      return route.fulfill({ headers: { 'set-cookie': 'wuhoucake_refresh=bob; Path=/api/auth; HttpOnly' },
        json: { success: true, data: { accessToken: bob, expiresIn: 3600 } } });
    });
    await context.route('**/api/me', route => {
      const isBob = route.request().headers().authorization === `Bearer ${bob}`;
      return ok(route, { accountId: isBob ? 'bob' : 'alice', nickname: isBob ? '员工 B' : '员工 A', jobRoles: ['FRONT_DESK'],
        access: { permissions: model.permissions, uiCapabilities: [] } });
    });
    await context.route(`**/api/orders/${orderId}/information`, route => {
      const bearer = route.request().headers().authorization;
      assert.ok(expireAlice);
      if (route.request().frame().page() === page) formerWrites.push(bearer);
      if (bearer === `Bearer ${alice}`) return fail(route, 401, 'AUTHENTICATION_FAILED');
      model.order = { ...model.order, version: model.order.version + 1, customer: { ...model.order.customer, phone: route.request().postDataJSON().changes.phone } };
      return ok(route, model.order);
    });
    await page.evaluate(id => { location.hash = '#/orders/' + id; }, orderId);
    await page.getByRole('button', { name: '编辑资料', exact: true }).click();
    await page.locator('#edit-phone').fill('13900008888');
    const second = await context.newPage();
    await second.goto(`${base}/#/orders/${orderId}`);
    await second.getByLabel('员工工号').fill('BOB');
    await second.locator('input[name="password"]').fill('test-password');
    await second.getByRole('button', { name: '登录工作台' }).click();
    await second.getByText('员工 B', { exact: true }).waitFor();
    expireAlice = true;
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await page.getByText('当前标签页的登录会话已变更，请重新登录。').waitFor();
    await page.getByRole('heading', { name: '员工登录', exact: true }).waitFor();
    assert.deepEqual(formerWrites, [`Bearer ${alice}`]);
    assert.ok(refreshes.some(cookie => cookie.includes('wuhoucake_refresh=bob')));
    assert.equal(model.order.customer.phone, '13800000000');
    assert.equal((await fixture.saved()).value.customerName, '员工 A 的录单草稿');
    await second.getByRole('button', { name: '编辑资料', exact: true }).click();
    await second.locator('#edit-phone').fill('13900009999');
    const savedByBob = second.waitForResponse(response => response.url().endsWith('/information') && response.ok());
    await second.getByRole('button', { name: '保存修改', exact: true }).click();
    await savedByBob;
    assert.equal(model.order.customer.phone, '13900009999');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

const submissionId = '20000000-0000-4000-8000-000000000001';
const ownerId = '30000000-0000-4000-8000-000000000001';
const phone = '13700008888';
const address = '合成配送地址';
const amount = '128.00';
const original = { phone, memberPhone: null, fulfillmentType: 'DELIVERY', address, requestedReceiveAt: '2026-11-30T10:00:00Z',
  items: [{ itemId: orderId, name: '合成蛋糕', productType: 'CAKE', quantity: 1, attributes: { size: '6' } }] };
const detail = { submission: { id: submissionId, ownerId, ownerName: '合成客服', version: 1, status: 'PENDING',
  original, reviewed: { content: original, totalAmountCents: 12800, creditedEmployeeId: ownerId, plannedHandoffAt: original.requestedReceiveAt, plannedFinishAt: '2026-11-30T09:00:00Z' },
  createdAt: '2026-11-13T10:00:00Z' }, duplicates: [], duplicateCheckToken: 'test',
  activities: [{ id: 1, type: 'REVIEWED', actorName: '合成审核历史', createdAt: '2026-11-13T10:00:00Z', details: {} }] };
const detailPath = `**/api/customer-submissions/${submissionId}`;

test('填单深链接等待账号权限，无权时不请求详情', async t => {
  const { context, page, model } = await submissionFixture(t);
  let reads = 0;
  const profile = Promise.withResolvers();
  await context.route('**/api/me', async route => {
    await profile.promise;
    return ok(route, { accountId: model.account, nickname: '合成测试', jobRoles: ['DECORATOR'], access: { permissions: ['ORDER_READ'], uiCapabilities: [] } });
  });
  await context.route(detailPath, route => { reads++; return ok(route, detail); });
  const waitingForProfile = page.waitForRequest(request => request.url().endsWith('/api/me'));
  await page.goto(`${base}/?case=denied#/customer-submissions/${submissionId}`);
  await waitingForProfile;
  assert.equal(reads, 0);
  profile.resolve();
  await page.getByText('当前账号不能查看客户填单。', { exact: true }).waitFor();
  assert.equal(reads, 0);
  assert.equal(await page.locator('#phone').count(), 0);
});

async function submissionFixture(t) {
  const fixture = await createOrderFixture(browser, base);
  const { context, page, model } = fixture;
  t.after(() => context.close());
  model.permissions.push('CUSTOMER_SUBMISSION_PROCESS', 'EMPLOYEE_DIRECTORY_READ');
  await context.route('**/api/employees/options**', route => ok(route, [{ accountId: ownerId, nickname: '合成员工', employeeNumber: 'T001', status: 'ACTIVE' }]));
  await page.clock.install();
  return fixture;
}

async function openSubmission(page, errors) {
  await page.goto(`${base}/?case=submission#/customer-submissions/${submissionId}`);
  await page.getByRole('heading', { name: '客服核对结果' }).waitFor().catch(async error => {
    throw new Error(`填单详情未打开，页面错误 ${JSON.stringify(errors)}，正文 ${await page.locator('body').innerText()}`, { cause: error });
  });
  assert.equal(await page.locator('#phone').inputValue(), phone);
  assert.equal(await page.locator('#totalAmount').inputValue(), amount);
  await page.getByText('合成审核历史').waitFor();
}

for (const [status, code, message] of [[403, 'FORBIDDEN', '当前账号不能查看客户填单。'],
  [404, 'SUBMISSION_NOT_FOUND', '填单不存在，请返回列表重新查看。']]) {
  test(`详情轮询收到 ${status} 后清除敏感展示并忽略迟到写入响应`, async t => {
    const { context, page, model, errors } = await submissionFixture(t);
    let denied = false, releaseWrite, profileReads = 0;
    await context.route('**/api/me', route => {
      profileReads++;
      return ok(route, { accountId: model.account, nickname: '合成测试', jobRoles: ['FRONT_DESK'], access: {
        permissions: denied && status === 403 ? model.permissions.filter(permission => permission !== 'CUSTOMER_SUBMISSION_PROCESS') : model.permissions, uiCapabilities: [] } });
    });
    await context.route(detailPath, route => {
      if (route.request().method() === 'PATCH') return new Promise(resolve => {
        releaseWrite = async () => { await ok(route, detail); resolve(); };
      });
      return denied ? fail(route, status, code) : ok(route, detail);
    });
    await openSubmission(page, errors);
    const writing = page.waitForRequest(request => request.method() === 'PATCH' && request.url().endsWith(submissionId));
    await page.getByRole('button', { name: '暂存核对结果' }).click();
    await writing;
    const readsBeforeDenial = profileReads;
    denied = true;
    const rejectedRead = page.waitForResponse(response => response.status() === status && response.request().method() === 'GET' && response.url().endsWith(submissionId));
    await page.clock.runFor(16_000);
    await rejectedRead;
    if (status === 403) await page.getByText(message, { exact: true }).waitFor();
    else await page.getByRole('alert').filter({ hasText: message }).waitFor();
    assert.ok(releaseWrite);
    const lateWrite = page.waitForResponse(response => response.ok() && response.request().method() === 'PATCH' && response.url().endsWith(submissionId));
    await releaseWrite();
    await lateWrite;
    await page.clock.runFor(100);
    assert.equal(await page.getByText(phone, { exact: true }).count(), 0);
    assert.equal(await page.getByText(address, { exact: true }).count(), 0);
    assert.equal(await page.getByText('合成审核历史', { exact: true }).count(), 0);
    assert.equal(await page.locator('#totalAmount').count(), 0);
    assert.equal(await page.getByRole('button', { name: '确认接单' }).count(), 0);
    assert.equal(profileReads - readsBeforeDenial, status === 403 ? 1 : 0);
    assert.deepEqual(errors, []);
  });
}

test('确认被拒但详情可读，后续读取 503 仍保留核对草稿', async t => {
  const { context, page, errors } = await submissionFixture(t);
  let detailReads = 0, unavailable = false;
  await context.route(detailPath, route => {
    detailReads++;
    return unavailable ? fail(route, 503, 'SERVICE_UNAVAILABLE') : ok(route, detail);
  });
  await context.route(detailPath + '/confirm', route => fail(route, 403, 'FORBIDDEN'));
  await openSubmission(page, errors);
  const reread = page.waitForResponse(response => response.request().method() === 'GET' && response.url().endsWith(submissionId));
  await page.getByRole('button', { name: '确认接单' }).click();
  await reread;
  await page.getByText('当前账号不能执行此操作。', { exact: true }).waitFor();
  assert.ok(detailReads >= 2);
  await page.locator('#address').fill('未保存核对地址');
  unavailable = true;
  const failed = page.waitForResponse(response => response.status() === 503 && response.url().endsWith(submissionId));
  await page.clock.fastForward(15_001);
  await failed;
  await page.clock.fastForward(3000);
  assert.equal(await page.locator('#address').inputValue(), '未保存核对地址');
  assert.ok(await page.getByRole('button', { name: '暂存核对结果' }).isEnabled());
  assert.deepEqual(errors, []);
});
