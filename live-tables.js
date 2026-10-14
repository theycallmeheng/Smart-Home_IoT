/* Bảng thật truy vấn và phân trang tại SQLite qua API. */
(() => {
  'use strict';
  const api = window.IoT;
  if (!api?.live) return;
  const page = document.querySelector('[data-table-page]');
  if (!page) return;
  const history = page.dataset.searchScope === 'time';
  const form = page.querySelector('[data-table-form]');
  const search = page.querySelector('[data-table-search]');
  const filters = [...page.querySelectorAll('[data-filter]')];
  const body = page.querySelector('tbody');
  const empty = page.querySelector('[data-empty]');
  const count = page.querySelector('[data-result-count]');
  const size = page.querySelector('[data-page-size]');
  const numbers = page.querySelector('[data-page-numbers]');
  const previous = page.querySelector('[data-page-previous]');
  const next = page.querySelector('[data-page-next]');
  const first = page.querySelector('[data-page-first]');
  const last = page.querySelector('[data-page-last]');
  const failure = document.createElement('p');
  failure.className = 'table-api-error';
  failure.setAttribute('role', 'alert');
  failure.hidden = true;
  page.querySelector('.table-card').before(failure);
  body.replaceChildren(empty);
  empty.hidden = false;
  empty.firstElementChild.textContent = 'Đang chờ backend...';
  count.textContent = 'Đang tải dữ liệu phần cứng...';
  let applied = {};
  let current = 1;
  let pages = 1;
  let version = 0;
  let loading = false;
  const node = (tag, text = '', className = '') => {
    const element = document.createElement(tag);
    element.textContent = text;
    element.className = className;
    return element;
  };
  const cell = (text, className) => node('td', String(text), className);
  const rowOf = (record) => {
    const row = document.createElement('tr');
    if (history) {
      row.dataset.device = record.device;
      row.dataset.action = record.action;
      row.dataset.status = record.status;
      const id = cell(record.id.slice(0, 8), 'row-id');
      id.title = record.id;
      row.append(
        id,
        cell({ light: 'Light 1', fan: 'Fan 1', ac: 'Air Condition' }[record.device]),
        cell(record.action === 'on' ? 'Turn ON' : 'Turn OFF'),
      );
      const status = document.createElement('td');
      status.append(
        node(
          'span',
          { success: 'Success', failed: 'Failed', pending: 'Pending' }[record.status],
          `badge ${record.status}`,
        ),
      );
      status.title = record.message || '';
      row.append(status, cell(record.operator, 'operator'));
    } else {
      row.dataset.sensor = record.sensor;
      const type = document.createElement('td');
      const badge = node('span', '', `badge ${record.sensor}`);
      badge.append(
        node('span', '', 'badge-dot'),
        document.createTextNode(
          { temperature: 'Temperature', humidity: 'Humidity', light: 'Light' }[record.sensor],
        ),
      );
      type.append(badge);
      row.append(
        cell(String(record.id).padStart(3, '0'), 'row-id'),
        type,
        cell(
          `${record.sensor === 'temperature' ? record.value.toFixed(1) : record.value} ${record.unit}`,
          'reading',
        ),
      );
    }
    const timeCell = document.createElement('td');
    timeCell.className = 'time';
    const time = node('time', record.time_text);
    time.dateTime = record.timestamp;
    timeCell.append(time);
    row.append(timeCell);
    return row;
  };
  const renderPages = () => {
    first.disabled = previous.disabled = current <= 1;
    last.disabled = next.disabled = current >= pages;
    numbers.replaceChildren();
    const shown = [...new Set([1, current - 1, current, current + 1, pages])]
      .filter((number) => number >= 1 && number <= pages)
      .sort((a, b) => a - b);
    let previousNumber = 0;
    for (const number of shown) {
      if (previousNumber && number - previousNumber > 1)
        numbers.append(node('span', '…', 'pagination-gap'));
      const button = node('button', String(number), number === current ? 'selected' : '');
      button.type = 'button';
      button.setAttribute('aria-label', `Trang ${number}`);
      if (number === current) button.setAttribute('aria-current', 'page');
      button.addEventListener('click', () => load(number));
      numbers.append(button);
      previousNumber = number;
    }
  };
  const load = async (number = current) => {
    const token = ++version;
    loading = true;
    const params = new URLSearchParams({ ...applied, page: String(number), size: size.value });
    try {
      const result = await api.request(`/api/${history ? 'history' : 'sensors'}?${params}`);
      if (token !== version) return;
      current = result.page;
      pages = result.pages;
      body.replaceChildren(...result.rows.map(rowOf), empty);
      empty.hidden = result.total !== 0;
      empty.firstElementChild.textContent = 'Không tìm thấy dữ liệu phù hợp.';
      const start = (current - 1) * result.size + 1;
      count.textContent = result.total
        ? `Hiển thị ${start}-${start + result.rows.length - 1} trên tổng số ${result.total} dòng`
        : 'Hiển thị 0 trên tổng số 0 dòng';
      failure.hidden = true;
      renderPages();
    } catch (reason) {
      if (token === version) {
        failure.textContent = `${reason.message} Kiểm tra backend đang chạy bằng npm start.`;
        failure.hidden = false;
      }
    } finally {
      if (token === version) loading = false;
    }
  };
  const apply = () => {
    applied = {
      q: search.value.trim(),
      ...Object.fromEntries(filters.map((filter) => [filter.dataset.filter, filter.value])),
    };
    load(1);
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    apply();
  });
  page.querySelector('[data-clear-filters]').addEventListener('click', () => {
    search.value = '';
    filters.forEach((filter) => {
      filter.value = 'all';
    });
    apply();
  });
  size.addEventListener('change', () => load(1));
  first.addEventListener('click', () => load(1));
  last.addEventListener('click', () => load(pages));
  previous.addEventListener('click', () => load(Math.max(1, current - 1)));
  next.addEventListener('click', () => load(Math.min(pages, current + 1)));
  api.subscribe((snapshot, kind) => {
    if (
      !loading &&
      current === 1 &&
      (kind === 'snapshot' || (history ? kind === 'command' : kind === 'sensor'))
    )
      load();
  });
  renderPages();
  apply();
})();
