/**
 * Suppliers, customers and staff/role management.
 */
import { h, track, signal } from '../../core/react.js';
import { api } from '../../core/api.js';
import { icon } from '../../ui/icons.js';
import { Button, Card, EmptyState, openModal, LoadingButton, SearchInput, Badge } from '../../ui/components.js';
import { Avatar, KPI, statusBadge } from '../../ui/bits.js';
import { pageHead, consoleRow } from './lib.js';
import { rs, num, formatDate, relativeTime, titleCase } from '../../core/format.js';
import { navigate } from '../../core/router.js';
import { toast, can } from '../../data/store.js';

const rupee = (paise) => `₹${(Number(paise || 0) / 100).toLocaleString('en-IN')}`;

/* ================================================================ suppliers == */
export async function suppliersPage() {
  const [data, products] = await Promise.all([
    api.get('/suppliers'),
    api.get('/products?per_page=60&sort=name-asc'),
  ]);

  // roll per-product stock value up so each supplier can be ranked
  const bySupplier = data.items.map((s) => ({
    ...s,
    stock_value: products.items
      .filter((p) => p.supplier_name === s.name)
      .reduce((sum, p) => sum + p.stock_value, 0),
  }));
  const totalValue = bySupplier.reduce((sum, s) => sum + s.stock_value, 0);

  const table = h('div.table-wrap', null,
    h('table.tbl', null,
      h('thead', null,
        h('tr', null,
          h('th', null, 'Supplier'),
          h('th', null, 'Contact'),
          h('th', null, 'GSTIN'),
          h('th.tbl-num', null, 'Products'),
          h('th.tbl-num', null, 'Low / out'),
          h('th.tbl-num', null, 'Lead time'),
          h('th.tbl-num', null, 'Stock value'))),
      h('tbody', null, bySupplier.map(supplierRow))));

  const bars = bySupplier.map((s) => h('div', null,
    h('div.row-between.mb-2', null,
      h('span.text-sm', null, s.name),
      h('span.mono.text-sm', null, rupee(s.stock_value))),
    h('div.progress-track', null,
      h('div.progress-fill', {
        style: {
          width: `${totalValue ? (s.stock_value / totalValue) * 100 : 0}%`,
          background: 'var(--brand-600)',
        },
      }))));

  const chart = h('div.chart-card.mt-6', null,
    h('div.chart-title.mb-4', null, 'Stock value by supplier'),
    h('div.col.gap-3', null, bars));

  return {
    title: 'Suppliers',
    node: h('div', null,
      pageHead({
        title: 'Suppliers',
        sub: `${data.items.length} suppliers · ${products.total} products trace back to them`,
        actions: Button({ variant: 'default', onclick: () => navigate('/admin/inventory') },
          icon('box', { size: 15 }), 'Stock'),
      }),
      table,
      chart),
  };
}

function supplierRow(s) {
  const identity = h('div', null,
    h('div.row.gap-3', null,
      h('div.pos-thumb', { style: { width: '2.25rem', height: '2.25rem', fontSize: '1.05rem' } }, '🚚'),
      h('div', null,
        h('div.font-semibold', null, s.name),
        h('div.text-xs.text-muted', null, s.address || '—'))));

  const counts = h('td.tbl-num', null,
    h('span', { class: s.out_count ? 'text-danger font-semibold' : '' }, String(s.out_count)),
    ' / ',
    h('span', { class: s.low_count ? 'text-warning font-semibold' : '' }, String(s.low_count)));

  return h('tr', null,
    h('td', null, identity),
    h('td', null,
      h('div.text-sm', null, s.contact || '—'),
      h('div.text-xs.text-muted.mono', null, s.phone || '')),
    h('td.mono.text-xs', null, s.gst_number || '—'),
    h('td.tbl-num', null, String(s.product_count)),
    counts,
    h('td.tbl-num', null, `${s.lead_time_days}d`),
    h('td.tbl-num.font-bold', null, rupee(s.stock_value)));
}

