import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, forgetSession, session, uploadOrderImage } from '../src/api.ts';
import { imageFileError, loadImagePreview } from '../src/imagePreview.ts';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
test('图片 FormData 保留真实文件与商品 ID，整单不发 itemId；失败与结果未知均不重传', async () => {
  const original = globalThis.fetch;
  Object.defineProperty(globalThis, 'document', { value: { cookie: 'XSRF-TOKEN=test' }, configurable: true });
  const requests: RequestInit[] = [];
  let failure = 0;
  globalThis.fetch = async (path, init) => {
    if (String(path).endsWith('/csrf')) return Response.json({ success: true, data: { headerName: 'X-XSRF-TOKEN' } });
    if (String(path).endsWith('/login')) return Response.json({ success: true, data: { accessToken: 'jwt', expiresIn: 900 } });
    assert.equal(path, '/api/orders/order-a/images');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer jwt');
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
    assert.equal(requests[0].signal, controller.signal);
    const body = requests[0].body as FormData;
    assert.equal(body.get('file'), file); assert.equal(body.get('itemId'), 'item-a');
    await uploadOrderImage('order-a', file, '');
    assert.equal((requests[1].body as FormData).has('itemId'), false);
    failure = 1; await assert.rejects(uploadOrderImage('order-a', file, ''), ApiError);
    failure = 2; await assert.rejects(uploadOrderImage('order-a', file, ''), TypeError);
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
    if (String(path).endsWith('/login')) return Response.json({ success: true, data: { accessToken: 'old', expiresIn: 900 } });
    if (String(path).endsWith('/refresh')) { refreshes++; return Response.json({ success: true, data: { accessToken: 'new', expiresIn: 900 } }); }
    const header = new Headers(init?.headers).get('Authorization')!; headers.push(header);
    if (String(path).includes('order-old')) return new Promise(resolve => { resolveOld = resolve; });
    return header === 'Bearer old' ? new Response(null, { status: 401 }) : new Response(new Blob(['png'], { type: 'image/png' }));
  };
  const failed = (error: unknown) => assert.fail(String(error));
  let stopNew = () => {};
  try {
    await session.login('test', 'test');
    const stopOld = loadImagePreview('order-old', 'old-image', url => shown.push(`old:${url}`), failed);
    stopOld();
    stopNew = loadImagePreview('order-new', 'new-image', url => shown.push(url), failed);
    await tick(); await tick();
    assert.equal(refreshes, 1); assert.deepEqual(headers, ['Bearer old', 'Bearer old', 'Bearer new']);
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
