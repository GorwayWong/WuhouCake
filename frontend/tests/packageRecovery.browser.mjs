import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createRequire } from 'node:module';
import { createOrderFixture } from './orderBrowserFixture.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DRAFT_TEST_URL || 'http://127.0.0.1:5197';
let browser;
before(async () => { browser = await chromium.launch({ channel: 'chrome', headless: true }); });
after(async () => { await browser?.close(); });

test('复制标签页的旧草稿版本不能覆盖或删除新版本', async () => {
  const fixture = await createOrderFixture(browser, base);
  try {
    const result = await fixture.page.evaluate(async () => {
      const storage = await import('/src/packageDraftStorage.ts');
      const original = { accountId: 'cas-account', tabId: 'cas-tab', editing: 'new', name: '原始', items: [], original: '', member: '', baseline: '', creationKey: crypto.randomUUID(), pending: null };
      const revision = await storage.savePackageDraft(original, null);
      const attempts = await Promise.allSettled([
        storage.savePackageDraft({ ...original, name: '甲的新内容' }, revision),
        storage.savePackageDraft({ ...original, name: '乙的新内容' }, revision),
      ]);
      let deletionRejected = false;
      try { await storage.removePackageDraft(original.accountId, original.tabId, revision); } catch { deletionRejected = true; }
      return { states: attempts.map(value => value.status), deletionRejected, stored: await storage.readPackageDraft(original.accountId, original.tabId) };
    });
    assert.deepEqual([...result.states].sort(), ['fulfilled', 'rejected']);
    assert.equal(result.deletionRejected, true);
    assert.equal(result.stored.name, result.states[0] === 'fulfilled' ? '甲的新内容' : '乙的新内容');
  } finally { await fixture.context.close(); }
});

test('七张套餐图片保存响应丢失后刷新，使用原文件和原幂等键确认且不重复创建', async () => {
  const fixture = await createOrderFixture(browser, base);
  const { context, page, png, model } = fixture;
  const calls = [], records = new Map();
  const nearLimit = Buffer.alloc(5 * 1024 * 1024); png.copy(nearLimit);
  await context.route('**/api/me', route => route.fulfill({ json: { success: true, data: { accountId: model.account, nickname: '店长', jobRoles: ['STORE_MANAGER'], access: { permissions: [], uiCapabilities: [] } } } }));
  await context.route('**/api/order-packages**', async route => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({ json: { success: true, data: { items: [...records.values()], total: records.size, size: 20, page: 1 } } });
    const boundary = request.headers()['content-type'].split('boundary=')[1];
    const buffer = request.postDataBuffer();
    const text = buffer.toString('latin1');
    const part = text.split('--' + boundary).find(value => value.includes('name="package"'));
    const body = JSON.parse(Buffer.from(part.split('\r\n\r\n')[1], 'latin1').toString());
    const filenames = [...text.matchAll(/filename="(phone-\d.png)"/g)].map(value => value[1]);
    const key = request.headers()['idempotency-key']; calls.push({ key, body, filenames });
    assert.ok(buffer.length > nearLimit.length);
    if (!records.has(key)) records.set(key, { ...body, id: crypto.randomUUID(), version: 0, updatedAt: new Date().toISOString() });
    if (calls.length === 1) return route.fulfill({ status: 502, body: 'Gateway timeout while reading upload' });
    if (calls.length === 2) return route.fulfill({ status: 503, json: { success: false, code: 'TEMP_STORAGE_UNAVAILABLE' } });
    return route.fulfill({ status: 201, json: { success: true, data: records.get(key) } });
  });
  page.on('dialog', dialog => dialog.accept());
  try {
    await page.goto(`${base}/#/admin/order-packages`); await page.reload();
    await page.getByRole('button', { name: '新建套餐', exact: true }).first().click();
    await page.locator('#package-name').fill('七张手机图套餐');
    for (let i = 0; i < 7; i++) {
      if (i) await page.getByRole('button', { name: '添加商品', exact: true }).click();
      await page.getByLabel(`商品 ${i + 1} 的名称`, { exact: true }).fill(`商品${i + 1}`);
      await page.getByLabel(`商品 ${i + 1} 的图片`, { exact: true }).setInputFiles({ name: `phone-${i}.png`, mimeType: 'image/png', buffer: i === 0 ? nearLimit : png });
    }
    await page.getByRole('button', { name: '保存套餐', exact: true }).click();
    await page.getByRole('button', { name: '确认原操作结果' }).waitFor();
    assert.equal(calls.length, 1); assert.equal(calls[0].filenames.length, 7);
    await page.reload();
    await page.getByRole('button', { name: '确认原操作结果' }).waitFor();
    assert.equal(await page.locator('#package-name').inputValue(), '七张手机图套餐');
    assert.equal(await page.locator('input[type=file]').count(), 7);
    await page.getByRole('button', { name: '确认原操作结果' }).click();
    await page.getByText('应用临时空间不足，请稍后重试。', { exact: true }).waitFor();
    await page.getByRole('button', { name: '确认原操作结果' }).waitFor();
    assert.equal(await page.getByRole('button', { name: '确认原操作结果' }).count(), 1);
    await page.getByRole('button', { name: '确认原操作结果' }).click();
    await page.getByText('套餐已保存，员工下单时即可选用。', { exact: true }).waitFor();
    assert.equal(calls.length, 3); assert.deepEqual(calls[1], calls[0]); assert.deepEqual(calls[2], calls[0]); assert.equal(records.size, 1);
    await page.reload();
    await page.getByRole('heading', { name: '套餐管理', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '确认原操作结果' }).count(), 0);
    assert.deepEqual(fixture.errors, []);
  } finally { await context.close(); }
});

