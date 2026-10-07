const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const { test } = require('node:test');

const root = join(__dirname, '..');
const script = readFileSync(join(root, 'tables.js'), 'utf8');
const textOf = (html) => html.replace(/<[^>]*>/g, '').trim();
const datasetOf = (html) =>
  Object.fromEntries(
    [...html.matchAll(/data-([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [
      key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()),
      value,
    ]),
  );

// Run the shipped browser script against rows and controls extracted from the
// actual HTML. These small DOM doubles test events without third-party packages.
function loadPage(file) {
  const html = readFileSync(join(root, file), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  assert.match(html, /<script src="tables.js(?:\?[^"]*)?" defer><\/script>/);
  assert.match(html, /<main[^>]*data-table-page/);
  assert.match(html, /<input[^>]*data-table-search/);
  assert.match(html, /<button[^>]*type="button"[^>]*data-clear-filters/);
  assert.match(html, /<form[^>]*data-table-form/);
  assert.match(html, /<button[^>]*type="submit"[^>]*data-find-filters/);
  assert.match(html, /<p[^>]*data-result-count[^>]*aria-live="polite"/);

  const control = (dataset = {}, value = '') => ({
    dataset,
    value,
    listeners: {},
    addEventListener(event, callback) {
      this.listeners[event] = callback;
    },
    emit(event, nextValue) {
      this.value = nextValue;
      this.listeners[event]?.();
    },
  });
  const form = control();
  const find = () => {
    let prevented = false;
    form.listeners.submit({
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(prevented, true, 'Find must not navigate or reload the page');
  };
  const search = control();
  const clear = control();
  const filters = [...html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)]
    .filter(([, attributes]) => attributes.includes('data-filter='))
    .map(([, attributes, options]) =>
      control(datasetOf(attributes), options.match(/value="([^"]*)"/)[1]),
    );
  const tbody = html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
  const rows = [...tbody.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/g)]
    .filter(([, attributes]) => !attributes.includes('data-empty'))
    .map(([, attributes, contents]) => {
      const cells = [...contents.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/g)].map(
        ([, attributes, cell]) => ({
          textContent: textOf(cell),
          classes: (attributes.match(/class="([^"]*)"/)?.[1] ?? '').split(/\s+/),
        }),
      );
      return {
        dataset: datasetOf(attributes),
        hidden: false,
        cells,
        querySelectorAll(selector) {
          if (selector === 'td') return cells;
          assert.equal(selector, 'td.time');
          return cells.filter((cell) => cell.classes.includes('time'));
        },
      };
    });
  const count = { textContent: '' };
  const empty = { hidden: true };
  const page = {
    dataset: datasetOf(html.match(/<main\b([^>]*)>/)[1]),
    querySelector(selector) {
      return {
        '[data-table-form]': form,
        '[data-table-search]': search,
        '[data-clear-filters]': clear,
        '[data-result-count]': count,
        '[data-empty]': empty,
      }[selector];
    },
    querySelectorAll(selector) {
      return { '[data-filter]': filters, 'tbody tr:not([data-empty])': rows }[selector];
    },
  };
  runInNewContext(script, {
    document: {
      querySelectorAll(selector) {
        assert.equal(selector, '[data-table-page]');
        return [page];
      },
    },
  });
  return {
    dataset: page.dataset,
    form,
    search,
    filters,
    count,
    empty,
    rows,
    find,
    ids() {
      return rows.filter((row) => !row.hidden).map((row) => row.cells[0].textContent);
    },
    searchFor(value) {
      search.emit('input', value);
      find();
    },
    filterBy(field, value) {
      filters.find((filter) => filter.dataset.filter === field).emit('change', value);
      find();
    },
    setSearch(value) {
      search.emit('input', value);
    },
    setFilter(field, value) {
      filters.find((filter) => filter.dataset.filter === field).emit('change', value);
    },
    clearAll() {
      clear.emit('click');
    },
  };
}

test('Action History searches full or partial time and excludes every other column', () => {
  const page = loadPage('action-history.html');
  assert.equal(page.ids().length, 9);
  for (const [query, ids] of [
    ['005', []],
    ['LIGHT', []],
    ['fan', []],
    ['turn off', []],
    ['failed', []],
    ['Admin', []],
    ['Air Condition', []],
    ['10:31', ['004', '005', '006']],
    ['10:31:15', ['006']],
    ['  10:33:00  ', ['008']],
    ['10:35', ['009']],
  ]) {
    page.searchFor(query);
    assert.deepEqual(page.ids(), ids, query);
    assert.equal(page.count.textContent, `Hiển thị ${ids.length} trên tổng số 9 dòng`);
  }
  page.searchFor('   ');
  assert.equal(page.ids().length, 9);
});

test('Device, Action and search work together, including zero results and recovery', () => {
  const page = loadPage('action-history.html');
  page.filterBy('device', 'light');
  page.filterBy('action', 'off');
  assert.deepEqual(page.ids(), ['002', '004', '005']);
  page.searchFor('10:31');
  assert.deepEqual(page.ids(), ['004', '005']);
  page.filterBy('status', 'failed');
  assert.deepEqual(page.ids(), ['005']);
  page.filterBy('device', 'fan');
  assert.deepEqual(page.ids(), []);
  assert.equal(page.empty.hidden, false);
  assert.equal(page.count.textContent, 'Hiển thị 0 trên tổng số 9 dòng');
  page.filterBy('action', 'on');
  assert.deepEqual(page.ids(), ['006']);
  page.search.emit('search', '');
  page.find();
  page.filterBy('status', 'all');
  assert.deepEqual(page.ids(), ['003', '006']);
  assert.equal(page.empty.hidden, true);
  page.filterBy('device', 'all');
  page.filterBy('action', 'all');
  assert.equal(page.ids().length, 9);
});

test('Air Condition combines with action, status and time, and every history row has an operator', () => {
  const page = loadPage('action-history.html');
  assert.ok(page.rows.every((row) => row.cells.length === 6));
  assert.ok(page.rows.every((row) => row.cells[4].textContent === 'Admin'));
  page.filterBy('device', 'ac');
  assert.deepEqual(page.ids(), ['008', '009']);
  page.filterBy('action', 'on');
  page.filterBy('status', 'success');
  page.searchFor('10:33');
  assert.deepEqual(page.ids(), ['008']);
  page.searchFor('10:35');
  assert.deepEqual(page.ids(), []);
  assert.equal(page.empty.hidden, false);
  page.filterBy('action', 'off');
  page.filterBy('status', 'failed');
  assert.deepEqual(page.ids(), ['009']);
  page.clearAll();
  assert.equal(page.ids().length, 9);
  assert.equal(page.empty.hidden, true);
});

test('Data Sensor searches ID, type, value, units and time', () => {
  const page = loadPage('data-sensor.html');
  assert.equal(page.count.textContent, 'Hiển thị 8 trên tổng số 8 dòng');
  for (const [query, ids] of [
    ['007', ['007']],
    ['TEMPERATURE', ['001', '004', '007']],
    ['28.5', ['001']],
    ['65 %', ['002']],
    ['LUX', ['003', '006']],
    ['10:34', ['007', '008']],
    ['temperature 10:32', ['004']],
    ['  28.5   °C  ', ['001']],
  ]) {
    page.searchFor(query);
    assert.deepEqual(page.ids(), ids, query);
  }
  page.filterBy('sensor', 'humidity');
  page.searchFor('10:34');
  assert.deepEqual(page.ids(), ['008']);
  page.searchFor('không tồn tại');
  assert.deepEqual(page.ids(), []);
  assert.equal(page.empty.hidden, false);
  page.searchFor('');
  assert.deepEqual(page.ids(), ['002', '005', '008']);
  page.filterBy('sensor', 'all');
  assert.equal(page.ids().length, 8);
});

test('Accents are ignored and special text is treated as a literal query', () => {
  const page = loadPage('data-sensor.html');
  page.rows[2].cells[1].textContent = 'Ánh sáng phòng';
  // Reinitialize with the modified text to exercise text normalization.
  const search = page.search;
  const rootPage = {
    dataset: page.dataset,
    querySelector: (selector) =>
      ({
        '[data-table-form]': page.form,
        '[data-table-search]': search,
        '[data-result-count]': page.count,
        '[data-empty]': page.empty,
      })[selector],
    querySelectorAll: (selector) =>
      ({ '[data-filter]': page.filters, 'tbody tr:not([data-empty])': page.rows })[selector],
  };
  runInNewContext(script, { document: { querySelectorAll: () => [rootPage] } });
  page.searchFor('ANH SANG PHONG');
  assert.deepEqual(page.ids(), ['003']);
  page.searchFor('<script>');
  assert.deepEqual(page.ids(), []);
  page.searchFor('[');
  assert.deepEqual(page.ids(), []);
});

test('Status combines with Device, Action and search, then resets', () => {
  const page = loadPage('action-history.html');
  page.filterBy('status', 'success');
  assert.deepEqual(page.ids(), ['001', '002', '003', '004', '007', '008']);
  page.filterBy('status', 'failed');
  assert.deepEqual(page.ids(), ['005', '006', '009']);
  page.filterBy('device', 'light');
  page.filterBy('action', 'off');
  page.searchFor('10:31');
  assert.deepEqual(page.ids(), ['005']);
  assert.equal(page.count.textContent, 'Hiển thị 1 trên tổng số 9 dòng');
  page.filterBy('status', 'success');
  assert.deepEqual(page.ids(), ['004']);
  page.filterBy('device', 'fan');
  assert.deepEqual(page.ids(), []);
  assert.equal(page.empty.hidden, false);
  page.clearAll();
  assert.equal(page.search.value, '');
  assert.ok(page.filters.every((filter) => filter.value === 'all'));
  assert.equal(page.ids().length, 9);
  assert.equal(page.empty.hidden, true);
  assert.equal(page.count.textContent, 'Hiển thị 9 trên tổng số 9 dòng');
  page.clearAll();
  assert.equal(page.ids().length, 9);
});

test('Sensor filter, value search and Clear all work without a Value dropdown', () => {
  const page = loadPage('data-sensor.html');
  assert.deepEqual(
    page.filters.map((filter) => filter.dataset.filter),
    ['sensor'],
  );
  page.filterBy('sensor', 'humidity');
  page.searchFor('65 %');
  assert.deepEqual(page.ids(), ['002']);
  assert.equal(page.count.textContent, 'Hiển thị 1 trên tổng số 8 dòng');
  page.filterBy('sensor', 'temperature');
  assert.deepEqual(page.ids(), []);
  assert.equal(page.empty.hidden, false);
  page.clearAll();
  assert.equal(page.search.value, '');
  assert.ok(page.filters.every((filter) => filter.value === 'all'));
  assert.equal(page.ids().length, 8);
  assert.equal(page.empty.hidden, true);
  assert.equal(page.count.textContent, 'Hiển thị 8 trên tổng số 8 dòng');
  page.clearAll();
  assert.equal(page.ids().length, 8);
});

for (const scenario of [
  {
    file: 'action-history.html',
    total: 9,
    filters: [
      ['device', 'light'],
      ['action', 'off'],
      ['status', 'failed'],
    ],
    query: '10:31',
    ids: ['005'],
  },
  {
    file: 'data-sensor.html',
    total: 8,
    filters: [['sensor', 'humidity']],
    query: '65 %',
    ids: ['002'],
  },
]) {
  test(`${scenario.file}: changing inputs waits for Find, and Clear all applies immediately`, () => {
    const page = loadPage(scenario.file);
    page.setSearch(scenario.query);
    scenario.filters.forEach(([field, value]) => page.setFilter(field, value));
    assert.equal(page.ids().length, scenario.total);
    assert.equal(
      page.count.textContent,
      `Hiển thị ${scenario.total} trên tổng số ${scenario.total} dòng`,
    );
    page.find();
    assert.deepEqual(page.ids(), scenario.ids);
    assert.equal(page.count.textContent, `Hiển thị 1 trên tổng số ${scenario.total} dòng`);

    page.setSearch('không có dữ liệu này');
    assert.deepEqual(page.ids(), scenario.ids);
    assert.equal(page.empty.hidden, true);
    page.find();
    assert.deepEqual(page.ids(), []);
    assert.equal(page.empty.hidden, false);
    page.clearAll();
    assert.equal(page.search.value, '');
    assert.ok(page.filters.every((filter) => filter.value === 'all'));
    assert.equal(page.ids().length, scenario.total);
    assert.equal(
      page.count.textContent,
      `Hiển thị ${scenario.total} trên tổng số ${scenario.total} dòng`,
    );
    assert.equal(page.empty.hidden, true);
  });
}
