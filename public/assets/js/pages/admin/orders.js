/**
 * Orders queue — filter, inspect, advance the fulfilment lifecycle.
 */
import { h, track, signal } from '../../core/react.js';
import { api } from '../../core/api.js';
import { icon } from '../../ui/icons.js';
import { Button, Card, EmptyState, Badge, openModal, LoadingButton, SearchInput } from '../../ui/components.js';
import { statusBadge, Avatar } from '../../ui/bits.js';
import { openInvoice } from '../invoice.js';
import { pageHead } from './lib.js';
import { rs, formatDateTime, relativeTime, titleCase, productEmoji, PAYMENT_META } from '../../core/format.js';
import { navigate } from '../../core/router.js';
import { toast, can } from '../../data/store.js';

const FLOW = {
  pending:          ['confirmed', 'cancelled'],
  confirmed:        ['packed', 'cancelled'],
  packed:           ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered'],
  delivered:        [],
  cancelled:        [],
};
const NEXT_LABEL = {
  confirmed: 'Confirm order', packed: 'Mark packed',
  out_for_delivery: 'Out for delivery', delivered: 'Mark delivered',
  cancelled: 'Cancel order',
};

export async function ordersPage({ query }) {
  const status = signal(query.get('status') || '');
  const searchQ = signal(query.get('q') || '');
  const page = signal(Number(query.get('page') || 1));
  const busyId = signal(null);

  const data = await api.get(
    `/orders${qs({ status: track(status), q: track(searchQ), page: track(page), per_page: 20 })}`);

  async function advance(order, next) {
    busyId.value = order.id;
    try {
      const updated = await api.post(`/orders/${order.id}/status`, { status: next });
      api.clearCache();
      toast('success', `${order.order_no} → ${titleCase(next)}`,
        next === 'cancelled' ? 'Stock was returned to the shelf.' : 'Order updated.');
      openOrderDetail(updated.id);
      navigate(`/admin/orders${qs({ status: track(status), q: track(searchQ), page: track(page) })}`);
    } catch (e) {
      toast('error', 'Could not update', e.message);
    } finally { busyId.value = null; }
  }

  async function openOrderDetail(id) {
    let order;
    try { order = await api.get(`/orders/${id}`); }
    catch (e) { return toast('error', 'Could not load order', e.message); }

    const nexts = FLOW[order.status] || [];
    const canAct = can('orders:write');

    const m = openModal({
      title: order.order_no,
      size: 'lg',
      body: h('div', null,
        h('div.row-between.wrap.gap-3.mb-4', null,
          h('div.row.gap-2', null, statusBadge(order.status),
            h('span.badge', null, `${PAYMENT_META[order.payment_mode]?.emoji} ${titleCase(order.payment_mode)}`),
            h('span.badge', { class: order.payment_status === 'paid' ? 'badge-success' : 'badge-warning' },
              order.payment_status)),
          h('div.text-right', null,
            h('div.text-xs.text-muted', null, 'Total'),
            h('div.mono.text-lg.font-bold', null, `₹${order.totals_rupees.total}`))),

        h('div.grid.mb-4', { style: { gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))' } },
          [['Customer', order.customer_name || 'Walk-in'],
           ['Phone', order.customer_phone || '—'],
           ['Cashier', order.cashier_name || '—'],
           ['Placed', formatDateTime(order.created_at)],
           ['Invoice', order.invoice_no || 'Not issued'],
           ['Items', String(order.items.length)]].map(([k, v]) =>
            h('div.spec', null, h('div.spec-label', null, k), h('div.spec-value', null, String(v))))),

        order.address ? h('div.mb-4', null,
          h('div.text-xs.text-muted.uppercase.mb-1', { style: { letterSpacing: '0.07em' } }, 'Address'),
          h('p.text-sm', null, order.address)) : null,
        order.note ? h('div.mb-4', null,
          h('div.text-xs.text-muted.uppercase.mb-1', { style: { letterSpacing: '0.07em' } }, 'Note'),
          h('p.text-sm', null, order.note)) : null,

        h('div.table-wrap', null,
          h('table.tbl', null,
            h('thead', null, h('tr', null,
              h('th', null, 'Item'), h('th.tbl-num', null, 'Rate'),
              h('th.tbl-num', null, 'Qty'), h('th.tbl-num', null, 'Amount'))),
            h('tbody', null, order.items.map((it) => h('tr', null,
              h('td', null,
                h('div.font-semibold', null, it.product_name),
                h('div.text-xs.text-muted.mono', null, it.sku)),
              h('td.tbl-num', null, `₹${(it.unit_price / 100).toFixed(2)}`),
              h('td.tbl-num', null, it.quantity),
              h('td.tbl-num.font-semibold', null, `₹${(it.line_total / 100).toFixed(2)}`)))))),

        h('div.mt-4', { style: { maxWidth: '300px', marginLeft: 'auto' } },
          h('div.summary-row', null, h('span.text-muted', null, 'Subtotal'),
            h('span.mono', null, `₹${order.totals_rupees.subtotal}`)),
          order.discount > 0
            ? h('div.summary-row', null, h('span.text-success', null, 'Discount'),
                h('span.mono.text-success', null, `− ₹${order.totals_rupees.discount}`)) : null,
          h('div.summary-row', null, h('span.text-muted', null, 'Delivery'),
            h('span.mono', null, order.delivery_fee > 0 ? `₹${order.totals_rupees.delivery_fee}` : 'Free')),
          h('div.summary-total', null, h('span', null, 'Total'),
            h('span.mono', null, `₹${order.totals_rupees.total}`))),

        nexts.length && canAct
          ? h('div', null,
            h('div.divider.mt-6.mb-4'),
            h('div.text-xs.text-muted.mb-2', { style: { letterSpacing: '0.07em' } }, 'MOVE ORDER'),
            h('div.chips', null,
              nexts.map((n) => h('button.btn', {
                class: n === 'cancelled' ? 'btn-danger btn-sm' : 'btn-primary btn-sm',
                disabled: track(busyId) === order.id,
                onclick: () => { m.close(); advance(order, n); },
              }, NEXT_LABEL[n] || titleCase(n)))))
          : nexts.length
            ? h('p.text-xs.text-muted.mt-4', null, 'Your role can view but not change order status.')
            : null),
      footer: h('div.row.gap-2', null,
        Button({ variant: 'subtle', onclick: () => { m.close(); openInvoice(order); } },
          icon('receipt', { size: 15 }), 'Invoice'),
        can('orders:write')
          ? Button({ variant: 'ghost', onclick: () => { m.close(); navigate('/admin/billing'); } },
              icon('plus', { size: 15 }), 'New bill')
          : null,
        Button({ variant: 'primary', onclick: () => m.close() }, 'Close')),
      onClose: () => api.clearCache(),
    });
  }

  const statusTabs = [['', 'All'], ['open', 'Open'], ['pending', 'Pending'], ['confirmed', 'Confirmed'],
    ['packed', 'Packed'], ['out_for_delivery', 'Out for delivery'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled']];

  return {
    title: 'Orders',
    node: h('div', null,
      pageHead({
        title: 'Orders',
        sub: `${data.total} orders · click any row for the full bill and fulfilment actions`,
        actions: can('orders:write')
          ? Button({ variant: 'primary', onclick: () => navigate('/admin/billing') },
              icon('plus', { size: 15 }), 'New bill')
          : null,
      }),

      h('div.card.card-pad.mb-4', null,
        h('div.row.gap-3.wrap', null,
          SearchInput({
            value: track(searchQ), placeholder: 'Search order no, customer, phone…',
            onInput: (v) => {
              searchQ.value = v;
              clearTimeout(searchQ._t);
              searchQ._t = setTimeout(() => navigate(`/admin/orders${qs({ status: track(status), q: v })}`), 320);
            },
          }),
          h('div.chips', null,
            statusTabs.map(([v, l]) => h('button.chip', {
              class: track(status) === v ? 'active' : '',
              onclick: () => navigate(`/admin/orders${qs({ status: v, q: track(searchQ) })}`),
            }, l))))),

      data.items.length
        ? h('div.table-wrap', null,
            h('table.tbl', null,
              h('thead', null, h('tr', null,
                h('th', null, 'Order'), h('th', null, 'Customer'),
                h('th', null, 'Items'), h('th', null, 'Placed'),
                h('th', null, 'Status'), h('th', null, 'Payment'),
                h('th.tbl-num', null, 'Total'), h('th', { style: { width: '40px' } }))),
              h('tbody', null,
                data.items.map((o) => h('tr', {
                  style: { cursor: 'pointer' },
                  onclick: () => openOrderDetail(o.id),
                },
                  h('td', null,
                    h('div.mono.font-semibold', null, o.order_no),
                    o.invoice_no ? h('div.text-xs.text-subtle.mono', null, o.invoice_no) : null),
                  h('td', null,
                    h('div.row.gap-2', null,
                      o.customer_name ? Avatar({ name: o.customer_name }) : null,
                      h('div', null,
                        h('div.text-sm.font-semibold', null, o.customer_name || 'Walk-in'),
                        h('div.text-xs.text-muted', null, o.customer_phone || 'Counter sale')))),
                  h('td.text-sm.text-muted', null, String(o.item_count)),
                  h('td.text-sm.text-muted', null, h('span', { title: formatDateTime(o.created_at) }, relativeTime(o.created_at))),
                  h('td', null, statusBadge(o.status)),
                  h('td.text-sm', null,
                    h('span', null, PAYMENT_META[o.payment_mode]?.emoji, ' ', titleCase(o.payment_mode)),
                    h('div.text-xs', { class: o.payment_status === 'paid' ? 'text-success' : 'text-warning' }, o.payment_status)),
                  h('td.tbl-num.font-bold', null, `₹${o.total_rupees}`),
                  h('td', null, icon('chevronRight', { size: 15 })))))))
        : EmptyState({
            icon: 'receipt', title: 'No orders match',
            text: 'Try a different status filter or clear the search.',
            action: Button({ variant: 'primary', onclick: () => navigate('/admin/orders') }, 'Reset filters'),
          }),

      data.total_pages > 1
        ? h('div.row-between.mt-4', null,
            h('span.text-sm.text-muted', null, `Page ${data.page} of ${data.total_pages}`),
            h('div.row.gap-2', null,
              Button({ variant: 'default', size: 'sm', disabled: data.page <= 1,
                onclick: () => navigate(`/admin/orders${qs({ status: track(status), q: track(searchQ), page: data.page - 1 })}`) },
                'Previous'),
              Button({ variant: 'default', size: 'sm', disabled: data.page >= data.total_pages,
                onclick: () => navigate(`/admin/orders${qs({ status: track(status), q: track(searchQ), page: data.page + 1 })}`) },
                'Next')))
        : null),
  };
}

function qs(params) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) usp.set(k, String(v));
  const s = usp.toString();
  return s ? `?${s}` : '';
}