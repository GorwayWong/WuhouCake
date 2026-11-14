export function testJwt(id = 'initial', { sub = 'employee', sid = 'session', ver = 0 } = {}) {
  const payload = Buffer.from(JSON.stringify({ sub, sid, ver, jti: id })).toString('base64url');
  return `eyJhbGciOiJSUzI1NiJ9.${payload}.test`;
}
