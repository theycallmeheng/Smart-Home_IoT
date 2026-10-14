const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const { test } = require('node:test');
const model = require('../sensor-chart.js');
const root = join(__dirname, '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const samplesOf = (markup) =>
  JSON.parse(markup.match(/<script\b[^>]*data-chart-data[^>]*>([\s\S]*?)<\/script>/)[1]);
const samples = samplesOf(html);

function loadChart(exported = false) {
  const page = exported ? readFileSync(join(root, 'figma-export/dashboard.html'), 'utf8') : html;
  const source = exported
    ? page.match(/<script data-source="sensor-chart.js">([\s\S]*?)<\/script>/)[1]
    : readFileSync(join(root, 'sensor-chart.js'), 'utf8');
  const element = (attributes = {}) => ({
    attributes,
    dataset: {},
    listeners: {},
    style: {},
    hidden: false,
    textContent: '',
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    toggleAttribute(name, enabled) {
      if (enabled) this.attributes[name] = '';
      else delete this.attributes[name];
    },
    addEventListener(name, callback) {
      this.listeners[name] = callback;
    },
    emit(name, event = {}) {
      this.listeners[name]?.(event);
    },
  });
  const svg = element();
  const viewport = element();
  const bounds = { left: 100, top: 20, width: 840, height: 230 };
  svg.getBoundingClientRect = () => bounds;
  viewport.getBoundingClientRect = () => bounds;
  const children = new Map();
  let markup = '';
  Object.defineProperty(svg, 'innerHTML', {
    get: () => markup,
    set(value) {
      markup = value;
      children.clear();
      for (const [tag, key] of [
        ...value.matchAll(/<circle\b[^>]*data-chart-marker="([^"]+)"[^>]*>/g),
      ].map((match) => [match[0], match[1]])) {
        const attributes = Object.fromEntries(
          [...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]),
        );
        children.set(`[data-chart-marker="${key}"]`, element(attributes));
      }
      children.set(
        '[data-chart-guide]',
        element({ d: value.match(/<path[^>]*data-chart-guide[^>]*d="([^"]*)"/)[1] }),
      );
    },
  });
  svg.querySelector = (selector) => {
    assert.ok(children.has(selector), `Missing SVG element: ${selector}`);
    return children.get(selector);
  };
  const tooltip = element();
  tooltip.offsetWidth = 226;
  const slider = element();
  slider.value = '11';
  const times = [element(), element()];
  const readings = {};
  for (const key of ['temperature', 'humidity', 'light']) {
    assert.equal([...page.matchAll(new RegExp('data-chart-reading="' + key + '"', 'g'))].length, 2);
    readings[key] = [element(), element()];
  }
  const stats = [...page.matchAll(/data-chart-stat="([^"]+)"/g)].map(([, key]) => {
    const node = element();
    node.dataset.chartStat = key;
    return node;
  });
  const component = {
    querySelector(selector) {
      const nodes = {
        '[data-chart-data]': { textContent: JSON.stringify(samplesOf(page)) },
        '[data-chart-svg]': svg,
        '[data-chart-viewport]': viewport,
        '[data-chart-tooltip]': tooltip,
        '[data-chart-slider]': slider,
      };
      assert.ok(nodes[selector], selector);
      return nodes[selector];
    },
    querySelectorAll(selector) {
      if (selector === '[data-chart-stat]') return stats;
      if (selector === '[data-chart-time]') return times;
      const key = selector.match(/^\[data-chart-reading="([^"]+)"\]$/)?.[1];
      assert.ok(readings[key], selector);
      return readings[key];
    },
  };
  runInNewContext(source, {
    document: {
      querySelectorAll(selector) {
        assert.equal(selector, '[data-sensor-chart]');
        return [component];
      },
    },
  });
  return {
    svg,
    tooltip,
    slider,
    times,
    readings,
    stats,
    bounds,
    marker: (key) => children.get(`[data-chart-marker="${key}"]`),
    select(index) {
      slider.value = String(index);
      slider.emit('input');
    },
    point(x, y = 90, type = 'mouse', event = 'pointermove') {
      svg.emit(event, {
        clientX:
          bounds.left +
          (bounds.width - 840 * Math.min(bounds.width / 840, bounds.height / 230)) / 2 +
          x * Math.min(bounds.width / 840, bounds.height / 230),
        clientY:
          bounds.top +
          (bounds.height - 230 * Math.min(bounds.width / 840, bounds.height / 230)) / 2 +
          y * Math.min(bounds.width / 840, bounds.height / 230),
        pointerType: type,
      });
    },
  };
}

