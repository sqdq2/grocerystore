/**
 * Reports — sales analysis, inventory valuation, hourly curve,
 * category split, top products, and exportable snapshots.
 */
import { h, render, track, signal } from '../../core/react.js';
import { api } from '../../core/api.js';
import { icon } from '../../ui/icons.js';
import { Button, Card, EmptyState, Badge } from '../../ui/components.js';
import { KPI, PanelTitle, ProgressBar, Tabs } from '../../ui/bits.js';
import { AreaChart, BarChart, DonutChart, HourChart, toSeries } from '../../ui/charts.js';
import { pageHead, consoleRow } from './lib.js';
import { rs, rsShort, num, shortDay, formatDate, titleCase, productEmoji } from '../../core/format.js';
import { navigate } from '../../core/router.js';
import { toast, can } from '../../data/store.js';

const RANGES = [
  { id: '7', label: '7 days', days: 7 },
  { id: '30', label: '30 days', days: 30 },
  { id: '90', label: '90 days', days: 90 },
];

export async function reportsPage() {
  const days = signal(30);
  const tab = signal('sales');

  async function load() {
    const from = new Date(Date.now() - (track(days) - 1) * 864e5).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    const [sales, inv] = await Promise.all([
      api.get(`/reports/sales?from=${from}&to=${to}`),
      api.get('/reports/inventory'),
    ]);
    return { sales, inv, from, to };
  }

  let data = await load();

  async function setDays(d) {
    days.value = Number(d);
    data = await load();
    renderContent();
  }

  const summary = data.sales.summary;
  const trend = toSeries(data.sales.daily);
  const best = summary.orders ? summary.revenue / summary.orders : 0;

  const paymentMix = data.sales.paymentMix.map((p) => ({
    label: titleCase(p.mode), value: p.revenue,
    color: p.mode === 'upi' ? 'var(--brand-600)' : p.mode === 'cash' ? 'var(--saffron-500)' : 'var(--info)',
  }));

  const container = render(h('div', null));

  function renderContent() {
    container.replaceChildren(render(
      tab.value === 'sales' ? salesView() : tab.value === 'inventory' ? inventoryView() : customerView()));
  }

  function salesView() {
    return h('div', null,
      h('div.kpi-grid', null,
        KPI({ label: 'Revenue', icon: 'wallet', value: `₹${Number(summary.revenue_rupees).toLocaleString('en-IN')}`,
          sub: `${summary.orders} orders`, accent: 'var(--brand-600)' }),
        KPI({ label: 'Avg order value', icon: 'receipt', value: `₹${summary.avg_order_value}`,
          sub: 'per bill', accent: 'var(--saffron-500)' }),
        KPI({ label: 'Discounts given', icon: 'percent', value: `₹${Number(summary.discount_rupees).toLocaleString('en-IN')}`,
          sub: 'manual + offers', accent: 'var(--info)' }),
        KPI({ label: 'Cancelled', icon: 'x', value: String(summary.cancelled_orders),
          sub: `of ${summary.orders + summary.cancelled_orders} bills`, accent: 'var(--danger)', invertDelta: true })),

      h('div.chart-card.mt-6', null,
        PanelTitle('Revenue over time', `${data.sales.period.from} → ${data.sales.period.to}`),
        trend.length
          ? AreaChart({ data: trend, height: 260 })
          : h('p.text-sm.text-muted', null, 'No sales in this window.')),

      h('div.grid.mt-6', { style: { gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)' } },
        h('div.chart-card', null,
          PanelTitle('Orders per day', 'Bill count'),
          BarChart({ data: data.sales.daily.map((d) => ({ label: shortDay(d.day), value: d.orders })),
            height: 220, color: 'var(--saffron-500)', format: (v) => String(Math.round(v)) })),
        h('div.chart-card', null,
          PanelTitle('Payment methods', 'Share of revenue'),
          paymentMix.length ? DonutChart({ data: paymentMix, centerLabel: 'Revenue' })
            : h('p.text-sm.text-muted', null, 'No payments recorded.'))),

      h('div.grid.mt-6', { style: { gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' } },
        h('div.chart-card', null,
          PanelTitle('Category split', 'Where the revenue comes from'),
          data.sales.byCategory.length
            ? BarChart({
                data: data.sales.byCategory.slice(0, 8).map((c) => ({ label: c.category.slice(0, 14), value: c.revenue })),
                horizontal: true, height: 240,
              })
            : h('p.text-sm.text-muted', null, 'No data.')),
        h('div.chart-card', null,
          PanelTitle('Busy hours', 'Revenue by time of day'),
          HourChart({ data: data.sales.byHour, height: 240 }))),

      h('div.chart-card.mt-6', null,
        PanelTitle('Top sellers', 'Highest revenue lines in this period'),
        data.sales.topProducts.length
          ? h('div.table-wrap', { style: { border: 'none' } },
              h('table.tbl', null,
                h('thead', null, h('tr', null,
                  h('th', { style: { width: '40px' } }, '#'),
                  h('th', null, 'Product'),
                  h('th.tbl-num', null, 'Units'),
                  h('th.tbl-num', null, 'Revenue'),
                  h('th', { style: { width: '140px' } }, 'Share'))),
                h('tbody', null,
                  data.sales.topProducts.map((p, i) => {
                    const share = summary.revenue ? (p.revenue / summary.revenue) * 100 : 0;
                    return h('tr', null,
                      h('td.text-subtle.mono', null, i + 1),
                      h('td.font-semibold', null, p.name),
                      h('td.tbl-num', null, num(p.units)),
                      h('td.tbl-num.font-bold', null, `₹${(p.revenue / 100).toLocaleString('en-IN')}`),
                      h('td', null,
                        h('div.row.gap-2', null,
                          ProgressBar({ value: share, max: 20, tone: 'var(--brand-600)', height: 6 }),
                          h('span.text-xs.mono.text-muted', null, `${share.toFixed(1)}%`))));
                  }))))
          : h('p.text-sm.text-muted', null, 'No sales in this period.')));
  }

  function inventoryView() {
    const inv = data.inv;
    return h('div', null,
      h('div.kpi-grid', null,
        KPI({ label: 'Stock at retail', icon: 'box', value: `₹${Math.round(inv.summary.retail_value / 100).toLocaleString('en-IN')}`,
          sub: `${inv.summary.skus} SKUs · ${num(inv.summary.units)} units`, accent: 'var(--brand-600)' }),
        KPI({ label: 'Stock at MRP', icon: 'tag', value: `₹${Math.round(inv.summary.mrp_value / 100).toLocaleString('en-IN')}`,
          sub: 'what it would sell at full price', accent: 'var(--info)' }),
        KPI({ label: 'Low stock', icon: 'alert', value: String(inv.summary.low_stock),
          sub: 'at or below reorder level', accent: 'var(--warning)' }),
        KPI({ label: 'Out of stock', icon: 'x', value: String(inv.summary.out_of_stock),
          sub: 'needs immediate restock', accent: 'var(--danger)', invertDelta: true })),

      h('div.chart-card.mt-6', null,
        PanelTitle('Value by category', 'Where the money is sitting on the shelves'),
        BarChart({
          data: inv.byCategory.map((c) => ({ label: c.category.slice(0, 14), value: c.value })),
          horizontal: true, height: 280,
        })),

      h('div.grid.mt-6', { style: { gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' } },
        h('div.chart-card', null,
          PanelTitle('Highest value lines', 'Biggest stock investments'),
          h('div.table-wrap', { style: { border: 'none' } },
            h('table.tbl', null,
              h('thead', null, h('tr', null,
                h('th', null, 'Product'), h('th', null, 'Category'),
                h('th.tbl-num', null, 'Qty'), h('th.tbl-num', null, 'Value'))),
              h('tbody', null, inv.topValue.map((p) => h('tr', null,
                h('td.font-semibold', null, p.name),
                h('td.text-sm.text-muted', null, p.category),
                h('td.tbl-num', null, String(p.quantity)),
                h('td.tbl-num.font-bold', null, `₹${(p.value / 100).toLocaleString('en-IN')}`))))))),
        h('div.chart-card', null,
          PanelTitle('Reorder now', 'At or below the reorder level'),
          inv.lowStock.length
            ? h('div.col.gap-2', null,
                inv.lowStock.slice(0, 12).map((p) => h('div.alert-row', {
                  class: p.stock_state === 'out_of_stock' ? 'alert-row sev-critical' : 'alert-row sev-warning',
                },
                  h('span.alert-icon', null, icon(p.stock_state === 'out_of_stock' ? 'alert' : 'bell', { size: 15 })),
                  h('div.grow', null,
                    h('div.text-sm.font-semibold', null, p.name),
                    h('div.text-xs.text-muted', null,
                      `${p.quantity} on hand · reorder at ${p.reorder_level} · ${p.supplier_name || 'no supplier'}`)),
                  h('a.btn.btn-sm.btn-subtle', { href: '/admin/inventory' }, 'Stock'))))
            : EmptyState({ icon: 'checkCircle', title: 'All stocked up', text: 'Nothing needs reordering.' }))));
  }

  function customerView() {
    // lazily fetched
    const host = h('div', null, h('div.page-loader', null, h('span.spinner')));
    api.get('/reports/customers').then((res) => {
      host.replaceChildren(
        h('div.kpi-grid', null,
          KPI({ label: 'Registered customers', icon: 'users', value: String(res.stats.total), accent: 'var(--brand-600)' }),
          KPI({ label: 'New this month', icon: 'user', value: String(res.stats.new_this_month), accent: 'var(--saffron-500)' }),
          KPI({ label: 'Avg lifetime value', icon: 'wallet', value: `₹${res.stats.avg_lifetime_rupees}`, accent: 'var(--info)' })),
        h('div.chart-card.mt-6', null,
          PanelTitle('Customers by lifetime spend', 'Your best customers first'),
          BarChart({
            data: res.customers.slice(0, 12).map((c) => ({ label: c.name.split(' ')[0], value: c.total_spent })),
            horizontal: true, height: 260,
          })));
    });
    return host;
  }

  async function saveReport() {
    try {
      const res = await api.post('/reports/save', { type: tab.value, period: data.sales.period.to });
      toast('success', 'Report snapshot saved', `${titleCase(tab.value)} report archived.`);
    } catch (e) { toast('error', 'Could not save', e.message); }
  }

  async function exportCsv() {
    const rows = tab.value === 'inventory'
      ? [['Product', 'SKU', 'Quantity', 'Reorder level', 'Status', 'Stock value (paise)'],
         ...data.inv.byCategory.flatMap((c) => [[c.category, '', '', '', '', String(c.value)]])]
      : [['Date', 'Orders', 'Revenue (paise)'],
         ...data.sales.daily.map((d) => [d.day, d.orders, d.revenue])];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `bijasan-${tab.value}-report-${data.sales.period.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('success', 'Exported', a.download);
  }

  renderContent();

  return {
    title: 'Reports',
    node: h('div', null,
      pageHead({
        title: 'Reports',
        sub: 'Live figures straight from the database — filter, compare and export.',
        actions: [
          h('div.chips', null,
            RANGES.map((r) => h('button.chip', {
              class: track(days) === r.days ? 'active' : '',
              onclick: async () => { await setDays(r.days); },
            }, r.label))),
          Button({ variant: 'subtle', onclick: saveReport }, icon('database', { size: 15 }), 'Save snapshot'),
          Button({ variant: 'primary', onclick: exportCsv }, icon('download', { size: 15 }), 'Export CSV'),
        ],
      }),

      h('div.tabs.mb-6', null,
        [['sales', 'Sales analysis'], ['inventory', 'Inventory valuation'], ['customers', 'Customers']]
          .map(([id, label]) => h('button.tab', {
            class: track(tab) === id ? 'active' : '',
            onclick: () => { tab.value = id; renderContent(); },
          }, label))),

      container),
  };
}