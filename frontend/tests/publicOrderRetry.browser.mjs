import { testBrowserChannel, closeTestBrowser, openTestPage, openTestContext } from './browserTrace.mjs';
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
const readPending = page => page.evaluate(async sessionKey => {
  const legacy = JSON.parse(sessionStorage.getItem(sessionKey));
  if (legacy) return { key: legacy.key, content: legacy.content };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('retry'));
  const key = 'public-submission:' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('wuhou-order-edits', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction('drafts').objectStore('drafts').get(key);
      request.onsuccess = () => { db.close(); resolve(request.result?.value.pending ?? null); };
      request.onerror = () => { db.close(); reject(request.error); };
    };
  });
}, storageKey);
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
  const browser = await chromium.launch({ headless: true, channel: testBrowserChannel() });
  try {
    const context = await openTestContext(browser);
    let page = await context.newPage();
    const attempts = [];
    const path = '**/api/public/order-entries/retry';
    await context.route(path, route => route.fulfill({ json: { success: true, data: { ownerName: '测试客服' } } }));
    await context.route(path + '/submissions', route => {
      const request = route.request();
      attempts.push({ key: request.headers()['idempotency-key'], body: request.postData() });
      if (attempts.length === 1) return route.fulfill({ status: 400, json: { success: false, code: 'VALIDATION_FAILED' } });
      if (attempts.length === 2) return route.abort('failed');
      if (attempts.length === 3) return route.fulfill({ status: 429, json: { success: false, code: 'SUBMISSION_THROTTLED' } });
      return route.fulfill({ status: 201, json: { success: true, data: receipt(attempts.length === 4 ? 1 : 2) } });
    });

    const phone = () => page.locator('#phone');
    const submit = () => page.getByRole('button', { name: '提交预订', exact: true });
    const retry = () => page.getByRole('button', { name: '重试提交', exact: true });
    const uncertain = () => page.getByText(/原提交结果仍待确认/);
    await page.goto(`${base}/#/fill/retry`);
    await complete(page);
    await submit().click();
    await page.getByText('填写内容不符合要求，请检查后重试。').waitFor();
    assert.equal(await readPending(page), null);
    await phone().fill('13900000000');
    await submit().click();
    await uncertain().waitFor();
    assert.equal(await phone().isDisabled(), true);
    await page.close();
    page = await context.newPage();
    await page.goto(`${base}/#/fill/retry`);
    await page.getByRole('button', { name: '恢复草稿' }).click();
    await uncertain().waitFor();
    assert.equal(await phone().inputValue(), '13900000000');
    assert.equal(attempts.length, 2);

    await retry().click();
    await page.getByText('提交过于频繁，请稍后再试。').waitFor();
    assert.equal(await uncertain().isVisible(), true);
    assert.equal(await phone().isDisabled(), true);
    await retry().click();
    await page.getByText(`填单编号：${receipt(1).submissionNo}`).waitFor();
    assert.equal(await readPending(page), null);
    assert.ok(attempts[1].key);
    assert.notEqual(attempts[0].key, attempts[1].key);
    assert.equal(JSON.parse(attempts[1].body).phone, '13900000000');
    assert.deepEqual(attempts.slice(1), Array(3).fill(attempts[1]));

    await page.getByRole('button', { name: '再填一单', exact: true }).click();
    await complete(page);
    await submit().click();
    await page.getByText(`填单编号：${receipt(2).submissionNo}`).waitFor();
    assert.ok(attempts[4].key);
    assert.notEqual(attempts[4].key, attempts[1].key);
  } finally { await closeTestBrowser(browser); }
});

test('扫码重试保留原键，入口检查超时或 503 后仍可恢复', async t => {
  const browser = await chromium.launch({ headless: true, channel: testBrowserChannel() });
  t.after(() => closeTestBrowser(browser));
  const page = await openTestPage(browser);
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
  await page.getByRole('button', { name: '恢复草稿' }).click();
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

test('浏览器存储不可用时，明确拒绝后保留输入，断线后以原请求重试', async t => {
  const browser = await chromium.launch({ headless: true, channel: testBrowserChannel() });
  t.after(() => closeTestBrowser(browser));
  const page = await openTestPage(browser);
  const attempts = [];
  await page.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = (name, version) => {
      if (name === 'wuhou-order-edits') throw new DOMException('测试配额', 'QuotaExceededError');
      return open(name, version);
    };
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('wuhou:public-submission:')) throw new DOMException('测试配额', 'QuotaExceededError');
      return write.call(this, key, value);
    };
  });
  await page.route('**/api/public/order-entries/retry', route => route.fulfill({ json: { success: true, data: { ownerName: '客服' } } }));
  await page.route('**/api/public/order-entries/retry/items/**', route => route.request().method() === 'POST'
    ? route.fulfill({ json: { success: true, data: route.request().url().split('/').at(-1) } })
    : route.fulfill({ status: 404, json: { success: false, code: 'IMAGE_NOT_FOUND' } }));
  await page.route('**/api/public/order-entries/retry/images/status', route =>
    route.fulfill({ json: { success: true, data: route.request().postDataJSON().map(row => row.imageId) } }));
  await page.route('**/api/public/order-entries/retry/submissions', route => {
    attempts.push([route.request().headers()['idempotency-key'], route.request().postData()]);
    if (attempts.length === 1) return route.fulfill({ status: 400, json: { success: false, code: 'VALIDATION_FAILED' } });
    if (attempts.length === 2) return route.abort();
    if (attempts.length === 4 || attempts.length === 5) return route.fulfill({ status: 404, json: { success: false, code: 'IMAGE_NOT_FOUND' } });
    return route.fulfill({ status: 201, json: { success: true, data: receipt(attempts.length === 3 ? 3 : 4) } });
  });
  await page.goto(`${base}/#/fill/retry`);
  await complete(page);
  const submit = page.getByRole('button', { name: '提交预订', exact: true });
  await submit.click();
  await page.getByText('填写内容不符合要求，请检查后重试。').waitFor();
  assert.equal(await page.getByRole('button', { name: '放弃重试' }).count(), 0);
  assert.equal(await page.locator('#phone').inputValue(), '13800000000');
  assert.equal(await page.locator('#address').inputValue(), '测试地址');
  await page.locator('#phone').fill('13900000000');
  await submit.click();
  await page.getByText(/原提交结果仍待确认/).waitFor();
  await page.getByRole('button', { name: '重试提交' }).click();
  await page.getByText(`填单编号：${receipt(3).submissionNo}`).waitFor();
  assert.notEqual(attempts[0][0], attempts[1][0]);
  assert.deepEqual(attempts[1], attempts[2]);
  assert.deepEqual(JSON.parse(attempts[1][1]), { ...JSON.parse(attempts[0][1]), phone: '13900000000' });
  await page.getByRole('button', { name: '再填一单' }).click();
  assert.equal(await page.locator('#phone').inputValue(), '');
  await complete(page);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=', 'base64');
  await page.locator('.submission-item-images input[type=file]').setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: png });
  await page.getByText('1 / 5 张').waitFor();
  await submit.click();
  await page.getByText('图片已保留，请再次提交。', { exact: true }).waitFor();
  assert.equal(await page.locator('#phone').isEditable(), true);
  await page.getByRole('button', { name: '移除', exact: true }).click();
  await submit.click();
  await page.getByText(`填单编号：${receipt(4).submissionNo}`).waitFor();
  assert.deepEqual(attempts[3], attempts[4]);
  assert.notEqual(attempts[3][0], attempts[5][0]);
});

