/**
 * Shared helpers for console pages.
 */
import { h } from '../../core/react.js';
import { icon } from '../../ui/icons.js';

export function alertVar(type) {
  return { out_of_stock: 'critical', low_stock: 'warning', restocked: 'info' }[type] || 'info';
}

export function pageHead({ title, sub, actions }) {
  return h('div.page-head', null,
    h('div', null,
      h('h1.page-title', null, title),
      sub ? h('p.page-sub', null, sub) : null),
    actions ? h('div.row.gap-2.wrap', null, actions) : null);
}

export function consoleRow({ label, value, mono = true }) {
  return h('div.row-between', null,
    h('span.text-sm.text-muted', null, label),
    h('span', { class: mono ? 'text-sm.mono.font-semibold' : 'text-sm.font-semibold' }, value));
}

/** Simple sortable/paginated client-side table helper for admin lists. */
export function paginate(items, page, perPage) {
  const p = Math.max(1, page);
  return {
    rows: items.slice((p - 1) * perPage, p * perPage),
    totalPages: Math.max(1, Math.ceil(items.length / perPage)),
    page: p,
  };
}

export const StatusDot = (color) =>
  h('span.badge-dot', { style: { background: color } });

export const StockBadge = (p) => {
  const map = {
    available: ['badge-success', 'In stock'],
    low_stock: ['badge-warning', 'Low'],
    out_of_stock: ['badge-danger', 'Out'],
    discontinued: ['badge-info', 'Discontinued'],
  };
  const [cls, label] = map[p.stock_state] || map.available;
  return h('span.badge', { class: cls }, label);
};