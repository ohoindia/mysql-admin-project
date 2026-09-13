const { test } = require('node:test');
const assert = require('node:assert/strict');

Object.assign(process.env, {
  AWS_LAMBDA_FUNCTION_NAME: 'local-test', NODE_ENV: 'production',
  DB_HOST: 'unused', DB_USER: 'test', DB_PASSWORD: 'test', DB_NAME: 'test',
  ADMIN_USER: 'admin', ADMIN_PASSWORD: 'test-password', SESSION_SECRET: 'test-secret',
  SUPER_USER: 'superadmin', ALLOWED_TABLES: 'visible',
  CORS_ORIGINS: 'https://main.example.amplifyapp.com',
});
// Exercise the real Express/Lambda adapter without connecting to a database.
let destroyed = 0;
const queryCalls = [];
require('mysql2/promise').createPool = () => ({
  getConnection: async () => ({
    destroy() { destroyed++; },
    async query(options) {
      queryCalls.push(options);
      if (options.sql === 'bad SQL') throw Object.assign(new Error('Syntax error'), { code: 'ER_PARSE_ERROR' });
      if (options.sql === 'UPDATE visible SET value = 2') return [{ affectedRows: 3, warningStatus: 0 }, undefined];
      if (options.sql === 'SELECT large') return [Array.from({ length: 1001 }, (_, i) => [i]), [{ name: 'id' }]];
      return [[[1, null]], [{ name: 'value' }, { name: 'value' }]];
    },
  }), query: async (sql) => [sql.includes('INFORMATION_SCHEMA.TABLES')
  ? [{ name: 'visible' }, { name: 'restricted' }] : [{ value: 1 }]] });
const { handler } = require('../lambda');
const origin = process.env.CORS_ORIGINS;

function invoke(method, path, { body, cookies, token, requestOrigin = origin } = {}) {
  return handler({
    version: '2.0', routeKey: 'ANY /api/{proxy+}', rawPath: path,
    rawQueryString: '', headers: {
      host: 'example.execute-api.us-east-1.amazonaws.com',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json', origin: requestOrigin,
    }, cookies,
    requestContext: { http: { method, path, sourceIp: '127.0.0.1', protocol: 'HTTP/1.1' } },
    body: body ? JSON.stringify(body) : undefined, isBase64Encoded: false,
  }, {});
}

test('preflight permits the configured client and Authorization header', async () => {
  const response = await invoke('OPTIONS', '/api/auth/login');
  assert.equal(response.statusCode, 204);
  assert.equal(response.headers['access-control-allow-origin'], origin);
  assert.match(response.headers['access-control-allow-headers'], /Authorization/);
});

