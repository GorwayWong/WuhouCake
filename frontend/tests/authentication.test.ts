import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, authenticatedFetch, forgetSession, publicApi, session, uploadOrderImage } from '../src/api.ts';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
test('换员工后丢弃旧请求的成功或 401 响应，不借用新员工令牌重发图片', async () => {
  const original = globalThis.fetch;
  Object.defineProperty(globalThis, 'document', { value: { cookie: 'XSRF-TOKEN=test' }, configurable: true });
  for (const status of [201, 401]) {
    const sent: string[] = [];
    let complete: (response: Response) => void = () => {};
    globalThis.fetch = async (path, init) => {
      if (String(path).endsWith('/csrf')) return Response.json({ success: true, data: { headerName: 'X-XSRF-TOKEN' } });
      if (String(path).endsWith('/login')) return Response.json({ success: true, data: { accessToken: JSON.parse(init?.body as string).employeeNumber, expiresIn: 900 } });
      sent.push(new Headers(init?.headers).get('Authorization')!);
      if (sent.length > 1) return Response.json({ success: true, data: { imageId: 'unexpected-retry' } }, { status: 201 });
      return new Promise(resolve => { complete = resolve; });
    };
    try {
      await session.login('employee-a', 'test');
      const pending = uploadOrderImage('order-a', new File(['png'], 'cake.png', { type: 'image/png' }), '');
      const rejected = assert.rejects(pending, error => error instanceof ApiError && error.status === 401);
      await session.login('employee-b', 'test');
      complete(Response.json({ success: status === 201, data: { imageId: 'old' } }, { status }));
      await rejected;
      assert.deepEqual(sent, ['Bearer employee-a']);
      assert.equal(session.snapshot().token?.accessToken, 'employee-b');
    } finally { forgetSession(); globalThis.fetch = original; }
  }
});

test('同会话刷新后的重试若迟到，也不能清除新员工会话', async () => {
  const original = globalThis.fetch;
  Object.defineProperty(globalThis, 'document', { value: { cookie: 'XSRF-TOKEN=test' }, configurable: true });
  let complete: ((response: Response) => void) | undefined;
  const sent: string[] = [];
  globalThis.fetch = async (path, init) => {
    if (String(path).endsWith('/csrf')) return Response.json({ success: true, data: { headerName: 'X-XSRF-TOKEN' } });
    if (String(path).endsWith('/login')) return Response.json({ success: true, data: { accessToken: JSON.parse(init?.body as string).employeeNumber, expiresIn: 900 } });
    if (String(path).endsWith('/refresh')) return Response.json({ success: true, data: { accessToken: 'refreshed-a', expiresIn: 900 } });
    sent.push(new Headers(init?.headers).get('Authorization')!);
    if (sent.length === 1) return new Response(null, { status: 401 });
    return new Promise(resolve => { complete = resolve; });
  };
  try {
    await session.login('employee-a', 'test');
    const pending = authenticatedFetch('/orders/order-a/exports/xlsx', { method: 'POST' });
    const rejected = assert.rejects(pending, error => error instanceof ApiError && error.status === 401);
    for (let i = 0; i < 200 && !complete; i++) await tick();
    assert.ok(complete, 'the original session must reach its authenticated retry');
    await session.login('employee-b', 'test');
    complete(new Response(null, { status: 401 }));
    await rejected;
    assert.deepEqual(sent, ['Bearer employee-a', 'Bearer refreshed-a']);
    assert.equal(session.snapshot().token?.accessToken, 'employee-b');
  } finally { forgetSession(); globalThis.fetch = original; }
});

test('退出请求失败时保留会话，重试成功后保护接口不再发送请求', async t => {
  Object.defineProperty(globalThis, 'document', { value: { cookie: 'XSRF-TOKEN=test' }, configurable: true });
  t.after(() => { forgetSession(); Reflect.deleteProperty(globalThis, 'document'); });
  let logouts = 0;
  const fetch = t.mock.method(globalThis, 'fetch', async (path: string) => {
    if (path === '/api/auth/csrf') return Response.json({ success: true, data: { headerName: 'X-XSRF-TOKEN' } });
    if (path === '/api/auth/login') return Response.json({ success: true, data: { accessToken: 'staff-token', expiresIn: 900 } });
    assert.equal(path, '/api/auth/logout');
    if (++logouts === 1) return Response.json({ success: false, code: 'SERVICE_UNAVAILABLE' }, { status: 503 });
    return Response.json({ success: true, data: null });
  });

  await session.login('employee', 'test');
  await assert.rejects(session.logout(), { status: 503, code: 'SERVICE_UNAVAILABLE' });
  assert.equal(session.snapshot().token?.accessToken, 'staff-token');
  await session.logout();
  assert.equal(session.snapshot().token, null);
  assert.equal(logouts, 2);
  const callsAfterLogout = fetch.mock.callCount();
  await assert.rejects(authenticatedFetch('/me'), { status: 401 });
  assert.equal(fetch.mock.callCount(), callsAfterLogout);
});

test('扫码提交与员工凭证隔离，透传幂等键且遇到服务异常不自动重试', async t => {
  Object.defineProperty(globalThis, 'document', { value: { cookie: 'XSRF-TOKEN=test' }, configurable: true });
  t.after(() => { forgetSession(); Reflect.deleteProperty(globalThis, 'document'); });
  const path = '/public/order-entries/sample-token/submissions';
  const body = { phone: '13800000000', items: [{ name: '蛋糕', quantity: 1 }] };
  const key = '10000000-0000-4000-8000-000000000001';
  const requests: Request[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    if (url === '/api/auth/csrf') return Response.json({ success: true, data: { headerName: 'X-XSRF-TOKEN' } });
    if (url === '/api/auth/login') return Response.json({ success: true, data: { accessToken: 'staff-token', expiresIn: 900 } });
    assert.equal(url, '/api' + path);
    requests.push(new Request('https://example.test' + url, init));
    if (requests.length === 1) return Response.json({ success: false, code: 'SERVICE_UNAVAILABLE' }, { status: 503 });
    return Response.json({ success: true, data: { submissionNo: 'SAMPLE-01' } }, { status: 201 });
  });

  await session.login('employee', 'test');
  const submit = () => publicApi(path, { method: 'POST', body, headers: { 'Idempotency-Key': key } });
  await assert.rejects(submit(), { status: 503, code: 'SERVICE_UNAVAILABLE' });
  assert.equal(requests.length, 1);
  assert.deepEqual(await submit(), { submissionNo: 'SAMPLE-01' });
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.method, 'POST');
    assert.equal(request.credentials, 'omit');
    assert.equal(request.cache, 'no-store');
    assert.equal(request.headers.has('Authorization'), false);
    assert.equal(request.headers.has('X-XSRF-TOKEN'), false);
    assert.equal(request.headers.get('Idempotency-Key'), key);
    assert.deepEqual(await request.json(), body);
  }
  assert.equal(session.snapshot().token?.accessToken, 'staff-token');
});