test('已有扫码草稿时，待确认记录写入失败不会发送请求', async t => {
  const browser = await chromium.launch({ headless: true, channel: testBrowserChannel() });
  t.after(() => closeTestBrowser(browser));
  const context = await openTestContext(browser);
  const path = '**/api/public/order-entries/retry';
  let page = await context.newPage();
  const attempts = [];
  await context.route(path, route => route.fulfill({ json: { success: true, data: { ownerName: '客服' } } }));
  await context.route(path + '/submissions', async route => {
    const request = route.request();
    const attempt = { key: request.headers()['idempotency-key'], content: request.postDataJSON() };
    attempts.push(attempt);
    assert.deepEqual(await readPending(page), attempt);
    return attempts.length === 1 ? route.abort() : route.fulfill({ status: 201, json: { success: true, data: receipt(4) } });
  });
  await page.goto(`${base}/#/fill/retry`);
  await complete(page);
  await page.getByText(/草稿已保存在本机/).waitFor();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (record, key) {
      if (record.value?.pending) throw new DOMException('测试配额', 'QuotaExceededError');
      return put.call(this, record, key);
    };
  });
  await page.getByRole('button', { name: '提交预订', exact: true }).click();
  await page.getByText(/本次未发送/).waitFor();
  assert.equal(attempts.length, 0);
  assert.equal(await page.locator('#phone').isEditable(), true);
  assert.equal(await page.evaluate(key => sessionStorage.getItem(key), storageKey), null);
  await page.close();

  page = await context.newPage();
  await page.goto(`${base}/#/fill/retry`);
  await page.getByRole('button', { name: '恢复草稿' }).click();
  assert.equal(await page.locator('#phone').inputValue(), '13800000000');
  assert.equal(await page.locator('#address').inputValue(), '测试地址');
  await page.getByRole('button', { name: '提交预订', exact: true }).click();
  await page.getByText(/原提交结果仍待确认/).waitFor();
  assert.equal(attempts.length, 1);
  await page.close();

  page = await context.newPage();
  await page.goto(`${base}/#/fill/retry`);
  await page.getByRole('button', { name: '恢复草稿' }).click();
  await page.getByRole('button', { name: '重试提交' }).click();
  await page.getByText(`填单编号：${receipt(4).submissionNo}`).waitFor();
  assert.deepEqual(attempts, [attempts[0], attempts[0]]);
});

test('旧版会话记录恢复后仍可用原请求取回回执', async t => {
  const browser = await chromium.launch({ headless: true, channel: testBrowserChannel() });
  t.after(() => closeTestBrowser(browser));
  const page = await openTestPage(browser);
  const path = '**/api/public/order-entries/retry';
  const legacy = { key: '20000000-0000-4000-8000-000000000088', content: {
    phone: '13800000000', memberPhone: null, address: null, fulfillmentType: 'PICKUP',
    requestedReceiveAt: '2026-11-17T10:00:00Z',
    items: [{ name: '合成蛋糕', quantity: 1, productType: 'CAKE', attributes: { size: '6' } }],
  } };
  const attempts = [];
  await page.route(path, route => route.fulfill({ json: { success: true, data: { ownerName: '客服' } } }));
  await page.route(path + '/submissions', route => {
    attempts.push({ key: route.request().headers()['idempotency-key'], content: route.request().postDataJSON() });
    return route.fulfill({ status: 201, json: { success: true, data: receipt(5) } });
  });
  await page.goto(`${base}/#/fill/retry`);
  await page.locator('#phone').waitFor();
  await page.evaluate(([key, value]) => sessionStorage.setItem(key, JSON.stringify(value)), [storageKey, legacy]);
  await page.reload();
  await page.getByRole('button', { name: '重试提交' }).click();
  await page.getByText(`填单编号：${receipt(5).submissionNo}`).waitFor();
  assert.deepEqual(attempts, [legacy]);
  assert.equal(await page.evaluate(key => sessionStorage.getItem(key), storageKey), null);
});

test('会话存储恢复读取后保留旧提交键，明确恢复原提交前不发送新请求', async t => {
  const browser = await chromium.launch({ headless: true, channel: testBrowserChannel() });
  t.after(() => closeTestBrowser(browser));
  const page = await openTestPage(browser);
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  const path = '**/api/public/order-entries/retry';
  const legacy = { key: '20000000-0000-4000-8000-000000000088', content: {
    phone: '13800000000', memberPhone: null, address: null, fulfillmentType: 'PICKUP',
    requestedReceiveAt: '2026-11-17T10:00:00Z',
    items: [{ name: '原填单', quantity: 1, productType: 'CAKE', attributes: { size: '6' } }],
  } };
  const attempts = [];
  await page.addInitScript(([key, value]) => {
    sessionStorage.setItem(key, JSON.stringify(value));
    Object.defineProperty(window, 'indexedDB', { get() { throw new DOMException('测试暂存不可用', 'SecurityError'); } });
    const getItem = Storage.prototype.getItem;
    window.failedSessionReadsRemaining = Infinity;
    Storage.prototype.getItem = function (name) {
      if (name === key && window.failedSessionReadsRemaining > 0) {
        window.failedSessionReadsRemaining--;
        throw new DOMException('测试会话读取失败', 'SecurityError');
      }
      return getItem.call(this, name);
    };
  }, [storageKey, legacy]);
  await page.route(path, route => route.fulfill({ json: { success: true, data: { ownerName: '客服' } } }));
  await page.route(path + '/submissions', route => {
    const request = route.request();
    attempts.push({ key: request.headers()['idempotency-key'], content: request.postDataJSON() });
    return route.fulfill({ status: 201, json: { success: true, data: receipt(5) } });
  });
  await page.goto(base + '/#/fill/retry');
  await complete(page);
  await page.locator('#phone').fill('13900000000');
  await page.evaluate(() => { window.failedSessionReadsRemaining = 1; });
  await page.getByRole('button', { name: '提交预订', exact: true }).click();
  const restore = page.getByRole('button', { name: '恢复原提交', exact: true });
  await restore.waitFor();
  assert.deepEqual(attempts, []);
  assert.equal(await page.locator('#phone').inputValue(), '13900000000');
  assert.deepEqual(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), storageKey), legacy);
  await page.evaluate(() => { window.failedSessionReadsRemaining = Infinity; });
  await page.getByRole('button', { name: '提交预订', exact: true }).click();
  await restore.waitFor();
  assert.deepEqual(attempts, []);
  page.once('dialog', dialog => dialog.accept());
  await restore.click();
  await page.evaluate(() => { window.failedSessionReadsRemaining = 0; });
  await page.getByRole('button', { name: '重试提交', exact: true }).click();
  await page.getByText('填单编号：' + receipt(5).submissionNo).waitFor();
  assert.deepEqual(attempts, [legacy]);
  assert.equal(await page.evaluate(key => sessionStorage.getItem(key), storageKey), null);
});