/* ================================================================ customers == */
export async function customersPage({ query }) {
  const search = signal(query.get('q') || '');
  const [data, report] = await Promise.all([
    api.get(`/customers?q=${encodeURIComponent(track(search))}`),
    api.get('/reports/customers').catch(() => null),
  ]);

  function openCustomer(c) {
    const points = signal('');
    const reason = signal('Manual adjustment');

    async function adjust() {
      const n = Number(track(points));
      if (!Number.isFinite(n) || n === 0) return toast('error', 'Enter a non-zero number');
      try {
        await api.post(`/customers/${c.id}/loyalty`, { points: n, reason: track(reason) });
        api.clearCache();
        toast('success', 'Loyalty updated', `${n > 0 ? '+' : ''}${n} points for ${c.name}`);
        m.close();
        navigate('/admin/customers');
      } catch (e) {
        toast('error', 'Could not update', e.message);
      }
    }

    const facts = [['Phone', c.phone], ['Email', c.email || '—'], ['Town', c.city || '—'],
      ['Orders', String(c.orders_count)], ['Lifetime', rs(c.total_spent_rupees)],
      ['Loyalty', `${c.loyalty_points} pts`]].map(([k, v]) =>
      h('div.spec', null, h('div.spec-label', null, k), h('div.spec-value', null, v)));

    const history = c.orders.length
      ? h('div', null,
          h('div.text-xs.text-muted.uppercase.mb-2', { style: { letterSpacing: '0.07em' } }, 'Purchase history'),
          h('div.table-wrap', null,
            h('table.tbl', null,
              h('thead', null, h('tr', null,
                h('th', null, 'Order'), h('th', null, 'When'),
                h('th', null, 'Status'), h('th.tbl-num', null, 'Total'))),
              h('tbody', null, c.orders.map((o) => h('tr', null,
                h('td.mono.text-sm', null, o.order_no),
                h('td.text-sm.text-muted', null, formatDate(o.created_at)),
                h('td', null, statusBadge(o.status)),
                h('td.tbl-num.font-semibold', null, `₹${(o.total / 100).toFixed(2)}`)))))))
      : h('p.text-sm.text-muted', null, 'No orders yet.');

    const favourites = c.favourites?.length
      ? h('div', null,
          h('div.text-xs.text-muted.uppercase.mb-2', { style: { letterSpacing: '0.07em' } }, 'Buys most often'),
          h('div.chips', null, c.favourites.map((f) =>
            h('span.chip', null, `${f.product_name} · ${f.times_bought}×`))))
      : null;

    const loyalty = can('customers:write')
      ? h('div', null,
          h('div.divider'),
          h('div.text-xs.text-muted.uppercase.mb-2', { style: { letterSpacing: '0.07em' } }, 'Adjust loyalty points'),
          h('div.row.gap-2.wrap', null,
            h('input.input', {
              type: 'number', placeholder: 'e.g. 50 or -20', style: { maxWidth: '140px' },
              oninput: (e) => { points.value = e.target.value; },
            }),
            h('select.select', { onchange: (e) => { reason.value = e.target.value; } },
              ['Manual adjustment', 'Bill returned', 'Promotional offer', 'Goodwill']
                .map((r) => h('option', { value: r }, r))),
            Button({ variant: 'primary', onclick: adjust }, 'Apply')))
      : null;

    const m = openModal({
      title: c.name,
      size: 'lg',
      body: h('div.col.gap-4', null,
        h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit, minmax(140px,1fr))' } }, facts),
        c.address ? h('div', null,
          h('div.text-xs.text-muted.uppercase.mb-1', { style: { letterSpacing: '0.07em' } }, 'Address'),
          h('p.text-sm', null, c.address)) : null,
        history,
        favourites,
        loyalty),
      footer: h('div.row.gap-2', null,
        Button({ variant: 'ghost', onclick: () => m.close() }, 'Close'),
        Button({ variant: 'subtle', onclick: () => { m.close(); navigate(`/orders?q=${c.phone}`); } },
          'View their orders')),
    });
  }

  const kpis = report
    ? h('div.kpi-grid.mb-6', null,
        KPI({ label: 'Registered', icon: 'users', value: String(report.stats.total), accent: 'var(--brand-600)' }),
        KPI({ label: 'New this month', icon: 'user', value: String(report.stats.new_this_month), accent: 'var(--saffron-500)' }),
        KPI({ label: 'Avg lifetime value', icon: 'wallet', value: `₹${report.stats.avg_lifetime_rupees}`, accent: 'var(--info)' }))
    : null;

  const searchBox = SearchInput({
    value: track(search), placeholder: 'Search name, phone or town…',
    onInput: (v) => {
      search.value = v;
      clearTimeout(searchBox._t);
      searchBox._t = setTimeout(() => navigate(`/admin/customers?q=${v}`), 320);
    },
  });

  const table = data.items.length
    ? h('div.table-wrap', null,
        h('table.tbl', null,
          h('thead', null, h('tr', null,
            h('th', null, 'Customer'), h('th', null, 'Contact'),
            h('th.tbl-num', null, 'Orders'),
            h('th.tbl-num', null, 'Lifetime spend'),
            h('th.tbl-num', null, 'Loyalty'),
            h('th', null, 'Last order'))),
          h('tbody', null, data.items.map((c) => h('tr', {
            style: { cursor: 'pointer' }, onclick: () => openCustomer(c),
          },
            h('td', null,
              h('div.row.gap-3', null,
                Avatar({ name: c.name }),
                h('div', null,
                  h('div.font-semibold', null, c.name),
                  h('div.text-xs.text-muted', null, c.city || '—')))),
            h('td', null,
              h('div.mono.text-sm', null, c.phone),
              c.email ? h('div.text-xs.text-muted', null, c.email) : null),
            h('td.tbl-num', null, String(c.orders_count)),
            h('td.tbl-num.font-bold', null, `₹${c.total_spent_rupees}`),
            h('td.tbl-num', null, h('span.badge.badge-brand', null, `${c.loyalty_points} pts`)),
            h('td.text-sm.text-muted', null, relativeTime(c.created_at)))))))
    : EmptyState({ icon: 'users', title: 'No customers match', text: 'Try a different search term.' });

  return {
    title: 'Customers',
    node: h('div', null,
      pageHead({ title: 'Customers', sub: 'Records, loyalty balances and purchase history', actions: searchBox }),
      kpis,
      table),
  };
}

