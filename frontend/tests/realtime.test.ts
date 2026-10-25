import test from 'node:test';
import assert from 'node:assert/strict';
import { isCancelledError, QueryClient, QueryObserver } from '@tanstack/react-query';
import { collectUpdate, connectOrders, receiveEvent } from '../src/realtime.ts';
import type { OrderUpdate } from '../src/realtime.ts';
import { api, session, forgetSession, ApiError } from '../src/api.ts';

const waitFor = async (condition: () => boolean) => {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(condition(), 'condition was not reached');
};
test('套餐通知刷新所有搜索分页，不触碰订单数据或产生订单通知', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: 0 } } });
  const reads = [0, 0, 0]; let notifications = 0;
  const keys = [['order-packages', 'keyword=蛋糕&page=1'], ['order-packages', 'page=2'], ['order', 'saved-order', 'detail']];
  const stops = keys.map((queryKey, index) => new QueryObserver(client, { queryKey, queryFn: async () => ++reads[index] }).subscribe(() => {}));
  try {
    await waitFor(() => reads.every(value => value === 1) && client.isFetching() === 0);
    receiveEvent(client, { event: 'package.changed', data: JSON.stringify({ packageId: '00000000-0000-4000-8000-000000000001', version: 2, deleted: true }) }, () => notifications++);
    await waitFor(() => reads[0] === 2 && reads[1] === 2 && client.isFetching() === 0);
    assert.equal(reads[2], 1); assert.equal(notifications, 0);
    receiveEvent(client, { event: 'order.changed', data: JSON.stringify({ orderId: 'saved-order', changeType: 'NOTE', version: 1 }) });
    await waitFor(() => reads[2] === 2 && client.isFetching() === 0);
    assert.equal(reads[0], 2); assert.equal(reads[1], 2);
  } finally { stops.forEach(stop => stop()); client.clear(); }
});
test('ready 补读套餐列表，缓存尚未过期也核对断线期间的变化', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: 0 } } }); let reads = 0;
  const stop = new QueryObserver(client, { queryKey: ['order-packages', 'page=1'], queryFn: async () => ++reads }).subscribe(() => {});
  try {
    await waitFor(() => reads === 1 && client.isFetching() === 0);
    receiveEvent(client, { event: 'ready', data: '{}' });
    await waitFor(() => reads === 2 && client.isFetching() === 0);
  } finally { stop(); client.clear(); }
});
test('套餐通知取消首次在途列表，迟到的旧响应不能覆盖新列表', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const key = ['order-packages', 'page=1']; let reads = 0, firstSignal: AbortSignal | undefined, release: (value: string) => void = () => {};
  const stop = new QueryObserver(client, { queryKey: key, queryFn: ({ signal }) => {
    if (++reads === 1) { firstSignal = signal; return new Promise<string>(resolve => { release = resolve; }); }
    return Promise.resolve('新版套餐');
  } }).subscribe(() => {});
  try {
    await waitFor(() => reads === 1);
    receiveEvent(client, { event: 'package.changed', data: '{}' });
    await waitFor(() => client.getQueryData(key) === '新版套餐');
    assert.equal(firstSignal?.aborted, true); release('旧名称');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(client.getQueryData(key), '新版套餐');
  } finally { stop(); client.clear(); }
});
test('变更通知取消目标套餐的在途带入读取，其他套餐读取保持有效', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const id = '00000000-0000-4000-8000-000000000001'; let signalA: AbortSignal | undefined, signalB: AbortSignal | undefined;
  let resolveA: (value: string) => void = () => {}, resolveB: (value: string) => void = () => {};
  const a = client.fetchQuery({ queryKey: ['order-packages', 'detail', id], queryFn: ({ signal }) => { signalA = signal; return new Promise<string>(resolve => { resolveA = resolve; }); } }).then(value => value, failure => { assert.ok(isCancelledError(failure)); return 'cancelled'; });
  const b = client.fetchQuery({ queryKey: ['order-packages', 'detail', 'other'], queryFn: ({ signal }) => { signalB = signal; return new Promise<string>(resolve => { resolveB = resolve; }); } });
  try {
    receiveEvent(client, { event: 'package.changed', data: JSON.stringify({ packageId: id, version: 3, deleted: true }) });
    assert.equal(await a, 'cancelled'); assert.equal(signalA?.aborted, true); assert.equal(signalB?.aborted, false);
    resolveA('迟到的已删除套餐'); resolveB('其他套餐'); assert.equal(await b, '其他套餐');
  } finally { resolveA('cleanup'); resolveB('cleanup'); client.clear(); }
});
test('站内更新保留同版本备注，合并同一订单、限制数量，坏事件只同步不产生可点击通知', () => {
  const client = new QueryClient(); let updates: OrderUpdate[] = [];
  const notify = (change: OrderUpdate) => { updates = collectUpdate(updates, change); };
  const id = '00000000-0000-4000-8000-000000000001';
  client.setQueryData(['order', id, 'detail'], { orderNo: '0000001' });
  for (const changeType of ['NOTE', 'NOTE', 'IMAGE_ADDED']) receiveEvent(client, { event: 'order.changed', data: JSON.stringify({ orderId: id, changeType, version: 0 }) }, notify);
  assert.equal(updates.length, 1); assert.equal(updates[0].changeType, 'IMAGE_ADDED'); assert.equal(updates[0].orderNo, '0000001');
  for (const data of ['null', '{bad', JSON.stringify({ orderId: 'javascript:alert(1)', changeType: 'NOTE', version: 0 }), JSON.stringify({ orderId: id, changeType: '__proto__', version: 0 }), JSON.stringify({ orderId: id, changeType: 'NOTE', version: -1 })]) receiveEvent(client, { event: 'order.changed', data }, notify);
  assert.equal(updates.length, 1);
  receiveEvent(client, { event: 'order.changed', data: JSON.stringify({ orderId: id, orderNo: '0000002', changeType: 'NOTE', version: 0 }) }, notify);
  assert.equal(updates[0].orderNo, '0000002');
  for (let n = 2; n < 30; n++) notify({ orderId: String(n), changeType: 'NOTE', version: 0, receivedAt: n });
  assert.equal(updates.length, 20); assert.equal(updates[0].orderId, '29'); client.clear();
});
test('相同版本 NOTE 仍刷新详情与商品备注，跨日通知重新获取整个可见范围', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const counts: Record<string, number> = {};
  const keys = [['calendar', '2026-10-12', '2026-10-19'], ['workbench', '2026-10-13'], ['order', 'order-a', 'detail'], ['order', 'order-a', 'activities', 'NOTE'], ['order', 'order-a', 'images'], ['order', 'order-b', 'images']];
  const stops = keys.map(key => {
    const observer = new QueryObserver(client, { queryKey: key, queryFn: async () => { const name = key.join('/'); counts[name] = (counts[name] || 0) + 1; return counts[name]; } });
    return observer.subscribe(() => {});
  });
  await waitFor(() => Object.values(counts).length === 6);
  await new Promise(resolve => setTimeout(resolve, 10));
  for (const changeType of ['NOTE', 'NOTE', 'ORDER_INFORMATION_CHANGED', 'IMAGE_ADDED', 'IMAGE_REMOVED']) {
    const before = { ...counts };
    receiveEvent(client, { event: 'order.changed', data: JSON.stringify({ orderId: 'order-a', changeType, version: 1 }) });
    await waitFor(() => Object.keys(counts).filter(key => key !== 'order/order-b/images').every(key => counts[key] > before[key]));
    assert.equal(counts['order/order-b/images'], before['order/order-b/images']);
  }
  stops.forEach(stop => stop()); client.clear();
});

