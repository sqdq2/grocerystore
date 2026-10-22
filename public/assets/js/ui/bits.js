/**
 * Small presentational atoms reused across storefront and console.
 */
import { h } from '../core/react.js';
import { icon } from './icons.js';
import { ORDER_STATUS_META, STOCK_STATE_META, PAYMENT_META, formatDate } from '../core/format.js';

export function statusBadge(status) {
  const meta = ORDER_STATUS_META[status] || { label: status, tone: 'info', emoji: '•' };
  return h('span.badge', { class: `badge-${meta.tone}` },
    h('span.badge-dot'), meta.label);
}

export function stockChip(state, label) {
  const meta = STOCK_STATE_META[state] || STOCK_STATE_META.available;
  return h('span.badge', { class: `badge-${meta.tone}` }, meta.label === 'In stock' ? null : label || meta.label);
}

export function paymentBadge(mode) {
  const meta = PAYMENT_META[mode] || { label: mode, emoji: '•' };
  return h('span.badge', { class: 'badge-brand' }, meta.emoji, ' ', meta.label);
}

/** Metric tile used across the console dashboard. */
export function KPI({ label, value, icon: ic, delta, deltaLabel, accent = 'var(--primary)', sub, invertDelta = false }) {
  const dir = delta === undefined || delta === null ? null
    : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const good = invertDelta ? dir === 'down' : dir === 'up';
  return h('div.kpi', { style: { '--kpi-accent': accent } },
    h('div.kpi-label', null, ic ? icon(ic, { size: 13 }) : null, label),
    h('div.kpi-value', null, value),
    dir
      ? h('div.kpi-delta', { class: dir === 'up' ? (good ? 'up' : 'down') : dir === 'down' ? (good ? 'up' : 'down') : 'flat' },
          dir === 'flat' ? null : icon(dir === 'up' ? 'arrowUp' : 'arrowDown', { size: 12 }),
          `${Math.abs(delta).toFixed(1)}%`, deltaLabel ? h('span.text-muted', null, deltaLabel) : null)
      : sub ? h('div.kpi-sub', null, sub) : null);
}

/** Horizontal progress bar used for stock levels and target attainment. */
export function ProgressBar({ value, max = 100, tone = 'var(--primary)', height }) {
  const pctVal = Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0));
  return h('div.progress-track', height ? { style: { height: `${height}px` } } : null,
    h('div.progress-fill', { style: { width: `${pctVal}%`, background: tone } }));
}

/** Section title used inside console panels. */
export const PanelTitle = (title, sub, right) => h('div.chart-head', null,
  h('div', null,
    h('div.chart-title', null, title),
    sub ? h('div.chart-sub', null, sub) : null),
  right || null);

export function Tabs({ tabs, active, onChange }) {
  return h('div.tabs', { role: 'tablist' },
    tabs.map((t) => h('button.tab', {
      class: t.id === active ? 'active' : '',
      role: 'tab',
      'aria-selected': t.id === active ? 'true' : 'false',
      onclick: () => onChange(t.id),
    }, t.label, t.count !== undefined ? h('span.badge', { style: { marginLeft: '6px' } }, t.count) : null)));
}

/** Avatar with initials fallback. */
export function Avatar({ name, size = '' }) {
  const ini = String(name || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return h(`div.avatar${size === 'lg' ? '.avatar-lg' : ''}`, {
    title: name, 'aria-hidden': 'true',
  }, ini);
}

export function MetaItem(label, value) {
  return h('div', null,
    h('div.inv-party-label', null, label),
    h('div', { style: { fontWeight: '550' } }, value));
}

export function DateCell(iso) {
  return h('span', { title: iso }, formatDate(iso));
}