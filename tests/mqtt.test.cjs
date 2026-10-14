const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, dirname, resolve } = require('node:path');
const { spawn } = require('node:child_process');
const net = require('node:net');
const mqtt = require('mqtt');
const { createStore, HardwareBridge } = require('../backend/core.cjs');
const binary =
  process.env.MOSQUITTO_BIN ||
  (process.platform === 'win32' ? 'C:/Program Files/mosquitto/mosquitto.exe' : '');
const until = async (condition) => {
  const deadline = Date.now() + 8000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('MQTT test timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

test(
  'Isolated Mosquitto routes real MQTT sensor packets and all three correlated commands',
  { skip: !binary || !existsSync(binary) },
  async () => {
    const listener = net.createServer();
    await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
    const port = listener.address().port;
    await new Promise((resolve) => listener.close(resolve));
    const folder = mkdtempSync(join(tmpdir(), 'iot-mqtt-'));
    const config = join(folder, 'mosquitto.conf');
    writeFileSync(config, `listener ${port} 127.0.0.1\nallow_anonymous true\npersistence false\n`);
    const broker = spawn(binary, ['-c', config], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let brokerError = '';
    broker.on('error', (reason) => {
      brokerError = reason.message;
    });
    const store = createStore();
    const service = mqtt.connect(`mqtt://127.0.0.1:${port}`, {
      reconnectPeriod: 100,
      queueQoSZero: false,
    });
    const esp = mqtt.connect(`mqtt://127.0.0.1:${port}`, { reconnectPeriod: 100 });
    service.on('error', () => {});
    esp.on('error', () => {});
    const bridge = new HardwareBridge({
      store,
      publish: (topic, payload, callback) =>
        service.publish(topic, payload, { retain: false, qos: 0 }, callback),
    });
    service.on('message', (topic, payload, packet) => bridge.receive(topic, payload, packet));
    const state = { led1: 'OFF', led2: 'OFF', led3: 'OFF' };
    esp.on('message', (topic, payload) => {
      const [action, id] = String(payload).split('|');
      const channel = topic.split('/').at(-1);
      state[channel] = action;
      setTimeout(
        () =>
          esp.publish(
            'esp8266/status',
            JSON.stringify({
              protocol: 2,
              result: 'SUCCESS',
              action: `${channel.toUpperCase()}_${action}`,
              commandId: id,
              ...state,
            }),
          ),
        40,
      );
    });
    try {
      await until(() => {
        if (brokerError) throw new Error(brokerError);
        return service.connected && esp.connected;
      });
      await new Promise((resolve, reject) =>
        service.subscribe(['esp8266/status', 'esp8266/sensor_data'], (reason) =>
          reason ? reject(reason) : resolve(),
        ),
      );
      await new Promise((resolve, reject) =>
        esp.subscribe(['esp8266/led1', 'esp8266/led2', 'esp8266/led3'], (reason) =>
          reason ? reject(reason) : resolve(),
        ),
      );
      bridge.setConnected(true);
      esp.publish(
        'esp8266/status',
        JSON.stringify({ protocol: 2, result: 'SUCCESS', action: 'GET_STATUS', ...state }),
      );
      esp.publish('esp8266/sensor_data', JSON.stringify({ temp: 27.5, hum: 70, light: 512 }));
      await until(
        () => bridge.online && bridge.protocol === 2 && store.list('sensors').total === 3,
      );
      for (const device of ['light', 'fan', 'ac']) {
        const command = bridge.command(device, true);
        assert.equal(command.status, 'pending');
        await until(() => store.command(command.id).status !== 'pending');
        assert.equal(store.command(command.id).status, 'success');
        assert.equal(bridge.states[device], true);
      }
      assert.equal(store.list('history', { status: 'success' }).total, 3);
      assert.equal(store.list('sensors', { sensor: 'light', q: '512 ADC' }).total, 1);
    } finally {
      bridge.close();
      await Promise.all(
        [service, esp].map((client) => new Promise((resolve) => client.end(true, {}, resolve))),
      );
      broker.kill();
      await new Promise((resolve) => {
        if (broker.exitCode !== null) resolve();
        else broker.once('exit', resolve);
      });
      store.close();
      assert.equal(dirname(resolve(folder)), resolve(tmpdir()));
      rmSync(folder, { recursive: true, force: true });
    }
  },
);