test('untrusted origins cannot log in or perform authenticated writes', async () => {
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

test('login returns a bearer token that authenticates API Gateway v2 requests without cookies', async () => {
  const login = await invoke('POST', '/api/auth/login', { body: { username: 'admin', password: 'test-password' } });
  assert.equal(login.statusCode, 200);
  assert.deepEqual(login.cookies, []);
  assert.equal(login.headers['set-cookie'], undefined);
  assert.equal(login.headers['cache-control'], 'no-store');
  const { token, expiresIn } = JSON.parse(login.body);
  assert.equal(expiresIn, 43200);
  const me = await invoke('GET', '/api/auth/me', { token });
  assert.equal(me.statusCode, 200);
  assert.deepEqual(JSON.parse(me.body), { username: 'admin', canRunQueries: false });
  assert.equal((await invoke('GET', '/api/tables', { token })).statusCode, 200);
  assert.equal((await invoke('GET', '/api/auth/me', { cookies: [`mysql_admin_session=${token}`] })).statusCode, 401);
  const logout = await invoke('POST', '/api/auth/logout', { token });
  assert.equal(logout.statusCode, 200);
  assert.deepEqual(logout.cookies, []);
});

test('expired, future, tampered, and legacy cookie tokens are rejected', async () => {
  const crypto = require('node:crypto');
  for (const [time, prefix, secret] of [
    [Date.now() - 43200001, 'bearer-v1:', 'test-secret'],
    [Date.now() + 60000, 'bearer-v1:', 'test-secret'],
    [Date.now(), 'bearer-v1:', 'wrong-secret'],
    [Date.now(), '', 'test-secret'],
  ]) {
    const payload = `admin:${time}`;
    const signature = crypto.createHmac('sha256', secret).update(prefix + payload).digest('hex');
    const token = Buffer.from(`${payload}:${signature}`).toString('base64');
    assert.equal((await invoke('GET', '/api/auth/me', { token })).statusCode, 401);
  }
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

test('super user bypasses table restrictions while admin remains restricted', async () => {
  for (const username of ['admin', 'superadmin']) {
    const login = await invoke('POST', '/api/auth/login', {
      body: { username, password: 'test-password' },
    });
    assert.equal(login.statusCode, 200);
    const { token } = JSON.parse(login.body);
    const me = await invoke('GET', '/api/auth/me', { token });
    assert.equal(me.statusCode, 200);
    assert.deepEqual(JSON.parse(me.body), { username, canRunQueries: username === 'superadmin' });
    const tables = await invoke('GET', '/api/tables', { token });
    assert.deepEqual(JSON.parse(tables.body), username === 'admin'
      ? [{ name: 'visible' }] : [{ name: 'visible' }, { name: 'restricted' }]);
    assert.equal((await invoke('GET', '/api/tables/visible/schema', { token })).statusCode, 200);
    for (const [method, suffix, superStatus] of [
      ['GET', 'schema', 200], ['GET', 'rows', 200],
      ['POST', 'rows', 400], ['PUT', 'rows', 400], ['DELETE', 'rows', 400],
    ]) {
      const response = await invoke(method, `/api/tables/restricted/${suffix}`, { token });
      assert.equal(response.statusCode, username === 'admin' ? 403 : superStatus);
      // Even a super user must pass identifier validation before querying SQL.
      assert.equal((await invoke(method, `/api/tables/bad-name/${suffix}`, { token })).statusCode, 400);
    }
  }
});

test('super user and unknown users cannot log in with invalid credentials', async () => {
  for (const [username, password] of [['superadmin', 'wrong'], ['unknown', 'test-password']]) {
    const response = await invoke('POST', '/api/auth/login', { body: { username, password } });
    assert.equal(response.statusCode, 401);
    assert.equal(JSON.parse(response.body).token, undefined);
  }
});

test('SQL console enforces auth and table restrictions, validates input and preserves results', async () => {
  assert.equal((await invoke('POST', '/api/query', { body: { sql: 'SELECT 1' } })).statusCode, 401);
  for (const username of ['admin', 'superadmin']) {
    const login = await invoke('POST', '/api/auth/login', { body: { username, password: 'test-password' } });
    const { token } = JSON.parse(login.body);
    const before = queryCalls.length;
    const response = await invoke('POST', '/api/query', { token, body: { sql: 'SELECT 1' } });
    assert.equal(response.statusCode, username === 'admin' ? 403 : 200);
    if (username === 'admin') { assert.equal(queryCalls.length, before); continue; }
    assert.deepEqual(JSON.parse(response.body).results, [{ columns: ['value', 'value'], rows: [[1, null]], truncated: false }]);
    for (const sql of ['', '  ', 42, 'x'.repeat(100001)]) {
      assert.equal((await invoke('POST', '/api/query', { token, body: { sql } })).statusCode, 400);
    }
    const writes = await invoke('POST', '/api/query', { token, body: { sql: 'UPDATE visible SET value = 2' } });
    assert.equal(JSON.parse(writes.body).results[0].affectedRows, 3);
    const large = JSON.parse((await invoke('POST', '/api/query', { token, body: { sql: 'SELECT large' } })).body);
    assert.equal(large.results[0].rows.length, 1000);
    assert.equal(large.results[0].truncated, true);
    const cleanup = destroyed;
    const failure = await invoke('POST', '/api/query', { token, body: { sql: 'bad SQL' } });
    assert.equal(failure.statusCode, 400);
    assert.equal(JSON.parse(failure.body).code, 'ER_PARSE_ERROR');
    assert.equal(destroyed, cleanup + 1);
    assert.equal(destroyed, queryCalls.length);
  }
});
