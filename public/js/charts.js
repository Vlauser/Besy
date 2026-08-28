/**
 * Small SVG chart set for the studio.
 * Palette validated for the dark chart surface (#151920): categorical hues are
 * used in this fixed order and never cycled.
 */
const CHART_COLORS = ['#e8425f', '#3d7fd6', '#189a63', '#8b5cd6', '#b87d24'];

const CHART_INK = {
  primary: '#e8ecf3',
  secondary: '#949cad',
  grid: 'rgba(148, 156, 173, .18)',
  axis: 'rgba(148, 156, 173, .35)',
  surface: '#151920',
};

/** Rounds up to 1, 2, 2.5 or 5 times a power of ten. */
function niceStep(value) {
  if (value <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

/** Four equal, round steps — so the axis never reads 5, 4, 3, 1. */
function niceScale(maxValue) {
  const step = niceStep(Math.max(1, maxValue) / 4);
  const max = step * 4;
  return { max, ticks: [0, 1, 2, 3, 4].map((i) => i * step) };
}

/**
 * Single-series line with an area wash and a crosshair tooltip.
 * One series needs no legend — the title names it.
 */
function lineChart(container, { title, points, formatValue = (v) => String(v), color = CHART_COLORS[0] }) {
  const width = 720;
  const height = 240;
  const pad = { top: 16, right: 16, bottom: 26, left: 52 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const scale = niceScale(Math.max(...points.map((point) => point.value)));
  const max = scale.max;
  const stepX = points.length > 1 ? plotW / (points.length - 1) : 0;
  const x = (i) => pad.left + i * stepX;
  const y = (value) => pad.top + plotH - (value / max) * plotH;

  const line = points.map((point, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(point.value).toFixed(1)}`).join('');
  const area = `${line}L${x(points.length - 1).toFixed(1)},${pad.top + plotH}L${x(0).toFixed(1)},${pad.top + plotH}Z`;

  const ticks = scale.ticks.map((value) => ({
    value,
    y: pad.top + plotH - (value / max) * plotH,
  }));

  // Label roughly six x positions so they never collide.
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));

  const id = `chart-${Math.random().toString(36).slice(2, 8)}`;
  container.innerHTML = `
    <figure class="chart" data-chart="${id}">
      <figcaption class="chart-title">${escapeHtml(title)}</figcaption>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}" preserveAspectRatio="none">
        <defs>
          <linearGradient id="${id}-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="${color}" stop-opacity=".28"/>
            <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
          </linearGradient>
        </defs>
        ${ticks.map((tick) => `
          <line x1="${pad.left}" x2="${width - pad.right}" y1="${tick.y}" y2="${tick.y}"
                stroke="${CHART_INK.grid}" stroke-width="1"/>
          <text x="${pad.left - 8}" y="${tick.y + 4}" text-anchor="end"
                fill="${CHART_INK.secondary}" font-size="11">${formatValue(tick.value)}</text>`).join('')}
        <path d="${area}" fill="url(#${id}-fill)"/>
        <path d="${line}" fill="none" stroke="${color}" stroke-width="2"
              stroke-linejoin="round" stroke-linecap="round"/>
        ${points.map((point, i) => (i % labelEvery === 0 ? `
          <text x="${x(i)}" y="${height - 8}" text-anchor="middle"
                fill="${CHART_INK.secondary}" font-size="11">${escapeHtml(point.label)}</text>` : '')).join('')}
        <line class="chart-crosshair" y1="${pad.top}" y2="${pad.top + plotH}"
              stroke="${CHART_INK.axis}" stroke-width="1" style="display:none"/>
        <circle class="chart-dot" r="4.5" fill="${color}" stroke="${CHART_INK.surface}" stroke-width="2"
                style="display:none"/>
        <rect x="${pad.left}" y="${pad.top}" width="${plotW}" height="${plotH}" fill="transparent"
              class="chart-hit"/>
      </svg>
      <div class="chart-tooltip" hidden></div>
    </figure>`;

  const figure = container.querySelector('.chart');
  const svg = figure.querySelector('svg');
  const crosshair = figure.querySelector('.chart-crosshair');
  const dot = figure.querySelector('.chart-dot');
  const tooltip = figure.querySelector('.chart-tooltip');

  function onMove(event) {
    const rect = svg.getBoundingClientRect();
    const relative = ((event.clientX - rect.left) / rect.width) * width;
    const index = Math.round(Math.min(Math.max((relative - pad.left) / (stepX || 1), 0), points.length - 1));
    const point = points[index];
    if (!point) return;

    crosshair.setAttribute('x1', x(index));
    crosshair.setAttribute('x2', x(index));
    crosshair.style.display = '';
    dot.setAttribute('cx', x(index));
    dot.setAttribute('cy', y(point.value));
    dot.style.display = '';

    tooltip.hidden = false;
    tooltip.innerHTML = `<strong>${formatValue(point.value)}</strong><span>${escapeHtml(point.label)}</span>`;
    tooltip.style.left = `${(x(index) / width) * 100}%`;
  }

  function onLeave() {
    crosshair.style.display = 'none';
    dot.style.display = 'none';
    tooltip.hidden = true;
  }

  svg.addEventListener('mousemove', onMove);
  svg.addEventListener('mouseleave', onLeave);
  svg.addEventListener('touchmove', (event) => onMove(event.touches[0]), { passive: true });
}

/** Horizontal bars with direct value labels — identity never rests on color alone. */
function barChart(container, { title, items, formatValue = (v) => String(v) }) {
  const max = Math.max(1, ...items.map((item) => item.value));

  container.innerHTML = `
    <figure class="chart">
      <figcaption class="chart-title">${escapeHtml(title)}</figcaption>
      <div class="bars">
        ${items.map((item, index) => `
          <div class="bar-row">
            <span class="bar-label">${escapeHtml(item.label)}</span>
            <span class="bar-track">
              <span class="bar-fill" style="width:${(item.value / max) * 100}%;
                    background:${CHART_COLORS[index % CHART_COLORS.length]}"></span>
            </span>
            <span class="bar-value">${formatValue(item.value)}</span>
          </div>`).join('')}
      </div>
    </figure>`;
}

/** Retention is a share-of-viewers curve, so its axis is fixed at 100%. */
function retentionChart(container, { title, points }) {
  lineChart(container, {
    title,
    points: points.map((point) => ({ label: `${point.percent}%`, value: point.value })),
    formatValue: (value) => `${value}%`,
    color: CHART_COLORS[1],
  });
}
