import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, authenticatedFetch, forgetSession, session, uploadOrderImage } from '../src/api.ts';

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
