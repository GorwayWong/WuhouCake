import { testJwt } from './testJwt.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, fetchPackageImage, forgetSession, session, uploadOrderImage } from '../src/api.ts';
import { imageFileError, loadImagePreview } from '../src/imagePreview.ts';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
test('图片 FormData 保留真实文件、商品 ID和稳定幂等键；失败与结果未知均不自动重传', async () => {
  const original = globalThis.fetch;
  Object.defineProperty(globalThis, 'document', { value: { cookie: 'XSRF-TOKEN=test' }, configurable: true });
  const requests: RequestInit[] = [];
  let failure = 0;
  globalThis.fetch = async (path, init) => {
    if (String(path).endsWith('/csrf')) return Response.json({ success: true, data: { headerName: 'X-XSRF-TOKEN' } });
    if (String(path).endsWith('/login')) return Response.json({ success: true, data: { accessToken: testJwt('jwt'), expiresIn: 900 } });
    assert.equal(path, '/api/orders/order-a/images');
    assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${testJwt('jwt')}`);
    assert.equal(new Headers(init?.headers).has('Content-Type'), false);
    requests.push(init!);
    if (failure === 1) return Response.json({ success: false, code: 'ORDER_IMAGE_LIMIT_EXCEEDED' }, { status: 409 });
    if (failure === 2) throw new TypeError('response lost');
    return Response.json({ success: true, data: { imageId: 'server-image-id' } });
  };
  try {
    await session.login('test', 'test');
    const file = new File(['png'], 'cake.png', { type: 'image/png' });
    const controller = new AbortController();
    assert.equal((await uploadOrderImage('order-a', file, 'item-a', controller.signal)).imageId, 'server-image-id');
    assert.ok(requests[0].signal instanceof AbortSignal);
    assert.equal(requests[0].signal.aborted, false);
    const body = requests[0].body as FormData;
    assert.equal(body.get('file'), file); assert.equal(body.get('itemId'), 'item-a');
    await uploadOrderImage('order-a', file, 'item-a', undefined, 'stable-upload-id');
    assert.equal(new Headers(requests[1].headers).get('Idempotency-Key'), 'stable-upload-id');
    assert.equal((requests[1].body as FormData).get('itemId'), 'item-a');
    failure = 1; await assert.rejects(uploadOrderImage('order-a', file, 'item-a'), ApiError);
    failure = 2; await assert.rejects(uploadOrderImage('order-a', file, 'item-a'), TypeError);
    await tick(); assert.equal(requests.length, 4);
  } finally { forgetSession(); globalThis.fetch = original; }
});

test('Blob 读取沿用 Bearer 和 401 刷新；释放 URL，切换订单后丢弃迟到的二进制', async () => {
  const original = globalThis.fetch, create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  Object.defineProperty(globalThis, 'document', { value: { cookie: 'XSRF-TOKEN=test' }, configurable: true });
  const created: string[] = [], revoked: string[] = [], shown: string[] = [];
  const headers: string[] = [];
  let resolveOld: (response: Response) => void = () => {};
  let refreshes = 0;
  URL.createObjectURL = () => { const url = `blob:${created.length}`; created.push(url); return url; };
  URL.revokeObjectURL = url => { revoked.push(url); };
  globalThis.fetch = async (path, init) => {
    if (String(path).endsWith('/csrf')) return Response.json({ success: true, data: { headerName: 'X-XSRF-TOKEN' } });
    if (String(path).endsWith('/login')) return Response.json({ success: true, data: { accessToken: testJwt('old'), expiresIn: 900 } });
    if (String(path).endsWith('/refresh')) { refreshes++; return Response.json({ success: true, data: { accessToken: testJwt('new'), expiresIn: 900 } }); }
    const header = new Headers(init?.headers).get('Authorization')!; headers.push(header);
    if (String(path).includes('order-old')) return new Promise(resolve => { resolveOld = resolve; });
    return header === `Bearer ${testJwt('old')}` ? new Response(null, { status: 401 }) : new Response(new Blob(['png'], { type: 'image/png' }));
  };
  const failed = (error: unknown) => assert.fail(String(error));
  let stopNew = () => {};
  try {
    await session.login('test', 'test');
    const stopOld = loadImagePreview('order-old', 'old-image', url => shown.push(`old:${url}`), failed);
    await tick();
    stopOld();
    stopNew = loadImagePreview('order-new', 'new-image', url => shown.push(url), failed);
    await tick(); await tick();
    assert.equal(refreshes, 1); assert.deepEqual(headers, [`Bearer ${testJwt('old')}`, `Bearer ${testJwt('old')}`, `Bearer ${testJwt('new')}`]);
    resolveOld(new Response(new Blob(['late']))); await tick();
    assert.deepEqual(shown, ['blob:0']); assert.deepEqual(created, ['blob:0']);
    stopNew(); assert.deepEqual(revoked, ['blob:0']);
  } finally { forgetSession(); globalThis.fetch = original; URL.createObjectURL = create; URL.revokeObjectURL = revoke; }
});

test('只接受非空 JPG/PNG，单张最多 5 MiB', () => {
  assert.equal(imageFileError(new File(['png'], 'cake.png', { type: 'image/png' })), '');
  assert.match(imageFileError(new File(['x'], 'cake.heic', { type: 'image/heic' })), /JPG\/PNG/);
  assert.match(imageFileError(new File([], 'cake.jpg', { type: 'image/jpeg' })), /为空/);
  assert.match(imageFileError(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'cake.jpg', { type: 'image/jpeg' })), /5 MiB/);
});

test('预览最多两个并发读取，取消尚未开始的请求不会访问网络', async () => {
  const original = globalThis.fetch;
  const complete = new Map<string, (response: Response) => void>();
  Object.defineProperty(globalThis, 'document', { value: { cookie: 'XSRF-TOKEN=test' }, configurable: true });
  globalThis.fetch = async path => {
    if (String(path).endsWith('/csrf')) return Response.json({ success: true, data: { headerName: 'X-XSRF-TOKEN' } });
    if (String(path).endsWith('/login')) return Response.json({ success: true, data: { accessToken: testJwt('jwt'), expiresIn: 900 } });
    return new Promise(resolve => { complete.set(String(path), resolve); });
  };
  const active = new AbortController(), queued = new AbortController();
  try {
    await session.login('test', 'test');
    const first = fetchPackageImage('/images/first', active.signal);
    const second = fetchPackageImage('/images/second', active.signal);
    const cancelled = fetchPackageImage('/images/third', queued.signal);
    const next = fetchPackageImage('/images/fourth', active.signal);
    const rejection = assert.rejects(cancelled);
    queued.abort();
    await rejection;
    await tick();
    assert.deepEqual([...complete.keys()], ['/api/images/first', '/api/images/second']);
    complete.get('/api/images/first')!(new Response('png'));
    await first; await tick();
    assert.deepEqual([...complete.keys()], ['/api/images/first', '/api/images/second', '/api/images/fourth']);
    complete.get('/api/images/second')!(new Response('png'));
    complete.get('/api/images/fourth')!(new Response('png'));
    await Promise.all([second, next]);
  } finally { forgetSession(); globalThis.fetch = original; }
});