test('套餐上传结果未知时，更新草稿成功后才能减少图片且新建键跨恢复保留', async () => {
  const fixture = await createOrderFixture(browser, base);
  const { context, page, model, png } = fixture;
  const calls = [];
  const gatewayFailure = Promise.withResolvers();
  await context.route('**/api/me', route => route.fulfill({ json: { success: true, data: { accountId: model.account, jobRoles: ['STORE_MANAGER'], access: { permissions: [], uiCapabilities: [] } } } }));
  await context.route('**/api/order-packages**', async route => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({ json: { success: true, data: { items: [], total: 0, size: 20, page: 1 } } });
    const multipart = request.headers()['content-type'].startsWith('multipart/form-data');
    calls.push({ key: request.headers()['idempotency-key'], multipart });
    if (multipart) {
      await gatewayFailure.promise;
      return route.fulfill({ status: 502, body: 'Gateway timeout while reading upload' });
    }
    return route.fulfill({ status: 201, json: { success: true, data: { id: crypto.randomUUID() } } });
  });
  page.on('dialog', dialog => dialog.accept());
  try {
    const url = base + '/#/admin/order-packages';
    await page.goto(url); await page.reload();
    await page.getByRole('button', { name: '新建套餐', exact: true }).first().click();
    await page.locator('#package-name').fill('需减少图片的套餐');
    await page.getByLabel('商品 1 的名称', { exact: true }).fill('商品');
    await page.getByLabel('商品 1 的图片', { exact: true }).setInputFiles({ name: 'phone.png', mimeType: 'image/png', buffer: png });
    const save = page.getByRole('button', { name: '保存套餐', exact: true });
    await page.clock.install();
    const submitted = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/order-packages');
    await save.click();
    await submitted;
    await page.clock.fastForward(61_000);
    assert.equal(await page.getByRole('button', { name: '正在保存…', exact: true }).isDisabled(), true);
    gatewayFailure.resolve();
    const confirm = page.getByRole('button', { name: '确认原操作结果' });
    const edit = page.getByRole('button', { name: '核对后继续编辑' });
    await confirm.waitFor();
    await page.reload();
    await edit.waitFor();
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      window.rejectEditablePackage = true;
      IDBObjectStore.prototype.put = function (value, ...args) {
        if (window.rejectEditablePackage && this.name === 'drafts' && value?.resumedUpload && value.pending === null)
          throw new DOMException('测试本机草稿写失败', 'QuotaExceededError');
        return put.call(this, value, ...args);
      };
    });
    await edit.click();
    await page.getByText('本机草稿更新失败，原待确认记录仍保留。', { exact: true }).waitFor();
    assert.equal(await save.isDisabled(), true);
    assert.equal(await confirm.isEnabled(), true);
    assert.equal(calls.length, 1);
    await page.evaluate(() => { window.rejectEditablePackage = false; });
    await edit.click();
    await page.getByRole('button', { name: '删除商品 1 的图片' }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: '删除商品 1 的图片' }).click();
    await page.getByRole('button', { name: '返回套餐列表' }).click();
    await page.getByRole('button', { name: '保存草稿并退出' }).click();
    await page.getByRole('button', { name: '新建套餐', exact: true }).first().click();
    await page.getByRole('button', { name: '继续填写', exact: true }).click();
    await save.click();
    await page.getByText('套餐已保存，员工下单时即可选用。', { exact: true }).waitFor();
    assert.deepEqual(calls, [{ key: calls[0].key, multipart: true }, { key: calls[0].key, multipart: false }]);
    assert.deepEqual(fixture.errors, []);
  } finally { gatewayFailure.resolve(); await context.close(); }
});

