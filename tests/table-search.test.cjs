const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const { test } = require('node:test');

const root = join(__dirname, '..');
const textOf = (html) => html.replace(/<[^>]*>/g, '').trim();
const datasetOf = (html) =>
  Object.fromEntries(
    [...html.matchAll(/data-([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [
      key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()),
      value,
    ]),
  );
const range = (first, last) =>
  Array.from({ length: last - first + 1 }, (_, index) => String(first + index).padStart(3, '0'));

// Đọc dữ liệu thật từ HTML và mô phỏng các phần tử cần cho sự kiện.
function loadPage(file, options = {}) {
  const html = readFileSync(
    join(root, options.exported ? 'figma-export' : '', file),
    'utf8',
  ).replace(/<!--[\s\S]*?-->/g, '');
  const script = options.exported
    ? html.match(/<script data-source="tables.js">([\s\S]*?)<\/script>/)[1]
    : readFileSync(join(root, 'tables.js'), 'utf8');
  assert.match(html, /<main[^>]*data-table-page/);
  assert.match(html, /<form[^>]*data-table-form/);
  assert.match(html, /<button[^>]*type="submit"[^>]*data-find-filters/);
  assert.match(html, /<button[^>]*type="button"[^>]*data-clear-filters/);
  assert.match(html, /<p[^>]*data-result-count[^>]*aria-live="polite"/);
  for (const marker of [
    'data-page-first',
    'data-page-previous',
    'data-page-next',
    'data-page-last',
    'data-page-numbers',
    'data-page-size',
  ])
    assert.ok(html.includes(marker));
  if (file === 'data-sensor.html') {
    assert.match(
      html,
      /<select[^>]*data-filter="sensor"[^>]*>[\s\S]*?<option value="time">Thời gian<\/option>[\s\S]*?<\/select>/,
    );
    assert.match(html, /<option value="time">Thời gian<\/option>/);
    assert.match(html, /data-find-filters[^>]*>\s*Filter\s*<\/button>/);
    assert.ok(!html.includes('data-time-from') && !html.includes('data-time-to'));
  }
  if (file === 'action-history.html')
    assert.match(html, /<option value="pending">Pending<\/option>/);
  const pageSizeOptions = html.match(/<select[^>]*data-page-size[^>]*>([\s\S]*?)<\/select>/)[1];
  assert.deepEqual(
    [...pageSizeOptions.matchAll(/value="(\d+)"/g)].map((match) => Number(match[1])),
    [5, 10, 20, 50],
  );
  assert.match(pageSizeOptions, /value="10" selected/);
  if (!options.exported) assert.match(html, /<script src="tables.js(?:\?[^"]*)?" defer><\/script>/);

  const control = (dataset = {}, value = '') => {
    const classes = new Set();
    return {
      dataset,
      value,
      listeners: {},
      attributes: {},
      children: [],
      disabled: false,
      hidden: false,
      classList: {
        toggle(name, enabled) {
          if (enabled) classes.add(name);
          else classes.delete(name);
        },
        contains(name) {
          return classes.has(name);
        },
      },
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      removeAttribute(name) {
        delete this.attributes[name];
      },
      replaceChildren(...children) {
        this.children = children;
      },
      addEventListener(event, callback) {
        this.listeners[event] = callback;
      },
      emit(event, value) {
        if (this.disabled) return;
        if (arguments.length > 1) this.value = value;
        this.listeners[event]?.({ target: this });
      },
    };
  };
  const form = control();
  const search = control();
  const clear = control();
  const previous = control();
  const next = control();
  const first = control();
  const last = control();
  const numbers = control();
  const pageSize = control({}, '10');
  const filters = [...html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)]
    .filter(([, attributes]) => attributes.includes('data-filter='))
    .map(([, attributes, contents]) =>
      control(datasetOf(attributes), contents.match(/value="([^"]*)"/)[1]),
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
        hidden: /\bhidden\b/.test(attributes),
        cells,
        querySelectorAll(selector) {
          if (selector === 'td') return cells;
          assert.equal(selector, 'td.time');
          return cells.filter((cell) => cell.classes.includes('time'));
        },
      };
    });
  assert.equal(rows.length, 35);
  assert.equal([...tbody.matchAll(/<time datetime="2026-10-07T\d{2}:\d{2}:\d{2}">/g)].length, 35);
  assert.ok(
    rows.every((row) => /07\/10\/2026 \d{2}:\d{2}:\d{2}/.test(row.cells.at(-1).textContent)),
  );
  assert.equal(
    rows.filter((row) => !row.hidden).length,
    10,
    'Static HTML also limits the first page to 10 rows',
  );
  options.transformRows?.(rows);
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
        '[data-page-previous]': previous,
        '[data-page-next]': next,
        '[data-page-first]': first,
        '[data-page-last]': last,
        '[data-page-numbers]': numbers,
        '[data-page-size]': pageSize,
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
      createElement(tag) {
        assert.equal(tag, 'button');
        return control();
      },
    },
  });
  const find = () => {
    let prevented = false;
    form.listeners.submit({
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(prevented, true, 'Find must not reload the page');
  };
  const setFilter = (field, value) =>
    filters.find((filter) => filter.dataset.filter === field).emit('change', value);
  return {
    search,
    filters,
    rows,
    count,
    empty,
    previous,
    next,
    first,
    last,
    numbers,
    pageSize,
    find,
    ids: () => rows.filter((row) => !row.hidden).map((row) => row.cells[0].textContent),
    selectedPage: () =>
      Number(
        numbers.children.find((button) => button.attributes['aria-current'] === 'page').dataset
          .page,
      ),
    pageNumbers: () =>
      numbers.children
        .filter((button) => !button.hidden)
        .map((button) => Number(button.dataset.page)),
    searchFor(value) {
      search.emit('input', value);
      find();
    },
    filterBy(field, value) {
      setFilter(field, value);
      find();
    },
    setSearch(value) {
      search.emit('input', value);
    },
    setFilter,
    clearAll() {
      clear.emit('click');
    },
    changePageSize(value) {
      pageSize.emit('change', String(value));
    },
    nextPage() {
      next.emit('click');
    },
    previousPage() {
      previous.emit('click');
    },
    firstPage() {
      first.emit('click');
    },
    lastPage() {
      last.emit('click');
    },
    goTo(number) {
      const button = numbers.children.find((button) => Number(button.dataset.page) === number);
      assert.ok(button && !button.hidden);
      button.emit('click');
    },
  };
}

const expectResults = (page, ids, total = ids.length) => {
  assert.deepEqual(page.ids(), ids);
  assert.equal(
    page.count.textContent,
    total
      ? `Hiển thị 1-${ids.length} trên tổng số ${total} dòng`
      : 'Hiển thị 0 trên tổng số 0 dòng',
  );
  assert.equal(page.empty.hidden, total !== 0);
};

test('Action History searches only full or partial time', () => {
  const page = loadPage('action-history.html');
  expectResults(page, range(1, 10), 35);
  for (const [query, ids] of [
    ['005', []],
    ['LIGHT', []],
    ['fan', []],
    ['turn off', []],
    ['failed', []],
    ['Admin', []],
    ['Nguyễn Đức Hưng', []],
    ['Air Condition', []],
    ['10:31', ['004', '005', '006']],
    ['10:31:15', ['006']],
    ['  10:33:00  ', ['008']],
    ['10:35', ['009']],
    ['07/10/2026 10:33:00', ['008']],
    ['06/10/2026', []],
  ]) {
    page.searchFor(query);
    expectResults(page, ids);
  }
  page.searchFor('   ');
  expectResults(page, range(1, 10), 35);
});

test('Device, action, status and time combine and recover from zero results', () => {
  const page = loadPage('action-history.html');
  page.searchFor('10:');
  page.filterBy('device', 'light');
  page.filterBy('action', 'off');
  expectResults(page, ['002', '004', '005', '025']);
  page.searchFor('10:31');
  expectResults(page, ['004', '005']);
  page.filterBy('status', 'failed');
  expectResults(page, ['005']);
  page.filterBy('device', 'fan');
  expectResults(page, []);
  page.filterBy('action', 'on');
  expectResults(page, ['006']);
  page.searchFor('10:');
  page.filterBy('status', 'all');
  expectResults(page, ['003', '006']);
  page.clearAll();
  expectResults(page, range(1, 10), 35);
});

test('Air Condition filters work and every history record includes an operator', () => {
  const page = loadPage('action-history.html');
  assert.ok(page.rows.every((row) => row.cells.length === 6 && row.cells[4].textContent));
  assert.ok(page.rows.some((row) => row.cells[4].textContent === 'Nguyễn Đức Hưng'));
  page.searchFor('10:');
  page.filterBy('device', 'ac');
  expectResults(page, ['008', '009']);
  page.filterBy('action', 'on');
  page.filterBy('status', 'success');
  page.searchFor('10:33');
  expectResults(page, ['008']);
  page.searchFor('10:35');
  expectResults(page, []);
  page.filterBy('action', 'off');
  page.filterBy('status', 'failed');
  expectResults(page, ['009']);
});

test('Data Sensor searches every column across all 35 records', () => {
  const page = loadPage('data-sensor.html');
  for (const [query, ids, total] of [
    ['007', ['007']],
    ['028', ['028']],
    ['TEMPERATURE', ['001', '004', '007', '010', '013', '016', '019', '022', '025', '028'], 12],
    ['28.5', ['001']],
    ['65 %', ['002']],
    ['LUX', ['003', '006', '009', '012', '015', '018', '021', '024', '027', '030'], 11],
    ['10:34', ['007', '008']],
    ['temperature 10:32', ['004']],
    ['  28.5   °C  ', ['001']],
  ]) {
    page.searchFor(query);
    expectResults(page, ids, total);
  }
  page.filterBy('sensor', 'humidity');
  page.searchFor('10:34');
  expectResults(page, ['008']);
  page.searchFor('không tồn tại');
  expectResults(page, []);
});

test('Search ignores accents and treats special characters as literal text', () => {
  const page = loadPage('data-sensor.html', {
    transformRows(rows) {
      rows[2].cells[1].textContent = 'Ánh sáng phòng';
    },
  });
  page.searchFor('ANH SANG PHONG');
  expectResults(page, ['003']);
  for (const query of ['<script>', '[']) {
    page.searchFor(query);
    expectResults(page, []);
  }
});

test('Status combines with filters and Clear all resets every condition', () => {
  const page = loadPage('action-history.html');
  page.searchFor('10:');
  page.filterBy('status', 'success');
  expectResults(page, ['001', '002', '003', '004', '007', '008', '025']);
  page.filterBy('status', 'failed');
  expectResults(page, ['005', '006', '009']);
  page.filterBy('device', 'light');
  page.filterBy('action', 'off');
  page.searchFor('10:31');
  expectResults(page, ['005']);
  page.filterBy('status', 'success');
  expectResults(page, ['004']);
  page.filterBy('device', 'fan');
  expectResults(page, []);
  page.clearAll();
  assert.equal(page.search.value, '');
  assert.ok(page.filters.every((filter) => filter.value === 'all'));
  expectResults(page, range(1, 10), 35);
});

test('Sensor filter and value search work without a Value dropdown', () => {
  const page = loadPage('data-sensor.html');
  assert.deepEqual(
    page.filters.map((filter) => filter.dataset.filter),
    ['sensor'],
  );
  page.filterBy('sensor', 'humidity');
  page.searchFor('65 %');
  expectResults(page, ['002']);
  page.filterBy('sensor', 'temperature');
  expectResults(page, []);
  page.clearAll();
  expectResults(page, range(1, 10), 35);
});

for (const file of ['data-sensor.html', 'action-history.html']) {
  test(`${file}: 35 records paginate as 10/10/10/5, with correct boundaries and page buttons`, () => {
    const page = loadPage(file);
    expectResults(page, range(1, 10), 35);
    assert.equal(page.previous.disabled, true);
    assert.equal(page.next.disabled, false);
    assert.equal(page.first.disabled, true);
    assert.equal(page.last.disabled, false);
    page.firstPage();
    assert.equal(page.selectedPage(), 1);
    page.previousPage();
    assert.equal(page.selectedPage(), 1);
    const buttons = [...page.numbers.children];
    for (const [number, first, last] of [
      [2, 11, 20],
      [3, 21, 30],
      [4, 31, 35],
    ]) {
      page.nextPage();
      assert.equal(page.selectedPage(), number);
      assert.deepEqual(page.ids(), range(first, last));
      assert.equal(page.count.textContent, `Hiển thị ${first}-${last} trên tổng số 35 dòng`);
      assert.ok(page.ids().length <= 10);
    }
    assert.equal(page.next.disabled, true);
    assert.equal(page.last.disabled, true);
    page.nextPage();
    assert.equal(page.selectedPage(), 4);
    page.previousPage();
    assert.deepEqual(page.ids(), range(21, 30));
    page.firstPage();
    expectResults(page, range(1, 10), 35);
    page.lastPage();
    assert.deepEqual(page.ids(), range(31, 35));
    assert.equal(page.count.textContent, 'Hiển thị 31-35 trên tổng số 35 dòng');
    page.firstPage();
    assert.deepEqual(page.pageNumbers(), [1, 2, 3, 4]);
    assert.ok(
      page.numbers.children.every((button, index) => button === buttons[index]),
      'Page buttons stay mounted to preserve keyboard focus',
    );
    assert.ok(page.numbers.children[0].classList.contains('selected'));
    assert.equal(page.numbers.children[1].attributes['aria-current'], undefined);
  });

  test(`${file}: pending inputs do not affect navigation; Find, empty results and Clear all reset to page 1`, () => {
    const page = loadPage(file);
    page.goTo(2);
    if (file === 'data-sensor.html') {
      page.setFilter('sensor', 'humidity');
      page.setSearch('65 %');
    } else {
      page.setFilter('device', 'light');
      page.setFilter('action', 'off');
      page.setFilter('status', 'failed');
      page.setSearch('10:31');
    }
    assert.deepEqual(page.ids(), range(11, 20));
    page.nextPage();
    assert.deepEqual(page.ids(), range(21, 30));
    page.find();
    assert.equal(page.selectedPage(), 1);
    expectResults(page, [file === 'data-sensor.html' ? '002' : '005']);
    assert.deepEqual(page.pageNumbers(), [1]);
    assert.equal(page.previous.disabled, true);
    assert.equal(page.next.disabled, true);
    assert.equal(page.first.disabled, true);
    assert.equal(page.last.disabled, true);
    page.setSearch('không có dữ liệu này');
    assert.equal(page.ids().length, 1);
    page.find();
    expectResults(page, []);
    assert.equal(page.previous.disabled, true);
    assert.equal(page.next.disabled, true);
    assert.equal(page.first.disabled, true);
    assert.equal(page.last.disabled, true);
    page.clearAll();
    expectResults(page, range(1, 10), 35);
    assert.equal(page.selectedPage(), 1);
    assert.equal(page.search.value, '');
    assert.ok(page.filters.every((filter) => filter.value === 'all'));
    assert.deepEqual(page.pageNumbers(), [1, 2, 3, 4]);
    page.goTo(4);
    page.clearAll();
    expectResults(page, range(1, 10), 35);
  });

  test(`${file}: standalone Figma export includes working pagination and inline JavaScript`, () => {
    const page = loadPage(file, { exported: true });
    expectResults(page, range(1, 10), 35);
    page.lastPage();
    assert.deepEqual(page.ids(), range(31, 35));
    page.firstPage();
    expectResults(page, range(1, 10), 35);
    page.nextPage();
    assert.deepEqual(page.ids(), range(11, 20));
    page.searchFor(file === 'data-sensor.html' ? '035' : '10:33:00');
    expectResults(page, [file === 'data-sensor.html' ? '035' : '008']);
    assert.equal(page.selectedPage(), 1);
    page.clearAll();
    expectResults(page, range(1, 10), 35);
  });
}

test('Sensor filtering paginates 12 humidity records and resets when a search is confirmed', () => {
  const page = loadPage('data-sensor.html');
  page.filterBy('sensor', 'humidity');
  expectResults(page, ['002', '005', '008', '011', '014', '017', '020', '023', '026', '029'], 12);
  assert.deepEqual(page.pageNumbers(), [1, 2]);
  page.nextPage();
  assert.deepEqual(page.ids(), ['032', '035']);
  assert.equal(page.count.textContent, 'Hiển thị 11-12 trên tổng số 12 dòng');
  assert.equal(page.next.disabled, true);
  assert.equal(page.last.disabled, true);
  page.firstPage();
  assert.equal(page.last.disabled, false);
  page.lastPage();
  assert.deepEqual(page.ids(), ['032', '035']);
  page.searchFor('71 %');
  expectResults(page, ['035']);
  assert.equal(page.selectedPage(), 1);
});

test('Device filtering paginates 14 light records; status filtering uses all matching records', () => {
  const page = loadPage('action-history.html');
  page.filterBy('device', 'light');
  expectResults(page, ['001', '002', '004', '005', '007', '010', '013', '016', '019', '022'], 14);
  page.nextPage();
  assert.deepEqual(page.ids(), ['025', '028', '031', '034']);
  assert.equal(page.count.textContent, 'Hiển thị 11-14 trên tổng số 14 dòng');
  page.setFilter('status', 'failed');
  page.previousPage();
  expectResults(page, ['001', '002', '004', '005', '007', '010', '013', '016', '019', '022'], 14);
  page.find();
  expectResults(page, ['005', '019', '034']);
  assert.equal(page.selectedPage(), 1);
  assert.deepEqual(page.pageNumbers(), [1]);
});

test('Pending status combines with device, action and time, then Clear all resets pagination', () => {
  const page = loadPage('action-history.html');
  page.goTo(4);
  page.filterBy('status', 'pending');
  expectResults(page, ['011', '016', '024']);
  assert.equal(page.selectedPage(), 1);
  page.filterBy('device', 'ac');
  page.filterBy('action', 'on');
  page.searchFor('11:09');
  expectResults(page, ['024']);
  page.searchFor('10:31');
  expectResults(page, []);
  page.clearAll();
  expectResults(page, range(1, 10), 35);
  assert.equal(page.filters.find((filter) => filter.dataset.filter === 'status').value, 'all');
});

for (const exported of [false, true]) {
  test(`Data Sensor: Thời gian in the Sensor menu searches dates/times only after confirmation (export=${exported})`, () => {
    const page = loadPage('data-sensor.html', { exported });
    page.goTo(2);
    page.setFilter('sensor', 'time');
    page.setSearch('07/10/2026 10:32');
    page.lastPage();
    assert.deepEqual(page.ids(), range(31, 35), 'Draft search conditions do not affect navigation');
    page.find();
    expectResults(page, ['004', '005', '006']);
    page.searchFor('2026 11:16:02');
    expectResults(page, ['033', '034', '035']);
    page.searchFor('65 %');
    expectResults(page, []);
    page.setFilter('sensor', 'humidity');
    page.find();
    expectResults(page, ['002']);
    page.setFilter('sensor', 'temperature');
    page.searchFor('07/10/2026 10:32');
    expectResults(page, ['004']);
    page.setFilter('sensor', 'time');
    page.searchFor('06/10/2026');
    expectResults(page, []);
    page.clearAll();
    assert.ok(page.filters.every((filter) => filter.value === 'all'));
    expectResults(page, range(1, 10), 35);
    page.setFilter('sensor', 'time');
    page.searchFor('07/10/2026');
    expectResults(page, range(1, 10), 35);
    page.lastPage();
    assert.deepEqual(page.ids(), range(31, 35));
  });
}

for (const file of ['data-sensor.html', 'action-history.html']) {
  for (const exported of [false, true]) {
    test(`${file}: page size supports 5/10/20/50 rows and keeps confirmed filters (export=${exported})`, () => {
      const page = loadPage(file, { exported });
      page.goTo(4);
      page.changePageSize(5);
      expectResults(page, range(1, 5), 35);
      assert.equal(page.selectedPage(), 1);
      assert.deepEqual(page.pageNumbers(), [1, 2, 3, 4, 5, 6, 7]);
      page.lastPage();
      assert.deepEqual(page.ids(), range(31, 35));
      assert.equal(page.selectedPage(), 7);
      assert.equal(page.count.textContent, 'Hiển thị 31-35 trên tổng số 35 dòng');
      assert.equal(page.last.disabled, true);
      page.previousPage();
      assert.deepEqual(page.ids(), range(26, 30));

      page.setSearch(file === 'data-sensor.html' ? '65 %' : '10:31');
      page.setFilter(
        file === 'data-sensor.html' ? 'sensor' : 'status',
        file === 'data-sensor.html' ? 'humidity' : 'failed',
      );
      page.changePageSize(20);
      expectResults(page, range(1, 20), 35);
      assert.deepEqual(page.pageNumbers(), [1, 2]);
      page.lastPage();
      assert.deepEqual(page.ids(), range(21, 35));
      assert.equal(page.count.textContent, 'Hiển thị 21-35 trên tổng số 35 dòng');
      page.find();
      expectResults(page, file === 'data-sensor.html' ? ['002'] : ['005', '006']);
      assert.equal(page.selectedPage(), 1);

      page.clearAll();
      assert.equal(page.pageSize.value, '20', 'Clear all preserves the display preference');
      expectResults(page, range(1, 20), 35);
      page.changePageSize(50);
      expectResults(page, range(1, 35), 35);
      assert.deepEqual(page.pageNumbers(), [1]);
      for (const control of [page.first, page.previous, page.next, page.last])
        assert.equal(control.disabled, true);
      page.searchFor('không có dữ liệu');
      expectResults(page, []);
      page.changePageSize(5);
      expectResults(page, []);
      page.clearAll();
      expectResults(page, range(1, 5), 35);
      page.changePageSize(10);
      expectResults(page, range(1, 10), 35);
      assert.deepEqual(page.pageNumbers(), [1, 2, 3, 4]);
      page.filterBy(
        file === 'data-sensor.html' ? 'sensor' : 'device',
        file === 'data-sensor.html' ? 'humidity' : 'light',
      );
      page.lastPage();
      page.setSearch('không có dữ liệu');
      page.changePageSize(5);
      assert.equal(page.selectedPage(), 1);
      assert.deepEqual(page.pageNumbers(), [1, 2, 3]);
      expectResults(
        page,
        file === 'data-sensor.html'
          ? ['002', '005', '008', '011', '014']
          : ['001', '002', '004', '005', '007'],
        file === 'data-sensor.html' ? 12 : 14,
      );
      page.lastPage();
      assert.deepEqual(
        page.ids(),
        file === 'data-sensor.html' ? ['032', '035'] : ['025', '028', '031', '034'],
      );
      page.find();
      expectResults(page, []);
    });
  }
}
