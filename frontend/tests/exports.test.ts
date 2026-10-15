import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, forgetSession, session } from '../src/api.ts';
import { exportActivitySummary, exportFailureText, exportFilename, exportFilters, fetchOrderExport, saveExportFile } from '../src/exportFiles.ts';

test('结束日期包含当天；跨年、闰月和 42 天边界转换为后端 [from,to)，空筛选不提交', () => {
  const draft = { from: '2026-12-31', through: '2027-01-01', status: '', fulfillmentType: '', paymentStatus: '' };
  assert.deepEqual(exportFilters(draft), { filters: { from: '2026-12-31', to: '2027-01-02' } });
  assert.deepEqual(exportFilters({ ...draft, from: '2028-02-29', through: '2028-02-29', paymentStatus: 'PAID' }), { filters: { from: '2028-02-29', to: '2028-03-01', paymentStatus: 'PAID' } });
  assert.ok(exportFilters({ ...draft, from: '2026-10-01', through: '2026-11-11' }).filters);
  assert.match(exportFilters({ ...draft, from: '2026-10-01', through: '2026-11-12' }).error!, /42 天/);
  assert.match(exportFilters({ ...draft, through: '2026-12-30' }).error!, /不能早于/);
  assert.ok(exportFilters({ ...draft, from: '2026-02-29' }).error);
  assert.ok(exportFilters({ ...draft, status: 'LAYER_DONE' }).error);
});

test('导出携带 Bearer 并复用 401 刷新，区分单单 XLSX 和筛选 ZIP，失败不自动重试', async () => {
  const original = globalThis.fetch;
  Object.defineProperty(globalThis, 'document', { value: { cookie: 'XSRF-TOKEN=test' }, configurable: true });
  const writes: { path: string; init: RequestInit }[] = [];
  let refreshes = 0, failure = '';
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path.endsWith('/csrf')) return Response.json({ success: true, data: { headerName: 'X-XSRF-TOKEN' } });
    if (path.endsWith('/login')) return Response.json({ success: true, data: { accessToken: 'old', expiresIn: 900 } });
    if (path.endsWith('/refresh')) { refreshes++; return Response.json({ success: true, data: { accessToken: 'new', expiresIn: 900 } }); }
    writes.push({ path, init: init! }); assert.equal(init?.method, 'POST'); assert.ok(init?.signal);
    if (new Headers(init?.headers).get('Authorization') === 'Bearer old') return new Response(null, { status: 401 });
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer new');
    if (failure === 'network') throw new TypeError('response lost');
    if (failure === 'json') return Response.json({ success: true, data: null });
    if (failure) return Response.json({ success: false, code: failure }, { status: 400 });
    return new Response(new Blob(['PK-file']), { headers: { 'Content-Type': path.endsWith('/zip') ? 'application/zip' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': "attachment; filename*=UTF-8''%E8%AE%A2%E5%8D%95-0000001.xlsx" } });
  };
  try {
    await session.login('test', 'test');
    const signal = new AbortController().signal;
    const single = await fetchOrderExport({ orderId: 'order-a', orderNo: '0000001' }, signal);
    assert.equal(single.filename, '订单-0000001.xlsx'); assert.equal(await single.blob.text(), 'PK-file');
    assert.equal(refreshes, 1); assert.equal(writes.length, 2); assert.equal(writes[1].path, '/api/orders/order-a/exports/xlsx');
    assert.equal(writes[1].init.body, undefined);
    const filters = { from: '2026-10-15', to: '2026-10-17', status: 'WAITING_PRODUCTION', fulfillmentType: 'PICKUP', paymentStatus: 'UNPAID' };
    const batch = await fetchOrderExport({ filters }, signal);
    assert.equal(batch.filename, 'orders-20261015-20261016.zip');
    assert.equal(writes[2].path, '/api/orders/exports/zip'); assert.deepEqual(JSON.parse(writes[2].init.body as string), filters);
    assert.equal(new Headers(writes[2].init.headers).get('Content-Type'), 'application/json');
    for (const code of ['EXPORT_EMPTY', 'EXPORT_LIMIT_EXCEEDED', 'EXPORT_FILE_TOO_LARGE', 'EXPORT_CONTENT_TOO_LARGE', 'json', 'network']) {
      failure = code; const before = writes.length;
      await assert.rejects(fetchOrderExport({ filters }, signal), error => code === 'network' ? error instanceof TypeError : error instanceof ApiError);
      assert.equal(writes.length, before + 1);
    }
    assert.match(exportFailureText(new ApiError(400, 'EXPORT_EMPTY')), /没有订单/);
    assert.match(exportFailureText(new TypeError('lost')), /可能已生成/);
  } finally { forgetSession(); globalThis.fetch = original; }
});

test('下载采用服务端中文文件名与安全回退，临时链接移除且 Blob URL 延后释放', () => {
  assert.equal(exportFilename("attachment; filename*=UTF-8''%E8%AE%A2%E5%8D%95.xlsx", 'order.xlsx'), '订单.xlsx');
  assert.equal(exportFilename('attachment; filename="a.zip"', 'orders.zip'), 'a.zip');
  assert.equal(exportFilename("attachment; filename*=UTF-8''%ZZ", 'order.xlsx'), 'order.xlsx');
  assert.equal(exportFilename('attachment; filename="unexpected.html"', 'order.xlsx'), 'order.xlsx');
  const documentBefore = globalThis.document, create = URL.createObjectURL, revoke = URL.revokeObjectURL, timeout = globalThis.setTimeout;
  const events: string[] = []; let release: (() => void) | undefined;
  const link = { href: '', download: '', click() { events.push(`click:${this.href}:${this.download}`); }, remove() { events.push('remove'); } };
  Object.defineProperty(globalThis, 'document', { value: { createElement: () => link, body: { append: () => events.push('append') } }, configurable: true });
  URL.createObjectURL = () => 'blob:export'; URL.revokeObjectURL = url => { events.push(`revoke:${url}`); };
  globalThis.setTimeout = ((callback: () => void, delay: number) => { assert.equal(delay, 1000); release = callback; return 1; }) as unknown as typeof setTimeout;
  try {
    saveExportFile({ blob: new Blob(['PK']), filename: '订单.xlsx' });
    assert.deepEqual(events, ['append', 'click:blob:export:订单.xlsx', 'remove']);
    release!(); assert.equal(events.at(-1), 'revoke:blob:export');
  } finally { Object.defineProperty(globalThis, 'document', { value: documentBefore, configurable: true }); URL.createObjectURL = create; URL.revokeObjectURL = revoke; globalThis.setTimeout = timeout; }
});

test('导出日志区分单单与批量、还原含首尾日期和筛选条件，并展示快照版本与图片数', () => {
  const single = exportActivitySummary({ mode: 'SINGLE', format: 'XLSX', snapshotVersion: 0, imageIds: ['one'] });
  assert.equal(single[0], '单订单 XLSX'); assert.ok(single.includes('导出时订单版本：0')); assert.ok(single.includes('参考图片：1 张'));
  const batch = exportActivitySummary({ mode: 'BATCH', filters: { from: '2026-12-31', to: '2027-01-02', status: 'COMPLETED', fulfillmentType: 'DELIVERY', paymentStatus: 'PAID' }, snapshotVersion: 4, imageIds: [] });
  assert.ok(batch.includes('收货日期：2026-12-31 至 2027-01-01（含首尾）'));
  assert.ok(batch.includes('订单状态：已完成；交接：配送；付款：已付款'));
  assert.match(batch.at(-1)!, /核对浏览器下载记录/);
});