async function resumeFailedUpload() {
  const fixture = await createOrderFixture(browser, base);
  const { page, context, model, png } = fixture;
  const state = { status: 502, keys: [] };
  await context.route('**/api/me', route => route.fulfill({ json: { success: true, data: {
    accountId: model.account, jobRoles: ['STORE_MANAGER'], access: { permissions: [], uiCapabilities: [] },
  } } }));
  await context.route('**/api/order-packages**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { success: true, data: { items: [], total: 0, size: 20, page: 1 } } });
    state.keys.push(route.request().headers()['idempotency-key']);
    if (state.status === 502) return route.fulfill({ status: 502, body: 'Synthetic gateway failure' });
    if (state.status === 413) return route.fulfill({ status: 413, json: { success: false, code: 'UPLOAD_REQUEST_TOO_LARGE' } });
    return route.fulfill({ status: 201, json: { success: true, data: { id: crypto.randomUUID() } } });
  });
  page.on('dialog', dialog => dialog.accept());
  await page.goto(base + '/#/admin/order-packages');
  await page.reload();
  await page.getByRole('button', { name: '新建套餐', exact: true }).first().click();
  await page.locator('#package-name').fill('原已恢复草稿');
  await page.getByLabel('商品 1 的名称', { exact: true }).fill('商品');
  await page.getByLabel('商品 1 的图片', { exact: true }).setInputFiles({ name: 'phone.png', mimeType: 'image/png', buffer: png });
  const save = page.getByRole('button', { name: '保存套餐', exact: true });
  await save.click();
  await page.getByRole('button', { name: '核对后继续编辑' }).click();
  await save.waitFor();
  return { ...fixture, state, save };
}

const storedPackageNames = page => page.evaluate(async () => {
  const { readPackageDraft, packageDraftTab, packageCreationSlot } = await import('/src/packageDraftStorage.ts');
  const local = await readPackageDraft('alice', packageDraftTab());
  const shared = await readPackageDraft('alice', packageCreationSlot);
  return { local: local?.name, shared: shared?.name };
});

test('套餐草稿移到共享槽时，删除旧副本失败会回滚写入并保留当前输入', async () => {
  const { page, context } = await resumeFailedUpload();
  try {
    await page.locator('#package-name').fill('应保留的新输入');
    await page.evaluate(() => {
      const remove = IDBObjectStore.prototype.delete;
      window.failTabCleanup = true;
      IDBObjectStore.prototype.delete = function (key) {
        if (window.failTabCleanup && this.name === 'drafts' && Array.isArray(key) && key[0] === 'alice' && key[1] !== 'new-package')
          throw new DOMException('Synthetic cleanup failure', 'UnknownError');
        return remove.call(this, key);
      };
    });
    await page.getByRole('button', { name: '返回套餐列表' }).click();
    const save = page.getByRole('button', { name: '保存草稿并退出' });
    await save.click();
    await page.getByText('草稿保存失败。请保留当前页面，检查浏览器存储空间后重试。').waitFor();
    assert.equal(await page.locator('#package-name').inputValue(), '应保留的新输入');
    assert.deepEqual(await storedPackageNames(page), { local: '原已恢复草稿', shared: undefined });
    await page.evaluate(() => { window.failTabCleanup = false; });
    await save.click();
    await page.getByRole('heading', { name: '套餐管理' }).waitFor();
    assert.deepEqual(await storedPackageNames(page), { local: undefined, shared: '应保留的新输入' });
    await page.reload();
    await page.getByRole('button', { name: '新建套餐', exact: true }).first().click();
    await page.getByRole('button', { name: '继续填写', exact: true }).click();
    assert.equal(await page.locator('#package-name').inputValue(), '应保留的新输入');
  } finally { await context.close(); }
});

