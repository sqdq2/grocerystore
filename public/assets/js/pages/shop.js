/**
 * Shop / catalog — search, category & price filters, sorting, pagination.
 * Filter state lives in the URL so any view is shareable.
 */
import { h, track, signal } from '../core/react.js';
import { api, qs } from '../core/api.js';
import { icon } from '../ui/icons.js';
import { Button, EmptyState, SearchInput, Skeletons } from '../ui/components.js';
import { ProductCard, accentVar } from './components-store.js';
import { Breadcrumb } from '../ui/components.js';
import { CATEGORY_EMOJI, rs } from '../core/format.js';
import { navigate } from '../core/router.js';

const SORTS = [
  { id: 'featured', label: 'Popular' },
  { id: 'price-asc', label: 'Price: low to high' },
  { id: 'price-desc', label: 'Price: high to low' },
  { id: 'discount', label: 'Biggest discount' },
  { id: 'name-asc', label: 'Name A–Z' },
  { id: 'newest', label: 'Newest first' },
];

const PRICE_BANDS = [
  { id: '0-100', label: 'Under ₹100', min: '', max: '100' },
  { id: '100-250', label: '₹100 – ₹250', min: '100', max: '250' },
  { id: '250-500', label: '₹250 – ₹500', min: '250', max: '500' },
  { id: '500-1000', label: '₹500 – ₹1000', min: '500', max: '1000' },
  { id: '1000-', label: '₹1000 and above', min: '1000', max: '' },
];

