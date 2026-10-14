/* Filter/Find/Enter áp dụng điều kiện; Clear all đặt lại ngay. */
(() => {
  'use strict';
  if (typeof window !== 'undefined' && window.IoT?.live) return;

  const PAGE_SIZES = [5, 10, 20, 50];

  // Bỏ dấu, chữ hoa và khoảng trắng thừa khi so sánh.
  const normalize = (value) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();

  // Xử lý riêng từng bảng.
  document.querySelectorAll('[data-table-page]').forEach((page) => {
    const form = page.querySelector('[data-table-form]');
    const search = page.querySelector('[data-table-search]');
    const filters = [...page.querySelectorAll('[data-filter]')];
    const clear = page.querySelector('[data-clear-filters]');
    const count = page.querySelector('[data-result-count]');
    const empty = page.querySelector('[data-empty]');
    const previous = page.querySelector('[data-page-previous]');
    const next = page.querySelector('[data-page-next]');
    const first = page.querySelector('[data-page-first]');
    const last = page.querySelector('[data-page-last]');
    const numbers = page.querySelector('[data-page-numbers]');
    const pageSizeControl = page.querySelector('[data-page-size]');

    // Lưu các dòng dữ liệu, bỏ dòng thông báo rỗng.
    const rows = [...page.querySelectorAll('tbody tr:not([data-empty])')].map((element) => ({
      element,
      text: normalize(
        [...element.querySelectorAll('td')].map((cell) => cell.textContent).join(' '),
      ),
      timeText: normalize(element.querySelectorAll('td.time')[0]?.textContent ?? ''),
    }));

    let currentPage = 1;
    let pageSize = 10;
    let filteredRows = rows;
    const pageButtons = [];

    // Đổi số dòng chỉ chia lại kết quả đã xác nhận.
    const render = () => {
      const total = filteredRows.length;
      const pageCount = Math.max(1, Math.ceil(total / pageSize));
      currentPage = Math.min(currentPage, pageCount);
      const start = (currentPage - 1) * pageSize;
      const end = Math.min(start + pageSize, total);
      const visibleRows = new Set(filteredRows.slice(start, end));

      rows.forEach((row) => {
        row.element.hidden = !visibleRows.has(row);
      });
      empty.hidden = total !== 0;
      count.textContent = total
        ? `Hiển thị ${start + 1}-${end} trên tổng số ${total} dòng`
        : 'Hiển thị 0 trên tổng số 0 dòng';

      previous.disabled = currentPage === 1;
      next.disabled = currentPage === pageCount;
      first.disabled = currentPage === 1;
      last.disabled = currentPage === pageCount;
      pageButtons.forEach((button, index) => {
        const selected = index + 1 === currentPage;
        button.hidden = index >= pageCount;
        button.classList.toggle('selected', selected);
        if (selected) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
      });
    };

    const goToPage = (number) => {
      const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
      if (number < 1 || number > pageCount || number === currentPage) return;
      currentPage = number;
      render();
    };

    // Tạo nút một lần để giữ focus bàn phím khi chuyển trang.
    for (
      let number = 1;
      number <= Math.max(1, Math.ceil(rows.length / Math.min(...PAGE_SIZES)));
      number += 1
    ) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = String(number);
      button.dataset.page = String(number);
      button.setAttribute('aria-label', `Trang ${number}`);
      button.addEventListener('click', () => goToPage(number));
      pageButtons.push(button);
    }
    numbers.replaceChildren(...pageButtons);
    previous.addEventListener('click', () => goToPage(currentPage - 1));
    next.addEventListener('click', () => goToPage(currentPage + 1));
    first.addEventListener('click', () => goToPage(1));
    last.addEventListener('click', () =>
      goToPage(Math.max(1, Math.ceil(filteredRows.length / pageSize))),
    );
    pageSizeControl.addEventListener('change', () => {
      const selectedSize = Number(pageSizeControl.value);
      if (!PAGE_SIZES.includes(selectedSize)) return;
      pageSize = selectedSize;
      currentPage = 1;
      render();
    });

    // Lọc dòng theo từ khóa và tất cả bộ lọc.
    const update = () => {
      const terms = normalize(search.value).split(' ').filter(Boolean);
      // Action History chỉ tìm thời gian; Data Sensor cho phép chọn phạm vi.
      const timeOnly =
        page.dataset.searchScope === 'time' ||
        filters.some((filter) => filter.dataset.filter === 'sensor' && filter.value === 'time');
      filteredRows = rows.filter(({ element, text, timeText }) => {
        // Tất cả từ khóa phải khớp.
        const matchesSearch = terms.every((term) => (timeOnly ? timeText : text).includes(term));

        // Giá trị all bỏ điều kiện lọc tương ứng.
        const matchesFilters = filters.every(
          (filter) =>
            filter.value === 'all' ||
            (filter.dataset.filter === 'sensor' && filter.value === 'time') ||
            element.dataset[filter.dataset.filter] === filter.value,
        );

        return matchesSearch && matchesFilters;
      });
      currentPage = 1;
      render();
    };

    // Nút xác nhận hoặc Enter áp dụng điều kiện, không tải lại trang.
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      update();
    });

    // Clear all xóa từ khóa và đặt bộ lọc về all.
    clear?.addEventListener('click', () => {
      search.value = '';
      filters.forEach((filter) => {
        filter.value = 'all';
      });
      update();
    });

    // Mặc định 10 dòng/trang; Clear all giữ lựa chọn số dòng.
    update();
  });
})();