test('恢复的套餐再次收到 413 后，刷新保留输入、图片及原创建键', async () => {
  const { page, context, state, save } = await resumeFailedUpload();
  try {
    state.status = 413;
    await page.locator('#package-name').fill('拒绝后应保留的名称');
    await save.click();
    await page.getByText(/请求超过大小上限/).waitFor();
    await page.reload();
    await page.locator('#package-name').waitFor();
    assert.equal(await page.locator('#package-name').inputValue(), '拒绝后应保留的名称');
    await page.getByRole('button', { name: '删除商品 1 的图片' }).click();
    state.status = 201;
    await save.click();
    await page.getByText('套餐已保存，员工下单时即可选用。', { exact: true }).waitFor();
    assert.ok(state.keys[0]);
    assert.deepEqual(state.keys, [state.keys[0], state.keys[0], state.keys[0]]);
  } finally { await context.close(); }
});

test('临时空间拒绝后可保存草稿，重开时可编辑且不误报待确认', async () => {
  const fixture = await createOrderFixture(browser, base);
  const { context, page, model, png } = fixture;
  await context.route('**/api/me', route => route.fulfill({ json: { success: true, data: { accountId: model.account, jobRoles: ['STORE_MANAGER'], access: { permissions: [], uiCapabilities: [] } } } }));
  await context.route('**/api/order-packages**', route => route.fulfill(route.request().method() === 'POST'
    ? { status: 503, json: { success: false, code: 'TEMP_STORAGE_UNAVAILABLE' } }
    : { json: { success: true, data: { items: [], total: 0, page: 1, size: 20 } } }));
  page.on('dialog', dialog => dialog.accept());
  try {
    await page.goto(`${base}/#/admin/order-packages`); await page.reload();
    await page.getByRole('button', { name: '新建套餐', exact: true }).first().click();
    await page.locator('#package-name').fill('保留的套餐');
    await page.getByLabel('商品 1 的名称', { exact: true }).fill('商品');
    await page.getByLabel('商品 1 的图片', { exact: true }).setInputFiles({ name: 'phone.png', mimeType: 'image/png', buffer: png });
    await page.getByRole('button', { name: '保存套餐', exact: true }).click();
    await page.getByText('应用临时空间不足，请稍后重试。', { exact: true }).waitFor();
    assert.equal(await page.locator('#package-name').inputValue(), '保留的套餐');
    await page.getByRole('button', { name: '返回套餐列表' }).click();
    await page.getByRole('button', { name: '保存草稿并退出' }).click();
    await page.getByRole('heading', { name: '套餐管理' }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: '新建套餐', exact: true }).first().click();
    await page.getByRole('button', { name: '继续填写', exact: true }).click();
    assert.equal(await page.locator('#package-name').inputValue(), '保留的套餐');
    assert.equal(await page.getByRole('button', { name: '确认原操作结果' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '保存套餐', exact: true }).isEnabled(), true);
    assert.deepEqual(fixture.errors, []);
  } finally { await context.close(); }
});

