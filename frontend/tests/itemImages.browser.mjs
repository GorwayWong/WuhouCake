import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DRAFT_TEST_URL || 'http://127.0.0.1:5197';
import { createOrderFixture, movePendingOrderDraftToLegacy, orderId, cycleOrderDraft, openOrderDraft, resumeOrderDraft, saveOrderDraftAndExit } from './orderBrowserFixture.mjs';
let browser;
before(async () => { browser = await chromium.launch({ headless: true, channel: process.env.DRAFT_BROWSER_CHANNEL || 'chrome' }); });
after(async () => { await browser?.close(); });
async function until(check) {
  for (let n = 0; n < 200; n++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error('等待图片状态超时');
}
const fixture = () => createOrderFixture(browser, base);

test('查重提示后保留已保存图片，未保存的移除可通过刷新恢复', async () => {
  const { context, page, model, complete, select } = await fixture();
  const token = 'b'.repeat(32) + '.' + 'a'.repeat(64);
  try {
    await context.route('**/api/orders', async route => {
      if (route.request().method() !== 'POST' || route.request().headers()['x-wuhou-duplicate-check'] === token)
        return route.fallback();
      return route.fulfill({ status: 409, json: { success: false, code: 'DUPLICATE_REVIEW_REQUIRED',
        data: { count: 1, orderNos: ['ORDER-123'], token } } });
    });
    await complete();
    await select(['review.png']);
    await page.getByAltText('review.png', { exact: true }).waitFor();
    await page.getByRole('button', { name: '创建订单', exact: true }).click();
    await page.getByRole('button', { name: '按独立订单保存', exact: true }).waitFor();
    await page.getByRole('button', { name: '移除已选图片：review.png', exact: true }).click();
    assert.equal(await page.getByAltText('review.png', { exact: true }).count(), 0);
    page.once('dialog', dialog => dialog.accept());
    await page.reload();
    await page.getByAltText('review.png', { exact: true }).waitFor();
    assert.equal(model.createCalls.length, 0);
    await page.getByRole('button', { name: '按独立订单保存', exact: true }).click();
    await page.waitForURL(`**/#/orders/${orderId}`);
    await until(() => model.images.length === 1);
    assert.equal(model.createCalls.length, 1);
    assert.deepEqual(model.uploads.map(upload => upload.name), ['review.png']);
  } finally { await context.close(); }
});

test('逐商品选图限制五张、保存恢复、以及两个标签页的图片相互隔离', async () => {
  const f = await fixture(), { context, page, select, saved, errors } = f;
  try {
    await select(['a.png', 'b.png', 'c.png', 'd.png', 'e.png']);
    await page.getByAltText('e.png', { exact: true }).waitFor();
    await select(['six.png']); await page.getByText(/还可添加 0 张/).waitFor(); assert.equal(await page.locator('.draft-image-thumbnail').count(), 5);
    await page.getByRole('button', { name: '添加商品', exact: true }).click();
    await select(['second.png']); await page.getByAltText('second.png', { exact: true }).waitFor();
    await saveOrderDraftAndExit(page); const original = await saved();
    await page.reload(); await openOrderDraft(page);
    await page.getByAltText('second.png', { exact: true }).waitFor();
    assert.deepEqual((await saved()).value.items.map(item => item.key), original.value.items.map(item => item.key));
    await page.getByRole('button', { name: '上一个商品', exact: true }).click();
    await page.getByAltText('a.png', { exact: true }).waitFor();
    await page.getByRole('button', { name: '移除已选图片：a.png', exact: true }).click();
    assert.equal(await page.locator('.draft-image-thumbnail').count(), 4);
    const peer = await context.newPage(); await peer.goto(`${base}/#/orders/new`); await resumeOrderDraft(peer);
    await peer.getByRole('button', { name: '上一个商品', exact: true }).click();
    await peer.getByAltText('a.png', { exact: true }).waitFor();
    await select(['replacement.png']); await page.getByAltText('replacement.png', { exact: true }).waitFor();
    assert.equal(await peer.getByAltText('replacement.png', { exact: true }).count(), 0);
    assert.equal(await peer.getByAltText('a.png', { exact: true }).count(), 1);
    await peer.close();
    if (process.env.IMAGE_SCREENSHOT_DIR) { await page.locator('.draft-item-images').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.IMAGE_SCREENSHOT_DIR}/item-images-create-mobile.png` }); }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('创建及上传响应丢失不重复建单传图，失败队列刷新后可按商品补传', async () => {
  const f = await fixture(), { context, page, model, select, saved, queue, complete, errors } = f;
  try {
    await complete(); await select(['ok.png', 'fail.png']); await page.getByAltText('fail.png', { exact: true }).waitFor();
    await page.getByRole('button', { name: '添加商品', exact: true }).click(); await page.locator('[id="items.1.name"]').fill('蛋糕B');
    const nearLimit = Buffer.alloc(5 * 1024 * 1024);
    f.png.copy(nearLimit);
    await page.locator('input[type=file]').setInputFiles({ name: 'lost.png', mimeType: 'image/png', buffer: nearLimit });
    await page.getByAltText('lost.png', { exact: true }).waitFor();
    await cycleOrderDraft(page);
    const before = await saved();
    assert.equal(before.value.items[1].images[0].size, nearLimit.length);
    model.loseCreate = true; model.failNames.add('fail.png'); model.lostNames.add('lost.png');
    await page.getByRole('button', { name: '创建订单', exact: true }).click();
    await page.getByRole('button', { name: '重试提交', exact: true }).click();
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
    const previous = page.getByRole('button', { name: '上一个商品', exact: true });
    if (await previous.isEnabled()) await previous.click();
    await page.locator('#order-reference-images').getByText('fail.png', { exact: true }).waitFor();
    model.failNames.clear(); await page.locator('#order-reference-images').getByRole('button', { name: '重试上传', exact: true }).click();
    await until(async () => (await queue()).length === 0); assert.equal(model.images.length, 3);
    assert.equal(new Set(model.images.map(image => image.imageId)).size, 3);
    assert.equal(model.images.filter(image => image.itemId === before.value.items[0].key).length, 2);
    await until(async () => await page.locator('#order-reference-images .image-thumbnail').count() === 2);
    if (process.env.IMAGE_SCREENSHOT_DIR) {
      await page.locator('#order-reference-images').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.IMAGE_SCREENSHOT_DIR}/item-images-detail-mobile.png` });
      await page.setViewportSize({ width: 1440, height: 1000 }); await page.screenshot({ path: `${process.env.IMAGE_SCREENSHOT_DIR}/item-images-detail-desktop.png` });
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('本机图片缺失阻止提交，可移除后重新选图并保存', async () => {
  const { context, page, select, saved, complete, model } = await fixture();
  try {
    await complete(); await select(['missing.png']); await page.getByAltText('missing.png', { exact: true }).waitFor();
    await saveOrderDraftAndExit(page);
    await page.evaluate(async () => {
      const { readCreationDraft, saveCreationDraft } = await import('/src/creationDraftStorage.ts');
      const saved = await readCreationDraft('order:alice');
      await saveCreationDraft('order:alice', saved.revision, { ...saved.value, images: [] });
    });
    await openOrderDraft(page);
    await page.getByText('本机图片缺失，请移除后重新选择。', { exact: true }).waitFor();
    await page.getByRole('button', { name: '创建订单', exact: true }).click();
    await page.getByText(/在本机缺失/).waitFor(); assert.equal(model.createCalls.length, 0);
    await page.getByRole('button', { name: '移除已选图片：missing.png', exact: true }).click();
    await select(['kept.png']); await page.getByAltText('kept.png', { exact: true }).waitFor();
    await cycleOrderDraft(page);
    assert.deepEqual((await saved()).value.items[0].images.map(image => image.name), ['kept.png']);
  } finally { await context.close(); }
});

test('创建成功后队列保存失败保留订单标识，旧页放弃记录后新版仍可补传且图片按账号隔离', async () => {
  const f = await fixture(), { context, page, model, select, saved, queue, complete } = f;
  try {
    await complete(); await select(['deferred.png']); await page.getByAltText('deferred.png', { exact: true }).waitFor();
    await page.evaluate(() => {
      window.originalImagePut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) { if (this.name === 'transfers') throw new DOMException('转存失败', 'QuotaExceededError'); return window.originalImagePut.apply(this, args); };
    });
    await page.getByRole('button', { name: '创建订单', exact: true }).click();
    await page.getByText(/订单已创建，部分图片未上传/).waitFor();
    assert.equal((await saved()).createdOrderId, orderId); assert.equal(model.createCalls.length, 1);
    await page.evaluate(() => { IDBObjectStore.prototype.put = window.originalImagePut; });
    await movePendingOrderDraftToLegacy(page);
    const oldRecord = await page.evaluate(() => JSON.parse(localStorage.getItem('wuhou:order-draft:v1:alice')));
    const oldTab = await context.newPage();
    await oldTab.goto(base);
    await page.reload();
    await page.getByRole('button', { name: '重试上传图片', exact: true }).waitFor();
    await oldTab.evaluate(async current => {
      const { OrderDraftSlot } = await import('/src/orderDraftStorage.ts');
      const storage = new OrderDraftSlot(current.accountId);
      const stored = storage.read();
      // Emulate the cleanup in a still-running pre-upgrade tab.
      if (stored.invalid || stored.record &&
          (current.requestId !== stored.record.requestId || current.revision !== stored.record.revision)) return;
      storage.remove();
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('wuhou-order-images', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction('files', 'readwrite');
          tx.oncomplete = resolve;
          tx.onabort = () => reject(tx.error);
          const files = tx.objectStore('files');
          const rows = files.index('draft').getAll([current.accountId, current.requestId]);
          rows.onsuccess = () => { for (const row of rows.result) if (!row.orderId) files.delete(row.key); };
        });
      } finally { db.close(); }
    }, oldRecord);
    await oldTab.close();
    model.failNames.add('deferred.png');
    await page.getByRole('button', { name: '重试上传图片', exact: true }).click();
    await page.waitForURL(`**/#/orders/${orderId}`); await until(async () => (await queue()).some(row => row.error));
    assert.equal(model.createCalls.length, 1);
    const calls = model.uploads.length;
    model.account = 'bob'; await page.reload(); await page.locator('#order-reference-images').waitFor();
    assert.deepEqual(await queue(), []); assert.equal(model.uploads.length, calls);
    assert.equal(await page.locator('#order-reference-images').getByText('deferred.png', { exact: true }).count(), 0);
  } finally { await context.close(); }
});