async function editableDraftWithUnreadableLegacy(browser, attempts, expiredImage = false) {
  const page = await openTestPage(browser);
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  const legacy = { key: '20000000-0000-4000-8000-000000000088', content: {
    phone: '13800000000', memberPhone: null, address: null, fulfillmentType: 'PICKUP',
    requestedReceiveAt: '2026-11-17T10:00:00Z',
    items: [{ name: '原填单', quantity: 1, productType: 'CAKE', attributes: { size: '6' }, ...(expiredImage ? {
      itemId: '20000000-0000-4000-8000-000000000090', imageIds: ['20000000-0000-4000-8000-000000000091'],
    } : {}) }],
  } };
  await page.addInitScript(([key, record]) => {
    if (!sessionStorage.getItem(key) && !sessionStorage.getItem('audit-legacy-seeded')) {
      sessionStorage.setItem(key, JSON.stringify(record));
      sessionStorage.setItem('audit-legacy-seeded', 'yes');
    }
    window.canReadLegacy = false;
    const getItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (name) {
      if (name === key && !window.canReadLegacy) throw new DOMException('Synthetic session read failure', 'SecurityError');
      return getItem.call(this, name);
    };
  }, [storageKey, legacy]);
  const path = '**/api/public/order-entries/retry';
  await page.route(path, route => route.fulfill({ json: { success: true, data: { ownerName: '客服' } } }));
  if (expiredImage) await page.route(path + '/items/**', route =>
    route.fulfill({ status: 404, json: { success: false, code: 'IMAGE_NOT_FOUND' } }));
  await page.route(path + '/submissions', route => {
    const request = route.request();
    attempts.push({ key: request.headers()['idempotency-key'], content: request.postDataJSON() });
    return expiredImage
      ? route.fulfill({ status: 404, json: { success: false, code: 'IMAGE_NOT_FOUND' } })
      : route.fulfill({ status: 201, json: { success: true, data: receipt(5) } });
  });
  page.on('dialog', dialog => dialog.accept());
  await page.goto(base + '/#/fill/retry');
  await complete(page);
  await page.locator('#phone').fill('13900000000');
  await page.locator('#address').fill('新预订的合成地址');
  await page.getByText(/草稿已保存在本机/).waitFor();
  return { page, legacy };
}

test('放弃找回的旧扫码提交后恢复独立草稿，继续填写保留其余字段', async t => {
  const browser = await chromium.launch({ headless: true, channel: testBrowserChannel() });
  t.after(() => closeTestBrowser(browser));
  const attempts = [];
  const { page } = await editableDraftWithUnreadableLegacy(browser, attempts);
  await page.evaluate(() => { window.canReadLegacy = true; });
  await page.getByRole('button', { name: '提交预订', exact: true }).click();
  await page.getByRole('button', { name: '恢复原提交' }).click();
  await page.getByRole('button', { name: '放弃重试' }).click();
  await page.getByRole('button', { name: '恢复草稿' }).click();
  assert.equal(await page.locator('#phone').inputValue(), '13900000000');
  await page.locator('#phone').fill('13700000000');
  await page.getByText(/草稿已保存在本机/).waitFor();
  await page.reload();
  await page.getByRole('button', { name: '恢复草稿' }).click();
  assert.equal(await page.locator('#phone').inputValue(), '13700000000');
  assert.equal(await page.locator('#address').inputValue(), '新预订的合成地址');
  assert.deepEqual(attempts, []);
});

test('旧会话图片失效时只保留一个可编辑草稿，读取延迟或失败也不会覆盖', async t => {
  const browser = await chromium.launch({ headless: true, channel: testBrowserChannel() });
  t.after(() => closeTestBrowser(browser));
  const attempts = [];
  const { page, legacy } = await editableDraftWithUnreadableLegacy(browser, attempts, true);
  await page.evaluate(() => { window.canReadLegacy = true; });
  await page.getByRole('button', { name: '提交预订', exact: true }).click();
  await page.getByRole('button', { name: '恢复原提交' }).click();
  await page.getByRole('button', { name: '重试提交', exact: true }).click();
  await page.locator('.create-submit').getByText(/这笔预订因图片失效未提交/).waitFor();
  assert.deepEqual(attempts, [legacy]);
  assert.deepEqual(await readPending(page), legacy);
  assert.equal(await page.locator('#phone').isDisabled(), true);
  const recover = page.getByRole('button', { name: '恢复编辑', exact: true });
  const recoveryStatus = page.locator('.create-submit [role=status]');
  await recover.click();
  await recoveryStatus.getByText(/仍未恢复编辑/).waitFor();
  await recover.click();
  await recoveryStatus.getByText(/仍未恢复编辑/).waitFor();
  assert.doesNotMatch(await recoveryStatus.innerText(), /待客服确认/);
  assert.deepEqual(attempts, [legacy]);

  await page.evaluate(() => {
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, mode, ...args) {
      if (mode === 'readonly') {
        IDBDatabase.prototype.transaction = transaction;
        throw new DOMException('Synthetic draft read failure', 'InvalidStateError');
      }
      return transaction.call(this, stores, mode, ...args);
    };
  });
  const continueDraft = page.getByRole('button', { name: '打开另一份草稿', exact: true });
  await continueDraft.click();
  await recoveryStatus.getByText(/暂时无法打开另一份草稿/).waitFor();
  assert.equal(await page.locator('#phone').inputValue(), '13800000000');
  assert.equal(await page.locator('#phone').isDisabled(), true);
  assert.deepEqual(await readPending(page), legacy);

  await page.evaluate(key => {
    const remove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (name) {
      if (name === key) {
        Storage.prototype.removeItem = remove;
        throw new DOMException('Synthetic session cleanup failure', 'SecurityError');
      }
      return remove.call(this, name);
    };
  }, storageKey);
  await continueDraft.click();
  await recoveryStatus.getByText(/无法切换草稿/).waitFor();
  assert.equal(await page.locator('#phone').inputValue(), '13800000000');
  assert.deepEqual(await readPending(page), legacy);

  await page.evaluate(() => {
    const open = indexedDB.open;
    indexedDB.open = function (...args) {
      indexedDB.open = open;
      const request = {};
      window.releaseDraftRead = () => {
        const actual = open.apply(this, args);
        actual.onsuccess = () => { request.result = actual.result; request.onsuccess(); };
        actual.onerror = () => { request.error = actual.error; request.onerror(); };
      };
      return request;
    };
  });
  await continueDraft.click();
  await page.waitForFunction(() => typeof window.releaseDraftRead === 'function');
  assert.equal(await page.locator('#phone').isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: '恢复草稿', exact: true }).count(), 0);
  await page.evaluate(() => window.releaseDraftRead());
  await page.locator('#phone[value="13900000000"]').waitFor();
  assert.equal(await page.getByRole('button', { name: '恢复草稿', exact: true }).count(), 0);
  assert.deepEqual(attempts, [legacy]);
  assert.equal(await page.locator('#address').inputValue(), '新预订的合成地址');
  assert.equal(await readPending(page), null);
  await page.locator('#phone').fill('13700000000');
  await page.getByText(/草稿已保存在本机/).waitFor();
  await page.reload();
  await page.getByRole('button', { name: '恢复草稿', exact: true }).click();
  assert.equal(await page.locator('#phone').inputValue(), '13700000000');
  assert.equal(await page.locator('#address').inputValue(), '新预订的合成地址');
  const keys = await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('wuhou-order-edits', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('drafts', 'readonly');
      const read = tx.objectStore('drafts').getAllKeys();
      tx.oncomplete = () => { db.close(); resolve(read.result.filter(key => String(key).startsWith('public-submission:'))); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
  assert.equal(keys.length, 1);
});

test('超限恢复保护独立草稿及其本机图片', async t => {
  const browser = await chromium.launch({ headless: true, channel: testBrowserChannel() });
  t.after(() => closeTestBrowser(browser));
  const { page, legacy } = await editableDraftWithUnreadableLegacy(browser, [], true);
  const buttons = name => page.getByRole('button', { name, exact: true });
  await page.locator('input[type=file]').setInputFiles({ name: 'draft.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=', 'base64') });
  await page.getByText('1 / 5 张').waitFor();
  await page.getByText(/草稿已保存在本机/).waitFor();
  await page.evaluate(() => { window.canReadLegacy = true; });
  await buttons('提交预订').click();
  await buttons('恢复原提交').click();
  await page.route('**/submissions', route => route.fulfill({ status: 409, json: { success: false, code: 'ORDER_IMAGE_STORAGE_EXCEEDED' } }));
  await buttons('重试提交').click();
  await page.getByText(/参考图片加起来太大，这笔预订还没提交/).waitFor();
  assert.equal(await page.locator('#phone').isDisabled(), true);
  page.removeAllListeners('dialog');
  let confirmation;
  page.once('dialog', async dialog => {
    confirmation = dialog.message();
    await dialog.dismiss();
  });
  await buttons('打开另一份草稿').click();
  await t.waitFor(() => assert.match(confirmation ?? '', /当前填写将无法找回/));
  assert.equal(await page.locator('#phone').inputValue(), legacy.content.phone);
  assert.deepEqual(await readPending(page), legacy);
  page.once('dialog', dialog => dialog.accept());
  await buttons('打开另一份草稿').click();
  await page.locator('#phone[value="13900000000"]').waitFor();
  await page.locator('.reference-image').scrollIntoViewIfNeeded();
  await buttons('查看图片 1').waitFor();
  await page.reload();
  await buttons('恢复草稿').click();
  assert.equal(await page.locator('#phone').inputValue(), '13900000000');
  await page.locator('.reference-image').scrollIntoViewIfNeeded();
  await buttons('查看图片 1').waitFor();
});

