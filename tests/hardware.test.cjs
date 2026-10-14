const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStore, HardwareBridge } = require('../backend/core.cjs');
const { createServer } = require('../backend/server.cjs');
const { createAuth } = require('../backend/auth.cjs');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, dirname, resolve } = require('node:path');

function setup(options = {}) {
  const store = createStore();
  const sent = [];
  let now = Date.parse('2026-10-13T03:00:00Z');
  const bridge = new HardwareBridge({
    store,
    now: () => now,
    publish: (topic, payload, callback) => {
      sent.push({ topic, payload });
      callback?.();
    },
    ...options,
  });
  const receive = (topic, data, packet) =>
    bridge.receive(
      `esp8266/${topic}`,
      Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)),
      packet,
    );
  const status = (extra = {}) =>
    receive('status', {
      result: 'SUCCESS',
      action: 'GET_STATUS',
      protocol: 2,
      led1: 'OFF',
      led2: 'OFF',
      led3: 'OFF',
      ...extra,
    });
  bridge.setConnected(true);
  status();
  return {
    store,
    bridge,
    sent,
    receive,
    status,
    advance(ms) {
      now += ms;
    },
    close() {
      bridge.close();
      store.close();
    },
  };
}

test('Real samples persist as three readings with ADC units; server searches and paginates', () => {
  const f = setup();
  try {
    for (let index = 0; index < 12; index++) {
      f.receive('sensor_data', { temp: 28.5, hum: 65, light: 720 });
      f.advance(2000);
    }
    let result = f.store.list('sensors', { size: 5, sensor: 'humidity' });
    assert.equal(result.total, 12);
    assert.equal(result.pages, 3);
    assert.equal(result.rows.length, 5);
    result = f.store.list('sensors', { size: 5, page: 99, sensor: 'humidity' });
    assert.equal(result.page, 3);
    assert.equal(result.rows.length, 2);
    assert.equal(f.store.list('sensors', { sensor: 'light', q: '720 ADC' }).total, 12);
    assert.equal(f.store.list('sensors', { sensor: 'time', q: '13/10/2026 10:00:00' }).total, 3);
    assert.equal(f.store.list('sensors', { sensor: 'time', q: '720 ADC' }).total, 0);
    assert.equal(f.bridge.snapshot().samples.length, 12);
    assert.equal(f.bridge.snapshot().lightUnit, 'ADC');
    assert.throws(() => f.store.list('history', { device: 'invalid' }), /Bộ lọc/);
    assert.throws(() => f.store.list('sensors', { size: 0 }), /Phân trang/);
  } finally {
    f.close();
  }
});

test('Null DHT data leaves chart gaps and still stores light; invalid/retained samples are ignored', () => {
  const f = setup();
  try {
    f.receive('sensor_data', { temp: null, hum: null, light: 900 });
    assert.equal(f.store.list('sensors').total, 1);
    assert.equal(f.bridge.snapshot().latest.temperature, null);
    for (const payload of [
      { temp: '28', hum: 60, light: 5 },
      { temp: 28, hum: 101, light: 5 },
      { temp: 28, hum: 60, light: 1024 },
      { temp: null, hum: null, light: null },
    ])
      f.receive('sensor_data', payload);
    f.receive('sensor_data', '{bad json');
    f.receive('sensor_data', { temp: 28, hum: 60, light: 5 }, { retain: true });
    assert.equal(f.store.list('sensors').total, 1);
  } finally {
    f.close();
  }
});

test('Each device waits for its own commandId and GPIO confirmation; broker write is not success', () => {
  const f = setup();
  try {
    const fan = f.bridge.command('fan', true);
    const ac = f.bridge.command('ac', true);
    assert.equal(fan.status, 'pending');
    assert.equal(f.sent[0].topic, 'esp8266/led2');
    assert.equal(f.sent[0].payload, `ON|${fan.id}`);
    assert.throws(() => f.bridge.command('fan', false), /đang xử lý/);
    f.status({ action: 'LED2_ON', led2: 'ON', commandId: 'unrelated' });
    assert.equal(f.store.command(fan.id).status, 'pending');
    f.status({ action: 'LED3_ON', led3: 'ON', commandId: ac.id });
    assert.equal(f.store.command(ac.id).status, 'success');
    assert.equal(f.store.command(fan.id).status, 'pending');
    f.status({ action: 'LED2_ON', led2: 'ON', commandId: fan.id });
    assert.equal(f.store.command(fan.id).status, 'success');
    assert.equal(f.store.list('history', { status: 'success' }).total, 2);
    assert.equal(f.store.list('history', { q: 'Nguyễn' }).total, 0);
    assert.equal(f.store.list('history', { q: '13/10/2026' }).total, 2);
  } finally {
    f.close();
  }
});

