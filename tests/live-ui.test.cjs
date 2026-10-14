const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');
const { createStore } = require('../backend/core.cjs');
const chart = require('../sensor-chart.js');
const root = join(__dirname, '..');
const pause = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

function createPage(file, fetch) {
  const dom = new JSDOM(readFileSync(join(root, file), 'utf8'), {
    url: `http://localhost:3000/${file}?mode=live`,
    runScripts: 'outside-only',
  });
  const streams = [];
  dom.window.fetch = (url, options) =>
    url.endsWith('/api/auth/session')
      ? response({ user: { id: 1, username: 'hung', name: 'Nguyễn Đức Hưng' } })
      : fetch(url, options);
  dom.window.EventSource = class {
    constructor() {
      streams.push(this);
    }
    close() {}
  };
  const scripts =
    file === 'index.html'
      ? ['iot-api.js', 'sensor-chart.js', 'live-dashboard.js', 'dashboard.js']
      : ['iot-api.js', 'live-tables.js', 'tables.js'];
  for (const script of scripts) dom.window.eval(readFileSync(join(root, script), 'utf8'));
  return { dom, window: dom.window, document: dom.window.document, streams };
}
const response = (body, ok = true) => Promise.resolve({ ok, json: async () => body });
const initialSnapshot = () => ({
  brokerConnected: true,
  online: true,
  protocol: 2,
  states: { light: false, fan: false, ac: false },
  supported: { light: true, fan: true, ac: true },
  pending: {},
  samples: [],
  latest: null,
  lastCommand: null,
});

test('Live dashboard waits for ESP ACK, shows ADC and disables controls when the stream disconnects', async () => {
  let snapshot = initialSnapshot();
  snapshot.latest = {
    timestamp: '2026-10-13T03:00:00Z',
    time: '10:00:00',
    temperature: 45,
    humidity: 90,
    light: 1023,
  };
  snapshot.samples = [snapshot.latest];
  const commands = [];
  const page = createPage('index.html', (url, options) => {
    if (url.endsWith('/api/commands')) {
      commands.push(JSON.parse(options.body));
      snapshot = { ...snapshot, pending: { fan: 'command-1' } };
      return response({ id: 'command-1', status: 'pending' });
    }
    return response(snapshot);
  });
  try {
    await pause();
    const toggle = page.document.querySelector('[data-device="fan"]');
    assert.equal(
      page.document.querySelector('[data-current-sensor="light"]').nextElementSibling.textContent,
      'ADC',
    );
    assert.equal(
      page.document.querySelector('[data-current-sensor="temperature"]').textContent,
      '45.0',
    );
    const y = Number(
      page.document.querySelector('[data-chart-marker="temperature"]').getAttribute('cy'),
    );
    assert.ok(y >= 24 && y <= 194, 'Live range includes measurements outside demo limits');
    assert.equal(toggle.disabled, false);
    toggle.checked = true;
    toggle.dispatchEvent(new page.window.Event('change'));
    await pause();
    assert.deepEqual(commands, [{ device: 'fan', state: true }]);
    assert.equal(toggle.checked, false);
    assert.equal(toggle.disabled, true);
    await pause(520);
    assert.equal(toggle.checked, false, '500ms alone must never mean hardware success');
    assert.equal(toggle.disabled, true, 'Command remains pending until hardware ACK');
    snapshot = {
      ...snapshot,
      states: { ...snapshot.states, fan: true },
      pending: {},
      lastCommand: { id: 'command-1', device: 'fan', status: 'success' },
    };
    page.streams[0].onmessage({ data: JSON.stringify({ kind: 'command', snapshot }) });
    assert.equal(toggle.checked, true);
    assert.equal(toggle.disabled, false);
    page.streams[0].onerror();
    assert.equal(toggle.disabled, true);
    assert.equal(toggle.checked, false);
    assert.match(page.document.querySelector('.iot-status-label').textContent, /chưa kết nối/);
  } finally {
    page.dom.window.close();
  }
});

