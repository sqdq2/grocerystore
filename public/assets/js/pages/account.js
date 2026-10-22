/**
 * Customer account — profile, loyalty ledger, order history and favourites.
 */
import { h, track, signal } from '../core/react.js';
import { api } from '../core/api.js';
import { icon } from '../ui/icons.js';
import { Button, Card, Breadcrumb, EmptyState, Badge, Tabs, openModal, LoadingButton } from '../ui/components.js';
import { ProductCard } from './components-store.js';
import { openInvoice } from './invoice.js';
import { statusBadge, Avatar, KPI } from '../ui/bits.js';
import { user, logout, favourites, isFav, toggleFav, toast, recent } from '../data/store.js';
import { productEmoji } from '../core/format.js';
import { rs, formatDate, relativeTime, titleCase } from '../core/format.js';
import { navigate } from '../core/router.js';

export async function accountPage() {
  const me = track(user);
  if (!me) { navigate('/login', { replace: true }); return { node: h('div') }; }

  if (!['admin', 'manager', 'staff'].includes(me.role)) {
    return {
      title: 'My account',
      node: h('div.container-page', null, h('div.shell', null,
        Breadcrumb([{ label: 'Home', href: '/' }, { label: 'Account' }]),
        EmptyState({
          icon: 'user', title: 'This is a staff account',
          text: 'Staff accounts manage the shop rather than shop as customers. Open the operations console instead.',
          action: Button({ variant: 'primary', onclick: () => navigate('/admin') }, 'Open console'),
        }))),
    };
  }

  // staff profile view: role, capabilities, shortcuts
  const caps = me.capabilities || [];
  const CAP_LABELS = {
    'catalog:write': 'Add & edit products', 'catalog:read': 'View catalogue',
    'inventory:write': 'Receive & adjust stock', 'orders:write': 'Create and fulfil orders',
    'orders:cancel': 'Cancel orders', 'reports:read': 'View reports and analytics',
    'users:write': 'Manage staff accounts', 'users:read': 'View staff accounts',
    'suppliers:write': 'Manage suppliers', 'customers:write': 'Manage customers',
    'settings:write': 'Change store settings', 'settings:read': 'View store settings',
  };

  return {
    title: 'My account',
    node: h('div.container-page', null,
      h('div.shell', null,
        Breadcrumb([{ label: 'Home', href: '/' }, { label: 'Account' }]),
        h('div.page-head', null,
          h('div.row.gap-4', null,
            Avatar({ name: me.name, size: 'lg' }),
            h('div', null,
              h('h1.page-title', null, me.name),
              h('p.page-sub', null,
                h('span.badge', { class: `badge-${me.role === 'admin' ? 'brand' : 'info'}` }, titleCase(me.role)),
                ' · ', me.email, me.phone ? ` · ${me.phone}` : ''))),
          h('div.row.gap-2', null,
            Button({ variant: 'default', onclick: () => navigate('/admin') },
              icon('grid', { size: 15 }), 'Operations console'),
            Button({ variant: 'ghost', onclick: () => logout().then(() => navigate('/')) },
              icon('logout', { size: 15 }), 'Sign out'))),

        h('div.grid.mt-6', { style: { gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' } },
          h('div.card.card-pad', null,
            h('h3.mb-4', null, 'Your access'),
            h('div.col.gap-2', null,
              caps.map((c) => h('div.row.gap-2.text-sm', null,
                h('span', { style: { color: 'var(--success)' } }, icon('check', { size: 14 })),
                h('span', null, CAP_LABELS[c] || c)))),
            h('div.divider.mt-4.mb-3'),
            h('div.row-between.text-sm', null, h('span.text-muted', null, 'Role'),
              h('span.badge.badge-brand', null, titleCase(me.role))),
            h('div.row-between.text-sm.mt-2', null, h('span.text-muted', null, 'Member since'),
              h('span', null, formatDate(me.created_at)))),

          h('div.card.card-pad', null,
            h('h3.mb-4', null, 'Quick actions'),
            h('div.col.gap-2', null,
              [['/admin/billing', 'receipt', 'Bill a walk-in customer'],
               ['/admin/orders', 'package', 'Open orders queue'],
               ['/admin/inventory', 'box', 'Check stock levels'],
               ['/shop', 'cart', 'Shop as a customer']].map(([href, ic, label]) =>
                h('a.btn.btn-ghost', { href, style: { justifyContent: 'flex-start' } },
                  icon(ic, { size: 15 }), label, icon('chevronRight', { size: 14 })))),
            h('div.divider.mt-4.mb-3'),
            h('div.col.gap-3', null,
              h('h4', null, 'Saved items'),
              track(favourites).length
                ? h('div.chips', null, track(favourites).map((f) =>
                    h('span.chip', null, productEmoji({ image: f.image, category_slug: f.category_slug }),
                      f.name.slice(0, 22))))
                : h('p.text-sm.text-muted', null, 'Nothing saved yet — tap the heart on any product.')))))),
  };
}

/* ------------------------------------------------------- order history --- */
export async function ordersPage({ query }) {
  const me = track(user);
  const status = signal(query.get('status') || '');
  const [data, custs] = await Promise.all([
    api.get(`/orders${status.value ? `?status=${status.value}` : ''}?per_page=50`.replace('??', '?')),
    me ? api.get('/customers?limit=300').catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
  ]);

  const selected = signal(query.get('customer') ? String(query.get('customer')) : '');
  let customerOrders = data.items;
  if (selected.value) {
    customerOrders = data.items.filter((o) => String(o.customer_id) === selected.value);
  }

  return {
    title: 'Orders',
    node: h('div.container-page', null,
      h('div.shell', null,
        Breadcrumb([{ label: 'Home', href: '/' }, { label: 'Orders' }]),
        h('div.page-head', null,
          h('div', null,
            h('h1.page-title', null, 'Order history'),
            h('p.page-sub', null, `${data.total} orders recorded at the store`))),

        h('div.card.card-pad.mb-4', null,
          h('div.row.gap-3.wrap', null,
            h('select.select', {
              style: { maxWidth: '260px' },
              onchange: (e) => navigate(`/orders${e.target.value ? `?status=${e.target.value}` : ''}`),
            }, [['', 'All statuses'], ['open', 'Open orders'], ['pending', 'Pending'],
                ['confirmed', 'Confirmed'], ['packed', 'Packed'], ['out_for_delivery', 'Out for delivery'],
                ['delivered', 'Delivered'], ['cancelled', 'Cancelled']]
              .map(([v, l]) => h('option', { value: v, selected: v === status.value }, l))),
            custs.items?.length
              ? h('select.select', {
                  style: { maxWidth: '260px' },
                  onchange: (e) => navigate(`/orders${status.value ? `?status=${status.value}&` : '?'}customer=${e.target.value}`),
                },
                  h('option', { value: '' }, 'All customers'),
                  custs.items.map((c) => h('option', { value: c.id, selected: String(c.id) === selected.value },
                    `${c.name} · ${c.orders_count} orders`)))
              : null)),

        customerOrders.length
          ? h('div.col.gap-3', null,
              customerOrders.map((o) => h('div.card.card-pad', null,
                h('div.row-between.wrap.gap-4', null,
                  h('div', null,
                    h('div.row.gap-3', null,
                      h('a', { href: `/order/${o.order_no}`, style: { fontWeight: '650', fontSize: 'var(--fs-md)' } }, o.order_no),
                      statusBadge(o.status)),
                    h('div.text-sm.text-muted.mt-1', null,
                      `${formatDate(o.created_at, { day: '2-digit', month: 'short' })} · ${o.item_count} item${o.item_count === 1 ? '' : 's'} · ${o.customer_name || 'Walk-in'}`)),
                  h('div.row.gap-4', null,
                    h('div.col', { style: { alignItems: 'flex-end' } },
                      h('span.text-xs.text-muted', null, 'Total'),
                      h('span.mono.font-bold', null, `₹${o.total_rupees}`)),
                    Button({ variant: 'subtle', size: 'sm',
                      onclick: () => api.get(`/orders/${o.order_no}`).then(openInvoice) },
                      icon('receipt', { size: 14 }), 'Invoice'))))))
          : EmptyState({ icon: 'receipt', title: 'No orders yet', text: 'Bills created at the counter will appear here.' }))),
  };
}

/* ------------------------------------------------------------ tracking --- */
export async function trackPage() {
  const input = signal('');
  const result = signal(null);
  const busy = signal(false);
  const notFound = signal(false);

  async function search(e) {
    e?.preventDefault();
    const no = input.value.trim().toUpperCase();
    if (!no) return;
    busy.value = true; notFound.value = false; result.value = null;
    try {
      result.value = await api.get(`/orders/track/${encodeURIComponent(no)}`);
    } catch {
      notFound.value = true;
    } finally { busy.value = false; }
  }

  const STEPS = ['pending', 'confirmed', 'packed', 'out_for_delivery', 'delivered'];
  const LABEL = ['Order placed', 'Confirmed by the shop', 'Packed', 'Out for delivery', 'Delivered'];

  const timeline = (order) => {
    const idx = order.status === 'cancelled' ? -1 : STEPS.indexOf(order.status);
    return h('div.timeline', null,
      STEPS.map((s, i) => h(`div.timeline-item${i <= idx ? '.done' : ''}${i === idx ? '.active' : ''}`, null,
        h('div.timeline-dot', null, i <= idx ? icon('check', { size: 11 }) : icon('clock', { size: 11 })),
        h('div', null,
          h('div.text-sm.font-semibold', null, LABEL[i]),
          h('div.text-xs.text-muted', null, i === 0 ? formatDate(order.created_at, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : (i <= idx ? 'Done' : 'Waiting'))))));
  };

  return {
    title: 'Track your order',
    node: h('div', { style: { paddingBlock: 'var(--sp-12) var(--sp-16)' } },
      h('div.shell', { style: { maxWidth: '640px' } },
        h('div.col', { style: { alignItems: 'center', textAlign: 'center', marginBottom: 'var(--sp-8)' } },
          h('span.eyebrow', null, 'Order status'),
          h('h1', { style: { fontFamily: 'var(--font-display)', marginTop: 'var(--sp-3)' } }, 'Track your order'),
          h('p.text-muted.mt-3', null,
            'Enter the order number from your bill — it looks like ', h('code.mono', null, 'BGS-2610-1042'), '.')),

        h('form.card.card-pad', { onsubmit: search },
          h('div.row.gap-2', { style: { alignItems: 'flex-end' } },
            h('div.field.grow', null,
              h('label.label', null, 'Order number'),
              h('input.input', {
                value: track(input), placeholder: 'BGS-2610-1042',
                style: { textTransform: 'uppercase', fontFamily: 'var(--font-mono)' },
                oninput: (e) => { input.value = e.target.value; },
              })),
            Button({ variant: 'primary', size: 'lg', type: 'submit', loading: track(busy) },
              icon('search', { size: 16 }), 'Track')),

          h('div.text-xs.text-muted.mt-3', null,
            'Try a recent order number: ',
            h('button', {
              style: { color: 'var(--primary)', fontWeight: '600', fontFamily: 'var(--font-mono)' },
              onclick: () => { input.value = 'BGS-2609-1001'; search(); },
            }, 'BGS-2609-1001'))),

        track(notFound)
          ? h('div.card.card-pad.mt-4', { style: { background: 'var(--danger-bg)' } },
              h('div.row.gap-3', null,
                h('span', { style: { color: 'var(--danger)' } }, icon('alert', { size: 18 })),
                h('div', null,
                  h('div.font-semibold', null, 'No order with that number'),
                  h('div.text-sm.text-muted', null, 'Check the number on your bill, or call the shop on +91 94278 05111.'))))
          : null,

        track(result)
          ? h('div.card.card-pad.mt-4', null,
              h('div.row-between.mb-4', null,
                h('div', null,
                  h('div.text-xs.text-muted.uppercase', { style: { letterSpacing: '0.07em' } }, 'Order'),
                  h('div.mono.font-bold', null, track(result).order_no)),
                statusBadge(track(result).status)),
              h('div.grid.mb-6', { style: { gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' } },
                [[track(result).item_count, 'Items'],
                 [`₹${track(result).total_rupees}`, 'Total'],
                 [track(result).payment_status, 'Payment']].map(([v, l]) =>
                  h('div.spec', null, h('div.spec-value', null, String(v)), h('div.spec-label', null, l)))),
              timeline(track(result)),
              h('div.divider.mt-4.mb-4'),
              h('a.btn.btn-subtle.btn-block', { href: `/order/${track(result).order_no}` },
                'See full details', icon('arrowRight', { size: 14 })))
          : null)),

  };
}