for (const deleted of ['拒绝前', '切换前', '确认时']) test(`另一份草稿在${deleted}消失，保留当前填写并可恢复编辑`, async t => {
  const browser = await chromium.launch({ headless: true, channel: testBrowserChannel() });
  t.after(() => closeTestBrowser(browser));
  const attempts = [];
  const { page, legacy } = await editableDraftWithUnreadableLegacy(browser, attempts, true);
  const button = name => page.getByRole('button', { name, exact: true });
  await page.evaluate(() => { window.canReadLegacy = true; });
  await button('提交预订').click();
  await button('恢复原提交').click();

  const otherTab = await page.context().newPage();
  await otherTab.route(base + '/draft-test-empty', route => route.fulfill({ contentType: 'text/html', body: '' }));
  await otherTab.goto(base + '/draft-test-empty');
  const deleteSavedDraft = () => otherTab.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('wuhou-order-edits', 1);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('drafts', 'readwrite');
      tx.objectStore('drafts').delete(IDBKeyRange.bound('public-submission:', 'public-submission:\uffff'));
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
  if (deleted === '拒绝前') await deleteSavedDraft();

  await button('重试提交').click();
  const openAnother = button('打开另一份草稿');
  page.removeAllListeners('dialog');
  let confirms = 0;
  page.on('dialog', async dialog => {
    confirms++;
    if (deleted === '确认时') await deleteSavedDraft();
    await dialog.accept();
  });
  if (deleted === '拒绝前') {
    await page.getByText(/草稿有变动，请点「恢复编辑」/).waitFor();
  } else {
    await openAnother.waitFor();
    if (deleted === '切换前') await deleteSavedDraft();
    await openAnother.click();
    await page.getByText(/另一份草稿已找不到/).waitFor();
  }
  assert.equal(await openAnother.count(), 0);
  assert.equal(confirms, deleted === '确认时' ? 1 : 0);
  assert.equal(await page.locator('#phone').inputValue(), legacy.content.phone);
  assert.deepEqual(await readPending(page), legacy);
  await button('恢复编辑').click();
  await page.getByText(/请重新选择或移除标为失效的图片/).waitFor();
  assert.equal(await page.locator('#phone').isEditable(), true);
  assert.equal(await readPending(page), null);
  assert.deepEqual(attempts, [legacy]);
});

test('旧会话键在 IndexedDB 写入期间恢复时停止新提交并保留可编辑草稿', async t => {
  const browser = await chromium.launch({ headless: true, channel: testBrowserChannel() });
  t.after(() => closeTestBrowser(browser));
  const attempts = [];
  const { page, legacy } = await editableDraftWithUnreadableLegacy(browser, attempts);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (record, ...args) {
      if (record?.value?.pending) window.canReadLegacy = true;
      return put.call(this, record, ...args);
    };
  });
  await page.getByRole('button', { name: '提交预订', exact: true }).click();
  const restore = page.getByRole('button', { name: '恢复原提交' });
  await restore.waitFor();
  assert.deepEqual(attempts, []);
  assert.deepEqual(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), storageKey), legacy);
  await restore.click();
  await page.getByRole('button', { name: '重试提交', exact: true }).click();
  await page.getByText('填单编号：' + receipt(5).submissionNo).waitFor();
  assert.deepEqual(attempts, [legacy]);
  await page.getByRole('button', { name: '再填一单' }).click();
  await page.getByRole('button', { name: '恢复草稿' }).click();
  assert.equal(await page.locator('#address').inputValue(), '新预订的合成地址');
  assert.equal(await page.getByRole('button', { name: '提交预订', exact: true }).isEnabled(), true);
});

test('另一标签页已经更换草稿时，仍可保留并重试旧版会话请求', async t => {
  const browser = await chromium.launch({ headless: true, channel: testBrowserChannel() });
  t.after(() => closeTestBrowser(browser));
  const context = await openTestContext(browser);
  const path = '**/api/public/order-entries/retry';
  const url = `${base}/#/fill/retry`;
  const attempts = [];
  await context.route(path, route => route.fulfill({ json: { success: true, data: { ownerName: '客服' } } }));
  await context.route(path + '/submissions', route => {
    const request = route.request();
    attempts.push({ key: request.headers()['idempotency-key'], content: request.postDataJSON() });
    return attempts.length === 1 ? route.abort() : route.fulfill({ status: 201, json: { success: true, data: receipt(6) } });
  });
  const other = await context.newPage();
  await other.goto(url);
  await complete(other);
  await other.getByRole('button', { name: '提交预订', exact: true }).click();
  await other.getByText(/原提交结果仍待确认/).waitFor();
  assert.equal(attempts.length, 1);
  const legacy = { key: '20000000-0000-4000-8000-000000000099', content: { ...attempts[0].content, phone: '13900000000' } };

  const page = await context.newPage();
  await page.goto(url);
  const restore = page.getByRole('button', { name: '恢复草稿', exact: true });
  await restore.waitFor();
  await page.evaluate(([key, value]) => sessionStorage.setItem(key, JSON.stringify(value)), [storageKey, legacy]);
  await page.reload();
  await restore.waitFor();

  other.once('dialog', dialog => dialog.accept());
  await other.getByRole('button', { name: '放弃重试', exact: true }).click();
  await other.locator('#phone').fill('13600000000');
  await other.getByText(/草稿已保存在本机/).waitFor();

  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '重新填写' }).click();
  await page.getByRole('button', { name: '重试提交', exact: true }).waitFor();
  assert.equal(attempts.length, 1);
  const readLegacy = () => page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), storageKey);
  assert.deepEqual(await readLegacy(), legacy);

  await page.reload();
  await page.getByRole('button', { name: '重试提交', exact: true }).click();
  await page.getByText(`填单编号：${receipt(6).submissionNo}`).waitFor();
  assert.deepEqual(attempts.slice(1), [legacy]);
  assert.equal(await readLegacy(), null);
  await other.reload();
  await other.getByRole('button', { name: '恢复草稿', exact: true }).click();
  assert.equal(await other.locator('#phone').inputValue(), '13600000000');
});

