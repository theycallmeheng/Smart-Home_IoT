/* Điều khiển mẫu: chờ 500ms rồi cập nhật trạng thái thiết bị. */
(() => {
  'use strict';
  if (typeof window !== 'undefined' && window.IoT?.live) return;

  const toggles = [...document.querySelectorAll('[data-device-toggle]')];
  const counts = [...document.querySelectorAll('[data-device-count]')];

  // Cập nhật số thiết bị đang bật.
  const updateCount = () => {
    const active = toggles.filter((toggle) => toggle.checked).length;
    counts.forEach((count) => {
      count.textContent = String(active);
    });
  };

  // Mỗi thiết bị có trạng thái và thời gian chờ riêng.
  toggles.forEach((toggle) => {
    const device = toggle.closest('.device');
    let appliedState = toggle.checked;
    let pending = false;

    toggle.addEventListener('change', () => {
      const requestedState = toggle.checked;

      // Giữ trạng thái cũ trong lúc xử lý.
      toggle.checked = appliedState;

      // Bỏ qua yêu cầu khi thiết bị đang xử lý.
      if (pending) return;

      // Khóa công tắc trong thời gian chờ.
      pending = true;
      toggle.disabled = true;
      toggle.setAttribute('aria-busy', 'true');
      device.classList.add('is-pending');

      // Áp dụng trạng thái mới sau 500ms.
      setTimeout(() => {
        appliedState = requestedState;
        toggle.checked = appliedState;

        // Mở khóa và cập nhật bộ đếm.
        toggle.disabled = false;
        toggle.removeAttribute('aria-busy');
        device.classList.remove('is-pending');
        pending = false;
        updateCount();
      }, 500);
    });
  });

  // Đồng bộ bộ đếm khi mở trang.
  updateCount();
})();
