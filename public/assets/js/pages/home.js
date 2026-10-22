/**
 * Home page — hero, category rail, deals, featured products,
 * store trust signals and the live "fresh today" strip.
 */
import { h, track, signal } from '../core/react.js';
import { api } from '../core/api.js';
import { icon } from '../ui/icons.js';
import { Button, Card, SectionHead, EmptyState } from '../ui/components.js';
import { ProductCard, CategoryRail, ProductRail } from './components-store.js';
import { store, addToCart, recent, isFav, toggleFav } from '../data/store.js';
import { rs, rsShort, productEmoji, CATEGORY_EMOJI } from '../core/format.js';
import { navigate } from '../core/router.js';
import { StockTicker } from './ticker.js';

export async function homePage() {
  const [featured, deals, cats, categories] = await Promise.all([
    api.get('/products?featured=1&per_page=8'),
    api.get('/products?min_discount=10&per_page=6&sort=discount'),
    api.get('/products?in_stock=1&per_page=4&sort=newest'),
    api.get('/categories'),
  ]);

  const meta = store.value;
  const isDark = document.documentElement.dataset.theme === 'dark';

  const hero = h('section.hero', null,
    h('div.shell', null,
      h('div', null,
        h('span.hero-eyebrow', null,
          h('span.pulse'), `Open now · ${meta?.hours?.split('·')[0]?.trim() || 'Mon–Sat 8:00–21:30'}`),
        h('h1', null, 'Your everyday ', h('em', null, 'grocery'), ' shop,', h('br'), 'just around the corner.'),
        h('p.hero-lead', null,
          `Fresh provisions from our family to yours. ${meta?.categories?.length || 10} aisles, `,
          `${meta?.categories?.reduce((s, c) => s + (c.in_stock_count || 0), 0) || 60} products in stock, `,
          'delivered the same day across Waghai.'),
        h('div.hero-cta', null,
          Button({ variant: 'primary', size: 'lg', onclick: () => navigate('/shop') },
            'Start shopping', { size: 18 }),
          Button({ variant: 'default', size: 'lg', onclick: () => navigate('/deals') },
            icon('percent', { size: 17 }), 'See today’s deals')),
        h('div.hero-stats', null,
          h('div', null,
            h('div.hero-stat-value', null, '26+'),
            h('div.hero-stat-label', null, 'Years in Waghai')),
          h('div', null,
            h('div.hero-stat-value', null, `${meta?.categories?.reduce((s, c) => s + (c.product_count || 0), 0) || 60}`),
            h('div.hero-stat-label', null, 'Products')),
          h('div', null,
            h('div.hero-stat-value', null, '60 min'),
            h('div.hero-stat-label', null, 'Delivery promise')))),

      h('div.hero-visual', { 'aria-hidden': 'true' },
        h('div.hero-blob'),
        h('div.hero-card', null,
          h('div.hero-card-emoji', null, '🌾'),
          h('div', null, h('div.hero-card-title', null, 'Chakki Atta'),
            h('div.hero-card-sub', null, 'Stone-milled daily'))),
        h('div.hero-card', null,
          h('div.hero-card-emoji', null, '🥛'),
          h('div', null, h('div.hero-card-title', null, 'Fresh Dairy'),
            h('div.hero-card-sub', null, 'Delivered 6 AM'))),
        h('div.hero-card', null,
          h('div.hero-card-emoji', null, '🫘'),
          h('div', null, h('div.hero-card-title', null, 'Daily Dals'),
            h('div.hero-card-sub', null, 'Stone-ground'))))));

  const trust = h('section', { style: { marginTop: 'calc(var(--sp-20) * -1)' } },
    h('div.shell', null,
      h('div.card.card-pad.feature-grid', { style: { boxShadow: 'var(--sh-lg)' } },
        [
          ['truckFast', 'Same-day delivery', 'Order before 6 PM inside Waghai and it lands the same evening.'],
          ['shield', 'Honest weights', 'Every bill carries our GSTIN — what you pay is what you get.'],
          ['wallet', 'UPI · Card · Cash', 'Pay however your family prefers at the counter or on delivery.'],
          ['award', 'Family since 1998', 'Three generations of the same shop, same spot on Krishna Market.'],
        ].map(([ic, t, d], i) => h(`div.feature.reveal`, { style: { animationDelay: `${i * 60}ms` } },
          h('div.feature-icon', null, icon(ic, { size: 20 })),
          h('div', null, h('div.feature-title', null, t), h('div.feature-text', null, d)))))));

  const catsSection = h('section.container-page', { style: { paddingBottom: 'var(--sp-8)' } },
    h('div.shell', null,
      SectionHead({
        eyebrow: 'Browse the aisles', title: 'Shop by category',
        sub: 'Everything we keep on the shelf, organised the way a kirana actually is.',
        action: h('a.btn.btn-ghost.btn-sm', { href: '/shop' }, 'View all', icon('arrowRight', { size: 14 })),
      }),
      CategoryRail({ categories: categories.items })));

  const dealsSection = h('section.container-page', { style: { paddingTop: 'var(--sp-4)', paddingBottom: 'var(--sp-8)' } },
    h('div.shell', null,
      SectionHead({
        eyebrow: 'This week at the store', title: 'Deals & discounts',
        sub: 'Marked down from MRP while stocks last — prices update as we sell.',
        action: h('a.btn.btn-ghost.btn-sm', { href: '/deals' }, 'All deals', icon('arrowRight', { size: 14 })),
      }),
      h('div.product-grid', null, deals.items.map((p) => ProductCard({ product: p })))));

  const featuredSection = h('section.container-page', { style: { paddingTop: 'var(--sp-4)', paddingBottom: 'var(--sp-8)' } },
    h('div.shell', null,
      SectionHead({
        eyebrow: 'House favourites', title: 'What Waghai buys most',
        sub: 'The staples our regulars come in for, week after week.',
        action: h('a.btn.btn-ghost.btn-sm', { href: '/shop?sort=featured' }, 'Browse all', icon('arrowRight', { size: 14 })),
      }),
      ProductRail({ products: featured.items, title: 'Popular this week' })));

  const tickerSection = h('section.container-page', { style: { paddingTop: 'var(--sp-4)', paddingBottom: 'var(--sp-8)' } },
    h('div.shell', null, StockTicker({ products: cats.items })));

  const recently = track(recent);
  const recentSection = recently.length
    ? h('section.container-page', { style: { paddingTop: 'var(--sp-4)', paddingBottom: 'var(--sp-8)' } },
        h('div.shell', null,
          SectionHead({ title: 'Pick up where you left off' }),
          h('div.product-grid', null,
            recently.slice(0, 5).map((r) => ProductCard({
              product: { ...r, quantity: 99, stock_state: 'available', price: Math.round((r.price_rupees || 0) * 100) },
            })))))
    : null;

  return {
    title: 'Fresh groceries in Waghai',
    node: h('div', null, hero, trust, catsSection, dealsSection, featuredSection, tickerSection, recentSection),
  };
}