export async function shopPage({ query }) {
  const state = {
    q: query.get('q') || '',
    category: query.get('category') || '',
    sort: query.get('sort') || 'featured',
    min: query.get('min') || '',
    max: query.get('max') || '',
    inStock: query.get('in_stock') === '1',
    page: Number(query.get('page') || 1),
    brand: query.get('brand') || '',
    minDiscount: query.get('min_discount') || '',
  };

  const [data, cats, facets] = await Promise.all([
    api.get(`/products${qs({
      q: state.q, category: state.category, sort: state.sort,
      min_price: state.min, max_price: state.max,
      in_stock: state.inStock ? '1' : '', brand: state.brand,
      min_discount: state.minDiscount, page: state.page, per_page: 24,
    })}`),
    api.get('/categories'),
    api.get('/products/facets'),
  ]);

  const activeCat = cats.items.find((c) => c.slug === state.category);

  /* --- URL-driven filter updates (no full page re-render) --- */
  function update(patch, { resetPage = true } = {}) {
    const next = { ...state, ...patch };
    if (resetPage && !('page' in patch)) next.page = 1;
    navigate(`/shop${qs({
      q: next.q, category: next.category, sort: next.sort,
      min: next.min, max: next.max, in_stock: next.inStock ? '1' : '',
      brand: next.brand, min_discount: next.minDiscount, page: next.page > 1 ? next.page : '',
    })}`);
  }

  const activeChips = [];
  if (state.q) activeChips.push({ label: `“${state.q}”`, clear: () => update({ q: '' }) });
  if (activeCat) activeChips.push({ label: activeCat.name, clear: () => update({ category: '' }) });
  if (state.min || state.max) {
    activeChips.push({
      label: `${state.min ? `₹${state.min}` : '₹0'} – ${state.max ? `₹${state.max}` : 'rs∞'}`,
      clear: () => update({ min: '', max: '' }),
    });
  }
  if (state.inStock) activeChips.push({ label: 'In stock only', clear: () => update({ inStock: false }) });
  if (state.brand) activeChips.push({ label: state.brand, clear: () => update({ brand: '' }) });
  if (state.minDiscount) activeChips.push({ label: `${state.minDiscount}%+ off`, clear: () => update({ minDiscount: '' }) });

  const filters = h('aside.filters', { 'aria-label': 'Product filters' },
    h('div.row-between', null,
      h('div.row.gap-2', null, icon('filter', { size: 15 }), h('strong.text-sm', null, 'Filters')),
      activeChips.length
        ? h('button.btn.btn-ghost.btn-sm', { onclick: () => navigate('/shop') }, 'Clear all')
        : null),

    // category
    h('div', null,
      h('div.filter-group-title', null, 'Category'),
      h('div.filter-list', null,
        h('button.filter-item', {
          class: !state.category ? 'active' : '',
          onclick: () => update({ category: '' }),
        }, h('span.dot', { style: { background: 'var(--text-subtle)' } }), 'All products',
          h('span.filter-count', null, facets.brands.reduce((s) => s, 0) || '')),
        cats.items.map((c) => h('button.filter-item', {
          class: state.category === c.slug ? 'active' : '',
          onclick: () => update({ category: c.slug }),
        },
          h('span.dot', { style: { background: accentVar(c.accent) } }),
          c.name,
          h('span.filter-count', null, c.product_count))))),

    // price
    h('div', null,
      h('div.filter-group-title', null, 'Price range'),
      h('div.col.gap-1', null,
        PRICE_BANDS.map((b) => {
          const active = state.min === b.min && state.max === b.max;
          return h('button.filter-item', {
            class: active ? 'active' : '',
            onclick: () => update(active ? { min: '', max: '' } : { min: b.min, max: b.max }),
          }, b.label);
        }))),

    // brand
    h('div', null,
      h('div.filter-group-title', null, 'Brand'),
      h('div.filter-list', null,
        facets.brands.slice(0, 12).map((b) => h('button.filter-item', {
          class: state.brand === b.name ? 'active' : '',
          onclick: () => update({ brand: state.brand === b.name ? '' : b.name }),
        }, b.name, h('span.filter-count', null, b.count))))),

    // toggles
    h('div.divider'),
    h('label.checkbox', null,
      h('input', {
        type: 'checkbox', checked: state.inStock,
        onchange: (e) => update({ inStock: e.target.checked }),
      }),
      'In stock only'),
    h('label.checkbox', null,
      h('input', {
        type: 'checkbox', checked: Boolean(state.minDiscount),
        onchange: (e) => update({ minDiscount: e.target.checked ? '10' : '' }),
      }),
      'On offer (10%+ off)'));

  const grid = data.items.length
    ? h('div.product-grid', null, data.items.map((p) => ProductCard({ product: p })))
    : EmptyState({
        icon: 'search', title: 'Nothing matches those filters',
        text: 'Try a broader price range, clear the search, or browse a different aisle.',
        action: Button({ variant: 'primary', onclick: () => navigate('/shop') }, 'Reset filters'),
      });

  const pager = data.total_pages > 1
    ? h('div.row-between.mt-8.wrap', { style: { gap: 'var(--sp-3)' } },
        h('span.text-sm.text-muted', null,
          `Showing ${(data.page - 1) * data.per_page + 1}–${Math.min(data.page * data.per_page, data.total)} of ${data.total} products`),
        h('div.row.gap-2', null,
          h('button.btn.btn-sm', {
            disabled: data.page <= 1,
            onclick: () => update({ page: data.page - 1 }, { resetPage: false }),
          }, icon('chevronLeft', { size: 14 }), 'Previous'),
          h('span.text-sm.text-muted.mono', null, `Page ${data.page} / ${data.total_pages}`),
          h('button.btn.btn-sm', {
            disabled: data.page >= data.total_pages,
            onclick: () => update({ page: data.page + 1 }, { resetPage: false }),
          }, 'Next', icon('chevronRight', { size: 14 }))))
    : h('p.text-sm.text-muted.mt-8', null, `${data.total} product${data.total === 1 ? '' : 's'}`);

  const sortSelect = h('select.select', {
    'aria-label': 'Sort products',
    value: state.sort,
    onchange: (e) => update({ sort: e.target.value }),
    style: { width: 'auto', minWidth: '190px' },
  }, SORTS.map((s) => h('option', { value: s.id, selected: s.id === state.sort }, s.label)));

  const toolbar = h('div.shop-toolbar', null,
    SearchInput({ value: state.q, placeholder: 'Search atta, dal, soap…', onInput: (v) => update({ q: v }) }),
    h('div', { style: { marginLeft: 'auto' } }, sortSelect));

  const chips = activeChips.length
    ? h('div.chips.mb-4', null, activeChips.map((c) =>
        h('span.chip.active', null, c.label,
          h('button.chip-remove', { onclick: c.clear, 'aria-label': `Remove ${c.label}` }, '×'))))
    : null;

  const results = h('div', null, toolbar, chips, grid, pager);

  const crumbs = h('nav.breadcrumb', { 'aria-label': 'Breadcrumb' },
    h('a', { href: '/' }, 'Home'), h('span.sep', null, '/'), h('span', null, 'Shop'),
    activeCat ? h('span.sep', null, '/') : null,
    activeCat ? h('span', { style: { color: 'var(--text)' } }, activeCat.name) : null);

  const heading = h('div.page-head', { style: { marginTop: 'var(--sp-4)' } },
    h('div', null,
      h('h1.page-title', null,
        activeCat
          ? h('span.row.gap-3', null,
              h('span', null, CATEGORY_EMOJI[activeCat.slug] || '🛍️'),
              activeCat.name)
          : state.q ? `Results for “${state.q}”` : 'Everything in the shop'),
      h('p.page-sub', null,
        activeCat?.description ||
        `${data.total} product${data.total === 1 ? '' : 's'} across ${cats.items.length} aisles · prices include GST`)));

  const layout = h('div.shop-layout', null, filters, results);

  return {
    title: activeCat ? activeCat.name : state.q ? `Search: ${state.q}` : 'Shop all products',
    node: h('div.container-page', null, h('div.shell', null, crumbs, heading, layout)),
  };
}

