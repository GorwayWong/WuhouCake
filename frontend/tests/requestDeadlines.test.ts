import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { testJwt } from './testJwt.mjs';
import * as http from '../src/api.ts';

const originalFetch = globalThis.fetch;
const flush = () => new Promise(resolve => setImmediate(resolve));
const ok = (data: unknown) => Response.json({ success: true, data });
const token = () => ({ accessToken: testJwt('old'), expiresIn: 3600, passwordChangeRequired: false });
beforeEach(t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { cookie: 'XSRF-TOKEN=test' } });
});
afterEach(() => { http.forgetSession(); globalThis.fetch = originalFetch; });

test('业务执行前明确拒绝时可以编辑重试，网络超时仍须核对原请求', () => {
  for (const code of ['IMAGE_PROCESSING_BUSY', 'IMAGE_PROCESSING_TIMEOUT', 'IMAGE_PROCESSING_UNAVAILABLE', 'TEMP_STORAGE_UNAVAILABLE'])
    assert.equal(http.creationResultUnknown(new http.ApiError(503, code)), false);
  assert.equal(http.creationResultUnknown(new http.ApiError(408, 'WRITE_TIMEOUT')), true);
  assert.equal(http.creationResultUnknown(new http.ApiError(503, 'HTTP_503')), true);
});

for (const stage of ['csrf-headers', 'csrf-body', 'auth-headers', 'auth-body']) test(`认证期限覆盖 ${stage}，失败后可以重试`, async t => {
  let requestSignal: AbortSignal | undefined;
  let posts = 0;
  globalThis.fetch = async (input, init) => {
    const csrf = String(input).endsWith('/csrf');
    if (!csrf) posts++;
    if ((stage.startsWith('csrf') && csrf) || (stage.startsWith('auth') && !csrf)) {
      requestSignal = init?.signal as AbortSignal;
      if (stage.endsWith('headers')) return new Promise<Response>(() => {});
      return { ok: true, status: 200, json: () => new Promise(() => {}) } as Response;
    }
    return ok(csrf ? { headerName: 'X-XSRF-TOKEN' } : token());
  };
  const request = http.refresh();
  const failure = assert.rejects(request, (error: unknown) => error instanceof http.ApiError && error.code === 'AUTH_TIMEOUT');
  await flush(); t.mock.timers.tick(15_000); await failure;
  assert.equal(http.session.snapshot().loading, false);
  assert.equal(requestSignal?.aborted, true);
  if (stage.startsWith('csrf')) assert.equal(posts, 0);
  globalThis.fetch = async input => ok(String(input).endsWith('/csrf') ? { headerName: 'X-XSRF-TOKEN' } : token());
  await http.refresh(); assert.ok(http.session.snapshot().token);
});

for (const stage of ['headers', 'body']) test(`套餐写入 ${stage} 挂起按结果未知退出，保留原幂等键且不自动重发`, async t => {
  globalThis.fetch = async input => ok(String(input).endsWith('/csrf') ? { headerName: 'X-XSRF-TOKEN' } : token());
  await http.session.login('test', 'test');
  let calls = 0, signal: AbortSignal | undefined;
  globalThis.fetch = async (_input, init) => {
    calls++; signal = init?.signal as AbortSignal;
    assert.equal((init?.headers as Record<string, string>)['Idempotency-Key'], 'same-key');
    if (stage === 'headers') return new Promise<Response>(() => {});
    return { ok: true, status: 201, json: () => new Promise(() => {}) } as Response;
  };
  const outer = new AbortController();
  const request = http.writeRequest('/order-packages', { method: 'POST', body: {}, signal: outer.signal, headers: { 'Idempotency-Key': 'same-key' } });
  const failure = assert.rejects(request, (error: unknown) => error instanceof http.ApiError && error.code === 'WRITE_TIMEOUT' && http.creationResultUnknown(error));
  await flush(); t.mock.timers.tick(60_000); await failure;
  assert.equal(calls, 1); assert.equal(signal?.aborted, true); assert.equal(outer.signal.aborted, false);
});