test('明确拒绝的会话记录清理失败后，可在下次发送前清理原键', async t => {
  const browser = await chromium.launch({ headless: true, channel: testBrowserChannel() });
  t.after(() => closeTestBrowser(browser));
  const page = await openTestPage(browser);
  const attempts = [];
  const path = '**/api/public/order-entries/retry';
  await page.addInitScript(key => {
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = (name, version) => {
      if (name === 'wuhou-order-edits') throw new DOMException('测试暂存不可用', 'InvalidStateError');
      return open(name, version);
    };
    const remove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (name) {
      if (name === key) throw new DOMException('测试清理失败', 'SecurityError');
      return remove.call(this, name);
    };
    window.allowSessionCleanup = () => { Storage.prototype.removeItem = remove; };
  }, storageKey);
  await page.route(path, route => route.fulfill({ json: { success: true, data: { ownerName: '客服' } } }));
  await page.route(path + '/submissions', route => {
    const request = route.request();
    attempts.push({ key: request.headers()['idempotency-key'], content: request.postDataJSON() });
    if (attempts.length === 1) return route.fulfill({ status: 400, json: { success: false, code: 'VALIDATION_FAILED' } });
    return route.fulfill({ status: 201, json: { success: true, data: receipt(7) } });
  });
  await page.goto(`${base}/#/fill/retry`);
  await complete(page);
  const submit = page.getByRole('button', { name: '提交预订', exact: true });
  await submit.click();
  await page.getByText('填写内容不符合要求，请检查后重试。').waitFor();
  await page.locator('#phone').fill('13900000000');
  await submit.click();
  await page.getByText(/本次未发送/).waitFor();
  assert.deepEqual(await readPending(page), attempts[0]);
  assert.equal(attempts.length, 1);

  await page.evaluate(() => window.allowSessionCleanup());
  await submit.click();
  await page.getByText(`填单编号：${receipt(7).submissionNo}`).waitFor();
  assert.equal(attempts.length, 2);
  assert.notEqual(attempts[1].key, attempts[0].key);
  assert.equal(attempts[1].content.phone, '13900000000');
  assert.equal(await page.evaluate(key => sessionStorage.getItem(key), storageKey), null);
});

test('扫码未提交草稿跨标签页恢复，入口隔离并在24小时后淘汰', async t => {
  const browser = await chromium.launch({ headless: true, channel: testBrowserChannel() });
  t.after(() => closeTestBrowser(browser));
  const context = await openTestContext(browser, { viewport: { width: 390, height: 844 } });
  await context.route('**/api/public/order-entries/*', route => route.fulfill({ json: { success: true, data: { ownerName: '客服' } } }));
  const first = await context.newPage();
  await first.goto(`${base}/#/fill/retry`);
  await first.locator('#phone').fill('1397');
  await first.locator('#address').fill('未输完的合成地址');
  await first.getByText(/草稿已保存在本机/).waitFor();
  // Submit a final field event with a distinct value to check that the last edit has committed.
  await first.locator('#phone').fill('13978');
  await first.getByText(/草稿已保存在本机/).waitFor();
  await first.close();
  const other = await context.newPage();
  await other.goto(`${base}/#/fill/other`);
  assert.equal(await other.locator('#phone').inputValue(), '');
  await other.goto(`${base}/#/fill/retry`);
  const restore = other.getByRole('button', { name: '恢复草稿' });
  await restore.waitFor();
  assert.equal(await other.locator('#phone').count(), 0);
  await restore.click();
  assert.equal(await other.locator('#phone').inputValue(), '13978');
  assert.equal(await other.locator('#address').inputValue(), '未输完的合成地址');
  await context.addInitScript(() => {
    const now = Date.now.bind(Date);
    Date.now = () => now() + (24 * 60 * 60 + 1) * 1000;
  });
  await other.reload();
  assert.equal(await other.locator('#phone').inputValue(), '');
  assert.equal(await restore.count(), 0);
});

test('待确认填单超过24小时后仍能跨标签页用同键和原内容确认', async t => {
  const browser = await chromium.launch({ headless: true, channel: testBrowserChannel() });
  t.after(() => closeTestBrowser(browser));
  const context = await openTestContext(browser);
  await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  const attempts = [];
  const path = '**/api/public/order-entries/retry';
  await context.route(path, route => route.fulfill({ json: { success: true, data: { ownerName: '客服' } } }));
  await context.route(path + '/submissions', route => {
    const request = route.request();
    attempts.push({ key: request.headers()['idempotency-key'], body: request.postDataJSON() });
    if (attempts.length === 1) return route.abort('failed');
    return route.fulfill({ status: 201, json: { success: true, data: receipt(1) } });
  });

  const first = await context.newPage();
  await first.goto(`${base}/#/fill/retry`);
  await complete(first);
  await first.getByRole('button', { name: '提交预订', exact: true }).click();
  await first.getByText(/原提交结果仍待确认/).waitFor();
  await first.close();

  await context.addInitScript(() => {
    const now = Date.now.bind(Date);
    Date.now = () => now() + (24 * 60 * 60 + 1) * 1000;
  });
  const second = await context.newPage();
  await second.goto(`${base}/#/fill/retry`);
  await second.getByRole('button', { name: '恢复草稿' }).click();
  await second.getByRole('button', { name: '重试提交', exact: true }).click();
  await second.getByRole('heading', { name: '已提交，待客服确认' }).waitFor();
  assert.deepEqual(attempts, [attempts[0], attempts[0]]);
  assert.ok(attempts[0].key);
  assert.equal(await readPending(second), null);
});

test('手机选图不上传，刷新后提交，部分上传失败再刷新可继续原图片 ID', async t => {
  const browser = await chromium.launch({ headless: true, channel: testBrowserChannel() });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const path = '**/api/public/order-entries/photos';
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=', 'base64');
  const uploads = [];
  let submitted;
  await context.route(path, route => route.fulfill({ json: { success: true, data: { ownerName: '测试客服' } } }));
  await context.route(path + '/items/**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ contentType: 'image/png', body: png });
    const parts = route.request().url().split('/');
    const id = parts.at(-1), item = parts.at(-3);
    uploads.push({ id, item });
    if (uploads.length === 2) return route.fulfill({ status: 503, json: { success: false, code: 'IMAGE_PROCESSING_BUSY' } });
    return route.fulfill({ json: { success: true, data: id } });
  });
  await context.route(path + '/submissions', route => {
    submitted = route.request().postDataJSON();
    return route.fulfill({ status: 201, json: { success: true, data: receipt(9) } });
  });
  await page.goto(`${base}/#/fill/photos`);
  await complete(page);
  const submit = page.getByRole('button', { name: '提交预订', exact: true });
  const attach = index => page.locator('.submission-item-images input[type=file]').nth(index)
    .setInputFiles({ name: `style-${index}.png`, mimeType: 'image/png', buffer: png });
  await attach(0);
  await page.getByText('1 / 5 张').first().waitFor();
  await page.getByRole('button', { name: '添加商品' }).click();
  await page.locator('[id="items.1.size"]').fill('8');
  await attach(1);
  await page.getByText('1 / 5 张').nth(1).waitFor();
  await page.getByText(/已保存在本机/).first().waitFor();
  assert.deepEqual(uploads, []);
  await page.reload();
  await page.getByRole('button', { name: '恢复草稿' }).click();
  await page.getByText('1 / 5 张').nth(1).waitFor();
  assert.deepEqual(uploads, []);
  await submit.click();
  await page.getByText('图片正在处理中，请稍后重试。', { exact: true }).waitFor();
  assert.equal(submitted, undefined);
  assert.equal(uploads.length, 2);
  await page.reload();
  await page.getByRole('button', { name: '恢复草稿' }).click();
  await page.getByText('1 / 5 张').nth(1).waitFor();
  assert.equal(uploads.length, 2);
  let releaseUpload;
  const interrupted = new Promise(resolve => { releaseUpload = resolve; });
  await page.route(path + '/items/**', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const parts = route.request().url().split('/');
    uploads.push({ id: parts.at(-1), item: parts.at(-3) });
    await interrupted;
    await route.abort().catch(() => {});
  }, { times: 1 });
  const uploadStarted = page.waitForRequest(request => request.method() === 'POST' && request.url().includes('/items/'));
  await submit.click();
  await uploadStarted;
  await page.getByText('正在上传图片 0/1', { exact: true }).waitFor();
  await page.reload();
  releaseUpload();
  await page.getByRole('button', { name: '恢复草稿' }).click();
  await page.getByText('1 / 5 张').nth(1).waitFor();
  assert.equal(uploads.length, 3);
  assert.equal(submitted, undefined);
  await submit.click();
  await page.getByRole('heading', { name: '已提交，待客服确认' }).waitFor();
  assert.equal(uploads.length, 4);
  assert.deepEqual(uploads[2], uploads[1]);
  assert.deepEqual(uploads[3], uploads[1]);
  assert.deepEqual(submitted.items.map(item => [item.itemId, item.imageIds]), [
    [uploads[0].item, [uploads[0].id]], [uploads[1].item, [uploads[1].id]],
  ]);
});

