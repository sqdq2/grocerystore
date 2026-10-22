/**
 * Product detail — gallery, price, stock state, add-to-cart,
 * supplier traceability, stock movement ledger and related items.
 */
import { h, track, signal } from '../core/react.js';
import { api } from '../core/api.js';
import { icon } from '../ui/icons.js';
import { Button, Card, Breadcrumb, QuantityStepper, EmptyState, Badge } from '../ui/components.js';
import { ProductCard, accentVar } from './components-store.js';
import { addToCart, cart, setQty, isFav, toggleFav, pushRecent, cartOpen } from '../data/store.js';
import { rs, productEmoji, formatDateTime, relativeTime, titleCase } from '../core/format.js';
import { navigate } from '../core/router.js';
import { toast } from '../data/store.js';

const REASON_ICON = { sale: 'cart', restock: 'truck', adjustment: 'edit', return: 'refresh', opening: 'box' };

export async function productPage({ params }) {
  const p = await api.get(`/products/${encodeURIComponent(params.slug || params.id)}`);
  pushRecent(p);

  const qty = signal(1);
  const inCart = track(cart).find((i) => i.product.id === p.id);
  const fav = track(isFav(p.id));
  const soldOut = p.stock_state === 'out_of_stock' || p.status === 'discontinued';
  const low = p.stock_state === 'low_stock';
  const maxQty = Math.min(p.quantity ?? 0, 99);

  const stockPct = p.reorder_level > 0
    ? Math.min(100, (p.quantity / (p.reorder_level * 3)) * 100) : 100;

  const addNow = () => {
    const n = Math.min(track(qty), Math.max(p.quantity, 1));
    if (addToCart(p, n)) qty.value = 1;
  };

  const availability = h('div.card.card-pad', null,
    h('div.row-between', null,
      h('div', null,
        h('div.text-xs.text-muted.uppercase', { style: { letterSpacing: '0.07em' } }, 'Availability'),
        h('div.row.gap-2.mt-2', null,
          soldOut
            ? h('span.badge.badge-danger', null, icon('x', { size: 12 }), 'Out of stock')
            : low
              ? h('span.badge.badge-warning', null, icon('alert', { size: 12 }), `Only ${p.quantity} left`)
              : h('span.badge.badge-success', null, icon('check', { size: 12 }), `${p.quantity} in stock`)),
        h('div.text-xs.text-subtle.mt-2', null,
          p.last_restocked_at ? `Last restocked ${relativeTime(p.last_restocked_at)}` : 'Recently stocked')),
      h('div.col', { style: { alignItems: 'flex-end' } },
        h('div.text-xs.text-muted', null, 'Reorder level'),
        h('div.text-lg.mono.font-semibold', null, p.reorder_level))),

    h('div.progress-track', { style: { marginTop: 'var(--sp-3)' } },
      h('div.progress-fill', {
        style: {
          width: `${stockPct}%`,
          background: soldOut ? 'var(--danger)' : low ? 'var(--warning)' : 'var(--success)',
        },
      })),
    soldOut
      ? h('p.text-sm.text-muted.mt-3', null,
          'This batch has sold out. It is usually back within a day — call the shop and we will keep one aside.')
      : h('p.text-sm.text-muted.mt-3', null,
          `We keep ${p.reorder_level} as a safety buffer and restock in batches of ${p.reorder_quantity}.`));

  const specs = h('div.spec-list', null,
    [['SKU', p.sku], ['Brand', p.brand || '—'], ['Pack size', p.pack_size || '1 pc'],
     ['Unit', titleCase(p.unit)], ['GST', `${p.tax_rate}%`],
     ['Barcode', p.barcode || '—']].map(([k, v]) =>
      h('div.spec', null, h('div.spec-label', null, k), h('div.spec-value.mono', null, v))));

  const supplierCard = p.supplier_name
    ? h('div.card.card-pad', null,
        h('div.row.gap-3', { style: { marginBottom: 'var(--sp-3)' } },
          h('div.feature-icon', null, icon('truck', { size: 18 })),
          h('div', null,
            h('div.feature-title', null, 'Supplied by'),
            h('div.text-sm.text-muted', null, p.supplier_name))),
        h('div.col.gap-2.text-sm', null,
          h('div.row-between', null, h('span.text-muted', null, 'Contact'),
            h('span.mono', null, p.supplier_phone || '—')),
          h('div.row-between', null, h('span.text-muted', null, 'Typical lead time'),
            h('span', null, `${p.lead_time_days || 0} days`))),
        h('div.divider.mt-3.mb-3'),
        h('div.text-xs.text-muted', null, 'Traceability: every unit carries this supplier record in the system.'))
    : null;

  const movements = p.movements?.length
    ? h('div.card.card-pad', null,
        h('div.chart-title', { style: { marginBottom: 'var(--sp-4)' } }, 'Stock movement ledger'),
        h('div.timeline', null,
          p.movements.slice(0, 8).map((m) => h('div.timeline-item', null,
            h('div.timeline-dot', null, icon(REASON_ICON[m.reason] || 'edit', { size: 11 })),
            h('div.grow', null,
              h('div.row-between', null,
                h('span.text-sm.font-semibold', null, titleCase(m.reason)),
                h('span.mono.text-sm', {
                  style: { color: m.change > 0 ? 'var(--success)' : 'var(--danger)' },
                }, `${m.change > 0 ? '+' : ''}${m.change}`)),
              h('div.text-xs.text-muted', null,
                `${formatDateTime(m.created_at)} · balance ${m.balance_after}${m.reference ? ` · ${m.reference}` : ''}`))))))
    : null;

  /* ---------- left column: media + buy actions + specs ---------- */
  const media = h('div.pdp-media', {
    style: {
      background: `linear-gradient(150deg, color-mix(in srgb, ${accentVar(p.accent)} 16%, var(--surface)), var(--bg-subtle))`,
    },
  }, h('span.product-emoji', null, productEmoji(p)));

  const buyActions = h('div.row.gap-3.mt-4.wrap', null,
    Button({ variant: 'primary', size: 'lg', disabled: soldOut,
      onclick: () => { addNow(); cartOpen.value = true; } },
      icon('cart', { size: 17 }), soldOut ? 'Sold out' : 'Add to cart'),
    soldOut ? null : QuantityStepper({ value: track(qty), onChange: (n) => { qty.value = n; } }),
    Button({ variant: 'ghost', size: 'lg', class: fav ? 'text-danger' : '',
      onclick: () => toggleFav(p), 'aria-pressed': fav ? 'true' : 'false' },
      icon('heart', { size: 17 }), fav ? 'Saved' : 'Save'),
    inCart
      ? h('button.btn.btn-subtle.btn-lg', { onclick: () => { setQty(p.id, 0); } },
          icon('trash', { size: 15 }), 'Remove')
      : null);

  const promises = h('div.row.gap-4.mt-6.wrap',
    { style: { fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' } },
    h('span.row.gap-2', null, icon('truckFast', { size: 15 }), 'Same-day delivery over \u20b9300'),
    h('span.row.gap-2', null, icon('shield', { size: 15 }), 'GST billed invoice'),
    h('span.row.gap-2', null, icon('refresh', { size: 15 }), 'Exchange within 24h'));

  const specBlock = h('div.mt-8', null, h('h3.mb-4', null, 'Specifications'), specs);
  const left = h('div', null, media, buyActions, promises, specBlock);

  /* ---------- right column: the buy box ---------- */
  const badges = h('div.row.gap-2.wrap', null,
    h('a.badge', { href: `/shop?category=${p.category_slug}`, style: { textDecoration: 'none' } },
      p.category_name),
    p.brand ? h('span.badge', null, p.brand) : null,
    p.is_featured ? h('span.badge.badge-brand', null, '\u2605 Popular') : null);

  const priceRow = h('div.pdp-price', null,
    h('span.price-now', null, rs(p.price_rupees)),
    p.mrp_rupees > p.price_rupees ? h('span.price-was', null, rs(p.mrp_rupees)) : null,
    p.discount_pct >= 5 ? h('span.badge.badge-success', null, `Save ${p.discount_pct}%`) : null);

  const saving = p.discount_pct >= 5
    ? h('p.text-sm.mt-2', null,
        h('span.text-success.font-semibold', null,
          `You save \u20b9${(p.mrp_rupees - p.price_rupees).toFixed(2)} `),
        h('span.text-muted', null, 'on every unit'))
    : null;

  const inCartNotice = inCart
    ? h('div.row.between', {
        style: { padding: '10px 12px', background: 'var(--primary-soft)', borderRadius: 'var(--r-md)' },
      },
      h('span.row.gap-2.text-sm', { style: { color: 'var(--primary)', fontWeight: '600' } },
        icon('checkCircle', { size: 15 }), `${inCart.quantity} already in your cart`),
      h('button.btn.btn-sm.btn-primary', { onclick: () => { cartOpen.value = true; } }, 'View cart'))
    : null;

  const priceCard = h('div.card.card-pad.mt-6', null,
    priceRow, saving,
    h('div.divider.mt-4.mb-4'),
    inCartNotice);

  const traceCards = [availability, supplierCard, movements].filter(Boolean);
  const right = h('div', null,
    badges,
    h('h1.pdp-title.mt-3', null, p.name),
    h('p.text-muted.mt-2', { style: { fontSize: 'var(--fs-md)' } }, p.description),
    h('div.row.gap-2.mt-4.wrap', null,
      h('span.badge', null, `${p.pack_size || '1 pc'}`),
      h('span.badge', null, `SKU ${p.sku}`),
      h('span.badge', null, `${p.tax_rate}% GST`)),
    priceCard,
    ...traceCards.map((c) => h('div.mt-4', null, c)));

  const layout = h('div.pdp-layout.mt-6', null, left, right);

  const related = p.related?.length
    ? h('div.mt-12', null,
        h('div.section-head', null,
          h('h2.section-title', null, 'You might also need'),
          h('a.btn.btn-ghost.btn-sm', { href: `/shop?category=${p.category_slug}` },
            `All ${p.category_name}`, icon('arrowRight', { size: 14 }))),
        h('div.product-grid', null, p.related.map((r) => ProductCard({ product: r }))))
    : null;

  return {
    title: p.name,
    node: h('div.container-page', null,
      h('div.shell', null,
        Breadcrumb([
          { label: 'Home', href: '/' },
          { label: 'Shop', href: '/shop' },
          { label: p.category_name, href: `/shop?category=${p.category_slug}` },
          { label: p.name },
        ]),
        layout,
        related)),
  };
}
