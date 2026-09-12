const { test } = require('node:test');
const assert = require('node:assert/strict');

Object.assign(process.env, {
  AWS_LAMBDA_FUNCTION_NAME: 'local-test', NODE_ENV: 'production',
  DB_HOST: 'unused', DB_USER: 'test', DB_PASSWORD: 'test', DB_NAME: 'test',
  ADMIN_USER: 'admin', ADMIN_PASSWORD: 'test-password', COOKIE_SECRET: 'test-secret',
  CORS_ORIGINS: 'https://main.example.amplifyapp.com', COOKIE_SAME_SITE: 'none',
});
// Exercise the real Express/Lambda adapter without connecting to a database.
require('mysql2/promise').createPool = () => ({ query: async () => [[{ value: 1 }]] });
const { handler } = require('../lambda');
const origin = process.env.CORS_ORIGINS;

function invoke(method, path, { body, cookies, requestOrigin = origin } = {}) {
  return handler({
    version: '2.0', routeKey: 'ANY /api/{proxy+}', rawPath: path,
    rawQueryString: '', headers: {
      host: 'example.execute-api.us-east-1.amazonaws.com',
      'content-type': 'application/json', origin: requestOrigin,
    }, cookies,
    requestContext: { http: { method, path, sourceIp: '127.0.0.1', protocol: 'HTTP/1.1' } },
    body: body ? JSON.stringify(body) : undefined, isBase64Encoded: false,
  }, {});
}

test('preflight permits the configured client and credentials', async () => {
  const response = await invoke('OPTIONS', '/api/auth/login');
  assert.equal(response.statusCode, 204);
  assert.equal(response.headers['access-control-allow-origin'], origin);
  assert.equal(response.headers['access-control-allow-credentials'], 'true');
});

test('untrusted origins cannot log in or perform cookie-authenticated writes', async () => {
  for (const method of ['OPTIONS', 'POST', 'PUT', 'DELETE']) {
    const response = await invoke(method, '/api/auth/login', { requestOrigin: 'https://untrusted.example' });
    assert.equal(response.statusCode, 403);
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  }
});

test('protected routes reject missing and tampered cookies', async () => {
  assert.equal((await invoke('GET', '/api/tables')).statusCode, 401);
  assert.equal((await invoke('GET', '/api/auth/me', { cookies: ['mysql_admin_session=bad'] })).statusCode, 401);
});

test('login cookies survive the API Gateway v2 round trip and logout clears them', async () => {
  const login = await invoke('POST', '/api/auth/login', { body: { username: 'admin', password: 'test-password' } });
  assert.equal(login.statusCode, 200);
  assert.match(login.cookies[0], /HttpOnly/);
  assert.match(login.cookies[0], /Secure/);
  assert.match(login.cookies[0], /SameSite=None/);
  const cookies = [login.cookies[0].split(';')[0]];
  const me = await invoke('GET', '/api/auth/me', { cookies });
  assert.equal(me.statusCode, 200);
  assert.deepEqual(JSON.parse(me.body), { username: 'admin' });
  const logout = await invoke('POST', '/api/auth/logout', { cookies });
  assert.equal(logout.statusCode, 200);
  assert.match(logout.cookies[0], /Expires=Thu, 01 Jan 1970/);
  assert.match(logout.cookies[0], /SameSite=None/);
});

test('invalid credentials do not issue a session', async () => {
  const response = await invoke('POST', '/api/auth/login', { body: { username: 'admin', password: 'wrong' } });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.cookies, []);
});

test('database health and unknown routes pass through the Lambda adapter', async () => {
  assert.equal((await invoke('GET', '/api/health')).statusCode, 200);
  assert.equal((await invoke('GET', '/api/missing')).statusCode, 404);
});
