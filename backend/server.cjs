/* HTTP/API và MQTT dùng chung một backend cục bộ. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createStore, HardwareBridge, error } = require('./core.cjs');
const { createAuth, requestToken } = require('./auth.cjs');

const ROOT = path.resolve(__dirname, '..');
const ASSETS = new Set([
  'index.html',
  'data-sensor.html',
  'action-history.html',
  'profile.html',
  'styles.css',
  'dashboard.css',
  'dashboard.js',
  'sensor-chart.js',
  'tables.js',
  'iot-api.js',
  'live-dashboard.js',
  'live-tables.js',
  'login.html',
  'login.css',
  'login.js',
]);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function createServer({ bridge, store, port = 3000, auth }) {
  const ownedAuth = !auth;
  auth ??= createAuth();
  const streams = new Map();
  const allowedOrigins = new Set([
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    'http://localhost:5500',
    'http://127.0.0.1:5500',
  ]);
  const broadcast = (payload) => {
    for (const [response, token] of streams) {
      if (!auth.session(token) || !response.write(`data: ${JSON.stringify(payload)}\n\n`))
        response.end();
    }
  };
  bridge.on('update', broadcast);
  const json = (response, status, body) => {
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify(body));
  };
  const bodyOf = (request) =>
    new Promise((resolve, reject) => {
      if (!request.headers['content-type']?.startsWith('application/json')) {
        reject(error('Cần gửi JSON.', 415));
        request.resume();
        return;
      }
      let buffer = '';
      let length = 0;
      let failed = false;
      request.on('data', (chunk) => {
        length += chunk.length;
        if (length > 4096) {
          if (!failed) reject(error('Yêu cầu quá lớn.', 413));
          failed = true;
          return;
        }
        buffer += chunk.toString();
      });
      request.on('error', reject);
      request.on('end', () => {
        if (failed) return;
        try {
          resolve(JSON.parse(buffer));
        } catch {
          reject(error('JSON không hợp lệ.'));
        }
      });
    });
  const server = http.createServer(async (request, response) => {
    try {
      const origin = request.headers.origin;
      if (origin && !allowedOrigins.has(origin)) {
        json(response, 403, { error: 'Nguồn yêu cầu không được cho phép.' });
        return;
      }
      if (origin) {
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Access-Control-Allow-Credentials', 'true');
        response.setHeader('Vary', 'Origin');
      }
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('X-Frame-Options', 'DENY');
      if (request.method === 'OPTIONS') {
        response.writeHead(204, {
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        response.end();
        return;
      }
      const url = new URL(request.url, 'http://localhost');
      const route = url.pathname;
      const token = requestToken(request);
      const user = auth.session(token);
      if (route === '/api/auth/session' && request.method === 'GET') {
        json(response, 200, { user });
        return;
      }
      if (route === '/api/auth/login' && request.method === 'POST') {
        const body = await bodyOf(request);
        if (!body || typeof body !== 'object' || Array.isArray(body))
          throw error('Nội dung đăng nhập không hợp lệ.');
        const session = await auth.login(body, request.socket.remoteAddress ?? 'local');
        auth.revoke(token);
        response.setHeader('Set-Cookie', auth.cookie(session.token, !!request.socket.encrypted));
        json(response, 200, { user: session.user });
        return;
      }
      if (route === '/api/auth/logout' && request.method === 'POST') {
        auth.revoke(token);
        for (const [stream, streamToken] of streams) if (streamToken === token) stream.end();
        response.setHeader('Set-Cookie', auth.clearCookie(!!request.socket.encrypted));
        json(response, 200, { ok: true });
        return;
      }
      if (route.startsWith('/api/') && !user) {
        json(response, 401, { error: 'Vui lòng đăng nhập để tiếp tục.' });
        return;
      }
      if (request.method === 'GET' && route === '/api/dashboard') {
        json(response, 200, bridge.snapshot());
        return;
      }
      if (request.method === 'GET' && ['/api/sensors', '/api/history'].includes(route)) {
        json(
          response,
          200,
          store.list(
            route === '/api/sensors' ? 'sensors' : 'history',
            Object.fromEntries(url.searchParams),
          ),
        );
        return;
      }
      if (request.method === 'POST' && route === '/api/commands') {
        const body = await bodyOf(request);
        if (!body || Array.isArray(body) || typeof body !== 'object')
          throw error('Nội dung lệnh không hợp lệ.');
        json(response, 202, bridge.command(body.device, body.state, user.name));
        return;
      }
      if (request.method === 'GET' && route === '/api/events') {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        response.write(
          `data: ${JSON.stringify({ kind: 'snapshot', snapshot: bridge.snapshot() })}\n\n`,
        );
        streams.set(response, token);
        const heartbeat = setInterval(() => {
          if (!auth.session(token)) response.end();
          else response.write(': heartbeat\n\n');
        }, 15000);
        heartbeat.unref();
        response.on('close', () => {
          streams.delete(response);
          clearInterval(heartbeat);
        });
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) {
        json(response, 405, { error: 'Phương thức không được hỗ trợ.' });
        return;
      }
      if (route === '/' && !url.searchParams.has('mode')) {
        response.writeHead(302, { Location: '/index.html?mode=live' });
        response.end();
        return;
      }
      const file = route === '/' ? 'index.html' : route.slice(1);
      if (!ASSETS.has(file)) {
        json(response, 404, { error: 'Không tìm thấy.' });
        return;
      }
      if (file.endsWith('.html') && file !== 'login.html' && !user) {
        const next = `/${file}${url.search || '?mode=live'}`;
        response.writeHead(302, {
          Location: `/login.html?next=${encodeURIComponent(next)}`,
          'Cache-Control': 'no-store',
        });
        response.end();
        return;
      }
      response.writeHead(200, {
        'Content-Type': TYPES[path.extname(file)],
        'Cache-Control': 'no-cache',
      });
      if (request.method === 'HEAD') response.end();
      else
        fs.createReadStream(path.join(ROOT, file))
          .on('error', () => response.destroy())
          .pipe(response);
    } catch (reason) {
      if (!response.headersSent)
        json(response, reason.status ?? 500, {
          error: reason.status ? reason.message : 'Backend gặp lỗi xử lý.',
        });
      else response.end();
    }
  });
  server.on('close', () => {
    bridge.off('update', broadcast);
    if (ownedAuth) auth.close();
  });
  server.closeStreams = () => {
    for (const response of streams.keys()) response.end();
  };
  return server;
}

function start() {
  const mqtt = require('mqtt');
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT không hợp lệ.');
  const timeoutMs = Number(process.env.COMMAND_TIMEOUT_MS ?? 8000);
  const staleMs = Number(process.env.DEVICE_STALE_MS ?? 15000);
  if (
    ![timeoutMs, staleMs].every(
      (value) => Number.isFinite(value) && value >= 1000 && value <= 120000,
    )
  )
    throw new Error('Thời gian chờ phải từ 1000 đến 120000ms.');
  const store = createStore(process.env.DATABASE_PATH ?? path.join(ROOT, 'data', 'iot.sqlite'));
  const auth = createAuth({
    filename: process.env.AUTH_DATABASE_PATH || path.join(ROOT, 'data', 'auth.sqlite'),
  });
  const client = mqtt.connect(process.env.MQTT_URL ?? 'mqtt://127.0.0.1:1884', {
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    clientId: `iot-backend-${process.pid}`,
    reconnectPeriod: 2000,
    queueQoSZero: false,
    connectTimeout: 5000,
  });
  const bridge = new HardwareBridge({
    store,
    timeoutMs,
    staleMs,
    publish: (topic, payload, callback) =>
      client.publish(topic, payload, { qos: 0, retain: false }, callback),
  });
  client.on('connect', () => {
    client.subscribe(
      ['esp8266/sensor_data', 'esp8266/status', 'esp8266/availability'],
      { qos: 0 },
      (reason) => {
        if (reason) {
          bridge.setConnected(false);
          return;
        }
        bridge.setConnected(true);
        client.publish('esp8266/get_status', 'GET', { retain: false, qos: 0 });
        console.log('MQTT đã kết nối và đăng ký dữ liệu ESP8266.');
      },
    );
  });
  client.on('message', (topic, payload, packet) => {
    try {
      bridge.receive(topic, payload, packet);
    } catch {
      console.error('Không lưu được dữ liệu MQTT.');
    }
  });
  client.on('close', () => bridge.setConnected(false));
  let previousError = '';
  client.on('error', (reason) => {
    const message = reason.code ?? 'CONNECTION_ERROR';
    if (message !== previousError)
      console.error(`MQTT chưa kết nối (${message}). Kiểm tra Mosquitto và .env.`);
    previousError = message;
  });
  const server = createServer({ bridge, store, auth, port });
  const ticker = setInterval(() => bridge.tick(), 5000);
  ticker.unref();
  const statusTicker = setInterval(() => {
    if (bridge.connected && !bridge.online)
      client.publish('esp8266/get_status', 'GET', { retain: false, qos: 0 });
  }, 10000);
  statusTicker.unref();
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    clearInterval(ticker);
    clearInterval(statusTicker);
    bridge.close();
    server.closeStreams();
    client.end(true, {}, () =>
      server.close(() => {
        store.close();
        auth.close();
      }),
    );
  };
  server.on('error', (reason) => {
    console.error(`Không mở được backend (${reason.code}).`);
    stop();
    process.exitCode = 1;
  });
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  server.listen(port, process.env.HOST ?? '127.0.0.1', () =>
    console.log(`IoT Control: http://localhost:${port}/`),
  );
  return { server, bridge, client, store, stop };
}

if (require.main === module) start();
module.exports = { createServer, start };
