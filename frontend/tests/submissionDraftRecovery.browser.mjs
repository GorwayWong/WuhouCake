import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { createOrderFixture } from './orderBrowserFixture.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DRAFT_TEST_URL || 'http://127.0.0.1:5197';
const id = '20000000-0000-4000-8000-000000000088';
const original = { phone: '13800000000', memberPhone: null, fulfillmentType: 'PICKUP', address: null,
  requestedReceiveAt: '2026-11-17T09:00:00Z', items: [{ itemId: '20000000-0000-4000-8000-000000000089',
    name: '合成蛋糕', productType: 'CAKE', quantity: 1, attributes: { size: '6' } }] };

test('客服刷新后保留输入，与同事的同字段冲突明确选择再提交', async t => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  t.after(() => browser.close());
  const { context, page, model, errors } = await createOrderFixture(browser, base);
  model.permissions.push('CUSTOMER_SUBMISSION_PROCESS');
  let submission = { id, status: 'PENDING', version: 1, ownerId: 'alice', ownerName: '客服',
    createdAt: '2026-11-17T08:00:00Z', orderId: null, original, reviewed: {
      content: original, totalAmountCents: 11000, creditedEmployeeId: 'alice', plannedHandoffAt: null,
      plannedFinishAt: null, prices: [{ unitPriceCents: null, memberPriceCents: null }],
    } };
  let patch;
  await context.route(`**/api/customer-submissions/${id}`, route => {
    if (route.request().method() === 'PATCH') {
      patch = route.request().postDataJSON();
      submission = { ...submission, version: submission.version + 1, reviewed: patch.review };
    }
    return route.fulfill({ json: { success: true, data: { submission, duplicates: [], duplicateCheckToken: null, activities: [] } } });
  });
  await page.goto(`${base}/#/customer-submissions/${id}`);
  await page.reload();
  await page.locator('#phone').fill('13900000000');
  await page.getByText('草稿已保存在本机。').waitFor();
  submission = { ...submission, version: 2, reviewed: {
    ...submission.reviewed, totalAmountCents: 13000, content: { ...original, phone: '13700000000' },
  } };
  await page.reload();
  await page.getByRole('button', { name: '恢复草稿' }).click();
  assert.equal(await page.locator('#phone').inputValue(), '13900000000');
  assert.equal(await page.getByRole('button', { name: '暂存核对结果' }).isDisabled(), true);
  await page.getByRole('button', { name: '核对同事改动' }).click();
  assert.equal(await page.getByRole('textbox', { name: '最新内容' }).inputValue(), '13700000000');
  assert.equal(await page.getByRole('button', { name: '核对后继续编辑' }).isDisabled(), true);
  await page.getByRole('radio', { name: '采用我的输入' }).check();
  await page.getByRole('button', { name: '核对后继续编辑' }).click();
  assert.equal(await page.locator('#totalAmount').inputValue(), '130.00');
  await page.getByRole('button', { name: '暂存核对结果' }).click();
  await page.getByText('核对结果已保存。').waitFor();
  assert.equal(patch.expectedVersion, 2);
  assert.equal(patch.review.content.phone, '13900000000');
  assert.equal(patch.review.totalAmountCents, 13000);
  assert.equal(patch.review.content.items[0].itemId, original.items[0].itemId);
  await page.reload();
  await page.locator('#phone').waitFor();
  assert.equal(await page.getByRole('button', { name: '恢复草稿' }).count(), 0);

  await page.locator('#phone').fill('13600000000');
  await page.getByText('草稿已保存在本机。').waitFor();
  submission = { ...submission, version: 4, status: 'CONFIRMED',
    orderId: '20000000-0000-4000-8000-000000000099' };
  await page.reload();
  await page.getByText('查看本机核对草稿', { exact: true }).click();
  assert.match(await page.getByRole('textbox', { name: '本机核对草稿（可复制）' }).inputValue(), /13600000000/);
  model.account = 'bob';
  await page.reload();
  await page.getByText('已确认填单', { exact: true }).waitFor();
  assert.equal(await page.getByText('查看本机核对草稿', { exact: true }).count(), 0);
  assert.deepEqual(errors, []);
});

