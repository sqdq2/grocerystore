/**
 * Lightweight SVG charting — area/line, bars, donut, sparkline.
 *
 * Written from scratch so the visuals match the design system exactly and
 * there is no charting dependency to load or theme.
 */
import { h, render } from '../core/react.js';
import { rsShort, shortDay } from '../core/format.js';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const palette = () => [
  css('--brand-600') || '#059669',
  css('--saffron-500') || '#f59e0b',
  css('--info') || '#3b82f6',
  css('--danger') || '#ef4444',
  css('--n-400') || '#a3a3a0',
];

function niceMax(value) {
  if (value <= 0) return 10;
  const mag = 10 ** Math.floor(Math.log10(value));
  const n = value / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * mag;
}

function ticks(max, count = 4) {
  return Array.from({ length: count + 1 }, (_, i) => (max / count) * i);
}

/* ------------------------------------------------------- area + line ---- */
/**
 * Time series with a gradient area, hover crosshair and tooltip.
 * data: [{ label, value, sub? }]
 */
export function AreaChart({ data, height = 220, valueKey = 'value', format = rsShort, showAxis = true }) {
  if (!data?.length) return h('div.empty', null, h('p.text-muted', null, 'No data yet'));

  const W = 720, H = height;
  const pad = { t: 14, r: 8, b: showAxis ? 26 : 8, l: 46 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;

  const values = data.map((d) => Number(d[valueKey] ?? 0));
  const max = niceMax(Math.max(...values, 1));
  const stepX = data.length > 1 ? iw / (data.length - 1) : 0;

  const px = (i) => pad.l + i * stepX;
  const py = (v) => pad.t + ih - (v / max) * ih;

  const linePath = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(Number(d[valueKey] ?? 0)).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${px(data.length - 1).toFixed(1)},${(pad.t + ih).toFixed(1)} L${pad.l},${(pad.t + ih).toFixed(1)} Z`;
  const gid = `grad-${Math.random().toString(36).slice(2, 8)}`;

  const tip = render(h('div.spark-tip'));
  const wrap = render(h('div.chart-body', { style: { position: 'relative' } }));

  const svgNode = render(h('svg', {
    viewBox: `0 0 ${W} ${H}`, width: '100%', height, preserveAspectRatio: 'none',
    style: { display: 'block', overflow: 'visible' }, role: 'img',
    'aria-label': 'Trend chart',
  },
    h('defs', null,
      h('linearGradient', { id: gid, x1: '0', y1: '0', x2: '0', y2: '1' },
        h('stop', { offset: '0%', 'stop-color': palette()[0], 'stop-opacity': '0.30' }),
        h('stop', { offset: '100%', 'stop-color': palette()[0], 'stop-opacity': '0.01' }))),

    showAxis ? ticks(max).map((t) => h('g', null,
      h('line', { class: 'grid-line', x1: pad.l, x2: W - pad.r, y1: py(t), y2: py(t) }),
      h('text', { class: 'axis-text', x: pad.l - 8, y: py(t) + 3, 'text-anchor': 'end' }, format(t)))) : null,

    h('path', { d: areaPath, fill: `url(#${gid})` }),
    h('path', { class: 'chart-line', d: linePath, stroke: palette()[0] }),

    data.map((d, i) => h('circle', {
      class: 'chart-point', cx: px(i), cy: py(Number(d[valueKey] ?? 0)), r: 2.6,
      fill: 'var(--surface)', stroke: palette()[0], 'stroke-width': '2',
      onmouseenter: (e) => showTip(e, d),
      onmouseleave: () => tip.classList.remove('show'),
    })),

    showAxis ? data.map((d, i) => {
      // label every nth point so the axis never collides
      const every = Math.ceil(data.length / 7);
      if (i % every !== 0 && i !== data.length - 1) return null;
      return h('text', {
        class: 'axis-text', x: px(i), y: H - 8, 'text-anchor': i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle',
      }, d.label);
    }) : null));

  function showTip(e, d) {
    const rect = wrap.getBoundingClientRect();
    tip.textContent = `${d.label} · ${format(d[valueKey] ?? 0)}${d.sub ? ` · ${d.sub}` : ''}`;
    tip.style.left = `${e.offsetX ?? (rect.width / 2)}px`;
    tip.style.top = `${(e.offsetY ?? 0) - 6}px`;
    tip.classList.add('show');
  }

  wrap.appendChild(svgNode);
  wrap.appendChild(tip);
  return wrap;
}

