import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DRAFT_TEST_URL || 'http://127.0.0.1:5197';
import { createOrderFixture, orderId } from './orderBrowserFixture.mjs';
let browser;
before(async () => { browser = await chromium.launch({ headless: true, channel: process.env.DRAFT_BROWSER_CHANNEL || 'chrome' }); });
after(async () => { await browser?.close(); });
async function until(check) {
  for (let n = 0; n < 200; n++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error('等待图片状态超时');
}
const fixture = () => createOrderFixture(browser, base);

test('逐商品选图限制五张、刷新恢复、移除及多标签页冲突', async () => {
  const f = await fixture(), { context, page, select, saved, errors } = f;
  try {
    await select(['a.png', 'b.png', 'c.png', 'd.png', 'e.png']);
    await until(async () => (await saved())?.value.items[0].images?.length === 5);
    await select(['six.png']); await page.getByText(/还可添加 0 张/).waitFor(); assert.equal((await saved()).value.items[0].images.length, 5);
    await page.getByRole('button', { name: '添加商品', exact: true }).click();
    await select(['second.png']); await until(async () => (await saved()).value.items[1].images?.length === 1);
    const original = await saved();
    await page.reload(); await page.getByRole('button', { name: '继续填写', exact: true }).click();
    await page.getByAltText('second.png', { exact: true }).waitFor();
    assert.deepEqual((await saved()).value.items.map(item => item.key), original.value.items.map(item => item.key));
    await page.getByRole('button', { name: '上一个商品', exact: true }).click();
    await page.getByAltText('a.png', { exact: true }).waitFor();
    await page.getByRole('button', { name: '移除已选图片：a.png', exact: true }).click();
    await until(async () => (await saved()).value.items[0].images.length === 4);
    const peer = await context.newPage(); await peer.goto(`${base}/#/orders/new`); await peer.getByRole('button', { name: '继续填写', exact: true }).click();
    await select(['replacement.png']); await until(async () => (await saved()).value.items[0].images.length === 5);
    await peer.getByText(/其他标签页已更新/).waitFor(); assert.equal(await peer.getByRole('button', { name: '添加图片', exact: true }).isDisabled(), true);
    await peer.close();
    if (process.env.IMAGE_SCREENSHOT_DIR) { await page.locator('.draft-item-images').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.IMAGE_SCREENSHOT_DIR}/item-images-create-mobile.png` }); }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('创建及上传响应丢失不重复建单传图，失败队列刷新后可按商品补传', async () => {
  const f = await fixture(), { context, page, model, select, saved, queue, complete, errors } = f;
  try {
    await complete(); await select(['ok.png', 'fail.png']); await until(async () => (await saved()).value.items[0].images?.length === 2);
    await page.getByRole('button', { name: '添加商品', exact: true }).click(); await page.locator('[id="items.1.name"]').fill('蛋糕B');
    await select(['lost.png']); await until(async () => (await saved()).value.items[1].images?.length === 1);
    const before = await saved(); model.loseCreate = true; model.failNames.add('fail.png'); model.lostNames.add('lost.png');
    await page.getByRole('button', { name: '创建订单', exact: true }).click();
    await page.getByRole('button', { name: '重试确认原订单', exact: true }).click();
    await page.waitForURL(`**/#/orders/${orderId}`);
    await until(async () => (await queue()).length === 2 && (await queue()).every(row => row.error));
    assert.equal(model.orders.size, 1); assert.equal(model.createCalls.length, 2); assert.equal(model.createCalls[0].key, model.createCalls[1].key);
    assert.deepEqual(model.createCalls[0].input.items.map(item => item.itemId), before.value.items.map(item => item.key));
    assert.equal(model.images.length, 2); assert.equal(await saved(), null);
    await page.reload(); await page.locator('#order-reference-images').waitFor();
    await page.getByRole('button', { name: '下一个商品', exact: true }).click();
    await page.locator('#order-reference-images').getByText('lost.png', { exact: true }).last().waitFor();
    const lost = model.uploads.find(row => row.name === 'lost.png');
    await page.locator('#order-reference-images').getByRole('button', { name: '重试上传', exact: true }).click();
    await until(async () => (await queue()).length === 1); assert.equal(model.images.length, 2);
    assert.equal(model.uploads.filter(row => row.name === 'lost.png').at(-1).key, lost.key);
    await page.getByRole('button', { name: '上一个商品', exact: true }).click();
    model.failNames.clear(); await page.locator('#order-reference-images').getByRole('button', { name: '重试上传', exact: true }).click();
    await until(async () => (await queue()).length === 0); assert.equal(model.images.length, 3);
    assert.equal(new Set(model.images.map(image => image.imageId)).size, 3);
    assert.equal(model.images.filter(image => image.itemId === before.value.items[0].key).length, 2);
    assert.equal(await page.locator('#order-reference-images .image-thumbnail').count(), 2);
    if (process.env.IMAGE_SCREENSHOT_DIR) {
      await page.locator('#order-reference-images').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.IMAGE_SCREENSHOT_DIR}/item-images-detail-mobile.png` });
      await page.setViewportSize({ width: 1440, height: 1000 }); await page.screenshot({ path: `${process.env.IMAGE_SCREENSHOT_DIR}/item-images-detail-desktop.png` });
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('本机图片缺失阻止提交，存储失败不标为已保存，放弃草稿清理文件', async () => {
  const f = await fixture(), { context, page, select, saved, complete, model } = f;
  try {
    await complete(); await select(['missing.png']); await until(async () => (await saved()).value.items[0].images?.length === 1);
    const record = await saved();
    await page.evaluate(async record => { const store = await import('/src/draftImages.ts'); await store.removeDraftImage(record, record.value.items[0].key, record.value.items[0].images[0].id); }, record);
    await page.reload(); await page.getByRole('button', { name: '继续填写', exact: true }).click();
    await page.getByText('本机图片缺失，请移除后重新选择。', { exact: true }).waitFor();
    await page.getByRole('button', { name: '创建订单', exact: true }).click(); await page.getByText(/在本机缺失/).waitFor(); assert.equal(model.createCalls.length, 0);
    await page.getByRole('button', { name: '移除已选图片：missing.png', exact: true }).click();
    await page.evaluate(() => { window.originalImageTransaction = IDBDatabase.prototype.transaction; IDBDatabase.prototype.transaction = function () { throw new DOMException('图片存储空间不足', 'QuotaExceededError'); }; });
    await select(['quota.png']); await page.getByText('本机存储空间不足，图片尚未保存。请释放空间后重试。', { exact: true }).waitFor();
    assert.equal((await saved()).value.items[0].images.length, 0);
    await page.evaluate(() => { IDBDatabase.prototype.transaction = window.originalImageTransaction; });
    await select(['kept.png']); await until(async () => (await saved()).value.items[0].images.length === 1);
    const kept = await saved(); await page.getByRole('button', { name: '放弃草稿', exact: true }).click(); await page.getByRole('button', { name: '确认放弃', exact: true }).click();
    await until(async () => !(await page.evaluate(async record => (await import('/src/draftImages.ts')).readDraftImage(record, record.value.items[0].key, record.value.items[0].images[0].id).then(Boolean), kept)));
  } finally { await context.close(); }
});

test('创建成功后队列保存失败保留订单标识，重试不建第二单且账号隔离待上传图片', async () => {
  const f = await fixture(), { context, page, model, select, saved, queue, complete } = f;
  try {
    await complete(); await select(['deferred.png']); await until(async () => (await saved()).value.items[0].images?.length === 1);
    await page.evaluate(() => {
      window.originalImagePut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) { if (this.name === 'transfers') throw new DOMException('转存失败', 'QuotaExceededError'); return window.originalImagePut.apply(this, args); };
    });
    await page.getByRole('button', { name: '创建订单', exact: true }).click();
    await page.getByText(/订单已创建，图片队列尚未保存完成/).waitFor();
    assert.equal((await saved()).createdOrderId, orderId); assert.equal(model.createCalls.length, 1);
    await page.evaluate(() => { IDBObjectStore.prototype.put = window.originalImagePut; });
    model.failNames.add('deferred.png');
    await page.getByRole('button', { name: '重试保存图片队列', exact: true }).click();
    await page.waitForURL(`**/#/orders/${orderId}`); await until(async () => (await queue()).some(row => row.error));
    assert.equal(model.createCalls.length, 1);
    const calls = model.uploads.length;
    model.account = 'bob'; await page.reload(); await page.locator('#order-reference-images').waitFor();
    assert.deepEqual(await queue(), []); assert.equal(model.uploads.length, calls);
    assert.equal(await page.locator('#order-reference-images').getByText('deferred.png', { exact: true }).count(), 0);
  } finally { await context.close(); }
});

test('历史超额及未关联图片保留，商品切换隔离展示，上传删除遵循权限', async () => {
  const f = await fixture(), { context, page, model, complete } = f;
  try {
    await complete(); await page.getByRole('button', { name: '添加商品', exact: true }).click(); await page.locator('[id="items.1.name"]').fill('蛋糕B');
    await page.getByRole('button', { name: '创建订单', exact: true }).click(); await until(() => Boolean(model.order));
    const first = model.order.items[0].itemId;
    const image = (itemId, name) => ({ imageId: crypto.randomUUID(), orderId, itemId, filename: name, contentType: 'image/png', size: 100, width: 10, height: 10, uploadedBy: 'alice', uploaderNameSnapshot: 'alice', uploadedAt: '2026-11-04T08:00:00Z' });
    model.images = [...Array.from({ length: 6 }, (_, i) => image(first, `legacy-${i}.png`)), image(null, 'unassigned.png'), image(crypto.randomUUID(), 'removed-item.png')];
    await page.goto(`${base}/#/orders/${orderId}`);
    await until(async () => await page.locator('#order-reference-images .image-thumbnail').count() === 8);
    assert.equal(await page.locator('#order-reference-images').getByRole('button', { name: '添加图片', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: '下一个商品', exact: true }).click();
    await page.getByText('该商品暂无款式图片。', { exact: true }).waitFor();
    assert.equal(await page.locator('#order-reference-images .image-thumbnail').count(), 2);
    model.permissions = model.permissions.filter(permission => !['ORDER_IMAGE_UPLOAD', 'ORDER_IMAGE_DELETE'].includes(permission));
    await page.reload(); await page.locator('#order-reference-images').waitFor();
    assert.equal(await page.locator('#order-reference-images').getByRole('button', { name: '添加图片', exact: true }).count(), 0);
    assert.equal(await page.locator('#order-reference-images').getByRole('button', { name: '移除图片：legacy-0.png', exact: true }).isDisabled(), true);
  } finally { await context.close(); }
});

test('识别替换和撤销保留原商品图片，明确删除商品后清理对应文件', async () => {
  const f = await fixture(), { context, page, model, select, saved, complete } = f;
  try {
    await complete(); await select(['original.png']); await until(async () => (await saved()).value.items[0].images?.length === 1);
    const original = await saved();
    const field = value => ({ value, source: 'RULE', evidence: ['合成原文'], needsReview: false, issues: [] });
    model.recognitionDraft = { fields: {}, items: [{ id: 'recognized', fields: { name: field('新蛋糕'), quantity: field('1'), productType: field('CAKE'), size: field('8') } }], issues: [], fragments: [], unmappedText: [], assistAvailable: false };
    await page.getByText('粘贴下单信息', { exact: true }).click(); await page.locator('#recognition-text').fill('合成新蛋糕');
    await page.getByRole('button', { name: '识别并填入', exact: true }).click();
    await page.getByRole('button', { name: '撤销本次填入', exact: true }).click();
    await page.getByAltText('original.png', { exact: true }).waitFor();
    assert.equal((await saved()).value.items[0].key, original.value.items[0].key);
    await page.getByRole('button', { name: '添加商品', exact: true }).click();
    await page.getByRole('button', { name: '上一个商品', exact: true }).click();
    await page.locator('button[aria-label="移除商品 1"]:enabled').click();
    await until(async () => !(await page.evaluate(async record => (await import('/src/draftImages.ts')).readDraftImage(record, record.value.items[0].key, record.value.items[0].images[0].id).then(Boolean), original)));
  } finally { await context.close(); }
});