/* ==================================================================== users == */
const ROLE_INFO = {
  admin: ['Full control', 'Everything, including staff accounts and pricing.', 'badge-brand'],
  manager: ['Operations', 'Stock, orders, reports, suppliers, customers.', 'badge-info'],
  staff: ['Counter only', 'Billing and day-to-day stock. No reports or user management.', 'badge-success'],
};

export async function usersPage() {
  const [data, me] = await Promise.all([api.get('/users'), api.get('/auth/me')]);
  const current = me.user;

  async function setRole(user, role) {
    try {
      await api.patch(`/users/${user.id}`, { role });
      api.clearCache();
      toast('success', 'Role updated', `${user.name} is now ${titleCase(role)}.`);
      navigate('/admin/users');
    } catch (e) {
      toast('error', 'Could not change role', e.message);
    }
  }

  async function toggleActive(user) {
    try {
      await api.patch(`/users/${user.id}`, { is_active: !user.is_active });
      api.clearCache();
      toast('success', user.is_active ? 'Account deactivated' : 'Account reactivated', user.name);
      navigate('/admin/users');
    } catch (e) {
      toast('error', 'Could not update', e.message);
    }
  }

  function resetPassword(user) {
    const pw = signal('');
    const busy = signal(false);

    const m = openModal({
      title: `Reset password — ${user.name}`,
      body: h('div.col.gap-3', null,
        h('div.field', null,
          h('label.label', null, 'New password'),
          h('input.input', {
            type: 'text', placeholder: 'At least 6 characters', autofocus: true,
            oninput: (e) => { pw.value = e.target.value; },
          })),
        h('p.text-xs.text-muted', null, 'Share it privately — they should change it after signing in.')),
      footer: h('div.row.gap-2', null,
        Button({ variant: 'ghost', onclick: () => m.close() }, 'Cancel'),
        LoadingButton({
          variant: 'primary', loading: track(busy),
          onclick: async () => {
            if (String(track(pw)).length < 6) return toast('error', 'Too short', 'Use at least 6 characters.');
            busy.value = true;
            try {
              await api.patch(`/users/${user.id}`, { password: track(pw) });
              toast('success', 'Password reset', `${user.name} can sign in with the new password.`);
              m.close();
              navigate('/admin/users');
            } catch (e) {
              toast('error', 'Could not reset', e.message);
              busy.value = false;
            }
          },
        }, 'Reset password')),
    });
  }

  const roleCards = h('div.grid.mb-6', { style: { gridTemplateColumns: 'repeat(auto-fit, minmax(260px,1fr))' } },
    Object.entries(ROLE_INFO).map(([role, info]) => {
      const [label, desc, tone] = info;
      const count = data.items.filter((u) => u.role === role).length;
      return h('div.card.card-pad', null,
        h('div.row-between.mb-3', null,
          h('span.badge', { class: tone }, titleCase(role)),
          h('span.text-2xl.font-bold.mono', null, String(count))),
        h('div.font-semibold', null, label),
        h('div.text-sm.text-muted.mt-1', null, desc));
    }));

  const rows = data.items.map((u) => {
    const roleCell = can('users:write')
      ? h('select.select', {
          style: { width: 'auto', minWidth: '110px' },
          disabled: u.id === current.id,
          onchange: (e) => setRole(u, e.target.value),
        }, ['admin', 'manager', 'staff'].map((r) =>
          h('option', { value: r, selected: r === u.role }, titleCase(r))))
      : h('span.badge', null, titleCase(u.role));

    const actions = can('users:write')
      ? h('div.row.gap-1', null,
          h('button.icon-btn', {
            onclick: () => resetPassword(u), title: 'Reset password',
            'aria-label': `Reset password for ${u.name}`,
            style: { width: '1.8rem', height: '1.8rem' },
          }, icon('key', { size: 14 })),
          h('button.icon-btn', {
            onclick: () => toggleActive(u),
            title: u.is_active ? 'Deactivate' : 'Reactivate',
            'aria-label': `${u.is_active ? 'Deactivate' : 'Reactivate'} ${u.name}`,
            disabled: u.id === current.id,
            style: { width: '1.8rem', height: '1.8rem', opacity: u.id === current.id ? '0.4' : '1' },
          }, icon(u.is_active ? 'x' : 'check', { size: 14 })))
      : null;

    return h('tr', null,
      h('td', null,
        h('div.row.gap-3', null,
          Avatar({ name: u.name }),
          h('div', null,
            h('div.font-semibold', null, u.name,
              u.id === current.id ? h('span.badge.badge-brand', { style: { marginLeft: '6px' } }, 'you') : null),
            h('div.text-xs.text-muted.mono', null, u.email)))),
      h('td.mono.text-sm', null, u.phone || '—'),
      h('td', null, roleCell),
      h('td', null, h('span.badge', { class: u.is_active ? 'badge-success' : 'badge-danger' },
        u.is_active ? 'Active' : 'Disabled')),
      h('td.text-sm.text-muted', null, u.last_login_at ? relativeTime(u.last_login_at) : 'Never'),
      h('td', null, actions));
  });

  const table = h('div.table-wrap', null,
    h('table.tbl', null,
      h('thead', null, h('tr', null,
        h('th', null, 'Person'), h('th', null, 'Contact'),
        h('th', null, 'Role'), h('th', null, 'Status'),
        h('th', null, 'Last sign-in'), h('th', { style: { width: '150px' } }))),
      h('tbody', null, rows)));

  const explain = h('div.card.card-pad.mt-6', null,
    h('div.row.gap-2.mb-3', null, icon('shield', { size: 16 }), h('h4', null, 'How permissions work')),
    h('p.text-sm.text-muted', null,
      'Every API route checks the signed-in user’s role before it returns data or accepts a change. ',
      'A staff member cannot reach reports, suppliers, customers or staff management — the server rejects the request even if the page is opened directly.'));

  return {
    title: 'Staff & roles',
    node: h('div', null,
      pageHead({
        title: 'Staff & roles',
        sub: 'Role-based access control — what each person can do in the system',
        actions: Button({ variant: 'default', onclick: () => navigate('/login?mode=register') },
          icon('plus', { size: 15 }), 'Add staff account'),
      }),
      roleCards,
      table,
      explain),
  };
}