/* ---------------------------------------------------------------- bars -- */
export function BarChart({ data, height = 220, valueKey = 'value', format = rsShort, color, horizontal = false }) {
  if (!data?.length) return h('div.empty', null, h('p.text-muted', null, 'No data yet'));

  const c = color || palette()[0];
  const max = Math.max(...data.map((d) => Number(d[valueKey] ?? 0)), 1);

  if (horizontal) {
    const W = 560, rowH = 30, H = data.length * rowH + 6;
    const labelW = 132;
    const max = Math.max(...data.map((d) => Number(d[valueKey] ?? 0)), 1);
    return h('div.chart-body', null,
      h('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, style: { display: 'block' }, role: 'img' },
        data.map((d, i) => {
          const y = i * rowH + 4;
          const w = Math.max(2, (Number(d[valueKey] ?? 0) / max) * (W - labelW - 60));
          return h('g', null,
            h('text', { class: 'axis-text', x: labelW - 8, y: y + 13, 'text-anchor': 'end', style: { fill: 'var(--text-muted)' } },
              String(d.label).slice(0, 20)),
            h('rect', { class: 'bar-track', x: labelW, y: y + 4, width: W - labelW - 60, height: 14, rx: 4 }),
            h('rect', { class: 'bar-fill', x: labelW, y: y + 4, width: w, height: 14, rx: 4, fill: d.color || c }),
            h('text', { class: 'axis-text', x: W - 52, y: y + 15, style: { fill: 'var(--text)' } }, format(d[valueKey] ?? 0)));
        })));
  }

  const W = 720, H = height;
  const pad = { t: 14, r: 8, b: 28, l: 46 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const maxN = niceMax(max);
  const slot = iw / data.length;
  const barW = Math.max(4, Math.min(38, slot * 0.62));
  const every = Math.ceil(data.length / 9);

  return h('div.chart-body', null,
    h('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, style: { display: 'block', overflow: 'visible' }, role: 'img' },
      ticks(maxN).map((t) => h('g', null,
        h('line', { class: 'grid-line', x1: pad.l, x2: W - pad.r, y1: pad.t + ih - (t / maxN) * ih, y2: pad.t + ih - (t / maxN) * ih }),
        h('text', { class: 'axis-text', x: pad.l - 8, y: pad.t + ih - (t / maxN) * ih + 3, 'text-anchor': 'end' }, format(t)))),

      data.map((d, i) => {
        const v = Number(d[valueKey] ?? 0);
        const bh = maxN > 0 ? (v / maxN) * ih : 0;
        const x = pad.l + i * slot + (slot - barW) / 2;
        const y = pad.t + ih - bh;
        const g = h('g', { style: { cursor: 'pointer' } },
          h('rect', { class: 'bar', x, y, width: barW, height: Math.max(bh, 1), rx: Math.min(4, barW / 3), fill: d.color || c },
            h('title', null, `${d.label}: ${format(v)}${d.sub ? ` (${d.sub})` : ''}`)),
          (i % every === 0 || i === data.length - 1)
            ? h('text', { class: 'axis-text', x: x + barW / 2, y: H - 9, 'text-anchor': 'middle' }, d.label) : null);
        return g;
      })));
}

/* --------------------------------------------------------------- donut -- */
export function DonutChart({ data, size = 190, thickness = 26, centerLabel = 'Total', format = rsShort }) {
  if (!data?.length) return h('div.empty', null, h('p.text-muted', null, 'No data yet'));

  const c = palette();
  const total = data.reduce((s, d) => s + Number(d.value ?? 0), 0);
  const r = (size - thickness) / 2;
  const cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;

  let offset = 0;
  const arcs = data.map((d, i) => {
    const frac = total > 0 ? Number(d.value ?? 0) / total : 0;
    const len = frac * circ;
    const seg = h('circle', {
      cx, cy, r, fill: 'none',
      stroke: d.color || c[i % c.length],
      'stroke-width': thickness,
      'stroke-dasharray': `${Math.max(len - 2, 0.5)} ${circ}`,
      'stroke-dashoffset': -offset,
      transform: `rotate(-90 ${cx} ${cy})`,
      'stroke-linecap': 'round',
      style: { transition: 'stroke-dasharray 600ms var(--ease-out)', cursor: 'pointer' },
    }, h('title', null, `${d.label}: ${format(d.value)} (${(frac * 100).toFixed(1)}%)`));
    offset += len;
    return seg;
  });

  return h('div.row.gap-6', { style: { alignItems: 'center', flexWrap: 'wrap' } },
    h('div', { style: { flex: 'none' } },
      h('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: 'img', 'aria-label': centerLabel },
        arcs,
        h('text', { x: cx, y: cy - 2, 'text-anchor': 'middle', class: 'donut-center-value' }, format(total)),
        h('text', { x: cx, y: cy + 15, 'text-anchor': 'middle', class: 'donut-center-label' }, centerLabel))),
    h('div.col.gap-2', { style: { flex: '1', minWidth: '150px' } },
      data.map((d, i) => h('div.row-between', { style: { fontSize: 'var(--fs-sm)' } },
        h('span.row.gap-2', null,
          h('span.legend-swatch', { style: { background: d.color || c[i % c.length] } }),
          d.label),
        h('span.row.gap-3', null,
          h('span.mono.text-muted', { style: { fontSize: 'var(--fs-xs)' } },
            `${total > 0 ? ((Number(d.value) / total) * 100).toFixed(0) : 0}%`),
          h('span.mono.font-semibold', null, format(d.value)))))));
}

/* ------------------------------------------------------------ sparkline -- */
export function Sparkline({ values = [], width = 120, height = 32, color }) {
  if (!values.length) return null;
  const c = color || palette()[0];
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const pts = values.map((v, i) => [i * step, height - ((v - min) / range) * (height - 4) - 2]);
  const d = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return h('svg', { width, height, viewBox: `0 0 ${width} ${height}`, style: { display: 'block' }, 'aria-hidden': 'true' },
    h('path', { d: `${d} L${width},${height} L0,${height} Z`, fill: c, opacity: '0.1' }),
    h('path', { d, fill: 'none', stroke: c, 'stroke-width': '1.8', 'stroke-linecap': 'round' }));
}

/* --------------------------------------------------------- hourly curve -- */
export function HourChart({ data, height = 200 }) {
  // always show the full trading day 8:00 → 21:00
  const hours = Array.from({ length: 14 }, (_, i) => i + 8);
  const byHour = new Map(data.map((d) => [Number(d.hour), d]));
  const rows = hours.map((hr) => ({
    label: `${hr % 12 || 12}${hr < 12 ? 'a' : 'p'}`,
    value: Number(byHour.get(hr)?.revenue ?? 0),
    orders: Number(byHour.get(hr)?.orders ?? 0),
  }));
  return BarChart({ data: rows, height, format: rsShort });
}

/** Transform DB rows into the shape AreaChart expects. */
export const toSeries = (rows, { key = 'day', value = 'revenue' } = {}) =>
  rows.map((r) => ({ label: shortDay(r[key]), value: r[value], sub: `${r.orders ?? 0} orders` }));