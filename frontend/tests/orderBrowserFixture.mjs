import { testJwt } from './testJwt.mjs';
import assert from 'node:assert/strict';
export const orderId = '10000000-0000-4000-8000-000000000001';
export async function createOrderFixture(browser, base) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
  context.setDefaultTimeout(10000);
  await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  const model = { account: 'alice', order: null, orders: new Map(), images: [], createCalls: [], uploads: [], failNames: new Set(), lostNames: new Set(), loseCreate: false,
    permissions: ['ORDER_READ', 'ORDER_CREATE', 'ORDER_EDIT', 'ORDER_CUSTOMER_READ', 'ORDER_AMOUNT_READ', 'ORDER_BUSINESS_DETAILS_READ', 'ORDER_IMAGE_UPLOAD', 'ORDER_IMAGE_DELETE'] };
  let png;
  await context.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const ok = (data, status = 200) => route.fulfill({ status, json: { success: true, data } });
    if (path === '/api/auth/csrf') return route.fulfill({ headers: { 'set-cookie': 'XSRF-TOKEN=test; Path=/' }, json: { success: true, data: { headerName: 'X-XSRF-TOKEN' } } });
    if (path === '/api/auth/refresh' || path === '/api/auth/login') return ok({ accessToken: testJwt('test', { sub: model.account }), expiresIn: 3600, passwordChangeRequired: false });
    if (path === '/api/me') return ok({ accountId: model.account, nickname: model.account, employeeNumber: 'TEST', jobRoles: ['FRONT_DESK'], access: { permissions: model.permissions, uiCapabilities: [] } });
    if (path === '/api/orders/stream') return route.fulfill({ status: 503 });
    if (path === '/api/order-packages') return ok({ items: [], total: 0, page: 1, size: 20 });
    if (path === '/api/employees/options') return ok([]);
    if (path === '/api/orders/recognition/parse') return ok(model.recognitionDraft);
    if (path === '/api/orders' && request.method() === 'POST') {
      const input = request.postDataJSON(), key = request.headers()['idempotency-key']; model.createCalls.push({ key, input });
      if (!model.orders.has(key)) model.orders.set(key, { ...input, orderId, orderNo: 'TEST-IMAGE', status: 'CAKE_BASE', currentStageCode: null, paymentStatus: 'UNPAID', version: 0,
        createdAt: '2026-11-04T08:00:00Z', updatedAt: '2026-11-04T08:00:00Z', createdBy: 'alice', items: input.items.map(({ referenceUnitPriceCents, referenceMemberPriceCents, ...item }) => ({ ...item, unitPriceCents: referenceUnitPriceCents ?? item.unitPriceCents, memberPriceCents: referenceMemberPriceCents ?? item.memberPriceCents, recentNotes: [], productionStatus: 'NOT_STARTED' })) });
      model.order = model.orders.get(key);
      if (model.loseCreate) { model.loseCreate = false; return route.abort('failed'); }
      return ok(model.order, 201);
    }
    if (path === `/api/orders/${orderId}`) return ok(model.order);
    if (path === `/api/orders/${orderId}/images`) {
      if (request.method() === 'GET') return ok(model.images);
      const body = request.postDataBuffer().toString('latin1');
      const itemId = /name="itemId"\r\n\r\n([^\r]+)/.exec(body)?.[1], name = /filename="([^"]+)"/.exec(body)?.[1];
      const key = request.headers()['idempotency-key']; model.uploads.push({ itemId, name, key });
      assert.ok(key); assert.ok(model.order.items.some(item => item.itemId === itemId));
      if (model.failNames.has(name)) return route.fulfill({ status: 503, json: { success: false, code: 'SERVICE_UNAVAILABLE' } });
      let image = model.images.find(image => image.imageId === key);
      if (!image) { image = { imageId: key, orderId, itemId, filename: name, contentType: 'image/png', size: png.length, width: 10, height: 10, uploadedBy: model.account, uploaderNameSnapshot: model.account, uploadedAt: '2026-11-04T08:00:00Z' }; model.images.push(image); }
      if (model.lostNames.delete(name)) return route.abort('failed');
      return ok(image, 201);
    }
    if (path.startsWith(`/api/orders/${orderId}/images/`)) {
      if (request.method() === 'DELETE') { model.images = model.images.filter(image => image.imageId !== path.split('/').at(-1)); return ok(null); }
      return route.fulfill({ contentType: 'image/png', body: png });
    }
    if (path.endsWith('/activities')) return ok({ items: [], total: 0, page: 1, size: 20 });
    if (path.endsWith('/calendar')) return ok([]);
    if (path.endsWith('/production-reminders')) return ok({ date: '2026-11-12', today: 0, overdue: 0 });
    if (path.endsWith('/workbench')) return ok({ pendingOrders: [], metrics: null });
    if (path.endsWith('/receipt-summary')) return ok({ orderCount: 0, amountCents: '0', missingAmountOrderCount: 0 });
    if (path.endsWith('/cake-bases')) return ok({ items: [] });
    if (path.endsWith('/payment-summary')) return ok({ totalOrderCount: 0, waitingDeliveryOrderCount: 0, paidWithoutDateOrderCount: 0, paid: { orderCount: 0, amountCents: '0' }, unpaid: { orderCount: 0, amountCents: '0' } });
    return route.fulfill({ status: 404, json: { success: false, code: 'NOT_FOUND' } });
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/#/orders/new`); await page.locator('#phone').waitFor();
  png = Buffer.from(await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 10; canvas.height = 10; canvas.getContext('2d').fillRect(0, 0, 10, 10); return canvas.toDataURL().split(',')[1]; }), 'base64');
  const select = names => page.locator('input[type=file]').setInputFiles(names.map(name => ({ name, mimeType: 'image/png', buffer: png })));
  const saved = () => page.evaluate(account => JSON.parse(localStorage.getItem(`wuhou:order-draft:v1:${account}`)), model.account);
  const queue = () => page.evaluate(async ([account, id]) => (await import('/src/draftImages.ts')).imageQueue(account, id).then(rows => rows.map(({ file, ...row }) => row)), [model.account, orderId]);
  const complete = async () => { await page.locator('#phone').fill('13800000000'); await page.getByRole('button', { name: /交接方式/ }).click(); await page.getByRole('option', { name: '门店自提' }).click(); await page.locator('[id="items.0.name"]').fill('蛋糕A'); };
  return { context, page, model, errors, png, select, saved, queue, complete };
}
