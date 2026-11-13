import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as http from '../src/api.ts';

const originalFetch = globalThis.fetch;
const flush = () => new Promise(resolve => setImmediate(resolve));
const read = http.readQuery;
const ok = (data: unknown) => Response.json({ success: true, data });
beforeEach(async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { cookie: 'XSRF-TOKEN=test' } });
  globalThis.fetch = async input => String(input).endsWith('/csrf') ? ok({ headerName: 'X-XSRF-TOKEN' })
    : ok({ accessToken: 'old', expiresIn: 3600, passwordChangeRequired: false });
  await http.session.login('test', 'test');
});
afterEach(() => { http.forgetSession(); globalThis.fetch = originalFetch; });

for (const stage of ['headers', 'body']) test(`JSON ${stage} 挂起在30秒结束，取消网络后可再次读取`, async t => {
  let signal: AbortSignal | undefined;
  globalThis.fetch = async (_input, init) => {
    signal = init?.signal as AbortSignal;
    if (stage === 'headers') return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal?.reason), { once: true }));
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('{"success":true,"data":'));
      signal?.addEventListener('abort', () => controller.error(signal?.reason), { once: true });
    } }), { headers: { 'Content-Type': 'application/json' } });
  };
  let failure: unknown;
  const pending = read('/orders/a', new AbortController().signal).catch(error => { failure = error; });
  await flush(); t.mock.timers.tick(29_999); await flush(); assert.equal(failure, undefined);
  t.mock.timers.tick(1); await flush();
  assert.ok(failure instanceof http.ApiError && failure.status === 408 && failure.code === 'READ_TIMEOUT');
  assert.equal(signal?.aborted, true); await pending;
  globalThis.fetch = async () => ok({ version: 2 });
  assert.deepEqual(await read('/orders/a', new AbortController().signal), { version: 2 });
});
test('查询取消不误报超时，已取消查询不发送请求', async t => {
  let calls = 0;
  globalThis.fetch = async (_input, init) => { calls++; return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })); };
  const controller = new AbortController();
  const pending = read('/orders/a', controller.signal).catch(error => error);
  controller.abort(); const error = await pending;
  assert.equal(error.name, 'AbortError');
  await assert.rejects(read('/orders/a', controller.signal), { name: 'AbortError' });
  assert.equal(calls, 1); t.mock.timers.tick(30_000);
});
test('一个查询超时不会取消共享认证刷新，也不会在刷新完成后补发已超时请求', async t => {
  let resolveRefresh: (response: Response) => void = () => {}, refreshes = 0, a = 0, b = 0;
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path.endsWith('/csrf')) return ok({ headerName: 'X-XSRF-TOKEN' });
    if (path.endsWith('/refresh')) { refreshes++; return new Promise(resolve => { resolveRefresh = resolve; }); }
    if (path.endsWith('/a')) a++; else b++;
    return new Headers(init?.headers).get('Authorization') === 'Bearer old'
      ? Response.json({ success: false }, { status: 401 }) : ok({ version: 2 });
  };
  let failure: unknown;
  const first = read('/orders/a', new AbortController().signal).catch(error => { failure = error; });
  await flush(); await flush(); t.mock.timers.tick(15_000);
  const second = read('/orders/b', new AbortController().signal);
  await flush(); t.mock.timers.tick(15_000); await flush();
  assert.ok(failure instanceof http.ApiError && failure.code === 'READ_TIMEOUT');
  resolveRefresh(ok({ accessToken: 'new', expiresIn: 3600, passwordChangeRequired: false }));
  assert.deepEqual(await second, { version: 2 }); await first;
  assert.equal(refreshes, 1); assert.equal(a, 1); assert.equal(b, 2);
});
test('响应体读取期间退出账号，旧数据不得返回', async () => {
  let release: (data: string) => void = () => {};
  globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) {
    release = data => { controller.enqueue(new TextEncoder().encode(data)); controller.close(); };
  } }));
  const pending = read('/orders/a', new AbortController().signal);
  await flush(); http.forgetSession(); release('{"success":true,"data":{"private":"old-account"}}');
  await assert.rejects(pending, error => error instanceof http.ApiError && error.code === 'AUTHENTICATION_FAILED');
});
test('读取成功后清除期限和取消监听，只发送 GET', async t => {
  let request: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => { request = init; return ok({ version: 2 }); };
  const controller = new AbortController();
  assert.deepEqual(await read('/orders/a', controller.signal), { version: 2 });
  assert.equal(request?.method, 'GET'); assert.equal(request?.body, undefined);
  controller.abort(); t.mock.timers.tick(30_000);
  assert.equal(request?.signal?.aborted, false);
});
test('普通写请求不套只读期限或重发', async t => {
  let calls = 0, release: (response: Response) => void = () => {};
  globalThis.fetch = async (_input, init) => {
    calls++; assert.equal(init?.method, 'PATCH');
    return new Promise(resolve => { release = resolve; });
  };
  const pending = http.api('/orders/a', { method: 'PATCH', body: { expectedVersion: 1 } });
  t.mock.timers.tick(90_000); assert.equal(calls, 1);
  release(ok({ version: 2 })); assert.deepEqual(await pending, { version: 2 });
});
