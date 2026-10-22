/**
 * Console dashboard — live KPIs, revenue trend, payment mix,
 * category split, low-stock alerts and the recent order feed.
 */
import { h, track, signal } from '../../core/react.js';
import { api } from '../../core/api.js';
import { icon } from '../../ui/icons.js';
import { Button, Card, EmptyState, Badge } from '../../ui/components.js';
import { KPI, statusBadge, PanelTitle, ProgressBar, Avatar } from '../../ui/bits.js';
import { AreaChart, BarChart, DonutChart, HourChart, toSeries } from '../../ui/charts.js';
import { alertVar } from './lib.js';
import { rs, rsShort, num, shortDay, formatTime, relativeTime, productEmoji, titleCase } from '../../core/format.js';
import { navigate } from '../../core/router.js';
import { user, can } from '../../data/store.js';

export async function dashboardPage() {
  const [dash, alerts, hourData] = await Promise.all([
    api.get('/reports/dashboard?days=14'),
    api.get('/alerts?unread=1'),
    api.get('/reports/sales').catch(() => ({ byHour: [], paymentMix: [] })),
  ]);

  const d = dash;
  const up = d.today.growth_pct >= 0;
  const series = toSeries(d.series);
  const topAlert = alerts.items.slice(0, 5);

  const MODE_COLOR = { upi: 'var(--brand-600)', cash: 'var(--saffron-500)', card: 'var(--info)' };
  const payMix = (hourData.paymentMix || [])
    .map((m) => ({ label: titleCase(m.mode), value: m.revenue, color: MODE_COLOR[m.mode] }))
    .filter((x) => x.value > 0);

  return {
    title: 'Dashboard',
    node: h('div', null,
      h('div.page-head', null,
        h('div', null,
          h('h1.page-title', null, `Namaste, ${(d.user?.name || track(user)?.name || 'there').split(' ')[0]}`),
          h('p.page-sub', null,
            `${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} · here is how the shop is doing today.`)),
        h('div.row.gap-2', null,
          Button({ variant: 'default', onclick: () => navigate('/admin/orders') },
            icon('package', { size: 15 }), 'Orders'),
          can('orders:write')
            ? Button({ variant: 'primary', onclick: () => navigate('/admin/billing') },
                icon('receipt', { size: 15 }), 'New bill')
            : null)),

      /* KPI row */
      h('div.kpi-grid', null,
        KPI({
          label: "Today's revenue", icon: 'wallet',
          value: `₹${d.today.revenue_rupees}`,
          delta: d.today.growth_pct, deltaLabel: 'vs yesterday',
          accent: 'var(--brand-600)',
          sub: `${d.today.orders} orders · avg ₹${d.month.avg_basket}`,
        }),
        KPI({
          label: 'This month', icon: 'calendar',
          value: `₹${Math.round(d.month.revenue / 100).toLocaleString('en-IN')}`,
          sub: `${d.month.orders} orders billed`,
          accent: 'var(--saffron-500)',
        }),
        KPI({
          label: 'Stock value', icon: 'box',
          value: `₹${Math.round(d.inventory.value / 100).toLocaleString('en-IN')}`,
          sub: `${d.inventory.skus} SKUs · ${num(d.inventory.units)} units`,
          accent: 'var(--info)',
        }),
        KPI({
          label: 'Needs attention', icon: 'alert',
          value: d.alerts.unread,
          sub: d.alerts.critical ? `${d.alerts.critical} out of stock` : 'low-stock warnings',
          accent: d.alerts.critical ? 'var(--danger)' : 'var(--warning)',
        })),

      /* charts */
      h('div.grid.mt-6', { style: { gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)' } },
        h('div.chart-card', null,
          PanelTitle('Revenue trend', 'Last 14 days · excludes cancelled orders',
            h('div.legend', null,
              h('span.legend-item', null,
                h('span.legend-swatch', { style: { background: 'var(--brand-600)' } }), 'Revenue'))),
          AreaChart({ data: series, height: 230 })),

        h('div.chart-card', null,
          PanelTitle('Payment mix', 'Where the money comes in'),
          payMix.length
            ? DonutChart({ data: payMix, centerLabel: '14 days', format: rsShort })
            : h('p.text-sm.text-muted', null, 'No sales recorded yet.'))),

      h('div.grid.mt-6', { style: { gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)' } },
        h('div.chart-card', null,
          PanelTitle('When people shop', 'Orders by hour of the day',
            h('span.badge', null, 'Peak hours')),
          HourChart({ data: hourData.byHour, height: 190 })),

        h('div.chart-card', null,
          PanelTitle('Low stock', 'Reorder before the shelf empties',
            h('a.btn.btn-ghost.btn-sm', { href: '/admin/alerts' }, 'All', icon('arrowRight', { size: 13 }))),
          topAlert.length
            ? h('div.col.gap-2', null,
                topAlert.map((a) => h('a.alert-row', {
                  href: a.product_id ? `/product/${a.sku}` : '/admin/alerts',
                  class: `alert-row sev-${a.severity}`,
                  style: { textDecoration: 'none' },
                },
                  h('span.alert-icon', null, icon(a.type === 'out_of_stock' ? 'alert' : 'bell', { size: 15 })),
                  h('div.grow', null,
                    h('div.text-sm.font-semibold.clamp-2', null, a.product_name || a.message),
                    h('div.text-xs.text-muted.clamp-2', null, a.message)))))
            : EmptyState({ icon: 'checkCircle', title: 'All stocked up', text: 'Nothing is below its reorder level.' }))),

      /* recent orders + top products */
      h('div.grid.mt-6', { style: { gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)' } },
        h('div.chart-card', null,
          PanelTitle('Recent orders', 'The last bills created at the counter',
            h('a.btn.btn-ghost.btn-sm', { href: '/admin/orders' }, 'See all', icon('arrowRight', { size: 13 }))),
          d.recent_orders.length
            ? h('div.table-wrap', { style: { border: 'none' } },
                h('table.tbl', null,
                  h('thead', null, h('tr', null,
                    h('th', null, 'Order'), h('th', null, 'Customer'),
                    h('th', null, 'When'), h('th', null, 'Status'),
                    h('th', null, 'Payment'), h('th.tbl-num', null, 'Total'))),
                  h('tbody', null,
                    d.recent_orders.map((o) => h('tr', null,
                      h('td', null, h('a.mono.text-sm', { href: `/admin/orders?q=${o.order_no}` }, o.order_no)),
                      h('td.text-sm', null, o.customer_name || 'Walk-in'),
                      h('td.text-sm.text-muted', null, relativeTime(o.created_at)),
                      h('td', null, statusBadge(o.status)),
                      h('td.text-sm', null, titleCase(o.payment_mode)),
                      h('td.tbl-num.font-semibold', null, `₹${o.total_rupees}`))))))
            : EmptyState({ icon: 'receipt', title: 'No orders yet', text: 'Bills will appear here as they are created.' })),

        h('div.chart-card', null,
          PanelTitle('Counter favourites', 'Most billed this week',
            h('a.btn.btn-ghost.btn-sm', { href: '/shop' }, 'Storefront', icon('arrowRight', { size: 13 }))),
          h('div.col.gap-3', null,
            d.top_products.map((p, i) => h('div.row.gap-3', null,
              h('span.text-xs.mono.text-subtle', { style: { width: '1.2rem' } }, `#${i + 1}`),
              h('div', { style: { fontSize: '1.25rem', flex: 'none' } }, productEmoji(p)),
              h('div.grow', null,
                h('div.text-sm.font-semibold.truncate', null, p.name),
                h('div.text-xs.text-muted', null, p.pack_size || p.category_name)),
              h('span.mono.text-sm.font-semibold', null, `₹${p.price_rupees}`)))))),

      /* bottom: pipeline + inventory health */
      h('div.grid.mt-6', { style: { gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' } },
        h('div.chart-card', null,
          PanelTitle('Inventory health', 'Where the stock sits right now'),
          h('div.col.gap-4', null,
            [['Healthy', d.inventory.skus - d.inventory.low_stock - d.inventory.out_of_stock, 'var(--success)'],
             ['Low stock', d.inventory.low_stock, 'var(--warning)'],
             ['Out of stock', d.inventory.out_of_stock, 'var(--danger)']]
              .map(([label, val, color]) => h('div', null,
                h('div.row-between.mb-2', null,
                  h('span.text-sm', null, label),
                  h('span.mono.text-sm.font-semibold', null, val)),
                ProgressBar({ value: val, max: Math.max(d.inventory.skus, 1), tone: color, height: 8 })))),
          h('div.divider.mt-4.mb-3'),
          h('div.row-between', null,
            h('span.text-sm.text-muted', null, 'Open orders to fulfil'),
            h('a.btn.btn-sm.btn-primary', { href: '/admin/orders?status=open' },
              `${d.pending_orders} orders`, icon('arrowRight', { size: 13 }))))),

        h('div.chart-card', null,
          PanelTitle('Shop at a glance', 'Since you asked'),
          h('div.grid', { style: { gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-3)' } },
            [['Customers', d.customers, 'users'],
             ['Stock units', num(d.inventory.units), 'box'],
             ['Alerts open', d.alerts.unread, 'bell'],
             ['Catalog SKUs', d.inventory.skus, 'layers']].map(([label, val, ic]) =>
              h('div.spec', null,
                h('div.row.gap-2', { style: { color: 'var(--text-muted)' } },
                  icon(ic, { size: 13 }), h('span.spec-label', null, label)),
                h('div.spec-value.text-xl', null, String(val))))))),
  };
}