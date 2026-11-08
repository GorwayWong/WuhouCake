import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { createOrderFixture, orderId } from './orderBrowserFixture.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.DRAFT_TEST_URL || 'http://127.0.0.1:5197';

test('管理筛选双列布局、组合查询、导出、分页和详情返回保留商品名称', async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const { context, page, model, errors, complete } = await createOrderFixture(browser, base);
  const calls = [], exports = [];
  try {
    await complete(); await page.getByRole('button', { name: '创建订单', exact: true }).click();
    await page.waitForURL(url => !url.hash.startsWith('#/orders/new'));
    model.permissions.push('ORDER_MANAGEMENT_READ');
    await context.route('**/api/admin/orders**', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname.endsWith('/export') || url.pathname.endsWith('/exports/zip')) {
        exports.push({ url: url.toString(), body: request.postDataJSON() });
        return route.fulfill({ contentType: url.pathname.endsWith('/zip') ? 'application/zip' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: 'synthetic download' });
      }
      calls.push(url.searchParams);
      return route.fulfill({ json: { success: true, data: { items: [{ orderId, orderNo: 'TEST-IMAGE', receiveDate: '2026-11-05',
        status: 'CAKE_BASE', paymentStatus: 'UNPAID', customerName: '合成客户', phone: '13800000000',
        totalAmountCents: '52000', matchingQuantity: 2, cakeQuantity: 2, products: '草莓蛋糕 ×2', productTypes: ['CAKE'] }],
        totals: { orderCount: 12, matchingQuantity: 24, cakeQuantity: 24, unclassifiedCakeQuantity: 0,
          totalAmountCents: '624000', paidAmountCents: '0', unpaidAmountCents: '624000', missingAmountOrders: 0 },
        sizes: [], employees: [], page: Number(url.searchParams.get('page') || 1), size: 10 } } });
    });
    await page.goto(base + '/#/admin/orders'); await page.reload();
    await page.getByRole('button', { name: '展开筛选条件' }).click();
    const filters = page.locator('.management-filters');
    const product = filters.getByRole('textbox', { name: '商品名称', exact: true });
    const customer = filters.getByRole('textbox', { name: '客户／电话', exact: true });
    const totals = page.locator('.report-totals');
    assert.deepEqual(await totals.locator('dt').allTextContents(), ['匹配订单', '订单总额']);
    assert.deepEqual(await totals.locator('dd').allTextContents(), ['12 单', '¥6240.00']);
    assert.match(await page.locator('.mobile-order-results').innerText(), /匹配 2 件，其中蛋糕 2 个/);
    for (const width of [360, 390, 1280, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      const labels = await filters.locator(':scope > label').evaluateAll(nodes => nodes.map(node => ({
        text: node.childNodes[0].textContent, x: node.getBoundingClientRect().x, y: node.getBoundingClientRect().y,
        width: node.getBoundingClientRect().width
      })));
      assert.deepEqual(labels.slice(0, 10).map(row => row.text), ['日期口径', '开始日期', '结束日期（含当天）', '订单状态', '付款状态', '配送或自提', '蛋糕尺寸（寸）', '下单方式', '客户／电话', '商品名称']);
      if (width >= 360) for (const left of [1, 3, 5, 7]) {
        assert.equal(labels[left].y, labels[left + 1].y); assert.ok(labels[left + 1].x > labels[left].x);
      }
      else assert.equal(labels[1].x, labels[2].x);
      assert.equal(labels[0].width, labels[9].width);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const positions = await totals.locator(':scope > div').evaluateAll(nodes => nodes.map(node => ({ x: node.getBoundingClientRect().x, y: node.getBoundingClientRect().y })));
      assert.equal(positions[0].y, positions[1].y); assert.ok(positions[1].x > positions[0].x);
      if (width === 390 || width === 1280) await totals.screenshot({ path: `/private/tmp/wuhou-management-totals-${width}.png` });
      const dateFits = await filters.locator('.date-control').evaluateAll(nodes => nodes.every(node => {
        const button = node.querySelector('.date-open').getBoundingClientRect();
        const segments = [...node.querySelectorAll('.date-segment')].map(segment => segment.getBoundingClientRect());
        return segments.every(segment => segment.right <= button.left + 1);
      }));
      assert.equal(dateFits, true, `date segments overlap calendar at ${width}px`);
      if (width !== 320) await page.locator('#management-advanced-filters').screenshot({ path: `/private/tmp/wuhou-management-filters-${width}.png` });
    }
    await page.setViewportSize({ width: 390, height: 1000 });
    await filters.locator('[data-control-label="开始日期"] .date-open').click();
    await page.getByRole('dialog', { name: '选择开始日期', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    const status = filters.locator('[data-control-label="订单状态"] .choice-trigger');
    await status.focus(); await page.keyboard.press('Enter'); await page.getByRole('option', { name: '出胚', exact: true }).click();
    await filters.locator('[data-control-label="配送或自提"] .choice-trigger').click();
    await page.getByRole('option', { name: '自提', exact: true }).click();
    await filters.getByRole('textbox', { name: '蛋糕尺寸（寸）', exact: true }).fill('8');
    const method = filters.locator('#management-orderingMethod');
    for (const option of ['下单人', '小程序', '到店', '客服号', '其他']) {
      await method.click(); await page.getByRole('option', { name: option, exact: true }).click();
    }
    await page.getByRole('button', { name: '查询', exact: true }).click();
    assert.equal(await filters.getByRole('textbox', { name: '具体下单方式', exact: true }).evaluate(input => input.validity.valueMissing), true);
    await filters.getByRole('textbox', { name: '具体下单方式', exact: true }).fill(' 微信%_ ');
    for (const width of [360, 390, 1280]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.locator('#management-advanced-filters').screenshot({ path: `/private/tmp/wuhou-ordering-method-${width}.png` });
    }
    await page.setViewportSize({ width: 390, height: 1000 });
    const before = calls.length;
    await product.fill(' 草莓%_蛋糕 '); await customer.fill(' 138 ');
    assert.equal(calls.length, before);
    await page.getByText('筛选已修改，查询后生效', { exact: true }).waitFor();
    await Promise.all([page.waitForResponse(response => response.url().includes('/api/admin/orders?') && response.url().includes('productName=')),
      page.getByRole('button', { name: '查询', exact: true }).click()]);
    assert.equal(calls.at(-1).get('productName'), '草莓%_蛋糕'); assert.equal(calls.at(-1).get('keyword'), '138');
    assert.equal(calls.at(-1).get('status'), 'CAKE_BASE'); assert.equal(calls.at(-1).get('fulfillmentType'), 'PICKUP');
    assert.equal(calls.at(-1).get('sizeInches'), '8');
    assert.equal(calls.at(-1).get('orderingMethod'), '微信%_');
    for (const name of ['导出统计汇总 Excel', '导出逐单 Excel ZIP']) {
      const download = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click(); await download;
    }
    assert.equal(new URL(exports[0].url).searchParams.get('productName'), '草莓%_蛋糕');
    assert.equal(exports[1].body.productName, '草莓%_蛋糕');
    assert.equal(exports[1].body.sizeInches, '8');
    assert.equal(new URL(exports[0].url).searchParams.get('orderingMethod'), '微信%_');
    assert.equal(exports[1].body.orderingMethod, '微信%_');
    await Promise.all([page.waitForResponse(response => response.url().includes('/api/admin/orders?') && response.url().includes('page=2')),
      page.getByRole('navigation', { name: '订单明细分页（上方）' }).getByRole('button', { name: '下一页', exact: true }).click()]);
    await page.locator('.mobile-order-results').getByRole('link', { name: /查看详情/ }).click();
    await page.getByRole('link', { name: '返回查询结果', exact: true }).click();
    await page.getByRole('button', { name: '展开筛选条件' }).click();
    assert.equal(await product.inputValue(), ' 草莓%_蛋糕 ');
    assert.equal(await filters.getByRole('textbox', { name: '具体下单方式', exact: true }).inputValue(), ' 微信%_ ');
    assert.match(await page.getByRole('navigation', { name: '订单明细分页（上方）' }).innerText(), /第 2 \/ 2 页/);
    await page.getByRole('button', { name: '清除筛选', exact: true }).click();
    await page.getByText('筛选已清除，保留当前查询的日期范围和口径。', { exact: true }).waitFor();
    assert.equal(await product.inputValue(), ''); assert.equal(await customer.inputValue(), '');
    const clearedDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出统计汇总 Excel', exact: true }).click(); await clearedDownload;
    assert.equal(new URL(exports.at(-1).url).searchParams.has('productName'), false);
    assert.equal(new URL(exports.at(-1).url).searchParams.has('orderingMethod'), false);
    assert.match(await method.innerText(), /全部/);
    await page.getByRole('button', { name: '所有历史未付款', exact: true }).click();
    await page.getByRole('button', { name: '展开筛选条件' }).click();
    await product.fill('草莓');
    await Promise.all([page.waitForResponse(response => response.url().includes('/api/admin/orders?') && response.url().includes('productName=')),
      page.getByRole('button', { name: '查询', exact: true }).click()]);
    assert.equal(calls.at(-1).has('allUnpaid'), false);
    assert.equal(calls.at(-1).get('productName'), '草莓');
    for (const amount of ['900719925474099100', '0']) {
      await context.route('**/api/admin/orders?**', route => route.fulfill({ json: { success: true, data: {
        items: [], totals: { orderCount: amount === '0' ? 0 : 1, matchingQuantity: 2, cakeQuantity: 2, unclassifiedCakeQuantity: 0,
          totalAmountCents: amount, paidAmountCents: '0', unpaidAmountCents: '0', missingAmountOrders: amount === '0' ? 0 : 1 },
        sizes: amount === '0' ? [] : [{ size: '8', orderCount: 1, cakeQuantity: 2 }], employees: [], page: 1, size: 10
      } } }));
      await page.reload(); await totals.locator('dd').first().waitFor();
      assert.deepEqual(await totals.locator('dt').allTextContents(), ['匹配订单', '订单总额']);
      assert.deepEqual(await totals.locator('dd').allTextContents(), amount === '0' ? ['0 单', '¥0.00'] : ['1 单', '¥9007199254740991.00']);
      await page.locator('.report-range').waitFor();
      assert.match(await page.locator('.report-payment-summary').innerText(), /已付款订单总额.*¥0.00.*未付款订单总额.*¥0.00/s);
      if (amount !== '0') {
        await page.getByText('未报价 1 单', { exact: true }).waitFor();
        await page.getByRole('button', { name: '查看 8 寸明细', exact: true }).waitFor();
      } else await page.getByText('暂无匹配蛋糕。', { exact: true }).waitFor();
      for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (amount !== '0' && width === 390) await totals.screenshot({ path: '/private/tmp/wuhou-management-totals-long.png' });
      }
    }
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});
