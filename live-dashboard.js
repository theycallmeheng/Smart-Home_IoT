/* Dashboard thật: trạng thái GPIO đã xác nhận và cảm biến từ backend. */
(() => {
  'use strict';
  const api = window.IoT;
  if (!api?.live) return;
  const keys = ['temperature', 'humidity', 'light'];
  const labels = { temperature: 'Nhiệt độ', humidity: 'Độ ẩm', light: 'Ánh sáng' };
  const units = { temperature: '°C', humidity: '%', light: 'ADC' };
  const devices = { light: 'Đèn test 1 · D1', fan: 'Đèn test 2 · D5', ac: 'Đèn test 3 · D6' };
  const toggles = [...document.querySelectorAll('[data-device-toggle]')];
  const deadlines = new Map();
  const errors = new Map();
  const reportedFailures = new Set();
  let lastSnapshot;
  for (const toggle of toggles) {
    const card = toggle.closest('.device');
    const key = toggle.dataset.device;
    toggle.checked = false;
    toggle.disabled = true;
    card.classList.add('is-unknown');
    const note = document.createElement('small');
    note.className = 'device-test-note';
    note.textContent = devices[key];
    const unknown = document.createElement('small');
    unknown.className = 'state-unknown';
    unknown.textContent = 'Chưa có trạng thái';
    const feedback = document.createElement('small');
    feedback.className = 'device-feedback';
    feedback.setAttribute('role', 'status');
    card.querySelector('.device-label').append(note, unknown, feedback);
    toggle.addEventListener('change', async () => {
      const requested = toggle.checked;
      toggle.checked = lastSnapshot?.states[key] === true;
      errors.delete(key);
      deadlines.set(key, Date.now() + 500);
      render(lastSnapshot);
      try {
        await api.command(key, requested);
        await api.refresh();
      } catch (reason) {
        errors.set(key, reason.message);
      } finally {
        setTimeout(
          () => {
            deadlines.delete(key);
            render(lastSnapshot);
          },
          Math.max(0, (deadlines.get(key) ?? 0) - Date.now()),
        );
      }
    });
  }
  const render = (snapshot) => {
    lastSnapshot = snapshot;
    const online = api.connected && snapshot?.online;
    for (const toggle of toggles) {
      const key = toggle.dataset.device;
      const card = toggle.closest('.device');
      const unknown = !online || snapshot.states[key] === null;
      const pending = deadlines.has(key) || !!snapshot?.pending[key];
      toggle.checked = !!online && snapshot?.states[key] === true;
      toggle.disabled = !online || snapshot.protocol !== 2 || !snapshot.supported[key] || pending;
      toggle.setAttribute('aria-busy', String(pending));
      card.classList.toggle('is-pending', pending);
      card.classList.toggle('is-unknown', unknown);
      card.querySelector('.state-unknown').textContent = !online
        ? 'Chưa kết nối'
        : 'Chưa có trạng thái';
      card.querySelector('.device-feedback').textContent = errors.get(key) || '';
    }
    document.querySelectorAll('[data-device-count]').forEach((node) => {
      node.textContent = online
        ? String(Object.values(snapshot.states).filter((value) => value === true).length)
        : '—';
    });
  };
  const updateSensors = (snapshot) => {
    const samples = snapshot?.samples ?? [];
    const latest = snapshot?.latest;
    for (const key of keys) {
      const number = document.querySelector(`[data-current-sensor="${key}"]`);
      const value = latest?.[key];
      number.textContent = Number.isFinite(value)
        ? key === 'temperature'
          ? value.toFixed(1)
          : String(value)
        : '—';
      number.nextElementSibling.textContent = units[key];
      const card = number.closest('.metric');
      card.querySelector('h2').textContent = `${labels[key]} (${units[key]})`;
      card.querySelector('.metric-top small').textContent = latest
        ? latest.time
        : 'Chưa có dữ liệu';
      const spark = card.querySelector('.metric-spark');
      spark.replaceChildren();
      const values = samples
        .slice(-12)
        .map((sample) => sample[key])
        .filter(Number.isFinite);
      if (values.length > 1) {
        const min = Math.min(...values);
        const span = Math.max(1, Math.max(...values) - min);
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        line.setAttribute(
          'points',
          values
            .map(
              (item, index) =>
                `${(index / (values.length - 1)) * 128},${36 - ((item - min) / span) * 32}`,
            )
            .join(' '),
        );
        spark.append(line);
      }
    }
    const chart = document.querySelector('[data-sensor-chart]');
    chart.updateSensorChart?.(samples, { lightUnit: 'ADC', autoScale: true });
    chart.querySelector('.chart-record-badge').textContent = `${samples.length} mốc đo · Phần cứng`;
    chart.querySelector('.chart-caption > span').textContent = samples.length
      ? `Dữ liệu thật · ${new Date(samples.at(-1).timestamp).toLocaleDateString('vi-VN', { timeZone: 'Asia/Bangkok' })} · ${samples[0].time} – ${samples.at(-1).time}`
      : 'Đang chờ dữ liệu cảm biến từ ESP8266';
  };
  api.subscribe((snapshot, kind) => {
    const result = snapshot?.lastCommand;
    if (result?.status === 'failed' && !reportedFailures.has(result.id)) {
      errors.set(result.device, result.message);
      reportedFailures.add(result.id);
    }
    render(snapshot);
    if (kind === 'sensor' || kind === 'snapshot') updateSensors(snapshot);
  });
  render(null);
  updateSensors(null);
})();