test('旧页面的读写和过期清理不会丢失新版草稿附件', async t => {
  const browser = await chromium.launch({ headless: true, channel: testBrowserChannel() });
  t.after(() => closeTestBrowser(browser));
  const context = await openTestContext(browser);
  const page = await context.newPage();
  const url = `${base}/#/fill/retry`;
  await context.route('**/api/public/order-entries/retry', route =>
    route.fulfill({ json: { success: true, data: { ownerName: '客服' } } }));
  const recordInfo = target => target.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('wuhou-order-edits', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const read = db.transaction('drafts').objectStore('drafts').openCursor();
      let schema, attachments = 0;
      read.onsuccess = () => {
        const row = read.result;
        if (!row) { db.close(); resolve({ schema, attachments }); return; }
        if (String(row.key).startsWith('draft-attachment:')) attachments++;
        if (String(row.key).startsWith('public-submission:')) schema = row.value.schema;
        row.continue();
      };
      read.onerror = () => { db.close(); reject(read.error); };
    };
  }));
  await page.goto(url);
  await complete(page);
  const add = () => page.locator('.submission-item-images input[type=file]').setInputFiles({
    name: 'reference.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=', 'base64'),
  });
  await add();
  await page.getByText('1 / 5 张').waitFor();
  await page.getByText(/草稿已保存在本机/).waitFor();
  const oldPage = await context.newPage();
  await oldPage.goto(url);
  const oldResult = await oldPage.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('wuhou-order-edits', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('drafts', 'readwrite');
      const range = IDBKeyRange.bound('public-submission:', 'public-submission:\uffff');
      const read = tx.objectStore('drafts').openCursor(range);
      const result = { overwritten: false, pruned: false };
      read.onsuccess = () => {
        const row = read.result;
        if (!row) return;
        const value = row.value;
        if (value.schema === 1 && typeof value.revision === 'string' && value.value) {
          row.update({ schema: 1, revision: crypto.randomUUID(), value: value.value, expiresAt: value.expiresAt });
          result.overwritten = true;
        }
        if (typeof value.expiresAt === 'number' && value.expiresAt <= Date.now() + 25 * 60 * 60 * 1000) {
          row.delete();
          result.pruned = true;
        }
        row.continue();
      };
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
  assert.deepEqual(oldResult, { overwritten: false, pruned: false });
  assert.deepEqual(await recordInfo(page), { schema: 2, attachments: 1 });
  await page.reload();
  await page.getByRole('button', { name: '恢复草稿' }).click();
  await page.locator('.reference-image').scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: '查看图片 1', exact: true }).waitFor();
  await page.getByRole('button', { name: '移除', exact: true }).click();
  await page.getByText('0 / 5 张').waitFor();
  await page.getByText(/草稿已保存在本机/).waitFor();
  assert.deepEqual(await recordInfo(page), { schema: 2, attachments: 0 });
  await add();
  await page.getByText('1 / 5 张').waitFor();
  await page.getByText(/草稿已保存在本机/).waitFor();
  await page.addInitScript(() => {
    const now = Date.now.bind(Date);
    Date.now = () => now() + 25 * 60 * 60 * 1000;
  });
  await page.reload();
  await page.locator('#phone').waitFor();
  assert.deepEqual(await recordInfo(page), { schema: undefined, attachments: 0 });
});

test('草稿续期保留超过暂存期限的本机图片，提交时原 ID 重传并等待限流', async t => {
  const browser = await chromium.launch({ headless: true, channel: testBrowserChannel() });
  t.after(() => closeTestBrowser(browser));
  const page = await openTestPage(browser);
  let submits = 0;
  const uploads = [];
  const path = '**/api/public/order-entries/retry';
  await page.addInitScript(() => {
    const now = Date.now.bind(Date);
    Date.now = () => now() + Number(sessionStorage.getItem('draft-test-offset') ?? 0);
  });
  await page.route(path, route => route.fulfill({ json: { success: true, data: { ownerName: '客服' } } }));
  await page.route(path + '/items/**', route => {
    if (route.request().method() === 'GET')
      return route.fulfill({ status: 404, json: { success: false, code: 'IMAGE_NOT_FOUND' } });
    const id = route.request().url().split('/').at(-1);
    uploads.push(id);
    if (uploads.length === 2) return route.fulfill({ status: 429, headers: { 'Retry-After': '1' },
      json: { success: false, code: 'SUBMISSION_THROTTLED' } });
    return route.fulfill({ json: { success: true, data: id } });
  });
  await page.route(path + '/submissions', route => {
    if (++submits === 1) return route.fulfill({ status: 400, json: { success: false, code: 'VALIDATION_FAILED' } });
    return route.fulfill({ status: 201, json: { success: true, data: receipt(11) } });
  });
  await page.goto(`${base}/#/fill/retry`);
  await complete(page);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=', 'base64');
  await page.locator('.submission-item-images input[type=file]').setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: png });
  await page.getByText('1 / 5 张').waitFor();
  const submit = page.getByRole('button', { name: '提交预订', exact: true });
  await submit.click();
  await page.getByText('填写内容不符合要求，请检查后重试。').waitFor();
  for (const hours of [20, 40]) {
    await page.evaluate(value => sessionStorage.setItem('draft-test-offset', String(value * 60 * 60 * 1000)), hours);
    await page.locator('#phone').fill(`138000000${hours}`);
    await page.getByText(/草稿已保存在本机/).waitFor();
  }
  await page.evaluate(() => sessionStorage.setItem('draft-test-offset', String(50 * 60 * 60 * 1000)));
  await page.reload();
  await page.getByRole('button', { name: '恢复草稿' }).click();
  assert.equal(await page.locator('#phone').inputValue(), '13800000040');
  await page.locator('.reference-image').scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: '查看图片 1', exact: true }).waitFor();
  assert.equal(uploads.length, 1);
  await submit.click();
  await page.getByText(/图片上传较忙/).waitFor();
  await page.getByText(`填单编号：${receipt(11).submissionNo}`).waitFor();
  assert.deepEqual(uploads, [uploads[0], uploads[0], uploads[0]]);
  const attachmentCount = await page.evaluate(() => new Promise(resolve => {
    const open = indexedDB.open('wuhou-order-edits', 1);
    open.onsuccess = () => {
      const db = open.result;
      const query = db.transaction('drafts').objectStore('drafts').getAllKeys();
      query.onsuccess = () => { resolve(query.result.filter(key => String(key).startsWith('draft-attachment:')).length); db.close(); };
    };
  }));
  assert.equal(attachmentCount, 0);
});

