import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DRAFT_TEST_URL || 'http://127.0.0.1:5197';

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
      return route.fulfill({ status: 201, json: { success: true, data: { submissionNo: attempts.length === 4 ? 'F-ORIGINAL' : 'F-NEW' } } });
    });

    const phone = page.locator('#phone');
    const submit = page.getByRole('button', { name: '提交预订', exact: true });
    const retry = page.getByRole('button', { name: '重试提交', exact: true });
    const uncertain = page.getByText(/原提交结果仍待确认/);
    const complete = async () => {
      await phone.fill('13800000000');
      await page.locator('#address').fill('测试地址');
      await page.locator('[id="items.0.size"]').fill('6');
      await page.locator('#requestedReceiveAt').click();
      await page.getByRole('button', { name: '今天', exact: true }).click();
      await page.locator('[data-control-label="配送员取货时间小时"] button').click();
      await page.getByRole('option', { name: '18 时', exact: true }).click();
    };

    await page.goto(`${base}/#/fill/retry`);
    await complete();
    await submit.click();
    await page.getByText('填写内容不符合要求，请检查后重试。').waitFor();
    await phone.fill('13900000000');
    await submit.click();
    await uncertain.waitFor();
    assert.equal(await phone.isDisabled(), true);

    await retry.click();
    await page.getByText('提交过于频繁，请稍后再试。').waitFor();
    assert.equal(await uncertain.isVisible(), true);
    assert.equal(await phone.isDisabled(), true);
    await retry.click();
    await page.getByText('填单编号：F-ORIGINAL').waitFor();
    assert.ok(attempts[1].key);
    assert.notEqual(attempts[0].key, attempts[1].key);
    assert.equal(JSON.parse(attempts[1].body).phone, '13900000000');
    assert.deepEqual(attempts.slice(1), Array(3).fill(attempts[1]));

    await page.getByRole('button', { name: '再填一单', exact: true }).click();
    await complete();
    await submit.click();
    await page.getByText('填单编号：F-NEW').waitFor();
    assert.ok(attempts[4].key);
    assert.notEqual(attempts[4].key, attempts[1].key);
  } finally { await browser.close(); }
});
