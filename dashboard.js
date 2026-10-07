/**
 * ĐIỀU KHIỂN THIẾT BỊ TRÊN DASHBOARD
 *
 * File này được index.html tải bằng thuộc tính defer, nên HTML đã được phân tích
 * trước khi các công tắc được tìm và gắn sự kiện.
 *
 * Luồng xử lý:
 * Nhấn công tắc -> giữ trạng thái cũ -> chờ 500ms -> áp dụng trạng thái mới.
 * CSS đọc thuộc tính checked để đổi màu và chạy hiệu ứng của từng thiết bị.
 * JavaScript cập nhật đồng thời hai vị trí hiển thị số thiết bị đang bật.
 *
 * Đây là mô phỏng tại trình duyệt; file chưa gửi lệnh đến phần cứng hoặc API.
 */
(() => {
  // Hàm tự gọi (IIFE) giữ các biến bên trong file, tránh trùng biến với file khác.
  // Strict mode giúp phát hiện các lỗi như gán vào một biến chưa được khai báo.
  'use strict';

  // querySelectorAll tìm các phần tử theo thuộc tính data-* trong index.html.
  // Dấu ... chuyển NodeList thành mảng để dùng forEach và filter.
  const toggles = [...document.querySelectorAll('[data-device-toggle]')];
  // Cùng một số lượng được hiển thị ở banner tổng quan và thẻ điều khiển.
  const counts = [...document.querySelectorAll('[data-device-count]')];

  // Đếm công tắc đang checked, rồi ghi số lượng vào tất cả vị trí đánh dấu.
  const updateCount = () => {
    const active = toggles.filter((toggle) => toggle.checked).length;
    counts.forEach((count) => {
      // textContent ghi văn bản; String chuyển số đếm thành chuỗi để hiển thị.
      count.textContent = String(active);
    });
  };

  // Mỗi công tắc có trạng thái và thời gian chờ riêng.
  // Vì vậy, quạt đang xử lý vẫn cho phép thao tác điều hòa hoặc đèn.
  toggles.forEach((toggle) => {
    // closest tìm thẻ .device gần nhất chứa công tắc để đổi trạng thái cả hàng.
    const device = toggle.closest('.device');
    // appliedState: trạng thái đã áp dụng, dùng làm mốc trong 0,5 giây chờ.
    let appliedState = toggle.checked;
    // pending: true khi hàng thiết bị này đang xử lý một thao tác.
    let pending = false;

    // change xảy ra khi checkbox thay đổi do nhấn chuột hoặc bàn phím.
    toggle.addEventListener('change', () => {
      // Lưu trạng thái người dùng vừa yêu cầu trước khi phục hồi trạng thái cũ.
      const requestedState = toggle.checked;

      // Trình duyệt đã đổi checked trước khi gọi change.
      // Đặt lại checked để màu, hiệu ứng và số đếm giữ trạng thái đã áp dụng.
      toggle.checked = appliedState;

      // Không tạo thêm bộ hẹn giờ nếu công tắc này đang xử lý.
      // Kiểm tra này cũng bảo vệ khi sự kiện được kích hoạt bằng mã khác.
      if (pending) return;

      // Bắt đầu chờ: khóa công tắc và thêm lớp CSS cho chữ/vòng quay xử lý.
      pending = true;
      toggle.disabled = true;
      // aria-busy thông báo trạng thái đang xử lý cho công cụ hỗ trợ truy cập.
      toggle.setAttribute('aria-busy', 'true');
      device.classList.add('is-pending');

      // setTimeout lên lịch chạy hàm sau khoảng 500ms (0,5 giây).
      // Nó không chặn các thao tác khác trên trang; trình duyệt bận có thể chạy muộn hơn.
      setTimeout(() => {
        // Hoàn tất: lưu trạng thái mới và cho CSS cập nhật hiệu ứng qua checked.
        appliedState = requestedState;
        toggle.checked = appliedState;

        // Mở khóa, gỡ trạng thái chờ, rồi cập nhật lại cả hai bộ đếm.
        toggle.disabled = false;
        toggle.removeAttribute('aria-busy');
        device.classList.remove('is-pending');
        pending = false;
        updateCount();
      }, 500);
    });
  });

  // Đồng bộ số đếm ngay khi mở trang theo các checkbox checked trong HTML.
  updateCount();
})();
