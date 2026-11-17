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
  await context.route('**/api/me', route => route.fulfill({ json: { success: true, data: { accountId: model.account, nickname: '店长', jobRoles: ['STORE_MANAGER'], access: { permissions: [], uiCapabilities: [] } } } }));
  await context.route('**/api/order-packages**', async route => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({ json: { success: true, data: { items: [...records.values()], total: records.size, size: 20, page: 1 } } });
    const boundary = request.headers()['content-type'].split('boundary=')[1];
    const text = request.postDataBuffer().toString();
    const part = text.split('--' + boundary).find(value => value.includes('name="package"'));
    const body = JSON.parse(part.split('\r\n\r\n')[1]);
    const filenames = [...text.matchAll(/filename="(phone-\d.png)"/g)].map(value => value[1]);
    const key = request.headers()['idempotency-key']; calls.push({ key, body, filenames });
    if (!records.has(key)) records.set(key, { ...body, id: crypto.randomUUID(), version: 0, updatedAt: new Date().toISOString() });
    if (calls.length === 1) return route.fulfill({ status: 503, json: { success: false, code: 'SERVICE_UNAVAILABLE' } });
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
      await page.getByLabel(`商品 ${i + 1} 的图片`, { exact: true }).setInputFiles({ name: `phone-${i}.png`, mimeType: 'image/png', buffer: png });
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

test('临时空间拒绝后立即刷新恢复可编辑草稿，不误报待确认', async () => {
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
    await page.reload(); await page.locator('#package-name').waitFor();
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
