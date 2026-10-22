/**
 * Storefront building blocks — product card, category rail, product rail.
 */
import { h, track } from '../core/react.js';
import { icon } from '../ui/icons.js';
import { rs, productEmoji, CATEGORY_EMOJI } from '../core/format.js';
import { addToCart, cart, setQty, isFav, toggleFav, pushRecent } from '../data/store.js';
import { navigate } from '../core/router.js';
import { QuantityStepper, Button } from '../ui/components.js';

/* ------------------------------------------------------- product card -- */
export function ProductCard({ product, compact = false }) {
  const inCart = track(cart).find((i) => i.product.id === product.id);
  const fav = track(isFav(product.id));
  const soldOut = product.stock_state === 'out_of_stock' || product.status === 'discontinued';
  const low = product.stock_state === 'low_stock';
  const discount = product.discount_pct || 0;

  const go = () => navigate(`/product/${product.slug || product.id}`);

  return h('article.product-card', { style: soldOut ? { opacity: '0.82' } : null },
    h('div.product-media', {
      style: {
        cursor: 'pointer',
        background: `linear-gradient(150deg, color-mix(in srgb, var(--cat, #10b981) 12%, var(--surface)), var(--bg-subtle))`,
        '--cat': accentVar(product.accent),
      },
      onclick: go, role: 'link', tabindex: '0',
      onkeydown: (e) => { if (e.key === 'Enter') go(); },
      'aria-label': product.name,
    },
      h('span.product-emoji', { 'aria-hidden': 'true' }, productEmoji(product)),
      h('div.product-flags', null,
        soldOut ? h('span.badge.badge-danger', null, 'Out of stock')
          : low ? h('span.badge.badge-warning', null, `Only ${product.quantity} left`) : null,
        discount >= 10 ? h('span.badge.badge-success', null, `${discount}% off`) : null,
        product.is_featured ? h('span.badge.badge-brand', null, '★ Popular') : null),
      h('button.product-fav', {
        class: fav ? 'on' : '',
        onclick: (e) => { e.stopPropagation(); toggleFav(product); },
        'aria-label': fav ? `Remove ${product.name} from saved` : `Save ${product.name}`,
        'aria-pressed': fav ? 'true' : 'false',
      }, icon('heart', { size: 15 }))),

    h('div.product-body', null,
      h('a', { href: `/product/${product.slug || product.id}`, class: 'product-name clamp-2', style: { display: 'block' } },
        product.name),
      h('div.product-meta', null,
        [product.brand, product.pack_size].filter(Boolean).join(' · ') || product.category_name || ''),

      h('div.product-foot', null,
        h('div', null,
          h('div.product-price', null,
            h('span.price-now', null, rs(product.price_rupees ?? product.price / 100)),
            product.mrp_rupees > product.price_rupees
              ? h('span.price-was', null, rs(product.mrp_rupees)) : null),
          h('div.text-xs.text-subtle', { style: { marginTop: '1px' } },
            product.tax_rate > 0 ? `incl. ${product.tax_rate}% GST` : 'GST included')),

        soldOut
          ? h('button.btn.btn-sm.btn-subtle', { disabled: true }, 'Sold out')
          : inCart
            ? QuantityStepper({
                value: inCart.quantity, small: true, max: Math.min(product.quantity ?? 99, 99),
                onChange: (n) => setQty(product.id, n),
              })
            : h('button.add-btn', {
                onclick: () => addToCart(product, 1),
                'aria-label': `Add ${product.name} to cart`,
                title: 'Add to cart',
              }, icon('cart', { size: 15 })))));
}

/* ------------------------------------------------------ category rail -- */
export function CategoryRail({ categories }) {
  return h('nav.cat-grid', { 'aria-label': 'Product categories' },
    categories.map((c) => h('a.cat-card', { href: `/shop?category=${c.slug}` },
      h('div.cat-emoji', { style: { background: `color-mix(in srgb, ${accentVar(c.accent)} 16%, transparent)` } },
        CATEGORY_EMOJI[c.slug] || '🛍️'),
      h('span.cat-name', null, c.name),
      h('span.cat-count', null, `${c.in_stock_count ?? c.product_count} in stock`))));
}

/* ------------------------------------------------------- product rail -- */
export function ProductRail({ products, title }) {
  return h('div', { style: { position: 'relative' } },
    h('div.product-grid', null, products.map((p) => ProductCard({ product: p }))));
}

/* ----------------------------------------------------- accent helper --- */
const ACCENTS = {
  emerald: 'var(--brand-600)', amber: '#d97706', orange: '#ea580c', lime: '#65a30d',
  rose: '#e11d48', sky: '#0284c7', teal: '#0d9488', indigo: '#4f46e5',
  fuchsia: '#c026d3', yellow: '#ca8a04',
};
export const accentVar = (name) => ACCENTS[name] || 'var(--brand-600)';

/* -------------------------------------------------------- mini rows --- */
export function CompactProductRow({ product, onClick }) {
  const inCart = track(cart).find((i) => i.product.id === product.id);
  return h('div.pos-search-result', {
    onclick: () => onClick?.(product),
  },
    h('div.pos-thumb', null, productEmoji(product)),
    h('div.grow', null,
      h('div.text-sm.font-semibold.truncate', null, product.name),
      h('div.text-xs.text-muted', null,
        `${product.sku} · ${product.stock_state === 'out_of_stock' ? 'Out of stock' : `${product.quantity} in stock`}`)),
    h('div.col', { style: { alignItems: 'flex-end' } },
      h('span.mono.font-semibold', null, rs(product.price_rupees ?? product.price / 100)),
      inCart
        ? h('span.badge.badge-success', null, `${inCart.quantity} in cart`)
        : h('button.btn.btn-sm.btn-primary', {
            disabled: product.stock_state === 'out_of_stock',
            onclick: (e) => { e.stopPropagation(); addToCart(product, 1); },
          }, 'Add')));
}