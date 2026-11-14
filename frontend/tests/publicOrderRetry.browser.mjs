import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DRAFT_TEST_URL || 'http://127.0.0.1:5197';
const receipt = suffix => {
  const submissionId = `20000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
  return { submissionId, submissionNo: `F${submissionId}` };
};
const storageKey = 'wuhou:public-submission:v1:retry';
const readPending = page => page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), storageKey);
async function complete(page) {
  await page.locator('#phone').fill('13800000000');
  await page.locator('#address').fill('测试地址');
  await page.locator('[id="items.0.size"]').fill('6');
  await page.locator('#requestedReceiveAt').click();
  await page.getByRole('button', { name: '今天', exact: true }).click();
  await page.locator('[data-control-label="配送员取货时间小时"] button').click();
  await page.getByRole('option', { name: '18 时', exact: true }).click();
}

test('客户填单校验失败后可修改，响应丢失后重试始终使用原请求', async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.DRAFT_BROWSER_CHANNEL || 'chrome' });
  try {
    const page = await browser.newPage();
    const attempts = [];
    const path = '**/api/public/order-entries/retry';
    await page.route(path, route => route.fulfill({ json: { success: true, data: { ownerName: '测试客服' } } }));
    await page.route(path + '/submissions', route => {
      const request = route.request();
      attempts.push({ key: request.headers()['idempotency-key'], body: request.postData() });
      if (attempts.length === 1) return route.fulfill({ status: 400, json: { success: false, code: 'VALIDATION_FAILED' } });
      if (attempts.length === 2) return route.abort('failed');
      if (attempts.length === 3) return route.fulfill({ status: 429, json: { success: false, code: 'SUBMISSION_THROTTLED' } });
      return route.fulfill({ status: 201, json: { success: true, data: receipt(attempts.length === 4 ? 1 : 2) } });
    });

    const phone = page.locator('#phone');
    const submit = page.getByRole('button', { name: '提交预订', exact: true });
    const retry = page.getByRole('button', { name: '重试提交', exact: true });
    const uncertain = page.getByText(/原提交结果仍待确认/);
    await page.goto(`${base}/#/fill/retry`);
    await complete(page);
    await submit.click();
    await page.getByText('填写内容不符合要求，请检查后重试。').waitFor();
    assert.equal(await readPending(page), null);
    await phone.fill('13900000000');
    await submit.click();
    await uncertain.waitFor();
    assert.equal(await phone.isDisabled(), true);
    await page.reload();
    await uncertain.waitFor();
    assert.equal(await phone.inputValue(), '13900000000');
    assert.equal(attempts.length, 2);

    await retry.click();
    await page.getByText('提交过于频繁，请稍后再试。').waitFor();
    assert.equal(await uncertain.isVisible(), true);
    assert.equal(await phone.isDisabled(), true);
    await retry.click();
    await page.getByText(`填单编号：${receipt(1).submissionNo}`).waitFor();
    assert.equal(await readPending(page), null);
    assert.ok(attempts[1].key);
    assert.notEqual(attempts[0].key, attempts[1].key);
    assert.equal(JSON.parse(attempts[1].body).phone, '13900000000');
    assert.deepEqual(attempts.slice(1), Array(3).fill(attempts[1]));

    await page.getByRole('button', { name: '再填一单', exact: true }).click();
    await complete(page);
    await submit.click();
    await page.getByText(`填单编号：${receipt(2).submissionNo}`).waitFor();
    assert.ok(attempts[4].key);
    assert.notEqual(attempts[4].key, attempts[1].key);
  } finally { await browser.close(); }
});

