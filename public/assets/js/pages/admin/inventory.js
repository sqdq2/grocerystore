/**
 * Inventory — searchable stock table, goods receipt, manual adjustment,
 * product create/edit and the movement ledger.
 */
import { h, track, signal } from '../../core/react.js';
import { api } from '../../core/api.js';
import { icon } from '../../ui/icons.js';
import { Button, Card, EmptyState, Badge, openModal, LoadingButton, SearchInput } from '../../ui/components.js';
import { ProgressBar, PanelTitle } from '../../ui/bits.js';
import { pageHead, StockBadge, consoleRow } from './lib.js';
import { openProductEditor } from './products.js';
import { rs, num, formatDateTime, relativeTime, titleCase, productEmoji } from '../../core/format.js';
import { navigate } from '../../core/router.js';
import { toast, can } from '../../data/store.js';
import { refreshAlertCount } from '../../ui/console.js';

export async function inventoryPage({ query }) {
  const q = signal(query.get('q') || '');
  const cat = signal(query.get('category') || '');
  const onlyLow = signal(query.get('low') === '1');
  const page = signal(Number(query.get('page') || 1));

  const [cats, data] = await Promise.all([
    api.get('/categories'),
    api.get(`/inventory${qs({ q: track(q), category: track(cat), low: track(onlyLow), page: track(page) })}`),
  ]);

  const stockValue = data.items.reduce((s, p) => s + p.stock_value, 0);

  function openStockActions(product) {
    const mode = signal('receive');
    const qty = signal('');
    const note = signal('');
    const busy = signal(false);

    const preview = () => {
      const n = Number(track(qty));
      if (!Number.isFinite(n)) return null;
      if (track(mode) === 'receive') return product.quantity + n;
      return n;
    };

    async function submit() {
      const n = Number(track(qty));
      if (!Number.isFinite(n)) return toast('error', 'Enter a quantity', 'Numbers only, please.');
      if (track(mode) === 'receive' && n <= 0) return toast('error', 'Quantity must be above zero');
      if (track(mode) === 'set' && n < 0) return toast('error', 'Quantity cannot be negative');

      busy.value = true;
      try {
        const updated = await api.post(`/inventory/${product.id}/adjust`, {
          mode: track(mode),
          quantity: n,
          note: track(note) || (track(mode) === 'receive' ? 'Goods received' : 'Manual correction'),
        });
        api.clearCache();
        toast('success', 'Stock updated',
          `${product.name} is now at ${updated.quantity} (${titleCase(updated.status)}).`);
        m.close();
        refreshAlertCount();
        navigate(`/admin/inventory${qs({ q: track(q), category: track(cat), low: track(onlyLow), page: track(page) })}`);
      } catch (e) {
        toast('error', 'Could not update stock', e.message);
      } finally { busy.value = false; }
    }

    async function openLedger() {
      const res = await api.get(`/inventory/${product.id}/movements`);
      m.close();
      openModal({
        title: `Movement ledger — ${product.name}`,
        size: 'lg',
        body: h('div', null,
          h('div.row.gap-4.mb-4', null,
            h('div.spec', null, h('div.spec-label', null, 'On hand'), h('div.spec-value', null, String(product.quantity))),
            h('div.spec', null, h('div.spec-label', null, 'Reorder level'), h('div.spec-value', null, String(product.reorder_level))),
            h('div.spec', null, h('div.spec-label', null, 'SKU'), h('div.spec-value.mono', null, product.sku))),
          h('div.table-wrap', null,
            h('table.tbl', null,
              h('thead', null, h('tr', null,
                h('th', null, 'When'), h('th', null, 'Reason'), h('th', null, 'Reference'),
                h('th.tbl-num', null, 'Change'), h('th.tbl-num', null, 'Balance'), h('th', null, 'By'))),
              h('tbody', null, res.items.map((m) => h('tr', null,
                h('td.text-sm.text-muted', { title: formatDateTime(m.created_at) }, relativeTime(m.created_at)),
                h('td', null, h('span.badge', null, titleCase(m.reason))),
                h('td.text-xs.mono.text-muted', null, m.reference || '—'),
                h('td.tbl-num.font-bold', { style: { color: m.change > 0 ? 'var(--success)' : 'var(--danger)' } },
                  `${m.change > 0 ? '+' : ''}${m.change}`),
                h('td.tbl-num', null, String(m.balance_after)),
                h('td.text-sm.text-muted', null, m.user_name || 'System'))))))),
      });
    }

    const m = openModal({
      title: product.name,
      body: h('div.col.gap-4', null,
        h('div.row.gap-3', {
          style: { padding: 'var(--sp-3)', background: 'var(--bg-subtle)', borderRadius: 'var(--r-md)' },
        },
          h('div.pos-thumb', { style: { width: '3rem', height: '3rem', fontSize: '1.4rem' } }, productEmoji(product)),
          h('div.grow', null,
            h('div.font-semibold', null, `${product.quantity} units on hand`),
            h('div.text-xs.text-muted', null,
              `${product.sku} · reorder at ${product.reorder_level} · batch of ${product.reorder_quantity}`)),
          StockBadge(product)),

        h('div', null,
          h('div.filter-group-title', null, 'What are you doing?'),
          h('div.grid', { style: { gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-2)' } },
            h('button.pay-option', {
              class: track(mode) === 'receive' ? 'active' : '',
              onclick: () => { mode.value = 'receive'; },
            }, icon('truck', { size: 16 }), h('span', { style: { textAlign: 'left' } }, 'Receive stock')),
            h('button.pay-option', {
              class: track(mode) === 'set' ? 'active' : '',
              onclick: () => { mode.value = 'set'; },
            }, icon('edit', { size: 16 }), h('span', { style: { textAlign: 'left' } }, 'Set count')))),

        h('div.field', null,
          h('label.label', null,
            track(mode) === 'receive' ? 'Quantity received' : 'New on-hand count'),
          h('input.input', {
            type: 'number', min: '0', placeholder: track(mode) === 'receive' ? 'e.g. 24' : String(product.quantity),
            value: track(qty),
            oninput: (e) => { qty.value = e.target.value; refreshPreview(); },
            autofocus: true,
          }),
          h('p.text-xs.text-muted', null,
            track(mode) === 'receive'
              ? 'Added on top of what is already there (goods received note).'
              : 'Overwrite the count — use when recounting the shelf.')),

        h('div.field', null,
          h('label.label', null, 'Note / supplier reference'),
          h('input.input', {
            placeholder: track(mode) === 'receive' ? 'e.g. GRN-2041, Anand Distributors' : 'e.g. Shelf recount',
            value: track(note),
            oninput: (e) => { note.value = e.target.value; },
          })),

        track(preview()) !== null && Number.isFinite(Number(track(qty)))
          ? h('div.row.between', {
              style: {
                padding: 'var(--sp-3)', borderRadius: 'var(--r-md)',
                background: 'var(--primary-soft)', color: 'var(--primary)', fontWeight: '600',
              },
            },
              h('span', null, track(mode) === 'receive' ? 'New on-hand count' : 'After correction'),
              h('span.mono', null, String(track(preview()))))
          : null),
      footer: h('div.row.gap-2', null,
        Button({ variant: 'subtle', onclick: openLedger }, icon('list', { size: 15 }), 'Ledger'),
        Button({ variant: 'ghost', onclick: () => m.close() }, 'Cancel'),
        LoadingButton({ variant: 'primary', loading: track(busy), onclick: submit },
          track(mode) === 'receive' ? 'Receive' : 'Update')),
    });

    function refreshPreview() {
      const p = preview();
      document.querySelectorAll('.modal .field').forEach(() => {});
      api.clearCache();
      if (p !== null) {
        const el = [...document.querySelectorAll('.modal div')].find((n) =>
          n.textContent.startsWith(track(mode) === 'receive' ? 'New on-hand count' : 'After correction'));
        if (el) el.lastChild.textContent = String(p);
      }
    }
  }

  const rows = data.items;

  return {
    title: 'Inventory',
    node: h('div', null,
      pageHead({
        title: 'Inventory',
        sub: `${data.total} SKUs tracked · this page is worth ₹${(stockValue / 100).toLocaleString('en-IN')}`,
        actions: [
          Button({ variant: 'default', onclick: () => navigate('/admin/alerts') },
            icon('bell', { size: 15 }), 'Alerts'),
          can('catalog:write')
            ? Button({ variant: 'primary', onclick: async () => {
                if (await openProductEditor(null, cats.items)) {
                  navigate(`/admin/inventory${qs({ q: track(q), category: track(cat), low: track(onlyLow) })}`);
                }
              } }, icon('plus', { size: 15 }), 'Add product')
            : null,
        ],
      }),

      h('div.card.card-pad.mb-4', null,
        h('div.row.gap-3.wrap', null,
          SearchInput({
            value: track(q), placeholder: 'Search name, SKU or barcode…',
            onInput: (v) => {
              q.value = v;
              clearTimeout(q._t);
              q._t = setTimeout(() => navigate(`/admin/inventory${qs({ q: v, category: track(cat), low: track(onlyLow) })}`), 320);
            },
          }),
          h('select.select', {
            style: { width: 'auto', minWidth: '160px' },
            onchange: (e) => navigate(`/admin/inventory${qs({ q: track(q), low: track(onlyLow), category: e.target.value })}`),
          }, h('option', { value: '' }, 'All categories'),
            cats.items.map((c) => h('option', { value: c.slug, selected: c.slug === track(cat) }, c.name))),
          h('label.checkbox', null,
            h('input', {
              type: 'checkbox', checked: track(onlyLow),
              onchange: (e) => navigate(`/admin/inventory${qs({ q: track(q), category: track(cat), low: e.target.checked })}`),
            }),
            'Below reorder level'))),

      rows.length
        ? h('div.table-wrap', null,
            h('table.tbl', null,
              h('thead', null, h('tr', null,
                h('th', null, 'Product'), h('th', null, 'Category'),
                h('th.tbl-num', null, 'Price'),
                h('th.tbl-num', null, 'On hand'),
                h('th', { style: { minWidth: '120px' } }, 'Level'),
                h('th', null, 'Status'),
                h('th.tbl-num', null, 'Value'),
                h('th', { style: { width: '90px' } })))),
              h('tbody', null,
                rows.map((prod) => h('tr', null,
                  h('td', null,
                    h('div.row.gap-3', null,
                      h('div.pos-thumb', { style: { width: '2rem', height: '2rem', fontSize: '1rem' } }, productEmoji(prod)),
                      h('div', null,
                        h('a', { href: `/product/${prod.slug}`, style: { fontWeight: '600' } }, prod.name),
                        h('div.text-xs.text-subtle.mono', null, prod.sku,
                          prod.brand ? ` · ${prod.brand}` : '')))),
                  h('td.text-sm.text-muted', null, prod.category_name),
                  h('td.tbl-num', null, `₹${prod.price_rupees}`),
                  h('td.tbl-num.font-bold', null, String(prod.quantity)),
                  h('td', null,
                    ProgressBar({
                      value: prod.quantity, max: Math.max(prod.reorder_level * 3, 1),
                      tone: prod.stock_state === 'out_of_stock' ? 'var(--danger)'
                        : prod.stock_state === 'low_stock' ? 'var(--warning)' : 'var(--success)',
                      height: 6,
                    }),
                    h('div.text-xs.text-subtle.mt-1', null, `reorder ${prod.reorder_level}`)),
                  h('td', null, StockBadge(prod)),
                  h('td.tbl-num', null, `₹${(prod.stock_value / 100).toLocaleString('en-IN')}`),
                  h('td', null,
                    h('div.row.gap-1', null,
                      can('inventory:write')
                        ? h('button.icon-btn', {
                            onclick: () => openStockActions(prod),
                            'aria-label': `Update stock for ${prod.name}`, title: 'Receive / adjust',
                            style: { width: '1.8rem', height: '1.8rem' },
                          }, icon('edit', { size: 14 }))
                        : null,
                      can('catalog:write')
                        ? h('button.icon-btn', {
                            onclick: async () => {
                              if (await openProductEditor(prod, cats.items)) {
                                navigate(`/admin/inventory${qs({ q: track(q), category: track(cat), low: track(onlyLow) })}`);
                              }
                            },
                            'aria-label': `Edit ${prod.name}`, title: 'Edit product',
                            style: { width: '1.8rem', height: '1.8rem' },
                          }, icon('settings', { size: 14 }))
                        : null))))))
        : EmptyState({
            icon: 'box', title: 'Nothing matches',
            text: 'Try a different search term or clear the category filter.',
            action: Button({ variant: 'primary', onclick: () => navigate('/admin/inventory') }, 'Reset'),
          }),

      data.total_pages > 1
        ? h('div.row-between.mt-4', null,
            h('span.text-sm.text-muted', null, `Page ${data.page} of ${data.total_pages} · ${data.total} SKUs`),
            h('div.row.gap-2', null,
              Button({ variant: 'default', size: 'sm', disabled: data.page <= 1,
                onclick: () => navigate(`/admin/inventory${qs({ q: track(q), category: track(cat), low: track(onlyLow), page: data.page - 1 })}`) }, 'Previous'),
              Button({ variant: 'default', size: 'sm', disabled: data.page >= data.total_pages,
                onclick: () => navigate(`/admin/inventory${qs({ q: track(q), category: track(cat), low: track(onlyLow), page: data.page + 1 })}`) }, 'Next')))
        : null),
  };
}

/* ------------------------------------------------------------- alerts --- */
export async function alertsPage() {
  const [res, low] = await Promise.all([
    api.get('/alerts'),
    api.get('/inventory/low-stock'),
  ]);

  async function markAllRead() {
    await api.post('/alerts/read', {});
    api.clearCache();
    toast('success', 'Alerts cleared', 'Everything is marked as read.');
    refreshAlertCount();
    navigate('/admin/alerts');
  }

  const critical = res.items.filter((a) => a.severity === 'critical').length;
  const warning = res.items.filter((a) => a.severity === 'warning').length;

  return {
    title: 'Alerts',
    node: h('div', null,
      pageHead({
        title: 'Stock alerts',
        sub: `${res.unread} unread · the system raises these automatically as quantities cross the reorder level`,
        actions: [
          Button({ variant: 'subtle', onclick: () => navigate('/admin/inventory?low=1') },
            icon('box', { size: 15 }), 'Open low stock'),
          res.unread
            ? Button({ variant: 'default', onclick: markAllRead }, icon('check', { size: 15 }), 'Mark all read')
            : null,
        ],
      }),

      h('div.kpi-grid.mb-6', null,
        h('div.kpi', { style: { '--kpi-accent': 'var(--danger)' } },
          h('div.kpi-label', null, icon('alert', { size: 13 }), 'Out of stock'),
          h('div.kpi-value', null, String(critical))),
        h('div.kpi', { style: { '--kpi-accent': 'var(--warning)' } },
          h('div.kpi-label', null, icon('bell', { size: 13 }), 'Low stock'),
          h('div.kpi-value', null, String(warning))),
        h('div.kpi', { style: { '--kpi-accent': 'var(--success)' } },
          h('div.kpi-label', null, icon('checkCircle', { size: 13 }), 'Healthy SKUs'),
          h('div.kpi-value', null, String(low.items.length ? '—' : '0')))),

      res.items.length
        ? h('div.col.gap-2', null,
            res.items.map((a) => h('div.alert-row', { class: `alert-row sev-${a.severity}` },
              h('span.alert-icon', { class: a.severity === 'info' ? 'info' : '' },
                icon(a.type === 'out_of_stock' ? 'alert' : a.type === 'restocked' ? 'truck' : 'bell', { size: 17 })),
              h('div.grow', null,
                h('div.row.gap-2.wrap', null,
                  h('span.text-sm.font-semibold', null, a.product_name || titleCase(a.type)),
                  a.is_read ? null : h('span.badge.badge-brand', null, 'new'),
                  a.category_name ? h('span.badge', null, a.category_name) : null),
                h('div.text-sm.text-muted.mt-1', null, a.message),
                h('div.text-xs.text-subtle.mt-1', null, relativeTime(a.created_at))),
              a.product_id
                ? h('a.btn.btn-sm.btn-subtle', { href: `/product/${a.sku}` }, 'View')
                : null)))
        : EmptyState({
            icon: 'checkCircle', title: 'Everything is stocked',
            text: 'No product is below its reorder level. Alerts appear here the moment that changes.',
          })),
  };
}

function qs(params) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) usp.set(k, String(v));
  const s = usp.toString();
  return s ? `?${s}` : '';
}