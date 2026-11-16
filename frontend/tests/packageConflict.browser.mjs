import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRequire } from 'node:module';
import { createOrderFixture } from './orderBrowserFixture.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DRAFT_TEST_URL || 'http://127.0.0.1:5197';
let browser;
before(async () => { browser = await chromium.launch({ headless: true, channel: 'chrome' }); });
after(async () => { await browser?.close(); });

function packageBody(request) {
  const contentType = request.headers()['content-type'];
  if (!contentType.includes('multipart/form-data')) return request.postDataJSON();
  const boundary = contentType.split('boundary=')[1];
  const part = request.postDataBuffer().toString().split('--' + boundary).find(value => value.includes('name="package"'));
  return JSON.parse(part.split('\r\n\r\n')[1]);
}

async function editors(width) {
  const first = await createOrderFixture(browser, base), second = await createOrderFixture(browser, base);
  const server = { response: 'normal', puts: 0, lastBody: null };
  let stored = {
    id: crypto.randomUUID(), name: '双人套餐', version: 1, originalAmountCents: 10000, memberAmountCents: null,
    items: [{ itemId: crypto.randomUUID(), imageId: crypto.randomUUID(), name: '果汁', productType: 'OTHER', quantity: 1,
      attributes: { specification: '旧备注' }, unitPriceCents: null, memberPriceCents: null }],
  };
  for (const [fixture, name] of [[first, '甲'], [second, '乙']]) {
    await fixture.context.route('**/api/me', route => route.fulfill({ json: { success: true, data: {
      accountId: name, nickname: name, jobRoles: ['STORE_MANAGER'], access: { permissions: [], uiCapabilities: [] },
    } } }));
    await fixture.context.route('**/api/order-packages**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (path.endsWith('/order-packages')) return route.fulfill({ json: { success: true, data: { items: [stored], total: 1, size: 20, page: 1 } } });
      if (path.includes('/images/')) {
        if (stored.items.some(item => path.endsWith('/' + item.imageId))) return route.fulfill({ contentType: 'image/png', body: fixture.png });
        return route.fulfill({ status: 404, json: { success: false, code: 'IMAGE_NOT_FOUND' } });
      }
      if (request.method() === 'PUT') {
        server.puts++;
        server.lastBody = packageBody(request);
        const { expectedVersion, ...values } = server.lastBody;
        if (server.response === 'reject-image') return route.fulfill({ status: 400, json: { success: false, code: 'INVALID_IMAGE' } });
        if (expectedVersion !== stored.version) return route.fulfill({ status: 409, json: { success: false, code: 'CONCURRENT_MODIFICATION' } });
        stored = { ...stored, ...values, version: expectedVersion + 1 };
        if (server.response === 'lost') return route.fulfill({ status: 503, json: { success: false, code: 'SERVICE_UNAVAILABLE' } });
      }
      return route.fulfill({ json: { success: true, data: stored } });
    });
    await fixture.page.setViewportSize({ width, height: 900 });
    await fixture.page.goto(`${base}/#/admin/order-packages`);
    await fixture.page.reload();
    await fixture.page.getByRole('button', { name: '编辑', exact: true }).click();
    await fixture.page.getByRole('heading', { name: '编辑套餐' }).waitFor();
  }
  return { first, second, server, current: () => stored, close: async () => Promise.all([first.context.close(), second.context.close()]) };
}
const save = page => page.getByRole('button', { name: '保存修改' });
const conflict = page => page.getByRole('region', { name: '核对最新套餐' });
const upload = (fixture, name) => fixture.page.locator('input[type=file]').first().setInputFiles({ name, mimeType: 'image/png', buffer: fixture.png });
async function saveRemote(page) {
  await save(page).click();
  await page.getByText('套餐已保存，员工下单时即可选用。').waitFor();
}

test('手机双人换图和改价备注自动合并，再次更新时可重新核对', async () => {
  const session = await editors(390);
  const { first, second, current } = session;
  try {
    const oldImage = current().items[0].imageId;
    await second.page.getByRole('button', { name: '编辑商品 1 的规格' }).click();
    await second.page.getByLabel('单价（元）', { exact: true }).fill('88');
    await second.page.getByLabel('特殊要求备注').fill('乙的备注');
    await second.page.getByRole('button', { name: '确认规格' }).click();
    await upload(first, '甲第一次换图.png');
    await saveRemote(first.page);
    assert.notEqual(current().items[0].imageId, oldImage);
    await save(second.page).click();
    await conflict(second.page).getByRole('button', { name: '读取最新版本' }).click();
    await conflict(second.page).getByText('双方的修改可以合并。').waitFor();
    await conflict(second.page).getByRole('button', { name: '应用合并结果' }).click();
    await first.page.getByRole('button', { name: '编辑', exact: true }).click();
    await upload(first, '甲第二次换图.png');
    await saveRemote(first.page);
    const newest = current().items[0].imageId;
    await save(second.page).click();
    await conflict(second.page).getByRole('button', { name: '读取最新版本' }).click();
    await conflict(second.page).getByRole('button', { name: '应用合并结果' }).click();
    await saveRemote(second.page);
    assert.equal(current().items[0].imageId, newest);
    assert.equal(current().items[0].attributes.specification, '乙的备注');
    assert.equal(current().originalAmountCents, 8800);
    assert.deepEqual(first.errors.concat(second.errors), []);
  } finally { await session.close(); }
});

test('桌面双方都换图时展示两个预览，选择后只保存采用的图片', async () => {
  const session = await editors(1280);
  const { first, second, current } = session;
  try {
    await upload(first, '甲.png');
    await upload(second, '乙.png');
    await saveRemote(first.page);
    const newest = current().items[0].imageId;
    await save(second.page).click();
    const panel = conflict(second.page);
    await panel.getByRole('button', { name: '读取最新版本' }).click();
    const apply = panel.getByRole('button', { name: '应用合并结果' });
    await apply.waitFor();
    assert.equal(await apply.isDisabled(), true);
    await panel.getByRole('img', { name: '套餐商品参考图' }).nth(1).waitFor();
    await panel.getByRole('radio', { name: '使用最新版本' }).check();
    await apply.click();
    await saveRemote(second.page);
    assert.equal(current().items[0].imageId, newest);
    assert.deepEqual(first.errors.concat(second.errors), []);
  } finally { await session.close(); }
});

test('换图被拒后保留本地文件，成功响应丢失时读回结果不重发 PUT', async () => {
  const session = await editors(390);
  const { first, current, server } = session;
  try {
    const originalImage = current().items[0].imageId;
    await upload(first, '待保存参考图.png');
    server.response = 'reject-image';
    await save(first.page).click();
    await first.page.getByText(/图片为空或已损坏/).waitFor();
    assert.equal(current().items[0].imageId, originalImage);
    const chosenImage = server.lastBody.items[0].imageId;
    assert.notEqual(chosenImage, originalImage);
    server.response = 'lost';
    await save(first.page).click();
    const verify = first.page.getByRole('button', { name: '确认原操作结果' });
    await verify.waitFor();
    assert.equal(current().items[0].imageId, chosenImage);
    assert.equal(current().version, 2);
    await verify.click();
    await first.page.getByText('套餐已保存，员工下单时即可选用。').waitFor();
    assert.equal(server.puts, 2);
    assert.equal(current().version, 2);
    assert.deepEqual(first.errors, []);
  } finally { await session.close(); }
});
