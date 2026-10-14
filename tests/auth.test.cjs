const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, dirname, join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createAuth, requestToken } = require('../backend/auth.cjs');
const { createStore, HardwareBridge } = require('../backend/core.cjs');
const { createServer } = require('../backend/server.cjs');
const { JSDOM } = require('jsdom');
const { readFileSync } = require('node:fs');
const credentials = {
  username: 'test.user',
  name: 'Người kiểm thử',
  password: 'Test123!',
};

test('Issued accounts validate inputs and persist only salted password hashes and hashed session tokens', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'iot-auth-'));
  const filename = join(folder, 'auth.sqlite');
  let auth = createAuth({ filename });
  let db;
  try {
    await assert.rejects(auth.createUser({ ...credentials, password: '1234567' }), /8/);
    await assert.rejects(auth.createUser({ ...credentials, password: 'x'.repeat(129) }), /128/);
    await assert.rejects(
      auth.createUser({ ...credentials, username: 'bad name' }),
      /Tên đăng nhập/,
    );
    await assert.rejects(auth.createUser({ ...credentials, name: '' }), /Tên hiển thị/);
    const user = await auth.createUser(credentials);
    assert.deepEqual(Object.keys(user).sort(), ['id', 'name', 'username']);
    await assert.rejects(auth.createUser({ ...credentials, username: 'TEST.USER' }), /tồn tại/);
    await auth.createUser({ ...credentials, username: 'second.user' });
    const session = await auth.login({ ...credentials, username: ' TEST.USER ' });
    db = new DatabaseSync(filename);
    const hashes = db
      .prepare('SELECT password_hash FROM users')
      .all()
      .map((row) => row.password_hash);
    assert.ok(
      hashes.every((hash) => hash.startsWith('scrypt$') && !hash.includes(credentials.password)),
    );
    assert.notEqual(hashes[0], hashes[1], 'Equal passwords have different salts');
    assert.notEqual(db.prepare('SELECT token_hash FROM sessions').get().token_hash, session.token);
    db.close();
    db = null;
    auth.close();
    auth = createAuth({ filename });
    assert.equal(auth.session(session.token).name, credentials.name);
    auth.revoke(session.token);
    assert.equal(auth.session(session.token), null);
  } finally {
    db?.close();
    auth.close();
    assert.equal(dirname(resolve(folder)), resolve(tmpdir()));
    rmSync(folder, { recursive: true, force: true });
  }
});

test('Invalid credentials return a generic error, login is throttled, sessions expire', async () => {
  let now = 0;
  const auth = createAuth({ now: () => now, sessionMs: 1000, maxAttempts: 2 });
  try {
    await auth.createUser(credentials);
    let known, unknown;
    try {
      await auth.login({ ...credentials, password: 'wrong-password' }, 'a');
    } catch (error) {
      known = error;
    }
    try {
      await auth.login({ ...credentials, username: 'unknown' }, 'b');
    } catch (error) {
      unknown = error;
    }
    assert.equal(known.status, 401);
    assert.equal(known.message, unknown.message);
    await assert.rejects(auth.login({ ...credentials, password: 'wrong-password' }, 'a'), {
      status: 401,
    });
    await assert.rejects(auth.login(credentials, 'a'), { status: 429 });
    now += 10 * 60 * 1000 + 1;
    const first = await auth.login(credentials, 'a');
    const second = await auth.login(credentials, 'a');
    assert.notEqual(first.token, second.token);
    assert.equal(auth.session(first.token).username, credentials.username);
    now += 1001;
    assert.equal(auth.session(first.token), null);
    assert.equal(auth.session('forged'), null);
    assert.match(auth.cookie(first.token), /HttpOnly; SameSite=Strict/);
    assert.match(auth.cookie(first.token, true), /; Secure$/);
    assert.equal(
      requestToken({ headers: { cookie: `other=x; iot_session=${first.token}; more=y` } }),
      first.token,
    );
  } finally {
    auth.close();
  }
});

async function fixture(run) {
  const auth = createAuth();
  await auth.createUser(credentials);
  const store = createStore();
  const sent = [];
  const bridge = new HardwareBridge({
    store,
    publish: (topic, payload, callback) => {
      sent.push({ topic, payload });
      callback?.();
    },
  });
  bridge.setConnected(true);
  bridge.receive(
    'esp8266/status',
    Buffer.from(
      JSON.stringify({
        protocol: 2,
        result: 'SUCCESS',
        action: 'GET_STATUS',
        led1: 'OFF',
        led2: 'OFF',
        led3: 'OFF',
      }),
    ),
  );
  const server = createServer({ auth, bridge, store });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body, cookie) =>
    fetch(base + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body),
    });
  try {
    await run({ auth, store, bridge, sent, server, base, post });
  } finally {
    server.closeStreams();
    await new Promise((done) => server.close(done));
    bridge.close();
    store.close();
    auth.close();
  }
}