test('Wrong confirmation, timeout and disconnect fail commands without inventing GPIO state', async () => {
  const f = setup({ timeoutMs: 15 });
  try {
    const wrong = f.bridge.command('light', true);
    f.status({ action: 'LED1_ON', led1: 'OFF', commandId: wrong.id });
    assert.equal(f.store.command(wrong.id).status, 'failed');
    const timeout = f.bridge.command('light', true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(f.store.command(timeout.id).status, 'failed');
    assert.equal(f.bridge.states.light, false);
    f.status({ action: 'LED1_ON', led1: 'ON', commandId: timeout.id });
    assert.equal(
      f.store.command(timeout.id).status,
      'failed',
      'Late ACK never rewrites a timed-out command',
    );
    assert.equal(f.bridge.states.light, true, 'Fresh GPIO report may update actual state');
    const disconnected = f.bridge.command('fan', true);
    f.bridge.setConnected(false);
    assert.equal(f.store.command(disconnected.id).status, 'failed');
    assert.throws(() => f.bridge.command('fan', false), /chưa kết nối/);
  } finally {
    f.close();
  }
});

test('Legacy firmware and stale or retained availability do not enable controls', () => {
  const f = setup();
  try {
    f.status({ protocol: undefined });
    assert.throws(() => f.bridge.command('light', true), /firmware/);
    f.status();
    f.advance(16000);
    f.bridge.tick();
    assert.equal(f.bridge.online, false);
    f.receive('availability', 'online', { retain: true });
    assert.equal(f.bridge.online, false);
    assert.throws(() => f.bridge.command('ac', true), /chưa kết nối/);
    f.status();
    f.receive('availability', 'offline');
    assert.equal(f.bridge.online, false);
  } finally {
    f.close();
  }
});

test('SQLite survives restart and unfinished commands become failed', () => {
  const folder = mkdtempSync(join(tmpdir(), 'iot-store-'));
  const file = join(folder, 'test.sqlite');
  let store = createStore(file);
  try {
    store.addSample({ temp: 25, hum: 60, light: 12 }, '2026-10-13T03:00:00Z');
    store.addCommand({
      id: 'test-command',
      device: 'light',
      action: 'on',
      operator: 'Nguyễn Đức Hưng',
      timestamp: '2026-10-13T03:00:00Z',
    });
    store.close();
    store = createStore(file);
    assert.equal(store.list('sensors').total, 3);
    assert.equal(store.command('test-command').status, 'failed');
  } finally {
    store.close();
    assert.equal(dirname(resolve(folder)), resolve(tmpdir()));
    rmSync(folder, { recursive: true, force: true });
  }
});

test('HTTP API validates commands, exposes SSE and protects local configuration', async () => {
  const f = setup();
  const auth = createAuth();
  await auth.createUser({
    username: 'hung',
    name: 'Nguyễn Đức Hưng',
    password: 'test-only-long-password',
  });
  const session = await auth.login({ username: 'hung', password: 'test-only-long-password' });
  const fetch = (url, options = {}) =>
    globalThis.fetch(url, {
      ...options,
      headers: { Cookie: auth.cookie(session.token), ...options.headers },
    });
  const server = createServer({ bridge: f.bridge, store: f.store, auth });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const home = await fetch(base, { redirect: 'manual' });
    assert.equal(home.status, 302);
    assert.equal(home.headers.get('location'), '/index.html?mode=live');
    for (const route of [
      '/.env',
      '/backend/server.cjs',
      '/hardware/iot_control/secrets.h',
      '/data/iot.sqlite',
    ])
      assert.equal((await fetch(base + route)).status, 404);
    assert.equal(
      (await fetch(base + '/api/dashboard', { headers: { Origin: 'https://unrelated.example' } }))
        .status,
      403,
    );
    const cors = await fetch(base + '/api/dashboard', {
      headers: { Origin: 'http://localhost:5500' },
    });
    assert.equal(cors.headers.get('access-control-allow-origin'), 'http://localhost:5500');
    assert.equal((await fetch(base + '/api/sensors?size=999')).status, 400);
    assert.equal(
      (
        await fetch(base + '/api/commands', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device: 'ac', state: 'ON' }),
        })
      ).status,
      400,
    );
    const response = await fetch(base + '/api/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device: 'ac', state: true, operator: 'spoofed' }),
    });
    assert.equal(response.status, 202);
    assert.equal((await response.json()).operator, 'Nguyễn Đức Hưng');
    const controller = new AbortController();
    const events = await fetch(base + '/api/events', { signal: controller.signal });
    assert.equal(events.headers.get('content-type'), 'text/event-stream');
    const reader = events.body.getReader();
    const packet = await reader.read();
    assert.match(new TextDecoder().decode(packet.value), /"kind":"snapshot"/);
    controller.abort();
    await reader.cancel().catch(() => {});
  } finally {
    server.closeStreams();
    await new Promise((resolve) => server.close(resolve));
    auth.close();
    f.close();
  }
});
