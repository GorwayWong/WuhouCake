import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { connectOrders, receiveEvent } from '../src/realtime.ts';
import { api, session, forgetSession, ApiError } from '../src/api.ts';

const waitFor = async (condition: () => boolean) => {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(condition(), 'condition was not reached');
};
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
