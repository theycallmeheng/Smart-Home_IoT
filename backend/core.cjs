/* Lưu SQLite và xác nhận lệnh bằng phản hồi ESP8266. */
const { DatabaseSync } = require('node:sqlite');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { mkdirSync } = require('node:fs');
const { dirname, resolve } = require('node:path');

const DEVICES = {
  light: { name: 'Light 1', channel: 'led1' },
  fan: { name: 'Fan 1', channel: 'led2' },
  ac: { name: 'Air Condition', channel: 'led3' },
};
const SENSORS = {
  temperature: { label: 'Temperature', unit: '°C', field: 'temp' },
  humidity: { label: 'Humidity', unit: '%', field: 'hum' },
  light: { label: 'Light', unit: 'ADC', field: 'light' },
};
const normalize = (value) =>
  String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Bangkok',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
const displayTime = (timestamp) => dateFormatter.format(new Date(timestamp)).replace(',', '');
const error = (message, status = 400) => Object.assign(new Error(message), { status });

function createStore(filename = ':memory:') {
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS samples (
      id INTEGER PRIMARY KEY, timestamp TEXT NOT NULL, temp REAL, hum REAL, light REAL
    );
    CREATE TABLE IF NOT EXISTS readings (
      id INTEGER PRIMARY KEY, sample_id INTEGER NOT NULL REFERENCES samples(id),
      sensor TEXT NOT NULL, value REAL NOT NULL, unit TEXT NOT NULL,
      timestamp TEXT NOT NULL, time_text TEXT NOT NULL, search_text TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS readings_sensor_id ON readings(sensor, id DESC);
    CREATE TABLE IF NOT EXISTS commands (
      id TEXT PRIMARY KEY, device TEXT NOT NULL, action TEXT NOT NULL, status TEXT NOT NULL,
      operator TEXT NOT NULL, timestamp TEXT NOT NULL, time_text TEXT NOT NULL,
      finished_at TEXT, message TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS commands_time ON commands(timestamp DESC);
    UPDATE commands SET status='failed', message='Backend đã khởi động lại trước khi nhận xác nhận.'
      WHERE status='pending';
  `);
  const addSample = db.prepare('INSERT INTO samples(timestamp,temp,hum,light) VALUES(?,?,?,?)');
  const addReading = db.prepare(
    'INSERT INTO readings(sample_id,sensor,value,unit,timestamp,time_text,search_text) VALUES(?,?,?,?,?,?,?)',
  );
  const addCommand = db.prepare(
    'INSERT INTO commands(id,device,action,status,operator,timestamp,time_text) VALUES(?,?,?,?,?,?,?)',
  );
  const findCommand = db.prepare('SELECT * FROM commands WHERE id=?');
  const finishCommand = db.prepare(
    "UPDATE commands SET status=?,message=?,finished_at=? WHERE id=? AND status='pending'",
  );
  const sampleView = (row) =>
    row && {
      timestamp: row.timestamp,
      time: displayTime(row.timestamp).slice(-8),
      temperature: row.temp,
      humidity: row.hum,
      light: row.light,
    };
  return {
    close: () => db.close(),
    addSample(values, timestamp) {
      db.exec('BEGIN');
      try {
        const result = addSample.run(timestamp, values.temp, values.hum, values.light);
        const time = displayTime(timestamp);
        for (const [sensor, definition] of Object.entries(SENSORS)) {
          const value = values[definition.field];
          if (value === null) continue;
          const text = `${sensor === 'temperature' ? value.toFixed(1) : value} ${definition.unit}`;
          addReading.run(
            result.lastInsertRowid,
            sensor,
            value,
            definition.unit,
            timestamp,
            time,
            normalize(`${definition.label} ${text} ${time}`),
          );
        }
        db.exec('COMMIT');
      } catch (reason) {
        db.exec('ROLLBACK');
        throw reason;
      }
    },
    samples: () =>
      db.prepare('SELECT * FROM samples ORDER BY id DESC LIMIT 60').all().reverse().map(sampleView),
    addCommand(command) {
      addCommand.run(
        command.id,
        command.device,
        command.action,
        'pending',
        command.operator,
        command.timestamp,
        displayTime(command.timestamp),
      );
      return findCommand.get(command.id);
    },
    command: (id) => findCommand.get(id),
    finishCommand(id, status, message, timestamp) {
      finishCommand.run(status, message, timestamp, id);
      return findCommand.get(id);
    },
    list(kind, options = {}) {
      const table = kind === 'sensors' ? 'readings' : 'commands';
      const size = Number(options.size ?? 10);
      const requestedPage = Number(options.page ?? 1);
      if (
        ![5, 10, 20, 50].includes(size) ||
        !Number.isSafeInteger(requestedPage) ||
        requestedPage < 1
      )
        throw error('Phân trang không hợp lệ.');
      const query = String(options.q ?? '');
      if (query.length > 200) throw error('Từ khóa tối đa 200 ký tự.');
      const where = [];
      const parameters = [];
      const selectFilter = (field, values) => {
        const selected = options[field] ?? 'all';
        if (!['all', ...values].includes(selected)) throw error('Bộ lọc không hợp lệ.');
        if (selected !== 'all' && selected !== 'time') {
          where.push(`${field}=?`);
          parameters.push(selected);
        }
      };
      if (kind === 'sensors') selectFilter('sensor', ['temperature', 'humidity', 'light', 'time']);
      else {
        selectFilter('device', Object.keys(DEVICES));
        selectFilter('action', ['on', 'off']);
        selectFilter('status', ['pending', 'success', 'failed']);
      }
      const searchColumn =
        kind === 'sensors' && options.sensor !== 'time'
          ? "(printf('%03d',id) || ' ' || search_text)"
          : 'time_text';
      for (const term of normalize(query).split(' ').filter(Boolean)) {
        where.push(`instr(${searchColumn},?)>0`);
        parameters.push(term);
      }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = db
        .prepare(`SELECT count(*) AS total FROM ${table} ${clause}`)
        .get(...parameters).total;
      const pages = Math.max(1, Math.ceil(total / size));
      const page = Math.min(requestedPage, pages);
      const order = kind === 'sensors' ? 'id DESC' : 'timestamp DESC, rowid DESC';
      const rows = db
        .prepare(`SELECT * FROM ${table} ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`)
        .all(...parameters, size, (page - 1) * size);
      return { rows, total, page, pages, size };
    },
  };
}

class HardwareBridge extends EventEmitter {
  constructor({
    store,
    publish,
    now = Date.now,
    timeoutMs = 8000,
    staleMs = 15000,
    operator = 'Nguyễn Đức Hưng',
  }) {
    super();
    Object.assign(this, { store, publish, now, timeoutMs, staleMs, operator });
    this.connected = false;
    this.lastSeen = null;
    this.available = null;
    this.protocol = 0;
    this.states = Object.fromEntries(Object.keys(DEVICES).map((key) => [key, null]));
    this.supported = Object.fromEntries(Object.keys(DEVICES).map((key) => [key, false]));
    this.pending = new Map();
    this.lastCommand = null;
  }
  get online() {
    return (
      this.connected &&
      this.available !== false &&
      this.lastSeen !== null &&
      this.now() - this.lastSeen < this.staleMs
    );
  }
  snapshot() {
    const samples = this.store.samples();
    return {
      brokerConnected: this.connected,
      online: this.online,
      protocol: this.protocol,
      lastSeen: this.lastSeen === null ? null : new Date(this.lastSeen).toISOString(),
      states: this.states,
      supported: this.supported,
      samples,
      latest: samples.at(-1) ?? null,
      lightUnit: 'ADC',
      lastCommand: this.lastCommand,
      pending: Object.fromEntries(
        [...this.pending.values()].map((item) => [item.command.device, item.command.id]),
      ),
    };
  }
  notify(kind) {
    this.emit('update', { kind, snapshot: this.snapshot() });
  }
  setConnected(connected) {
    this.connected = connected;
    if (!connected) {
      this.lastSeen = null;
      this.failPending('Mất kết nối MQTT.');
    }
    this.notify('connection');
  }
  receive(topic, buffer, packet = {}) {
    if (packet.retain && topic !== 'esp8266/availability') return;
    if (buffer.length > 4096) return;
    if (topic === 'esp8266/availability') {
      const status = String(buffer);
      if (!['online', 'offline'].includes(status)) return;
      this.available = status === 'online';
      if (!this.available) {
        this.lastSeen = null;
        this.failPending('ESP8266 đã ngoại tuyến.');
      }
      this.notify('connection');
      return;
    }
    let payload;
    try {
      payload = JSON.parse(String(buffer));
    } catch {
      return;
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
    if (topic === 'esp8266/sensor_data') {
      const valid = (value, min, max) =>
        value === null ||
        (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max);
      if (
        !valid(payload.temp, -40, 125) ||
        !valid(payload.hum, 0, 100) ||
        !valid(payload.light, 0, 1023)
      )
        return;
      if ([payload.temp, payload.hum, payload.light].every((value) => value === null)) return;
      this.lastSeen = this.now();
      this.available = true;
      this.store.addSample(payload, new Date(this.lastSeen).toISOString());
      this.notify('sensor');
    } else if (topic === 'esp8266/status') {
      if (!['SUCCESS', 'FAILURE'].includes(payload.result)) return;
      const fields = Object.entries(DEVICES).filter(([, definition]) =>
        ['ON', 'OFF'].includes(payload[definition.channel]),
      );
      if (!fields.length) return;
      this.lastSeen = this.now();
      this.available = true;
      this.protocol = payload.protocol === 2 ? 2 : 1;
      for (const [device, definition] of fields) {
        this.states[device] = payload[definition.channel] === 'ON';
        this.supported[device] = true;
      }
      const pending = this.pending.get(payload.commandId);
      if (pending) {
        const command = pending.command;
        const definition = DEVICES[command.device];
        const action = `${definition.channel.toUpperCase()}_${command.action.toUpperCase()}`;
        const correct =
          payload.result === 'SUCCESS' &&
          payload.action === action &&
          payload[definition.channel] === command.action.toUpperCase();
        this.finish(
          command.id,
          correct ? 'success' : 'failed',
          correct ? '' : 'ESP8266 không xác nhận đúng lệnh đã gửi.',
        );
      }
      this.notify('status');
    }
  }
  command(device, state, operator = this.operator) {
    if (!Object.hasOwn(DEVICES, device) || typeof state !== 'boolean')
      throw error('Thiết bị hoặc trạng thái không hợp lệ.');
    if (!this.online) throw error('ESP8266 chưa kết nối. Kiểm tra nguồn, WiFi và MQTT.', 503);
    if (this.protocol !== 2 || !this.supported[device])
      throw error('Cần nạp firmware iot_control hỗ trợ 3 đèn và mã xác nhận lệnh.', 409);
    if ([...this.pending.values()].some((item) => item.command.device === device))
      throw error('Thiết bị đang xử lý lệnh trước.', 409);
    const command = this.store.addCommand({
      id: randomUUID(),
      device,
      action: state ? 'on' : 'off',
      operator,
      timestamp: new Date(this.now()).toISOString(),
    });
    const timer = setTimeout(
      () => this.finish(command.id, 'failed', 'Hết thời gian chờ phản hồi từ ESP8266.'),
      this.timeoutMs,
    );
    timer.unref?.();
    this.pending.set(command.id, { command, timer });
    this.notify('command');
    try {
      this.publish(
        `esp8266/${DEVICES[device].channel}`,
        `${state ? 'ON' : 'OFF'}|${command.id}`,
        (reason) => {
          if (reason) this.finish(command.id, 'failed', 'Không gửi được lệnh tới MQTT.');
        },
      );
    } catch {
      this.finish(command.id, 'failed', 'Không gửi được lệnh tới MQTT.');
    }
    return this.store.command(command.id);
  }
  finish(id, status, message) {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    this.lastCommand = this.store.finishCommand(
      id,
      status,
      message,
      new Date(this.now()).toISOString(),
    );
    this.notify('command');
  }
  failPending(message) {
    for (const id of [...this.pending.keys()]) this.finish(id, 'failed', message);
  }
  tick() {
    if (!this.online) this.failPending('ESP8266 không còn phản hồi.');
    this.notify('connection');
  }
  close() {
    this.failPending('Backend đã dừng.');
  }
}

module.exports = { createStore, HardwareBridge, DEVICES, SENSORS, normalize, displayTime, error };