/* ------------------------------------------------------------- deals --- */
export async function dealsPage({ query }) {
  const [data, cats] = await Promise.all([
    api.get(`/products${qs({ min_discount: 10, per_page: 60, sort: 'discount', in_stock: '1' })}`),
    api.get('/categories'),
  ]);

  return {
    title: 'Deals & discounts',
    node: h('div.container-page', null,
      h('div.shell', null,
        Breadcrumb([{ label: 'Home', href: '/' }, { label: 'Deals' }]),
        h('div.page-head.mt-4', null,
          h('div', null,
            h('span.eyebrow', null, 'Live markdowns'),
            h('h1.page-title', null, 'Deals & discounts'),
            h('p.page-sub', null,
              `${data.items.length} products marked down from MRP. Discounts apply automatically at the till.`))),

        h('div.feature-grid.mb-8', null,
          [['gift', '5% loyalty bonus', 'Every paid bill earns points you can redeem next visit.'],
           ['truckFast', 'Free over ₹300', 'No delivery charge on baskets above ₹300 inside Waghai.'],
           ['scan', 'Scan & go', 'Show your phone number at billing — the system pulls your loyalty balance.']]
            .map(([ic, t, d]) => h('div.feature', null,
              h('div.feature-icon', null, icon(ic, { size: 18 })),
              h('div', null, h('div.feature-title', null, t), h('div.feature-text', null, d))))),

        h('div.section-head', null,
          h('h2.section-title', null, 'On offer right now'),
          h('div.row.gap-2.wrap', null,
            h('span.badge.badge-success', null, h('span.badge-dot'), 'Live from inventory'))),

        data.items.length
          ? h('div.product-grid', null, data.items.map((p) => ProductCard({ product: p })))
          : EmptyState({ icon: 'tag', title: 'No offers running', text: 'Check back tomorrow — the owner marks down fresh stock every morning.' }))),
  };
}