for (const partial of [false, true]) test(`旧页已${partial ? '部分' : '全部'}传图后新版按凭证完成恢复`, async () => {
  const { context, page, model, select, saved, complete, errors } = await fixture();
  try {
    await complete();
    await select(partial ? ['confirmed.png', 'remaining.png'] : ['confirmed.png']);
    await page.getByAltText('confirmed.png', { exact: true }).waitFor();
    model.loseCreate = true;
    await page.getByRole('button', { name: '创建订单', exact: true }).click();
    const retry = name => page.getByRole('button', { name, exact: true });
    await retry('重试提交').waitFor();
    const record = await saved();
    await movePendingOrderDraftToLegacy(page);
    await page.reload();
    await retry('重试提交').waitFor();
    const confirmed = await page.evaluate(async ({ record, order }) => {
      const { promoteDraftImages, imageQueue, removeQueuedImage, forgetImageTransfer } = await import('/src/draftImages.ts');
      const { OrderDraftSlot } = await import('/src/orderDraftStorage.ts');
      const { uploadOrderImage } = await import('/src/api.ts');
      const legacy = new OrderDraftSlot(record.accountId);
      legacy.read();
      legacy.write({ ...record, createdOrderId: order.orderId });
      await promoteDraftImages(record, order, () => { throw new Error('unexpected receipt lookup'); });
      legacy.remove();
      await forgetImageTransfer(record);
      const image = (await imageQueue(record.accountId, order.orderId)).find(row => row.name === 'confirmed.png');
      await uploadOrderImage(order.orderId, new File([image.file], image.name, { type: image.type }), image.itemId, undefined, image.id);
      await removeQueuedImage(image);
      return { id: image.id, itemId: image.itemId };
    }, { record, order: model.order });
    let outcome = partial ? 'unavailable' : 'verified';
    await context.route(`**/api/orders/${orderId}/image-upload-receipts?**`, route => {
      assert.deepEqual(new URL(route.request().url()).searchParams.getAll('requestId'), [confirmed.id]);
      if (outcome === 'unavailable') return route.fulfill({ status: 503, json: { success: false, code: 'SERVICE_UNAVAILABLE' } });
      const data = outcome === 'missing' ? {} : { [confirmed.id]: outcome === 'verified' ? confirmed.itemId : crypto.randomUUID() };
      return route.fulfill({ json: { success: true, data } });
    });
    await page.reload();
    await retry('重试提交').click();
    if (partial) {
      await page.getByText(/暂时无法核对图片上传结果/).waitFor();
      assert.equal((await saved()).createdOrderId, orderId);
      for (const unverified of ['wrong-item', 'missing']) {
        outcome = unverified;
        await Promise.all([
          page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/image-upload-receipts')),
          retry('重试上传图片').click(),
        ]);
        await page.getByText(/无法确认已上传/).waitFor();
        await retry('重试上传图片').waitFor();
        assert.equal((await saved()).createdOrderId, orderId);
        assert.equal(model.uploads.length, 1);
      }
      outcome = 'verified';
      await retry('重试上传图片').click();
    }
    await page.waitForURL(`**/#/orders/${orderId}`);
    await until(() => model.uploads.length === (partial ? 2 : 1));
    assert.equal(model.orders.size, 1);
    assert.equal(model.createCalls.length, 2);
    assert.equal(await saved(), null);
    assert.deepEqual(model.uploads.map(upload => upload.name), partial ? ['confirmed.png', 'remaining.png'] : ['confirmed.png']);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('新版明确放弃已迁移记录时清理本机待传文件', async () => {
  const { context, page, model, select, saved, complete } = await fixture();
  try {
    await complete(); await select(['abandoned.png']);
    await page.getByAltText('abandoned.png', { exact: true }).waitFor();
    model.loseCreate = true;
    await page.getByRole('button', { name: '创建订单', exact: true }).click();
    await page.getByRole('button', { name: '重试提交', exact: true }).waitFor();
    const record = await saved();
    const hasFile = () => page.evaluate(async draft => {
      const { readDraftImage } = await import('/src/draftImages.ts');
      const item = draft.value.items[0];
      return Boolean(await readDraftImage(draft, item.key, item.images[0].id));
    }, record);
    await movePendingOrderDraftToLegacy(page);
    await page.reload();
    await page.getByRole('button', { name: '放弃待确认记录', exact: true }).click();
    assert.equal(await hasFile(), true);
    await page.getByRole('button', { name: '确认放弃', exact: true }).click();
    await until(async () => !await hasFile());
    assert.equal(await saved(), null);
    assert.equal(model.createCalls.length, 1);
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
    await complete(); await select(['original.png']); await page.getByAltText('original.png', { exact: true }).waitFor();
    const field = value => ({ value, source: 'RULE', evidence: ['合成原文'], needsReview: false, issues: [] });
    model.recognitionDraft = { fields: {}, items: [{ id: 'recognized', fields: { name: field('新蛋糕'), quantity: field('1'), productType: field('CAKE'), size: field('8') } }], issues: [], fragments: [], unmappedText: [], assistAvailable: false };
    await page.getByText('粘贴下单信息', { exact: true }).click(); await page.locator('#recognition-text').fill('合成新蛋糕');
    await page.getByRole('button', { name: '识别并填入', exact: true }).click();
    await page.getByRole('button', { name: '撤销本次填入', exact: true }).click();
    await page.getByAltText('original.png', { exact: true }).waitFor();
    await page.getByRole('button', { name: '添加商品', exact: true }).click();
    await page.getByRole('button', { name: '上一个商品', exact: true }).click();
    await page.locator('button[aria-label="移除商品 1"]:enabled').click();
    await cycleOrderDraft(page);
    assert.equal((await saved()).value.items.length, 1);
    assert.deepEqual((await saved()).value.items[0].images ?? [], []);
  } finally { await context.close(); }
});