test('Chart uses the same 35 values and 12 time groups as Data Sensor', () => {
  assert.equal(samples.length, 12);
  const sensor = readFileSync(join(root, 'data-sensor.html'), 'utf8');
  let count = 0;
  for (const [, key, row] of sensor.matchAll(/<tr data-sensor="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((match) =>
      match[1].replace(/<[^>]*>/g, '').trim(),
    );
    assert.match(cells[3], /^07\/10\/2026 /);
    assert.equal(
      samples.find((sample) => sample.time === cells[3].split(/\s+/).at(-1))[key],
      parseFloat(cells[2]),
    );
    count += 1;
  }
  assert.equal(count, 35);
  assert.equal(samples[2].light, null);
  for (const [key, value] of [
    ['temperature', '28.9'],
    ['humidity', '71'],
    ['light', '780'],
  ]) {
    assert.match(html, new RegExp('data-current-sensor="' + key + '">' + value + '<'));
  }
});

test('One plot overlays three independent scales, 35 points and a gap for missing light data', () => {
  const markup = model.buildMarkup(samples);
  assert.equal([...markup.matchAll(/class="sensor-point"/g)].length, 35);
  for (const key of ['temperature', 'humidity', 'light']) {
    const group = markup.match(
      new RegExp('<g data-chart-series="' + key + '">([\\s\\S]*?)<\\/g>'),
    )[1];
    assert.equal([...group.matchAll(/class="sensor-line"/g)].length, key === 'light' ? 2 : 1);
    assert.ok(!group.includes('NaN') && !group.includes('Infinity'));
  }
  assert.equal([...markup.matchAll(/class="sensor-panel"/g)].length, 1);
  for (const [key, unit] of [
    ['temperature', '°C'],
    ['humidity', '%'],
    ['light', 'lux'],
  ]) {
    assert.match(markup, new RegExp('data-chart-axis="' + key + '"[\\s\\S]*?>' + unit + '<'));
  }
  assert.match(markup, /10:30/);
  assert.match(markup, /11:16/);
});

test('Statistics exclude missing measurements and show correct min, average and max', () => {
  const stats = model.summarize(samples);
  assert.equal(stats.temperature.count, 12);
  assert.equal(stats.temperature.min, 26.9);
  assert.equal(stats.temperature.max, 29);
  assert.equal(model.formatValue(stats.temperature.average, 'temperature', true), '28.0 °C');
  assert.equal(stats.humidity.average, 65.5);
  assert.equal(stats.light.count, 11);
  assert.equal(stats.light.min, 680);
  assert.equal(stats.light.max, 780);
  assert.equal(stats.light.average, 730);
});

test('Initial selection uses latest values and places each marker on its own scale', () => {
  const chart = loadChart();
  assert.equal(chart.times[0].textContent, '11:16:02');
  assert.equal(chart.readings.temperature[0].textContent, '28.9 °C');
  assert.equal(chart.slider.value, '11');
  assert.equal(chart.tooltip.hidden, true);
  assert.equal(chart.marker('temperature').attributes.cy, '70.75');
  assert.equal(chart.marker('humidity').attributes.cy, '100.5');
  assert.equal(chart.marker('light').attributes.cy, '41');
  assert.equal(
    chart.stats.find((node) => node.dataset.chartStat === 'light-count').textContent,
    '11 điểm đo',
  );
});