test('恢复旧草稿时保留有效图片 ID，仅补传有本机副本的失效图片', async t => {
  const browser = await chromium.launch({ headless: true, channel: testBrowserChannel() });
  t.after(() => closeTestBrowser(browser));
  const page = await openTestPage(browser);
  const path = '**/api/public/order-entries/retry';
  const legacy = ['20000000-0000-4000-8000-000000000092', '20000000-0000-4000-8000-000000000093',
    '20000000-0000-4000-8000-000000000094', '20000000-0000-4000-8000-000000000095'];
  const uploads = [];
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=', 'base64');
  let readable = true;
  let firstExpired = false;
  let remoteOnlyReadable = false;
  await page.route(path, route => route.fulfill({ json: { success: true, data: { ownerName: '客服' } } }));
  await page.route(path + '/items/**', route => {
    const id = route.request().url().split('/').at(-1);
    if (route.request().method() === 'GET') return id === legacy[0] || readable && id === legacy[1] || remoteOnlyReadable && id === legacy[3]
      ? route.fulfill({ contentType: 'image/png', body: png })
      : route.fulfill({ status: 404, json: { success: false, code: 'IMAGE_NOT_FOUND' } });
    uploads.push(id);
    return route.fulfill({ json: { success: true, data: id } });
  });
  await page.route(path + '/images/status', route => route.fulfill({
    json: { success: true, data: route.request().postDataJSON()
      .filter(row => row.imageId !== legacy[3] && !uploads.includes(row.imageId) && (row.imageId !== legacy[0] || firstExpired)).map(row => row.imageId) },
  }));
  let submitted;
  await page.route(path + '/submissions', route => {
    submitted = route.request().postDataJSON();
    if (!firstExpired) {
      firstExpired = true;
      return route.fulfill({ status: 404, json: { success: false, code: 'IMAGE_NOT_FOUND' } });
    }
    return route.fulfill({ status: 201, json: { success: true, data: receipt(12) } });
  });
  await page.goto(`${base}/#/fill/retry`);
  await complete(page);
  await page.getByText(/草稿已保存在本机/).waitFor();
  await page.evaluate(ids => new Promise((resolve, reject) => {
    const open = indexedDB.open('wuhou-order-edits', 1);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('drafts', 'readwrite');
      const cursor = tx.objectStore('drafts').openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        const saved = row.value;
        saved.value.value.items[0].imageIds = ids;
        row.update(saved);
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), legacy);
  await page.reload();
  await page.getByRole('button', { name: '恢复草稿' }).click();
  await t.waitFor(async () => assert.equal(await page.evaluate(() => new Promise(resolve => {
    const open = indexedDB.open('wuhou-order-edits', 1);
    open.onsuccess = () => {
      const db = open.result;
      const read = db.transaction('drafts').objectStore('drafts').getAllKeys();
      read.onsuccess = () => { resolve(read.result.filter(key => String(key).startsWith('draft-attachment:')).length === 2); db.close(); };
    };
  })), true));
  readable = false;
  await page.reload();
  await page.getByRole('button', { name: '恢复草稿' }).click();
  await page.locator('.reference-image').nth(0).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: '查看图片 1', exact: true }).waitFor();
  await page.locator('.reference-image').nth(1).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: '查看图片 2', exact: true }).waitFor();
  await page.locator('.reference-image').nth(2).scrollIntoViewIfNeeded();
  await page.locator('.reference-image').nth(2).getByText('图片已失效', { exact: true }).waitFor();
  assert.deepEqual(uploads, []);
  const submit = page.getByRole('button', { name: '提交预订', exact: true });
  await submit.click();
  await page.getByText('请重新选择或移除标为失效的图片，再次提交。', { exact: true }).waitFor();
  assert.equal(submitted, undefined);
  await page.locator('.reference-image').nth(2).getByRole('button', { name: '移除', exact: true }).click();
  await submit.click();
  await page.getByText('图片已保留，请再次提交。', { exact: true }).waitFor();
  remoteOnlyReadable = true;
  assert.deepEqual(submitted.items[0].imageIds, [legacy[0], uploads[0], legacy[3]]);
  assert.equal(await page.locator('#phone').isEditable(), true);
  await page.getByText('3 / 5 张').waitFor();
  await submit.click();
  await page.getByText(`填单编号：${receipt(12).submissionNo}`).waitFor();
  assert.equal(uploads.length, 2);
  assert.ok(uploads.every(id => !legacy.includes(id)));
  assert.deepEqual(submitted.items[0].imageIds, [uploads[1], uploads[0], legacy[3]]);
});

for (const scenario of ['补传后拒绝', '直接拒绝', '暂存持续失败后恢复']) test(`补齐图片后明确超限可继续编辑，断线或限流时保留原提交（重试${scenario}）`, async t => {
  const direct = scenario !== '补传后拒绝';
  const storageBlocked = scenario === '暂存持续失败后恢复';
  const browser = await chromium.launch({ headless: true, channel: testBrowserChannel() });
  t.after(() => closeTestBrowser(browser));
  const page = await openTestPage(browser);
  const path = '**/api/public/order-entries/retry';
  const attempts = [];
  await page.route(path, route => route.fulfill({ json: { success: true, data: { ownerName: '客服' } } }));
  await page.route(path + '/items/**', route =>
    route.fulfill({ json: { success: true, data: route.request().url().split('/').at(-1) } }));
  await page.route(path + '/images/status', route =>
    route.fulfill({ json: { success: true, data: [route.request().postDataJSON()[0].imageId] } }));
  await page.route(path + '/submissions', route => {
    attempts.push({ key: route.request().headers()['idempotency-key'], content: route.request().postDataJSON() });
    if (attempts.length <= (direct ? 4 : 6) && attempts.length % 2 === 1)
      return route.fulfill({ status: 404, json: { success: false, code: 'IMAGE_NOT_FOUND' } });
    if (attempts.length === 2)
      return route.fulfill({ status: 429, json: { success: false, code: 'SUBMISSION_THROTTLED' } });
    if (attempts.length === 4) return route.abort('failed');
    if (attempts.length === (direct ? 5 : 6))
      return route.fulfill({ status: 409, json: { success: false, code: 'ORDER_IMAGE_STORAGE_EXCEEDED' } });
    return route.fulfill({ status: 201, json: { success: true, data: receipt(13) } });
  });
  await page.goto(`${base}/#/fill/retry`);
  await complete(page);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=', 'base64');
  for (let index = 1; index <= 2; index++) {
    await page.locator('.submission-item-images input[type=file]').setInputFiles({ name: `photo-${index}.png`, mimeType: 'image/png', buffer: png });
    await page.getByText(`${index} / 5 张`).waitFor();
  }
  const submit = page.getByRole('button', { name: '提交预订', exact: true });
  const retry = page.getByRole('button', { name: '重试提交', exact: true });
  await submit.click();
  await page.getByText('提交过于频繁，请稍后再试。', { exact: true }).waitFor();
  assert.equal(await page.locator('#phone').isDisabled(), true);
  assert.deepEqual(await readPending(page), attempts[0]);
  await retry.click();
  await page.getByText('网络连接失败，请检查连接后重试。', { exact: true }).waitFor();
  assert.equal(await page.locator('#phone').isDisabled(), true);
  assert.deepEqual(await readPending(page), attempts[0]);
  if (direct) await page.evaluate(failures => {
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, mode, ...args) {
      if (mode === 'readwrite') {
        if (--failures === 0) IDBDatabase.prototype.transaction = transaction;
        throw new DOMException('Synthetic temporary write failure', 'InvalidStateError');
      }
      return transaction.call(this, stores, mode, ...args);
    };
  }, storageBlocked ? 4 : 1);
  await retry.click();
  if (storageBlocked) {
    await page.getByText(/手机暂时无法保存这笔填写/).waitFor();
    assert.equal(await page.getByRole('button', { name: '打开另一份草稿' }).count(), 0);
    const recover = page.getByRole('button', { name: '恢复编辑', exact: true });
    for (let retry = 0; retry < 2; retry++) {
      await recover.click();
      await page.getByText(/手机仍无法保存这笔填写/).waitFor();
      assert.deepEqual(await readPending(page), attempts[0]);
    }
    assert.equal(attempts.length, 5);
    await recover.click();
  }
  await page.getByText('参考图片加起来太大，请移除部分图片后再次提交。', { exact: true }).waitFor();
  assert.equal(await readPending(page), null);
  if (direct) {
    await page.reload();
    await page.getByRole('button', { name: '恢复草稿' }).click();
  }
  assert.equal(await page.locator('#phone').isEditable(), true);
  assert.equal(await page.locator('#phone').inputValue(), '13800000000');
  assert.equal(await page.locator('#address').inputValue(), '测试地址');
  await page.getByText('2 / 5 张').waitFor();
  await page.getByRole('button', { name: '移除', exact: true }).last().click();
  await submit.click();
  await page.getByText(`填单编号：${receipt(13).submissionNo}`).waitFor();
  assert.deepEqual(attempts.slice(0, -1), Array(direct ? 5 : 6).fill(attempts[0]));
  assert.notEqual(attempts.at(-1).key, attempts[0].key);
  assert.deepEqual(attempts.at(-1).content.items[0].imageIds, attempts[0].content.items[0].imageIds.slice(0, 1));
});

