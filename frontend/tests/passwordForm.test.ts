import test from 'node:test';
import assert from 'node:assert/strict';
import { newPasswordError } from '../src/passwordForm.ts';
import { api, ApiError, errorText, forgetSession, session } from '../src/api.ts';

test('新密码确认检查长度、Unicode 字符数及逐字一致，不隐式去除空格', () => {
  assert.ok(newPasswordError('short', 'short'));
  assert.ok(newPasswordError('🍰'.repeat(14), '🍰'.repeat(14)));
  assert.equal(newPasswordError('🍰'.repeat(15), '🍰'.repeat(15)), '');
  assert.ok(newPasswordError('x'.repeat(129), 'x'.repeat(129)));
  assert.ok(newPasswordError('A long new password ', 'A long new password'));
  assert.equal(newPasswordError('A long new password ', 'A long new password '), '');
});

test('当前密码错误保留首次登录会话，不刷新令牌或重复提交密码修改', async () => {
  const originalFetch = globalThis.fetch, originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { value: { cookie: 'XSRF-TOKEN=test-csrf' }, configurable: true });
  let refreshes = 0, changes = 0;
  const envelope = (data: unknown) => Response.json({ success: true, data });
  globalThis.fetch = async input => {
    const path = String(input);
    if (path === '/api/auth/csrf') return envelope({ headerName: 'X-XSRF-TOKEN' });
    if (path === '/api/auth/login') return envelope({ accessToken: 'first-login-token', expiresIn: 900, passwordChangeRequired: true });
    if (path === '/api/auth/refresh') { refreshes++; throw new Error('A password validation error must not refresh authentication'); }
    if (path === '/api/me/password') { changes++; return Response.json({ success: false, code: 'CURRENT_PASSWORD_INCORRECT' }, { status: 400 }); }
    throw new Error('Unexpected request ' + path);
  };
  try {
    await session.login('0001', 'Synthetic initial password!');
    await assert.rejects(api('/me/password', { method: 'POST', body: { currentPassword: 'wrong', newPassword: 'Synthetic new password!' } }), error => {
      assert.ok(error instanceof ApiError); assert.equal(error.code, 'CURRENT_PASSWORD_INCORRECT'); assert.match(errorText(error), /新密码尚未保存/); return true;
    });
    assert.equal(refreshes, 0); assert.equal(changes, 1);
    assert.equal(session.snapshot().token?.accessToken, 'first-login-token');
    assert.equal(session.snapshot().token?.passwordChangeRequired, true);
  } finally {
    forgetSession(); globalThis.fetch = originalFetch;
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else Reflect.deleteProperty(globalThis, 'document');
  }
});