test('删除已确认但本机清理失败时显示原因并保留重试，不产生未处理异常', async () => {
  const fixture = await createOrderFixture(browser, base);
  const { context, page, model } = fixture;
  const value = { id: crypto.randomUUID(), name: '待删套餐', items: [], version: 0, originalAmountCents: null, memberAmountCents: null, updatedAt: new Date().toISOString() };
  let deleted = false, deletes = 0;
  await context.route('**/api/me', route => route.fulfill({ json: { success: true, data: { accountId: model.account, jobRoles: ['STORE_MANAGER'], access: { permissions: [], uiCapabilities: [] } } } }));
  await context.route('**/api/order-packages**', route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === 'DELETE') { deleted = true; deletes++; return route.fulfill({ status: 503, json: { success: false, code: 'SERVICE_UNAVAILABLE' } }); }
    if (path.endsWith(value.id)) return route.fulfill({ status: 404, json: { success: false, code: 'PACKAGE_NOT_FOUND' } });
    return route.fulfill({ json: { success: true, data: { items: deleted ? [] : [value], total: deleted ? 0 : 1, page: 1, size: 20 } } });
  });
  page.on('dialog', dialog => dialog.accept());
  try {
    await page.goto(`${base}/#/admin/order-packages`); await page.reload();
    await page.getByRole('button', { name: '删除', exact: true }).click();
    await page.getByRole('button', { name: '确认原操作结果' }).waitFor();
    await page.evaluate(() => {
      window.restorePackageDelete = IDBObjectStore.prototype.delete;
      IDBObjectStore.prototype.delete = function (key) {
        if (this.name === 'drafts') throw new DOMException('synthetic local cleanup failure', 'UnknownError');
        return window.restorePackageDelete.call(this, key);
      };
    });
    await page.getByRole('button', { name: '确认原操作结果' }).click();
    await page.getByText('服务端结果已确认，但本机恢复记录未能清理，请重试确认。', { exact: true }).waitFor();
    await page.evaluate(() => { IDBObjectStore.prototype.delete = window.restorePackageDelete; });
    await page.getByRole('button', { name: '确认原操作结果' }).click();
    await page.getByText('套餐已删除，已带入订单的商品不受影响。', { exact: true }).waitFor();
    assert.equal(deletes, 1); assert.deepEqual(fixture.errors, []);
  } finally { await context.close(); }
});

test("新建套餐恢复图片，放弃新输入保留旧稿，提交恢复稿后消费原版本", async () => {
  const fixture = await createOrderFixture(browser, base);
  const { context, page, model, png } = fixture;
  await context.route("**/api/me", route => route.fulfill({ json: { success: true, data: { accountId: model.account, jobRoles: ["STORE_MANAGER"], access: { permissions: [], uiCapabilities: [] } } } }));
  let writes = 0;
  await context.route("**/api/order-packages**", route => {
    if (route.request().method() === "POST") {
      writes++;
      return route.fulfill({ status: 201, json: { success: true, data: { id: crypto.randomUUID() } } });
    }
    return route.fulfill({ json: { success: true, data: { items: [], total: 0, page: 1, size: 20 } } });
  });
  const start = () => page.getByRole("button", { name: "新建套餐", exact: true }).first().click();
  const back = () => page.getByRole("button", { name: "返回套餐列表" }).click();
  const name = page.locator("#package-name");
  const button = name => page.getByRole("button", { name, exact: true });
  try {
    await page.goto(`${base}/#/admin/order-packages`); await page.reload();
    await start(); await back();
    await page.getByRole("heading", { name: "套餐管理", exact: true }).waitFor();
    await start();
    await name.fill("旧草稿");
    await page.getByLabel("商品 1 的图片", { exact: true }).setInputFiles({ name: "kept.png", mimeType: "image/png", buffer: png });
    await back(); await page.getByRole("dialog", { name: "保存草稿？" }).waitFor({ timeout: 3500 });
    await page.keyboard.press("Escape");
    assert.equal(await name.inputValue(), "旧草稿");
    await back(); await button("保存草稿并退出").click();
    await start(); await button("重新填写").click();
    assert.equal(await name.inputValue(), "");
    await name.fill("临时输入");
    await page.getByRole("link", { name: "日历工作台" }).click();
    await button("不保存并退出").click();
    await page.getByRole("link", { name: "套餐管理" }).click();
    await start(); await button("继续填写").click();
    assert.equal(await name.inputValue(), "旧草稿");
    assert.equal(await button("删除商品 1 的图片").count(), 1);
    await name.fill("覆盖后的草稿");
    await back(); await button("保存草稿并退出").click();
    await page.reload();
    await start(); await button("继续填写").click();
    assert.equal(await name.inputValue(), "覆盖后的草稿");
    await page.getByLabel("商品 1 的名称", { exact: true }).fill("测试商品");
    await button("保存套餐").click();
    await page.getByText("套餐已保存，员工下单时即可选用。", { exact: true }).waitFor();
    assert.equal(writes, 1);
    await start();
    await name.waitFor();
    assert.equal(await name.inputValue(), "");
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.deepEqual(fixture.errors, []);
  } finally { await context.close(); }
});
