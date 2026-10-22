/**
 * Live stock ticker — a marquee of what's fresh / running low today.
 * Reads the live inventory feed so it stays truthful.
 */
import { h } from '../core/react.js';
import { api } from '../core/api.js';
import { icon } from '../ui/icons.js';
import { productEmoji, rs } from '../core/format.js';
import { addToCart } from '../data/store.js';

export async function StockTicker({ products }) {
  let items = [];
  try {
    const res = await api.get('/products?in_stock=1&per_page=10&sort=newest');
    items = res.items;
  } catch {
    items = products || [];
  }
  if (!items.length) return null;

  const chips = items.map((p) => h('span.ticker-item', {
    onclick: () => addToCart(p, 1),
    role: 'button', tabindex: '0',
    title: `Add ${p.name} — ${rs(p.price_rupees)}`,
  },
    h('span.ticker-emoji', null, productEmoji(p)),
    h('span.ticker-name', null, p.name),
    h('span.ticker-price', null, rs(p.price_rupees)),
    icon('plus', { size: 13 })));

  return h('div.card.card-pad', { style: { padding: 'var(--sp-4) var(--sp-5)' } },
    h('div.row-between.mb-4', null,
      h('div', null,
        h('div.chart-title', null, 'Fresh in the store today'),
        h('div.chart-sub', null, 'Tap any item to drop it in your basket')),
      h('span.badge.badge-success', null, h('span.badge-dot'), 'Live stock')),
    h('div.ticker', { 'aria-label': 'Recently restocked products' },
      h('div.ticker-track', null, ...chips, ...chips)));
}