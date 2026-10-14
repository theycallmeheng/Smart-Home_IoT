/* Chế độ thật dùng HTTP/SSE; dữ liệu mẫu vẫn mở được độc lập. */
(() => {
  'use strict';
  const live = new URLSearchParams(location.search).get('mode') === 'live';
  const base =
    window.IOT_API_BASE ||
    (location.protocol === 'file:'
      ? 'http://localhost:3000'
      : location.port === '5500'
        ? `${location.protocol}//${location.hostname}:3000`
        : location.origin);
  const needsAuth = location.protocol !== 'file:' || live;
  let authentication;
  let user = null;
  let redirecting = false;
  let logout;
  const login = () => {
    if (redirecting) return;
    redirecting = true;
    connected = false;
    stream?.close();
    emit('connection');
    const file = location.pathname.split('/').pop();
    const next = `/${/^(index|data-sensor|action-history|profile)\.html$/.test(file) ? file : 'index.html'}?mode=${live ? 'live' : 'demo'}`;
    location.replace(`${base}/login.html?next=${encodeURIComponent(next)}`);
  };
  const listeners = new Set();
  let snapshot = null;
  let connected = false;
  let stream = null;
  let polling = false;
  let label;
  const emit = (kind) => {
    if (label)
      label.textContent = !live
        ? 'Dữ liệu mẫu'
        : !connected
          ? 'Backend chưa kết nối'
          : !snapshot?.brokerConnected
            ? 'MQTT chưa kết nối'
            : !snapshot.online
              ? 'ESP8266 ngoại tuyến'
              : snapshot.protocol !== 2
                ? 'Cần cập nhật firmware'
                : 'ESP8266 trực tuyến';
    for (const listener of listeners) listener(snapshot, kind);
  };
  const request = async (route, options = {}) => {
    if (needsAuth && !route.startsWith('/api/auth/')) {
      await authentication;
      if (!user) throw new Error('Vui lòng đăng nhập để tiếp tục.');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(`${base}${route}`, {
        ...options,
        credentials: 'include',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...options.headers },
      });
      const data = await response.json();
      if (response.status === 401) {
        user = null;
        login();
      }
      if (!response.ok) throw new Error(data.error || 'Không xử lý được yêu cầu.');
      return data;
    } finally {
      clearTimeout(timeout);
    }
  };
  const accept = (data, kind) => {
    snapshot = data;
    connected = true;
    emit(kind);
  };
  const refresh = async () => {
    if (polling) return;
    polling = true;
    try {
      accept(await request('/api/dashboard'), 'snapshot');
      if (!stream && typeof EventSource !== 'undefined') {
        stream = new EventSource(`${base}/api/events`, { withCredentials: true });
        stream.onmessage = (event) => {
          try {
            const update = JSON.parse(event.data);
            accept(update.snapshot, update.kind);
          } catch {
            /* Bỏ bản tin không hợp lệ. */
          }
        };
        stream.onerror = () => {
          connected = false;
          emit('connection');
        };
      }
    } catch {
      connected = false;
      emit('connection');
    } finally {
      polling = false;
    }
  };
  window.IoT = {
    live,
    request,
    refresh,
    get snapshot() {
      return snapshot;
    },
    get connected() {
      return connected;
    },
    get user() {
      return user;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    command(device, state) {
      return request('/api/commands', { method: 'POST', body: JSON.stringify({ device, state }) });
    },
  };
  document.documentElement.dataset.iotMode = live ? 'live' : 'demo';
  // Giữ chế độ khi chuyển giữa các tab.
  document.querySelectorAll('a[href]').forEach((link) => {
    const href = link.getAttribute('href');
    if (/^(index|data-sensor|action-history|profile)\.html$/.test(href))
      link.setAttribute('href', `${href}?mode=${live ? 'live' : 'demo'}`);
  });
  const header = document.querySelector('.page-header');
  if (header) {
    const oldBadge = header.querySelector('.demo-badge');
    if (oldBadge) oldBadge.remove();
    header.classList.add('has-iot-status');
    const bar = document.createElement('div');
    bar.className = 'iot-modebar';
    label = document.createElement('span');
    label.className = 'iot-status-label';
    label.setAttribute('role', 'status');
    const switcher = document.createElement('a');
    switcher.href = `?mode=${live ? 'demo' : 'live'}`;
    switcher.textContent = live ? 'Dữ liệu mẫu' : 'Dùng phần cứng';
    bar.append(label, switcher);
    if (needsAuth) {
      logout = document.createElement('button');
      logout.type = 'button';
      logout.className = 'iot-logout';
      logout.textContent = 'Đăng xuất';
      logout.hidden = true;
      logout.addEventListener('click', async () => {
        logout.disabled = true;
        try {
          await request('/api/auth/logout', { method: 'POST' });
          user = null;
          login();
        } catch {
          label.textContent = 'Chưa đăng xuất được. Hãy thử lại.';
          logout.disabled = false;
        }
      });
      bar.append(logout);
    }
    header.append(bar);
  }
  emit('connection');
  // Chờ xác thực trước khi đọc dữ liệu hoặc bật điều khiển phần cứng.
  authentication = needsAuth
    ? (async () => {
        try {
          if (location.protocol === 'file:') {
            login();
            return;
          }
          const data = await request('/api/auth/session');
          user = data.user;
          if (!user) {
            login();
            return;
          }
          const name = document.querySelector('.account strong');
          const avatar = document.querySelector('.account-avatar');
          const note = document.querySelector('.account small');
          if (name) {
            name.textContent = user.name;
            name.title = `${user.name} (${user.username})`;
          }
          if (avatar)
            avatar.textContent = [...user.name.trim().split(/\s+/).pop()][0].toUpperCase();
          if (note) note.textContent = 'Đã đăng nhập';
          if (logout) logout.hidden = false;
        } catch {
          connected = false;
          emit('connection');
        }
      })()
    : Promise.resolve();
  const start = async () => {
    await authentication;
    if (!live || (needsAuth && !user)) return;
    refresh();
    const interval = setInterval(refresh, 10000);
    window.addEventListener(
      'beforeunload',
      () => {
        clearInterval(interval);
        stream?.close();
      },
      { once: true },
    );
  };
  if (document.readyState === 'complete') start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