test('Pointer selects the nearest actual timestamp and works when the SVG is resized', () => {
  const chart = loadChart();
  chart.point(54);
  assert.equal(chart.times[0].textContent, '10:30:02');
  assert.equal(chart.readings.light[1].textContent, '720 lux');
  assert.equal(chart.tooltip.hidden, false);
  chart.point(400);
  assert.equal(chart.times[0].textContent, '11:00:02');
  assert.equal(chart.slider.value, '3');
  chart.bounds.width = 420;
  chart.bounds.height = 115;
  chart.point(690);
  assert.equal(chart.times[0].textContent, '11:16:02');
  chart.svg.emit('pointerleave');
  assert.equal(chart.tooltip.hidden, true);
});

test('Independent physical scales align their limits in the same plot', () => {
  const markup = model.buildMarkup([
    { time: '10:00:00', temperature: 26, humidity: 60, light: 600 },
    { time: '10:01:00', temperature: 30, humidity: 80, light: 800 },
  ]);
  for (const key of ['temperature', 'humidity', 'light']) {
    const group = markup.match(
      new RegExp('<g data-chart-series="' + key + '">([\\s\\S]*?)<\\/g>'),
    )[1];
    assert.match(group, /cx="54" cy="194"/);
    assert.match(group, /cx="690" cy="24"/);
  }
});

test('Pointer compensates for SVG margins when chart height is capped', () => {
  const chart = loadChart();
  chart.bounds.height = 130;
  chart.point(54);
  assert.equal(chart.slider.value, '0');
  chart.point(690);
  assert.equal(chart.slider.value, '11');
  chart.svg.emit('pointermove', {
    clientX: chart.bounds.left + 20,
    clientY: chart.bounds.top + 60,
    pointerType: 'mouse',
  });
  assert.equal(chart.tooltip.hidden, true);
  assert.equal(chart.slider.value, '11');
});

test('Slider exposes missing data correctly and provides accessible values', () => {
  const chart = loadChart();
  chart.select(2);
  assert.equal(chart.times[0].textContent, '10:34:02');
  assert.equal(chart.readings.temperature[0].textContent, '27.8 °C');
  assert.equal(chart.readings.light[0].textContent, 'Chưa có dữ liệu');
  assert.ok(Object.hasOwn(chart.marker('light').attributes, 'hidden'));
  assert.match(chart.slider.attributes['aria-valuetext'], /Ánh sáng: Chưa có dữ liệu/);
  chart.select(3);
  assert.equal(Object.hasOwn(chart.marker('light').attributes, 'hidden'), false);
  assert.equal(chart.readings.light[0].textContent, '680 lux');
  chart.slider.emit('blur');
  assert.equal(chart.tooltip.hidden, true);
});

test('Touch does not interfere with scrolling; tapping selects a sample', () => {
  const chart = loadChart();
  chart.point(54, 90, 'touch');
  assert.equal(chart.slider.value, '11');
  chart.point(54, 90, 'touch', 'pointerdown');
  assert.equal(chart.slider.value, '0');
  chart.point(10);
  assert.equal(chart.tooltip.hidden, true);
});

test('Standalone Figma export embeds the same interactive chart and data', () => {
  const chart = loadChart(true);
  assert.equal([...chart.svg.innerHTML.matchAll(/class="sensor-panel"/g)].length, 1);
  assert.equal([...chart.svg.innerHTML.matchAll(/data-chart-axis=/g)].length, 3);
  chart.select(0);
  assert.equal(chart.readings.temperature[0].textContent, '28.5 °C');
  chart.select(2);
  assert.equal(chart.readings.light[0].textContent, 'Chưa có dữ liệu');
  chart.select(11);
  assert.equal(chart.readings.humidity[0].textContent, '71 %');
});