test('Live tables query stored readings, keep draft filters staged and preserve page size on reset', async () => {
  const store = createStore();
  for (let index = 0; index < 12; index++)
    store.addSample(
      { temp: 28.5, hum: 65, light: 720 },
      new Date(Date.parse('2026-10-13T03:00:00Z') + index * 2000).toISOString(),
    );
  const page = createPage('data-sensor.html', (url) => {
    const parsed = new URL(url);
    return response(
      parsed.pathname === '/api/sensors'
        ? store.list('sensors', Object.fromEntries(parsed.searchParams))
        : initialSnapshot(),
    );
  });
  try {
    await pause();
    const doc = page.document;
    const rows = () => [...doc.querySelectorAll('tbody tr:not([data-empty])')];
    const sensor = doc.querySelector('[data-filter="sensor"]');
    const search = doc.querySelector('[data-table-search]');
    const size = doc.querySelector('[data-page-size]');
    const find = () =>
      doc
        .querySelector('form')
        .dispatchEvent(new page.window.Event('submit', { cancelable: true }));
    sensor.value = 'humidity';
    search.value = '65 %';
    size.value = '5';
    size.dispatchEvent(new page.window.Event('change'));
    await pause();
    assert.equal(rows().length, 5);
    assert.ok(rows().some((row) => row.dataset.sensor !== 'humidity'));
    find();
    await pause();
    assert.equal(rows().length, 5);
    assert.ok(rows().every((row) => row.dataset.sensor === 'humidity'));
    doc.querySelector('[data-page-last]').click();
    await pause();
    assert.equal(rows().length, 2);
    assert.match(doc.querySelector('[data-result-count]').textContent, /11-12.*12 dòng/);
    doc.querySelector('[data-clear-filters]').click();
    await pause();
    assert.equal(size.value, '5');
    assert.equal(sensor.value, 'all');
    assert.equal(search.value, '');
    assert.equal(rows().length, 5);
    assert.match(doc.querySelector('[data-result-count]').textContent, /36 dòng/);
    sensor.value = 'time';
    search.value = '13/10/2026 10:00:00';
    find();
    await pause();
    assert.equal(rows().length, 3);
    assert.ok(rows().some((row) => row.textContent.includes('ADC')));
  } finally {
    page.dom.window.close();
    store.close();
  }
});

test('Live mode with backend unavailable clears sample data and never enables simulated switches', async () => {
  const page = createPage('index.html', () => Promise.reject(new Error('offline')));
  try {
    await pause();
    assert.equal(
      page.document.querySelector('[data-current-sensor="temperature"]').textContent,
      '—',
    );
    assert.equal(page.document.querySelectorAll('.sensor-point').length, 0);
    assert.ok(
      [...page.document.querySelectorAll('[data-device-toggle]')].every(
        (toggle) => toggle.disabled,
      ),
    );
    assert.match(page.document.querySelector('.iot-status-label').textContent, /chưa kết nối/);
  } finally {
    page.dom.window.close();
  }
});

test('Live chart supports empty samples, ADC limits and timestamps crossing midnight', () => {
  assert.match(chart.buildMarkup([]), /Đang chờ dữ liệu/);
  const samples = [
    {
      timestamp: '2026-10-13T16:59:58Z',
      time: '23:59:58',
      temperature: 42,
      humidity: 95,
      light: 0,
    },
    {
      timestamp: '2026-10-13T17:00:02Z',
      time: '00:00:02',
      temperature: 43,
      humidity: 96,
      light: 1023,
    },
  ];
  const markup = chart.buildMarkup(samples, { lightUnit: 'ADC', autoScale: true });
  assert.ok(!markup.includes('NaN') && !markup.includes('Infinity'));
  assert.match(markup, /cx="54"/);
  assert.match(markup, /cx="690"/);
  assert.match(markup, />ADC</);
  assert.match(markup, /00:00:02/);
  assert.ok(
    chart
      .seriesFor(samples, { lightUnit: 'ADC', autoScale: true })
      .find((series) => series.key === 'temperature').max >= 43,
  );
});
