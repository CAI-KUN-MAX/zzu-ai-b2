const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, extra = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src/api', file), 'utf8')
    .replaceAll('import.meta.env', 'env');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, env: {}, setTimeout, clearTimeout, AbortController, DOMException, ...extra });
  return exports;
}

test('write requests bootstrap CSRF and safe requests omit the header', async () => {
  const document = { cookie: '' };
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/auth/me') document.cookie = 'resume_csrf=localtesttoken';
    return { ok: true, text: async () => '{}' };
  };
  const api = load('http.ts', { document, fetch });
  await api.request('/api/resumes/batch', { method: 'POST' });
  assert.equal(calls[0].url, '/api/auth/me');
  assert.equal(calls[0].options.headers['X-CSRF-Token'], undefined);
  assert.equal(calls[1].options.headers['X-CSRF-Token'], 'localtesttoken');
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    await api.request('/api/test', { method });
    assert.equal(calls.at(-1).options.headers['X-CSRF-Token'], 'localtesttoken');
  }
  await api.request('/api/test');
  assert.equal(calls.at(-1).options.headers['X-CSRF-Token'], undefined);
});

test('authentication reads nested users and rejects malformed authenticated responses', async () => {
  const user = { id: 'usr_test', username: 'student' };
  let response = { authenticated: true, user };
  class ApiError extends Error { constructor(message, code) { super(message); this.code = code; } }
  const http = { ApiError, request: async () => response };
  const auth = load('auth.ts', { require: () => http });
  assert.equal((await auth.fetchMe()).username, 'student');
  response = { user };
  assert.equal((await auth.login('student', 'password')).id, 'usr_test');
  assert.equal((await auth.register('student', 'password')).username, 'student');
  response = { authenticated: false, user: null };
  assert.equal(await auth.fetchMe(), null);
  response = { authenticated: true, user: null };
  await assert.rejects(auth.fetchMe(), /不完整/);
});

test('concurrent writes share CSRF bootstrap and never write without a cookie', async () => {
  const document = { cookie: '' };
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/auth/me') {
      await new Promise(resolve => setTimeout(resolve, 10));
      document.cookie = 'resume_csrf=localtesttoken';
    }
    return { ok: true, text: async () => '{}' };
  };
  const api = load('http.ts', { document, fetch });
  await Promise.all([api.request('/api/a', { method: 'POST' }), api.request('/api/b', { method: 'POST' })]);
  assert.equal(calls.filter(call => call.url === '/api/auth/me').length, 1);
  assert.equal(calls.filter(call => call.options.headers['X-CSRF-Token'] === 'localtesttoken').length, 2);

  document.cookie = '';
  const failedCalls = [];
  const missing = load('http.ts', { document, fetch: async url => {
    failedCalls.push(url);
    return { ok: true, text: async () => '{}' };
  }});
  await assert.rejects(missing.request('/api/a', { method: 'POST' }), /安全令牌/);
  assert.deepEqual(failedCalls, ['/api/auth/me']);
});