test('填单被确认后，旧标签页放弃草稿不能删除另一标签页的新输入', async t => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  t.after(() => browser.close());
  const { context, page, model, errors } = await createOrderFixture(browser, base);
  model.permissions.push('CUSTOMER_SUBMISSION_PROCESS');
  let submission = { id, status: 'PENDING', version: 1, ownerId: 'alice', ownerName: '客服',
    createdAt: '2026-11-17T08:00:00Z', orderId: null, original, reviewed: null };
  const url = `${base}/#/customer-submissions/${id}`;
  await context.route(`**/api/customer-submissions/${id}`, route => route.fulfill({
    json: { success: true, data: { submission, duplicates: [], duplicateCheckToken: null, activities: [] } },
  }));
  await page.clock.install();
  await page.goto(url);
  await page.reload();
  await page.locator('#phone').fill('13900000000');
  await page.getByText('草稿已保存在本机。', { exact: true }).waitFor();

  const other = await context.newPage();
  await other.goto(url);
  await other.getByRole('button', { name: '恢复草稿' }).click();
  await other.locator('#phone').fill('13600000000');
  await other.getByText('草稿已保存在本机。', { exact: true }).waitFor();
  submission = { ...submission, version: 2, status: 'CONFIRMED', orderId: '20000000-0000-4000-8000-000000000099' };

  await page.bringToFront();
  await page.clock.fastForward(15_100);
  await page.getByRole('heading', { name: '已确认填单' }).waitFor();
  await page.getByText('查看本机核对草稿', { exact: true }).click();
  const textbox = tab => tab.getByRole('textbox', { name: '本机核对草稿（可复制）' });
  assert.match(await textbox(page).inputValue(), /13900000000/);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '放弃草稿', exact: true }).click();
  await page.getByText(/另一个标签页已更新草稿/).waitFor();
  assert.match(await textbox(page).inputValue(), /13900000000/);

  await other.reload();
  await other.getByText('查看本机核对草稿', { exact: true }).click();
  assert.match(await textbox(other).inputValue(), /13600000000/);
  other.once('dialog', dialog => dialog.accept());
  await other.getByRole('button', { name: '放弃草稿', exact: true }).click();
  await textbox(other).waitFor({ state: 'detached' });
  await other.reload();
  await other.getByRole('heading', { name: '已确认填单' }).waitFor();
  assert.equal(await other.getByText('查看本机核对草稿', { exact: true }).count(), 0);
  assert.deepEqual(errors, []);
});

test('手机核单排除原图、补图并在重新打开时保留选择', async t => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  t.after(() => browser.close());
  const { context, page, model, errors } = await createOrderFixture(browser, base);
  await page.setViewportSize({ width: 390, height: 844 });
  model.permissions.push('CUSTOMER_SUBMISSION_PROCESS', 'ORDER_IMAGE_UPLOAD');
  const photo = '20000000-0000-4000-8000-000000000071';
  const source = { ...original, items: [{ ...original.items[0], imageIds: [photo] }] };
  let submission = { id, status: 'PENDING', version: 0, ownerId: 'alice', ownerName: '客服',
    createdAt: '2026-11-17T08:00:00Z', orderId: null, original: source, reviewed: null };
  await context.route(`**/api/customer-submissions/${id}`, route => {
    if (route.request().method() === 'PATCH') {
      const patch = route.request().postDataJSON();
      submission = { ...submission, version: submission.version + 1, reviewed: patch.review };
    }
    return route.fulfill({ json: { success: true, data: { submission, duplicates: [], duplicateCheckToken: null, activities: [] } } });
  });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=', 'base64');
  let supplement;
  await context.route(`**/api/customer-submissions/${id}/items/**`, route => {
    if (route.request().method() === 'GET') return route.fulfill({ contentType: 'image/png', body: png });
    supplement = route.request().url().split('/').at(-1);
    return route.fulfill({ json: { success: true, data: supplement } });
  });
  await page.goto(`${base}/#/customer-submissions/${id}`);
  await page.reload();
  await page.getByRole('button', { name: '不采用', exact: true }).click();
  await page.locator('.submission-item-images input[type=file]').setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: png });
  await page.locator('.image-caption').getByText('客服补图 1', { exact: true }).waitFor();
  await page.getByRole('button', { name: '暂存核对结果' }).click();
  await page.getByText('核对结果已保存。').waitFor();
  assert.deepEqual(submission.original.items[0].imageIds, [photo]);
  assert.deepEqual(submission.reviewed.content.items[0].imageIds, [supplement]);
  await page.reload();
  await page.getByRole('button', { name: '重新选用' }).waitFor();
  await page.locator('.image-caption').getByText('客服补图 1', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
});
