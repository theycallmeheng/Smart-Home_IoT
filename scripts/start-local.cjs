/* Dùng Mosquitto hiện có; chỉ quản lý broker do lệnh này tự mở. */
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { start } = require('../backend/server.cjs');
const root = path.resolve(__dirname, '..');
let broker;
const stopBroker = () => {
  if (broker && broker.exitCode === null) broker.kill();
};
const reachable = (host, port) =>
  new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (connected) => {
      socket.destroy();
      resolve(connected);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(500, () => done(false));
  });
(async () => {
  const url = new URL(process.env.MQTT_URL ?? 'mqtt://127.0.0.1:1884');
  const binary = process.env.MOSQUITTO_BIN ?? 'C:/Program Files/mosquitto/mosquitto.exe';
  const config = process.env.MOSQUITTO_CONFIG ?? 'C:/Program Files/mosquitto/mosquitto.conf';
  if (
    process.platform === 'win32' &&
    ['127.0.0.1', 'localhost'].includes(url.hostname) &&
    url.protocol === 'mqtt:' &&
    Number(url.port) === 1884 &&
    !(await reachable(url.hostname, 1884)) &&
    fs.existsSync(binary) &&
    fs.existsSync(config)
  ) {
    fs.mkdirSync(path.join(root, 'data'), { recursive: true });
    const output = fs.openSync(path.join(root, 'data', 'mosquitto.log'), 'a');
    broker = spawn(binary, ['-c', config], {
      windowsHide: true,
      stdio: ['ignore', output, output],
    });
    fs.closeSync(output);
    broker.on('error', () =>
      console.error('Không mở được Mosquitto. Kiểm tra MOSQUITTO_BIN và MOSQUITTO_CONFIG.'),
    );
    process.once('exit', stopBroker);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !(await reachable(url.hostname, 1884)))
      await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const app = start();
  app.server.once('close', stopBroker);
})().catch((reason) => {
  stopBroker();
  console.error(reason.code || 'Không khởi động được ứng dụng.');
  process.exitCode = 1;
});
