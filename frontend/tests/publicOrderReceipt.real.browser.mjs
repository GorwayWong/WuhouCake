import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { test } from 'node:test';
import { testBrowserChannel, closeTestBrowser, openTestContext } from './browserTrace.mjs';

test('真实扫码请求已提交但响应丢失，恢复后返回同一填单回执', async () => {
  const { DRAFT_TEST_URL: base, WUHOU_TEST_ENTRY_TOKEN: token, WUHOU_TEST_RECEIPT_FILE: receiptFile } = process.env;
  assert.ok(base && token && receiptFile, 'Run test-browser-receipt.py to provision the isolated services');
  const browser = await chromium.launch({ headless: true, channel: testBrowserChannel() });
  try {
    const context = await openTestContext(browser);
    const requests = [], receipts = [];
    await context.route(`**/api/public/order-entries/${token}/submissions`, async route => {
      const request = route.request();
      requests.push({ key: request.headers()['idempotency-key'], body: request.postData() });
      const response = await route.fetch();
      receipts.push({ status: response.status(), body: await response.json() });
      if (receipts.length === 1) await route.abort('failed');
      else await route.fulfill({ response });
    });
    const page = await context.newPage();
    await page.goto(`${base}/#/fill/${token}`);
    await page.locator('#phone').fill('13800000000');
    await page.locator('#address').fill('隔离回执验收地址');
    await page.locator('[id="items.0.size"]').fill('6');
    await page.locator('#requestedReceiveAt').click();
    await page.getByRole('button', { name: '今天', exact: true }).click();
    await page.locator('[data-control-label="配送员取货时间小时"] button').click();
    await page.getByRole('option', { name: '18 时', exact: true }).click();
    await page.getByRole('button', { name: '提交预订', exact: true }).click();
    await page.getByText(/原提交结果仍待确认/).waitFor();
    assert.equal(receipts[0].status, 201);
    await page.reload();
    await page.getByRole('button', { name: '恢复草稿' }).click();
    await page.getByRole('button', { name: '重试提交', exact: true }).click();
    await page.getByText(`填单编号：${receipts[0].body.data.submissionNo}`).waitFor();
    assert.ok(requests[0].key);
    assert.deepEqual(requests, [requests[0], requests[0]]);
    assert.deepEqual(receipts, [receipts[0], receipts[0]]);
    await writeFile(receiptFile, receipts[0].body.data.submissionId);
  } finally {
    await closeTestBrowser(browser);
  }
});
