/**
 * TÌM KIẾM VÀ BỘ LỌC DÙNG CHUNG CHO HAI TRANG BẢNG
 *
 * data-sensor.html và action-history.html đều đánh dấu phần nội dung bằng
 * data-table-page, nên cùng một file JavaScript có thể xử lý cả hai trang.
 * Các thuộc tính data-* nối phần tử HTML với chức năng JavaScript.
 * Data Sensor tìm trong mọi cột của sensor đã chọn; Action History chỉ tìm cột TIME.
 *
 * Luồng xử lý:
 * Đọc các dòng HTML -> chuẩn hóa văn bản -> chờ Find/Enter -> xét từng dòng.
 * Một dòng chỉ hiện khi khớp tất cả từ tìm kiếm VÀ tất cả bộ lọc đang chọn.
 * Clear all đặt lại điều kiện và hiển thị kết quả ngay.
 */
(() => {
  // IIFE tạo phạm vi riêng cho các biến; strict mode hỗ trợ phát hiện lỗi khai báo.
  'use strict';

  // Chuẩn hóa cả dữ liệu lẫn từ khóa theo cùng quy tắc trước khi so sánh.
  // Ví dụ: "  ĐÈN   phòng  " trở thành "den phong".
  const normalize = (value) =>
    value
      // NFD tách dấu ra khỏi chữ; biểu thức tiếp theo loại các dấu kết hợp.
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      // Chữ đ/Đ không được NFD đổi thành d, nên phải xử lý riêng.
      .replace(/[đĐ]/g, 'd')
      .toLowerCase()
      // Gộp khoảng trắng liên tiếp thành một dấu cách và bỏ khoảng trắng hai đầu.
      .replace(/\s+/g, ' ')
      .trim();

  // Chỉ tìm phần tử trong từng vùng data-table-page, tránh lẫn với trang/vùng khác.
  document.querySelectorAll('[data-table-page]').forEach((page) => {
    // Các nút và ô nhập được tìm bằng thuộc tính chức năng thay vì lớp trang trí CSS.
    const form = page.querySelector('[data-table-form]');
    const search = page.querySelector('[data-table-search]');
    // Data Sensor có bộ lọc sensor; Action History có device, action và status.
    const filters = [...page.querySelectorAll('[data-filter]')];
    const clear = page.querySelector('[data-clear-filters]');
    const count = page.querySelector('[data-result-count]');
    const empty = page.querySelector('[data-empty]');

    // data-search-scope="time" chỉ lấy ô td.time ở Action History.
    // Các trang còn lại lấy tất cả ô td, rồi kết hợp với bộ lọc loại cảm biến.
    const searchSelector = page.dataset.searchScope === 'time' ? 'td.time' : 'td';

    // Bỏ dòng thông báo rỗng ra khỏi dữ liệu cần tìm kiếm và đếm.
    // Lưu tham chiếu dòng cùng văn bản chuẩn hóa một lần vì dữ liệu hiện là mẫu tĩnh.
    const rows = [...page.querySelectorAll('tbody tr:not([data-empty])')].map((element) => ({
      element,
      // Chỉ ghép các ô thuộc phạm vi tìm kiếm của trang: mọi cột hoặc riêng TIME.
      // join(' ') ngăn từ cuối ô này dính vào từ đầu ô kế tiếp.
      text: normalize(
        [...element.querySelectorAll(searchSelector)].map((cell) => cell.textContent).join(' '),
      ),
    }));

    // Đọc điều kiện hiện tại, hiện/ẩn các dòng và cập nhật phần kết quả.
    const update = () => {
      // Chia từ khóa thành nhiều từ; filter(Boolean) bỏ chuỗi rỗng.
      // Khi không nhập gì, terms là mảng rỗng và mọi dòng đều khớp phần tìm kiếm.
      const terms = normalize(search.value).split(' ').filter(Boolean);
      let visibleCount = 0;

      rows.forEach(({ element, text }) => {
        // every yêu cầu tất cả từ có mặt trong phạm vi tìm kiếm của trang.
        // Với Data Sensor, các từ có thể nằm ở nhiều cột của cùng một dòng.
        // includes tìm một phần chuỗi: "10:34" khớp với "10:34:02".
        const matchesSearch = terms.every((term) => text.includes(term));

        // "all" nghĩa là bỏ điều kiện của bộ lọc đó.
        // Ví dụ: data-filter="device" đọc element.dataset.device từ data-device của dòng.
        // Tên trường và giá trị trong select phải khớp với data-* trên dòng HTML.
        const matchesFilters = filters.every(
          (filter) =>
            filter.value === 'all' || element.dataset[filter.dataset.filter] === filter.value,
        );

        // && kết hợp tìm kiếm với bộ lọc; hidden chỉ ẩn dòng, không xóa dữ liệu.
        const visible = matchesSearch && matchesFilters;
        element.hidden = !visible;
        if (visible) visibleCount += 1;
      });

      // Chỉ hiện thông báo rỗng khi không có dòng khớp; tổng lấy từ số dòng thực.
      empty.hidden = visibleCount !== 0;
      count.textContent = `Hiển thị ${visibleCount} trên tổng số ${rows.length} dòng`;
    };

    // Nút Find có type="submit"; nhấn Enter trong ô tìm kiếm cũng gửi form.
    // preventDefault ngăn form tải lại trang để giữ các điều kiện và kết quả.
    // Dấu ?. chỉ gắn sự kiện khi tìm thấy phần tử tương ứng.
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      update();
    });

    // Clear all có type="button", vì vậy không gửi form.
    // Xóa cả từ khóa lẫn bộ lọc, rồi áp dụng ngay mà không cần nhấn Find.
    clear?.addEventListener('click', () => {
      search.value = '';
      filters.forEach((filter) => {
        filter.value = 'all';
      });
      update();
    });

    // Hiển thị đúng số dòng khi mở trang. Không gắn update vào input/change,
    // nên nhập chữ hoặc đổi select chỉ có hiệu lực sau khi nhấn Find/Enter.
    update();
  });
})();
