/* Ba đường cảm biến trong một biểu đồ, mỗi loại có trục giá trị riêng. */
(() => {
  'use strict';

  const LEFT = 54;
  const RIGHT = 690;
  const WIDTH = 840;
  const HEIGHT = 230;
  const TOP = 24;
  const BOTTOM = 194;
  const SERIES = [
    {
      key: 'temperature',
      label: 'Nhiệt độ',
      unit: '°C',
      color: '#ff6474',
      min: 26,
      max: 30,
      axisX: 42,
      anchor: 'end',
    },
    {
      key: 'humidity',
      label: 'Độ ẩm',
      unit: '%',
      color: '#4587ff',
      min: 60,
      max: 80,
      axisX: 710,
      anchor: 'start',
    },
    {
      key: 'light',
      label: 'Ánh sáng',
      unit: 'lux',
      color: '#e4a321',
      min: 600,
      max: 800,
      axisX: 776,
      anchor: 'start',
    },
  ];
  const seconds = (time) => time.split(':').reduce((total, part) => total * 60 + Number(part), 0);
  const timeAt = (sample) =>
    sample.timestamp ? new Date(sample.timestamp).getTime() / 1000 : seconds(sample.time);
  const round = (value) => Math.round(value * 100) / 100;
  const xAt = (sample, samples) =>
    LEFT +
    ((timeAt(sample) - timeAt(samples[0])) /
      Math.max(1, timeAt(samples.at(-1)) - timeAt(samples[0]))) *
      (RIGHT - LEFT);
  const yAt = (value, series) =>
    BOTTOM - ((value - series.min) / (series.max - series.min)) * (BOTTOM - TOP);

  const formatValue = (value, key, average = false, lightUnit = 'lux') => {
    if (!Number.isFinite(value)) return 'Chưa có dữ liệu';
    const series = SERIES.find((item) => item.key === key);
    const number = key === 'temperature' || average ? value.toFixed(1) : String(value);
    return `${number} ${key === 'light' ? lightUnit : series.unit}`;
  };

  const seriesFor = (samples, options) =>
    SERIES.map((base) => {
      const series = { ...base };
      if (series.key === 'light') series.unit = options.lightUnit ?? 'lux';
      if (!options.autoScale) return series;
      if (series.key === 'light' && series.unit === 'ADC') return { ...series, min: 0, max: 1024 };
      const values = samples.map((sample) => sample[series.key]).filter(Number.isFinite);
      if (!values.length) return series;
      const low = Math.min(...values);
      const high = Math.max(...values);
      const raw = Math.max(series.key === 'temperature' ? 4 : 20, high - low) / 4;
      const power = 10 ** Math.floor(Math.log10(raw));
      const step = [1, 2, 5, 10].find((value) => value * power >= raw) * power;
      series.min = Math.floor((low - step * 0.25) / step) * step;
      series.max = Math.max(series.min + 4 * step, Math.ceil((high + step * 0.25) / step) * step);
      if (series.key === 'humidity') {
        series.min = Math.max(0, series.min);
        series.max = Math.min(100, series.max);
      }
      return series;
    });

  const summarize = (samples) =>
    Object.fromEntries(
      SERIES.map(({ key }) => {
        const values = samples.map((sample) => sample[key]).filter(Number.isFinite);
        return [
          key,
          {
            count: values.length,
            min: values.length ? Math.min(...values) : null,
            max: values.length ? Math.max(...values) : null,
            average: values.length
              ? values.reduce((sum, value) => sum + value, 0) / values.length
              : null,
          },
        ];
      }),
    );

  // Tọa độ X dựa trên thời gian thực của mốc mẫu; bỏ đoạn thiếu dữ liệu.
  const buildMarkup = (samples, options = {}) => {
    if (!samples.length)
      return '<title id="chart-title">Chưa có dữ liệu cảm biến</title><desc id="chart-desc">Đang chờ ESP8266 gửi dữ liệu.</desc><text class="sensor-axis-label" x="420" y="115" text-anchor="middle">Đang chờ dữ liệu ESP8266</text>';
    const seriesList = seriesFor(samples, options);
    const first = timeAt(samples[0]);
    const last = timeAt(samples.at(-1));
    const interval = options.autoScale
      ? ([1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600, 7200, 14400, 86400].find(
          (value) => value >= (last - first) / 4,
        ) ?? 86400)
      : 600;
    const ticks = [first];
    for (let tick = Math.ceil((first + 1) / interval) * interval; tick < last; tick += interval) {
      if (
        !options.autoScale ||
        (((tick - ticks.at(-1)) / Math.max(1, last - first)) * (RIGHT - LEFT) >= 120 &&
          ((last - tick) / Math.max(1, last - first)) * (RIGHT - LEFT) >= 120)
      )
        ticks.push(tick);
    }
    if (last > first) ticks.push(last);
    const tickX = (tick) =>
      round(LEFT + ((tick - first) / Math.max(1, last - first)) * (RIGHT - LEFT));
    const timeLabel = (tick) =>
      samples[0].timestamp
        ? new Date(tick * 1000).toLocaleTimeString('en-GB', {
            timeZone: 'Asia/Bangkok',
            hour: '2-digit',
            minute: '2-digit',
            ...(interval < 60 ? { second: '2-digit' } : {}),
            hourCycle: 'h23',
          })
        : `${String(Math.floor(tick / 3600)).padStart(2, '0')}:${String(Math.floor(tick / 60) % 60).padStart(2, '0')}`;
    const plots = seriesList
      .map((series) => {
        const segments = [];
        let segment = [];
        samples.forEach((sample) => {
          if (Number.isFinite(sample[series.key])) {
            segment.push({
              sample,
              x: round(xAt(sample, samples)),
              y: round(yAt(sample[series.key], series)),
            });
          } else if (segment.length) {
            segments.push(segment);
            segment = [];
          }
        });
        if (segment.length) segments.push(segment);
        const paths = segments
          .map((points) => {
            const path = points
              .map((point, index) => `${index ? 'L' : 'M'}${point.x} ${point.y}`)
              .join(' ');
            return `<path class="sensor-line" stroke="${series.color}" d="${path}"/>`;
          })
          .join('');
        const points = segments
          .flat()
          .map(
            ({ sample, x, y }) =>
              `<circle class="sensor-point" cx="${x}" cy="${y}" r="3.3" stroke="${series.color}"><title>${sample.time} · ${series.label}: ${formatValue(sample[series.key], series.key, false, options.lightUnit)}</title></circle>`,
          )
          .join('');
        return `<g data-chart-series="${series.key}">${paths}${points}</g>`;
      })
      .join('');
    const grid = Array.from({ length: 5 }, (_, index) => {
      const y = BOTTOM - (index / 4) * (BOTTOM - TOP);
      return `<path class="sensor-grid" d="M${LEFT} ${y}H${RIGHT}"/>`;
    }).join('');
    const axes = seriesList
      .map(
        (series) => `<g data-chart-axis="${series.key}" fill="${series.color}">
      <text class="sensor-axis-unit" x="${series.axisX}" y="15" text-anchor="${series.anchor}">${series.unit}</text>
      ${Array.from({ length: 5 }, (_, index) => {
        const y = BOTTOM - (index / 4) * (BOTTOM - TOP);
        const value = round(series.min + (index / 4) * (series.max - series.min));
        return `<text class="sensor-axis-value" x="${series.axisX}" y="${y + 5}" text-anchor="${series.anchor}">${value}</text>`;
      }).join('')}
    </g>`,
      )
      .join('');
    const vertical = ticks
      .map(
        (tick) =>
          `<path class="sensor-grid sensor-grid-vertical" d="M${tickX(tick)} ${TOP}V${BOTTOM}"/>`,
      )
      .join('');
    const lastSample = samples.at(-1);
    const markers = seriesList
      .map(
        (series) =>
          `<circle class="sensor-selected-point" data-chart-marker="${series.key}" cx="${round(xAt(lastSample, samples))}" cy="${round(yAt(lastSample[series.key] ?? series.min, series))}" r="5" fill="${series.color}" ${Number.isFinite(lastSample[series.key]) ? '' : 'hidden'}/>`,
      )
      .join('');
    return `<title id="chart-title">Nhiệt độ, độ ẩm và ánh sáng theo thời gian</title>
      <desc id="chart-desc">${samples.length} mốc từ ${samples[0].time} đến ${lastSample.time}. Ba đường trong cùng một vùng vẽ: nhiệt độ theo trục °C bên trái, độ ẩm theo trục % và ánh sáng theo trục ${options.lightUnit ?? 'lux'} bên phải. Mỗi trục có thang đo riêng. Mốc thiếu dữ liệu được để trống.</desc>
      <rect class="sensor-panel" x="${LEFT}" y="${TOP}" width="${RIGHT - LEFT}" height="${BOTTOM - TOP}" rx="7"/>
      ${grid}${vertical}${axes}${plots}
      <g>${ticks.map((tick, index) => `<text class="sensor-axis-label" x="${tickX(tick)}" y="220" text-anchor="${index === 0 ? 'start' : index === ticks.length - 1 ? 'end' : 'middle'}">${timeLabel(tick)}</text>`).join('')}</g>
      <path class="sensor-guide" data-chart-guide d="M${RIGHT} ${TOP}V${BOTTOM}"/>
      ${markers}`;
  };

  const initialize = (root, initialOptions = {}) => {
    let options = initialOptions;
    let samples =
      options.samples ?? JSON.parse(root.querySelector('[data-chart-data]').textContent);
    let seriesList = seriesFor(samples, options);
    const svg = root.querySelector('[data-chart-svg]');
    const viewport = root.querySelector('[data-chart-viewport]');
    const tooltip = root.querySelector('[data-chart-tooltip]');
    const slider = root.querySelector('[data-chart-slider]');

    const selectSample = (index, showTooltip = false, clientX) => {
      const sample = samples[index];
      const x = round(xAt(sample, samples));
      slider.value = String(index);
      root.querySelectorAll('[data-chart-time]').forEach((element) => {
        element.textContent = sample.time;
      });
      seriesList.forEach((series) => {
        const value = sample[series.key];
        root.querySelectorAll(`[data-chart-reading="${series.key}"]`).forEach((element) => {
          element.textContent = formatValue(value, series.key, false, options.lightUnit);
        });
        const marker = svg.querySelector(`[data-chart-marker="${series.key}"]`);
        marker.toggleAttribute('hidden', !Number.isFinite(value));
        if (Number.isFinite(value)) {
          marker.setAttribute('cx', String(x));
          marker.setAttribute('cy', String(round(yAt(value, series))));
        }
      });
      svg.querySelector('[data-chart-guide]').setAttribute('d', `M${x} ${TOP}V${BOTTOM}`);
      slider.setAttribute(
        'aria-valuetext',
        `${sample.time}; ${seriesList.map((series) => `${series.label}: ${formatValue(sample[series.key], series.key, false, options.lightUnit)}`).join('; ')}`,
      );
      tooltip.hidden = !showTooltip;
      if (showTooltip) {
        const bounds = viewport.getBoundingClientRect();
        const anchor =
          clientX === undefined
            ? bounds.width - tooltip.offsetWidth - 12
            : clientX - bounds.left + 14;
        tooltip.style.left = `${Math.max(8, Math.min(anchor, bounds.width - tooltip.offsetWidth - 8))}px`;
      }
    };

    // Rê chuột hoặc chạm để xem điểm đo gần nhất, không nội suy giá trị.
    const inspect = (event) => {
      if (!samples.length) return;
      const bounds = svg.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      // SVG giữ tỷ lệ khi bị giới hạn chiều cao; trừ phần lề trống trước khi chọn điểm.
      const scale = Math.min(bounds.width / WIDTH, bounds.height / HEIGHT);
      const x = (event.clientX - bounds.left - (bounds.width - WIDTH * scale) / 2) / scale;
      const y = (event.clientY - bounds.top - (bounds.height - HEIGHT * scale) / 2) / scale;
      if (x < LEFT || x > RIGHT || y < TOP || y > BOTTOM) {
        tooltip.hidden = true;
        return;
      }
      let nearest = 0;
      samples.forEach((sample, index) => {
        if (Math.abs(xAt(sample, samples) - x) < Math.abs(xAt(samples[nearest], samples) - x))
          nearest = index;
      });
      selectSample(nearest, true, event.clientX);
    };
    svg.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'touch') inspect(event);
    });
    svg.addEventListener('pointerdown', inspect);
    svg.addEventListener('pointerleave', () => {
      tooltip.hidden = true;
    });
    slider.addEventListener('input', () => {
      if (!samples.length) return;
      const index = Math.max(0, Math.min(samples.length - 1, Number(slider.value)));
      selectSample(index, true);
    });
    slider.addEventListener('blur', () => {
      tooltip.hidden = true;
    });
    const render = (nextSamples, nextOptions = options) => {
      if (!Array.isArray(nextSamples)) return;
      const selected = Number(slider.value);
      const oldTimestamp = selected < samples.length - 1 ? samples[selected]?.timestamp : null;
      samples = nextSamples;
      options = nextOptions;
      seriesList = seriesFor(samples, options);
      svg.innerHTML = buildMarkup(samples, options);
      slider.max = String(Math.max(0, samples.length - 1));
      slider.disabled = !samples.length;
      const statistics = summarize(samples);
      root.querySelectorAll('[data-chart-stat]').forEach((element) => {
        const [key, field] = element.dataset.chartStat.split('-');
        element.textContent =
          field === 'count'
            ? `${statistics[key].count} điểm đo`
            : formatValue(statistics[key][field], key, field === 'average', options.lightUnit);
      });
      if (samples.length) {
        const preserved = oldTimestamp
          ? samples.findIndex((sample) => sample.timestamp === oldTimestamp)
          : -1;
        selectSample(preserved >= 0 ? preserved : samples.length - 1);
      } else {
        tooltip.hidden = true;
        root.querySelectorAll('[data-chart-time]').forEach((element) => {
          element.textContent = '—';
        });
        for (const series of seriesList)
          root.querySelectorAll(`[data-chart-reading="${series.key}"]`).forEach((element) => {
            element.textContent = 'Chưa có dữ liệu';
          });
      }
    };
    render(samples, options);
    return render;
  };

  // Dùng cùng hàm vẽ cho HTML tĩnh và kiểm tra bằng Node.js.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildMarkup, summarize, formatValue, initialize, seriesFor };
    return;
  }
  document.querySelectorAll('[data-sensor-chart]').forEach((root) => {
    const live = typeof window !== 'undefined' && window.IoT?.live;
    root.updateSensorChart = initialize(
      root,
      live ? { samples: [], lightUnit: 'ADC', autoScale: true } : {},
    );
  });
})();