test('并发 401 只刷新一次；SSE 分块 UTF-8、断线重连与清理不留下多条连接', async () => {
  const originalFetch = globalThis.fetch;
  const documentTarget = new EventTarget();
  Object.assign(documentTarget, { cookie: 'XSRF-TOKEN=test-csrf', visibilityState: 'visible' });
  Object.defineProperty(globalThis, 'document', { value: documentTarget, configurable: true });
  Object.defineProperty(globalThis, 'window', { value: new EventTarget(), configurable: true });
  let refreshes = 0, live = 0, maxLive = 0, connections = 0, reads = 0, writes = 0;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let disconnect = () => {};
  const envelope = (data: unknown) => Response.json({ success: true, data });
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path === '/api/auth/csrf') return envelope({ headerName: 'X-XSRF-TOKEN' });
    if (path === '/api/auth/login') return envelope({ accessToken: 'old', expiresIn: 900, passwordChangeRequired: false });
    if (path === '/api/auth/logout') return envelope(null);
    if (path === '/api/auth/refresh') { refreshes++; await new Promise(resolve => setTimeout(resolve, 20)); return envelope({ accessToken: 'new', expiresIn: 900, passwordChangeRequired: false }); }
    if (path === '/api/me') return new Headers(init?.headers).get('Authorization') === 'Bearer old' ? Response.json({ success: false, code: 'AUTHENTICATION_FAILED' }, { status: 401 }) : envelope({ nickname: '员工' });
    if (path === '/api/orders/conflict') { writes++; return Response.json({ success: false, code: 'CONCURRENT_MODIFICATION' }, { status: 409 }); }
    if (path === '/api/orders/stream') {
      connections++; live++; maxLive = Math.max(maxLive, live);
      let ended = false;
      const end = () => { if (!ended) { ended = true; live--; } };
      const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; init?.signal?.addEventListener('abort', () => { end(); c.error(new DOMException('Aborted', 'AbortError')); }, { once: true }); c.enqueue(new TextEncoder().encode('event: ready\r\ndata: {}\r\n\r\n')); }, cancel() { end(); } });
      disconnect = () => { end(); controller.close(); };
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    }
    throw new Error(`Unexpected request ${path}`);
  };
  const client = new QueryClient();
  const observer = new QueryObserver(client, { queryKey: ['order', 'a', 'detail'], queryFn: async () => ++reads });
  const stopObserver = observer.subscribe(() => {});
  let stop = () => {};
  try {
    await session.login('test', 'test');
    await Promise.all([api('/me'), api('/me')]);
    assert.equal(refreshes, 1);
    await assert.rejects(api('/orders/conflict', { method: 'POST', body: { expectedVersion: 1 } }), error => error instanceof ApiError && error.status === 409 && error.code === 'CONCURRENT_MODIFICATION');
    assert.equal(writes, 1, 'a conflicting write must not be automatically retried');
    stop = connectOrders(client, () => {});
    await waitFor(() => connections === 1 && reads >= 2);
    const before = reads;
    const bytes = new TextEncoder().encode('event: order.changed\ndata: {"orderId":"a","changeType":"NOTE","version":1,"text":"备注"}\n\n');
    for (const byte of bytes) controller!.enqueue(new Uint8Array([byte]));
    await waitFor(() => reads > before);
    disconnect();
    await waitFor(() => connections === 2);
    assert.equal(maxLive, 1);
    assert.ok(reads > before + 1);
    const disconnectedAt = Date.now();
    disconnect();
    await waitFor(() => connections === 3);
    assert.ok(Date.now() - disconnectedAt >= 2000, 'a short ready connection must not reset backoff');
    assert.equal(maxLive, 1);
    stop(); await waitFor(() => live === 0);
    await session.logout();
    assert.equal(session.snapshot().token, null);
    await assert.rejects(api('/me'), error => error instanceof ApiError && error.status === 401);
  } finally { stop(); stopObserver(); client.clear(); forgetSession(); globalThis.fetch = originalFetch; }
});
