/* Chỉ nhận tài khoản được cấp; phiên được backend lưu trong cookie HttpOnly. */
(() => {
  'use strict';
  const form = document.querySelector('#login-form');
  const password = form.elements.password;
  const toggle = document.querySelector('#toggle-password');
  const submit = document.querySelector('#login-submit');
  const error = document.querySelector('#login-error');
  const status = document.querySelector('#login-status');
  const base =
    location.protocol === 'file:'
      ? 'http://localhost:3000'
      : location.port === '5500'
        ? `${location.protocol}//${location.hostname}:3000`
        : location.origin;
  const requested = new URLSearchParams(location.search).get('next') || '';
  // Giới hạn trang đích vào các tab của ứng dụng.
  const next = /^\/(index|data-sensor|action-history|profile)\.html(?:\?mode=(live|demo))?$/.test(
    requested,
  )
    ? requested
    : '/index.html?mode=live';
  if (location.protocol === 'file:') {
    location.replace(`${base}/login.html?next=${encodeURIComponent(next)}`);
    return;
  }
  let busy = false;
  const go = () => location.replace(`${base}${next}`);
  toggle.addEventListener('click', () => {
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    toggle.textContent = show ? 'Ẩn' : 'Hiện';
    toggle.setAttribute('aria-pressed', String(show));
    toggle.setAttribute('aria-label', show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    busy = true;
    submit.disabled = true;
    form.setAttribute('aria-busy', 'true');
    error.hidden = true;
    status.textContent = 'Đang xác thực…';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        credentials: 'include',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: form.elements.username.value.trim(),
          password: password.value,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Không đăng nhập được.');
      password.value = '';
      status.textContent = 'Đăng nhập thành công. Đang mở hệ thống…';
      go();
    } catch (reason) {
      error.textContent =
        reason.name === 'TypeError' || reason.name === 'AbortError'
          ? 'Không kết nối được backend. Hãy kiểm tra server và thử lại.'
          : reason.message;
      error.hidden = false;
      status.textContent = '';
    } finally {
      clearTimeout(timer);
      busy = false;
      submit.disabled = false;
      form.removeAttribute('aria-busy');
    }
  });
  fetch(`${base}/api/auth/session`, { credentials: 'include' })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      if (data?.user) go();
    })
    .catch(() => {});
})();