test('All private pages and APIs require login; only the login page and static assets are public', () =>
  fixture(async ({ base, post, sent }) => {
    for (const route of ['/api/dashboard', '/api/sensors', '/api/history', '/api/events'])
      assert.equal((await fetch(base + route)).status, 401);
    assert.equal((await post('/api/commands', { device: 'fan', state: true })).status, 401);
    assert.equal(sent.length, 0);
    for (const file of ['index', 'data-sensor', 'action-history', 'profile']) {
      const result = await fetch(`${base}/${file}.html?mode=live`, { redirect: 'manual' });
      assert.equal(result.status, 302);
      assert.equal(
        result.headers.get('location'),
        `/login.html?next=${encodeURIComponent(`/${file}.html?mode=live`)}`,
      );
    }
    for (const file of ['login.html', 'login.css', 'login.js', 'styles.css'])
      assert.equal((await fetch(`${base}/${file}`)).status, 200);
    for (const file of ['data/auth.sqlite', 'scripts/create-account.cjs', 'backend/auth.cjs'])
      assert.equal((await fetch(`${base}/${file}`)).status, 404);
    assert.deepEqual(await (await fetch(`${base}/api/auth/session`)).json(), { user: null });
    assert.equal((await post('/api/auth/register', credentials)).status, 401);
  }));

test('Login rotates the session, protects cookies and records the authenticated operator; logout revokes access and SSE', () =>
  fixture(async ({ base, post, auth, store }) => {
    assert.equal(
      (await post('/api/auth/login', { ...credentials, password: 'wrong' })).status,
      401,
    );
    assert.equal((await post('/api/auth/login', null)).status, 400);
    assert.equal((await post('/api/auth/login', { password: 'x'.repeat(5000) })).status, 413);
    const result = await post('/api/auth/login', credentials);
    assert.equal(result.status, 200);
    const first = result.headers.get('set-cookie').split(';')[0];
    assert.match(result.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Max-Age=28800/);
    assert.deepEqual(await result.json(), {
      user: { id: 1, username: credentials.username, name: credentials.name },
    });
    const renewed = await post('/api/auth/login', credentials, first);
    const cookie = renewed.headers.get('set-cookie').split(';')[0];
    assert.notEqual(cookie, first);
    assert.equal(auth.session(first.split('=')[1]), null);
    const headers = { Cookie: cookie };
    assert.equal((await fetch(`${base}/profile.html`, { headers })).status, 200);
    const cors = await fetch(`${base}/api/dashboard`, {
      headers: { ...headers, Origin: 'http://localhost:5500' },
    });
    assert.equal(cors.status, 200);
    assert.equal(cors.headers.get('access-control-allow-credentials'), 'true');
    assert.equal(
      (
        await fetch(`${base}/api/auth/session`, {
          headers: { ...headers, Origin: 'https://evil.example' },
        })
      ).status,
      403,
    );
    const command = await post(
      '/api/commands',
      { device: 'fan', state: true, operator: 'spoofed' },
      cookie,
    );
    assert.equal(command.status, 202);
    const action = await command.json();
    assert.equal(action.operator, credentials.name);
    assert.equal(store.command(action.id).operator, credentials.name);
    const stream = await fetch(`${base}/api/events`, { headers });
    const reader = stream.body.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /snapshot/);
    const logout = await post('/api/auth/logout', {}, cookie);
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await reader.read()).done, true, 'Logout closes the current SSE stream');
    assert.equal((await fetch(`${base}/api/dashboard`, { headers })).status, 401);
    assert.equal(
      (await post('/api/commands', { device: 'light', state: true }, cookie)).status,
      401,
    );
  }));

test('Login UI masks passwords, submits credentials once and displays server errors', async () => {
  const root = resolve(__dirname, '..');
  const dom = new JSDOM(readFileSync(join(root, 'login.html'), 'utf8'), {
    url: 'http://localhost:3000/login.html',
    runScripts: 'outside-only',
  });
  const { window } = dom;
  const requests = [];
  let finish;
  window.fetch = (url, options) => {
    if (url.endsWith('/session'))
      return Promise.resolve({ ok: true, json: async () => ({ user: null }) });
    requests.push({ url, options });
    return new Promise((done) => {
      finish = done;
    });
  };
  try {
    window.eval(readFileSync(join(root, 'login.js'), 'utf8'));
    const doc = window.document;
    const form = doc.querySelector('form');
    assert.equal(form.method, 'post');
    form.elements.username.value = 'test.user';
    form.elements.password.value = credentials.password;
    doc.querySelector('#toggle-password').click();
    assert.equal(form.elements.password.type, 'text');
    assert.equal(doc.querySelector('#toggle-password').getAttribute('aria-pressed'), 'true');
    const submit = () => form.dispatchEvent(new window.Event('submit', { cancelable: true }));
    submit();
    submit();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options.credentials, 'include');
    assert.equal(JSON.parse(requests[0].options.body).password, credentials.password);
    assert.equal(doc.querySelector('#login-submit').disabled, true);
    finish({ ok: false, json: async () => ({ error: 'Tên đăng nhập hoặc mật khẩu không đúng.' }) });
    await new Promise((done) => setTimeout(done, 20));
    assert.match(doc.querySelector('#login-error').textContent, /không đúng/);
    assert.equal(doc.querySelector('#login-error').hidden, false);
    assert.equal(doc.querySelector('#login-submit').disabled, false);
    assert.equal(doc.querySelector('a[href*="register"]'), null);
  } finally {
    window.close();
  }
});