test('待确认补传中断后按原键重放，只上传服务端仍缺少的图片', async t => {
  const browser = await chromium.launch({ headless: true, channel: testBrowserChannel() });
  t.after(() => browser.close());
  const context = await openTestContext(browser);
  const page = await context.newPage();
  const path = '**/api/public/order-entries/retry';
  const attempts = [];
  const uploaded = [];
  const staged = new Set();
  const checked = [];
  await context.route(path, route => route.fulfill({ json: { success: true, data: { ownerName: '测试客服' } } }));
  await context.route(path + '/items/**', route => {
    const id = route.request().url().split('/').at(-1);
    if (route.request().method() === 'POST') {
      uploaded.push(id);
      staged.add(id);
      if (uploaded.length === 6) return route.abort('failed');
      return route.fulfill({ json: { success: true, data: id } });
    }
    return route.fulfill({ status: 404, json: { success: false, code: 'IMAGE_NOT_FOUND' } });
  });
  await context.route(path + '/submissions', route => {
    attempts.push({ key: route.request().headers()['idempotency-key'], content: route.request().postDataJSON() });
    if (attempts.length === 1) {
      for (const id of uploaded.slice(1)) staged.delete(id);
      return route.abort('failed');
    }
    if (attempts.length <= 3) return route.fulfill({ status: 404, json: { success: false, code: 'IMAGE_NOT_FOUND' } });
    return route.fulfill({ status: 201, json: { success: true, data: receipt(10) } });
  });
  await context.route(path + '/images/status', route => {
    const missing = route.request().postDataJSON().map(row => row.imageId).filter(id => !staged.has(id));
    checked.push({ attempts: attempts.length, missing });
    return route.fulfill({ json: { success: true, data: missing } });
  });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=', 'base64');
  await page.goto(`${base}/#/fill/retry`);
  await complete(page);
  for (let index = 1; index <= 4; index++) {
    await page.locator('.submission-item-images input[type=file]').setInputFiles({ name: `reference-${index}.png`, mimeType: 'image/png', buffer: png });
    await page.getByText(`${index} / 5 张`).waitFor();
  }
  await page.locator('.reference-image').nth(0).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: '查看图片 1', exact: true }).waitFor();
  await page.locator('.reference-image').nth(1).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: '查看图片 2', exact: true }).waitFor();
  await page.getByRole('button', { name: '提交预订', exact: true }).click();
  await page.getByRole('button', { name: '重试提交', exact: true }).waitFor();
  const original = uploaded.slice();
  assert.equal(original.length, 4);
  assert.deepEqual(checked, []);
  await page.reload();
  await page.getByRole('button', { name: '恢复草稿' }).click();
  assert.equal(uploaded.length, 4);
  await page.getByRole('button', { name: '重试提交', exact: true }).click();
  await page.getByText('网络连接失败，请检查连接后重试。', { exact: true }).waitFor();
  assert.deepEqual(uploaded, [...original, original[1], original[2]]);
  assert.deepEqual(await readPending(page), attempts[0]);
  await page.reload();
  await page.getByRole('button', { name: '恢复草稿' }).click();
  assert.equal(uploaded.length, 6);
  await page.getByRole('button', { name: '重试提交', exact: true }).click();
  await page.getByRole('heading', { name: '已提交，待客服确认' }).waitFor();
  assert.deepEqual(attempts, Array(4).fill(attempts[0]));
  assert.deepEqual(checked, [{ attempts: 2, missing: original.slice(1) }, { attempts: 3, missing: [original[3]] }]);
  assert.deepEqual(uploaded, [...original, original[1], original[2], original[3]]);
  assert.equal(await readPending(page), null);
});

for (const queryFails of [false, true]) test(`补传后二次缺图按查询结果提示（${queryFails ? '查询失败' : '查询成功'}）`, async t => {
  const browser = await chromium.launch({ headless: true, channel: testBrowserChannel() });
  t.after(() => closeTestBrowser(browser));
  const page = await openTestPage(browser);
  const path = '**/api/public/order-entries/retry';
  const remote = '20000000-0000-4000-8000-000000000096';
  let attempts = 0;
  const missing = [[], [0], [1], [1]];
  await page.route(path, route => route.fulfill({ json: { success: true, data: { ownerName: '客服' } } }));
  await page.route(path + '/items/**', route => route.request().method() === 'GET'
    ? route.abort() : route.fulfill({ json: { success: true, data: route.request().url().split('/').at(-1) } }));
  await page.route(path + '/images/status', route => {
    const images = route.request().postDataJSON();
    if (images.length === 1) return route.fulfill({ json: { success: true, data: [] } });
    if (queryFails && attempts === 2) return route.abort();
    return route.fulfill({ json: { success: true, data: (missing[attempts] ?? []).map(i => images[i].imageId) } });
  });
  await page.route(path + '/submissions', route => ++attempts <= 3
    ? route.fulfill({ status: 404, json: { success: false, code: 'IMAGE_NOT_FOUND' } })
    : route.fulfill({ json: { success: true, data: receipt(14) } }));
  await page.goto(base + '/#/fill/retry');
  await complete(page);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=', 'base64');
  for (const n of [1, 2]) {
    await page.locator('input[type=file]').setInputFiles({ name: n + '.png', mimeType: 'image/png', buffer: png });
    await page.getByText(n + ' / 5 张').waitFor();
  }
  await page.getByText(/草稿已保存在本机/).waitFor();
  await page.evaluate(id => new Promise((resolve, reject) => {
    const open = indexedDB.open('wuhou-order-edits', 1);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('drafts', 'readwrite');
      const cursor = tx.objectStore('drafts').openCursor(IDBKeyRange.bound('public-submission:', 'public-submission:\uffff'));
      cursor.onsuccess = () => {
        const row = cursor.result;
        const saved = row.value;
        saved.value.value.items[0].imageIds.push(id);
        row.update(saved);
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), remote);
  await page.reload();
  await page.getByRole('button', { name: '恢复草稿' }).click();
  const submit = page.getByRole('button', { name: '提交预订', exact: true });
  await submit.click();
  await page.locator('.notice.error[role=alert]').first().waitFor();
  assert.equal(attempts, 2);
  const message = await page.locator('.notice.error[role=alert]').first().innerText();
  assert.match(message, queryFails ? /图片可用时会直接提交/ : /图片已保留，请再次提交/);
  assert.equal(await page.getByText(/填单编号/).count(), 0);
  await submit.click();
  await page.getByText(`填单编号：${receipt(14).submissionNo}`).waitFor();
});