test('扫码重试保留原键，入口检查超时或 503 后仍可恢复', async t => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const path = '**/api/public/order-entries/retry';
  const attempts = [];
  const held = Promise.withResolvers();
  const heldRead = Promise.withResolvers();
  t.after(() => heldRead.resolve());
  let enabled = true;
  let entryReads = 0, entryResponse = 'normal';
  const inactive = { status: 404, json: { success: false, code: 'ENTRY_UNAVAILABLE' } };
  await page.route('**/api/public/order-entries/*', async route => {
    entryReads++;
    if (entryResponse === 'hang') {
      await heldRead.promise;
      return route.abort().catch(() => {});
    }
    if (entryResponse === '503')
      return route.fulfill({ status: 503, json: { success: false, code: 'SERVICE_UNAVAILABLE' } });
    return route.fulfill(enabled ? { json: { success: true, data: { ownerName: '客服' } } } : inactive);
  });
  await page.route(path + '/submissions', async route => {
    const attempt = { key: route.request().headers()['idempotency-key'], content: route.request().postDataJSON() };
    attempts.push(attempt);
    if (attempts.length === 1) {
      assert.deepEqual(await readPending(page), attempt);
      await held.promise;
      return route.abort().catch(() => {});
    }
    if (attempts.length === 2) return route.fulfill({ status: 201, json: { success: true, data: { submissionNo: receipt(1).submissionNo } } });
    if (attempts.length === 3) return route.fulfill({ status: 201, json: { success: true, data: { ...receipt(1), submissionNo: receipt(2).submissionNo } } });
    if (attempts.length === 4) { enabled = false; return route.fulfill(inactive); }
    return route.fulfill({ status: 201, json: { success: true, data: receipt(1) } });
  });
  await page.clock.install();
  await page.goto(`${base}/#/fill/retry`);
  await complete(page);
  const submit = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/submissions'));
  await page.getByRole('button', { name: '提交预订', exact: true }).click();
  await submit;
  await page.clock.fastForward(30_001);
  await page.getByText('提交超时，暂未收到填单回执。', { exact: true }).waitFor();
  held.resolve();
  await page.goto(`${base}/#/fill/other`);
  await page.getByRole('button', { name: '提交预订', exact: true }).waitFor();
  assert.equal(await page.locator('#phone').inputValue(), '');
  await page.goto(`${base}/#/fill/retry`);
  const retry = page.getByRole('button', { name: '重试提交', exact: true });
  for (let count = 2; count <= 3; count++) {
    await retry.click();
    await page.getByText('未收到有效的填单回执。', { exact: true }).waitFor();
    assert.equal(attempts.length, count);
    assert.deepEqual(await readPending(page), attempts[0]);
  }
  await retry.click();
  await page.getByText('填写入口暂不可用。请联系发码客服核对原填单。').waitFor();
  assert.equal(await retry.isDisabled(), true);
  await page.getByText('填写入口已停用或失效，请联系发送二维码的客服。').waitFor();
  const check = page.getByRole('button', { name: '重试', exact: true });
  const readsBeforeCheck = entryReads;
  entryResponse = 'hang';
  await check.click();
  await page.getByText('正在检查填写入口…', { exact: true }).waitFor();
  assert.equal(await check.count(), 0);
  assert.equal(await retry.isDisabled(), true);
  await page.clock.fastForward(30_001);
  await page.getByText('读取超时，当前资料可能不是最新的，请重试', { exact: false }).waitFor();
  heldRead.resolve();
  assert.equal(entryReads, readsBeforeCheck + 1);
  entryResponse = '503';
  await check.click();
  await page.getByText('服务暂时不可用，请稍后重试。', { exact: false }).waitFor();
  assert.equal(await page.getByText('填写入口已停用或失效，请联系发送二维码的客服。').count(), 0);
  assert.equal(await retry.isDisabled(), true);
  assert.deepEqual(await readPending(page), attempts[0]);
  enabled = true;
  entryResponse = 'normal';
  await check.click();
  await page.getByText('填写入口暂不可用。请联系发码客服核对原填单。').waitFor({ state: 'detached' });
  assert.equal(attempts.length, 4);
  assert.deepEqual(await readPending(page), attempts[0]);
  await retry.click();
  await page.getByText(`填单编号：${receipt(1).submissionNo}`).waitFor();
  assert.deepEqual(attempts, Array(5).fill(attempts[0]));
  assert.equal(await readPending(page), null);
});

test('浏览器存储不可用时仍可在当前页面用原请求重试', async t => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const attempts = [];
  await page.addInitScript(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('wuhou:public-submission:')) throw new DOMException('测试配额', 'QuotaExceededError');
      return write.call(this, key, value);
    };
  });
  await page.route('**/api/public/order-entries/retry', route => route.fulfill({ json: { success: true, data: { ownerName: '客服' } } }));
  await page.route('**/api/public/order-entries/retry/submissions', route => {
    attempts.push([route.request().headers()['idempotency-key'], route.request().postData()]);
    return attempts.length === 1 ? route.abort() : route.fulfill({ status: 201, json: { success: true, data: receipt(3) } });
  });
  await page.goto(`${base}/#/fill/retry`);
  await complete(page);
  await page.getByRole('button', { name: '提交预订' }).click();
  await page.getByText('浏览器暂存不可用，本次只能在当前页面重试。').waitFor();
  await page.getByRole('button', { name: '重试提交' }).click();
  await page.getByText(`填单编号：${receipt(3).submissionNo}`).waitFor();
  assert.deepEqual(attempts[0], attempts[1]);
});
