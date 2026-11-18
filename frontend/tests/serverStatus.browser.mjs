import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { createOrderFixture } from './orderBrowserFixture.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DRAFT_TEST_URL || 'http://127.0.0.1:5197';

test('管理员查看服务器状态，刷新看到告警，权限变化后隐藏旧数据', async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.DRAFT_BROWSER_CHANNEL || 'chrome' });
  try {
    const { context, page, errors } = await createOrderFixture(browser, base);
    await context.route('**/api/me', route => route.fulfill({ json: { success: true, data: {
      accountId: 'alice', nickname: '店长', employeeNumber: '0001', systemRole: 'SUPER_ADMIN', jobRoles: ['STORE_MANAGER'],
      access: { permissions: ['EMPLOYEE_MANAGE'], uiCapabilities: [] },
    } } }));
    const when = '2026-11-18T03:00:00Z';
    const empty = { latestAttempt: null, lastSuccess: null };
    let data = {
      state: 'AVAILABLE', observedAt: when, disk: { availableBytes: 20 * 1024 ** 3, totalBytes: 40 * 1024 ** 3 },
      daily: { latestAttempt: { state: 'SUCCESS', startedAt: when, finishedAt: when, error: null },
        lastSuccess: { verifiedAt: when, bytes: 3 * 1024 ** 2 } },
      predeploy: empty, alerts: [],
    };
    const healthy = data;
    await context.route('**/api/admin/server-status', route => data === null
      ? route.fulfill({ status: 403, json: { success: false, code: 'FORBIDDEN' } })
      : route.fulfill({ json: { success: true, data } }));
    await page.goto(`${base}/#/admin/server-status`);
    await page.reload();
    await page.getByRole('heading', { name: '服务器情况' }).waitFor();
    await page.getByText('20 GiB（50.0%）').waitFor();
    await page.getByText('校验通过').waitFor();
    data = { ...data, alerts: ['DISK_LOW', 'DAILY_FAILED', 'DAILY_OVERDUE'], daily: { ...data.daily,
      latestAttempt: { state: 'FAILED', startedAt: when, finishedAt: when, error: 'VERIFY_FAILED' } } };
    const refresh = page.getByRole('button', { name: '刷新', exact: true });
    await refresh.click();
    await page.getByText('备份验读失败', { exact: true }).waitFor();
    await page.getByText(/日常备份已逾期/).waitFor();
    await page.getByText(/磁盘余量不足/).waitFor();
    await page.getByRole('link', { name: /服务器情况.*有提醒/ }).waitFor();
    assert.equal(await page.getByText('3 MiB', { exact: true }).count(), 1);
    data = { state: 'UNKNOWN' };
    await refresh.click();
    await page.getByText(/状态不可确认/).waitFor();
    assert.equal(await page.getByText('20 GiB（50.0%）').count(), 0);
    data = healthy;
    await refresh.click();
    await page.getByText('20 GiB（50.0%）').waitFor();
    data = null;
    const denied = page.waitForResponse(response => response.url().endsWith('/api/admin/server-status') && response.status() === 403);
    await refresh.click();
    await denied;
    await page.getByText(/状态不可确认/).waitFor();
    assert.equal(await page.getByText('20 GiB（50.0%）').count(), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('普通员工的服务器情况直链不发起状态查询', async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.DRAFT_BROWSER_CHANNEL || 'chrome' });
  try {
    const { page, context } = await createOrderFixture(browser, base);
    let requests = 0;
    await context.route('**/api/admin/server-status', route => { requests++; return route.abort(); });
    await page.goto(`${base}/#/admin/server-status`);
    await page.getByText('仅管理员可以查看服务器情况。').waitFor();
    assert.equal(await page.getByRole('link', { name: /服务器情况/ }).count(), 0);
    assert.equal(requests, 0);
  } finally { await browser.close(); }
});
