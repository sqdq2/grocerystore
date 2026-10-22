/**
 * Reporting module — powers the deck's Reports use case.
 * Every figure is a live SQL aggregate; nothing is pre-baked into the UI.
 */
import { q, toRupees } from './db.js';
import { listProducts, lowStockList } from './catalog.js';
import { listOrders } from './billing.js';

const LIVE = "status <> 'cancelled'";
const isPaid = (extra = '') => `status <> 'cancelled' ${extra}`;

/* ------------------------------------------------------------ dashboard -- */
export async function dashboard(db) {
  const today = await q.get(db, `
    SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue
    FROM orders WHERE date(created_at) = date('now') AND ${LIVE}`);

  const yesterday = await q.get(db, `
    SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue
    FROM orders WHERE date(created_at) = date('now','-1 day') AND ${LIVE}`);

  const month = await q.get(db, `
    SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue
    FROM orders WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m','now') AND ${LIVE}`);

  const inventory = await q.get(db, `
    SELECT COUNT(*) AS skus,
           COALESCE(SUM(s.quantity),0) AS units,
           COALESCE(SUM(p.price * s.quantity),0) AS value,
           COALESCE(SUM(CASE WHEN s.quantity <= 0 THEN 1 ELSE 0 END),0) AS out_of_stock,
           COALESCE(SUM(CASE WHEN s.quantity > 0 AND s.quantity <= s.reorder_level THEN 1 ELSE 0 END),0) AS low_stock
    FROM products p JOIN stock s ON s.product_id = p.id
    WHERE p.status <> 'discontinued'`);

  const customers = await q.get(db, `SELECT COUNT(*) AS total FROM customers`);
  const alerts = await q.get(db, `SELECT COUNT(*) AS unread,
                                    COALESCE(SUM(severity='critical'),0) AS critical
                             FROM alerts WHERE is_read = 0`);
  const pending = await q.scalar(db, `SELECT COUNT(*) FROM orders
                                WHERE status IN ('pending','confirmed','packed','out_for_delivery')`);

  const growth = yesterday.revenue > 0
    ? ((today.revenue - yesterday.revenue) / yesterday.revenue) * 100
    : (today.revenue > 0 ? 100 : 0);

  const avgBasket = today.orders > 0 ? today.revenue / today.orders : 0;

  return {
    today: {
      orders: today.orders,
      revenue: today.revenue,
      revenue_rupees: toRupees(today.revenue),
      growth_pct: Math.round(growth * 10) / 10,
    },
    yesterday: { orders: yesterday.orders, revenue: yesterday.revenue, revenue_rupees: toRupees(yesterday.revenue) },
    month: {
      orders: month.orders,
      revenue: month.revenue,
      revenue_rupees: toRupees(month.revenue),
      avg_basket: toRupees(avgBasket),
    },
    inventory: {
      skus: inventory.skus,
      units: inventory.units,
      value: inventory.value,
      value_rupees: toRupees(inventory.value),
      low_stock: inventory.low_stock,
      out_of_stock: inventory.out_of_stock,
    },
    customers: customers.total,
    alerts: { unread: alerts.unread || 0, critical: alerts.critical || 0 },
    pending_orders: pending,
  };
}

/* --------------------------------------------------------------- series -- */
export async function salesSeries(db, { days = 14 } = {}) {
  const n = Math.min(Math.max(1, Number(days) || 14), 90);
  const rows = await q.all(db, `
    SELECT date(created_at) AS day,
           COUNT(*) AS orders,
           COALESCE(SUM(total),0) AS revenue,
           COALESCE(SUM(payment_mode='upi'),0) AS upi,
           COALESCE(SUM(payment_mode='card'),0) AS card,
           COALESCE(SUM(payment_mode='cash'),0) AS cash
    FROM orders
    WHERE date(created_at) >= date('now', ?) AND ${LIVE}
    GROUP BY day ORDER BY day`, `-${n} day`);

  // fill gaps so the chart has no holes
  const byDay = Object.fromEntries(rows.map((r) => [r.day, r]));
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    const r = byDay[d];
    out.push({
      day: d,
      orders: r?.orders ?? 0,
      revenue: r?.revenue ?? 0,
      revenue_rupees: toRupees(r?.revenue ?? 0),
      upi: r?.upi ?? 0, card: r?.card ?? 0, cash: r?.cash ?? 0,
    });
  }
  return out;
}

export async function monthlySeries(db, { months = 6 } = {}) {
  const n = Math.min(Math.max(1, Number(months) || 6), 24);
  const rows = await q.all(db, `
    SELECT strftime('%Y-%m', created_at) AS month,
           COUNT(*) AS orders,
           COALESCE(SUM(total),0) AS revenue
    FROM orders
    WHERE date(created_at) >= date('now', ?) AND ${LIVE}
    GROUP BY month ORDER BY month`, `-${n - 1} months`);
  return rows.map((r) => ({ ...r, revenue_rupees: toRupees(r.revenue) }));
}

/* --------------------------------------------------------------- reports -- */
export async function salesReport(db, { from, to } = {}) {
  const f = from || new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  const t = to   || new Date().toISOString().slice(0, 10);

  const summary = await q.get(db, `
    SELECT COUNT(*) AS orders,
           COALESCE(SUM(total),0) AS revenue,
           COALESCE(SUM(discount),0) AS discount,
           COALESCE(SUM(delivery_fee),0) AS delivery,
           COALESCE(SUM(tax),0) AS tax,
           COUNT(DISTINCT customer_id) AS customers
    FROM orders WHERE date(created_at) BETWEEN date(?) AND date(?) AND ${LIVE}`, f, t);

  const cancelled = await q.scalar(db,
    `SELECT COUNT(*) FROM orders WHERE date(created_at) BETWEEN date(?) AND date(?) AND status='cancelled'`, f, t);

  const daily = await q.all(db, `
    SELECT date(created_at) AS day, COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue
    FROM orders WHERE date(created_at) BETWEEN date(?) AND date(?) AND ${LIVE}
    GROUP BY day ORDER BY day`, f, t);

  const paymentMix = await q.all(db, `
    SELECT payment_mode AS mode, COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue
    FROM orders WHERE date(created_at) BETWEEN date(?) AND date(?) AND ${LIVE}
    GROUP BY payment_mode ORDER BY revenue DESC`, f, t);

  const topProducts = await q.all(db, `
    SELECT oi.product_name AS name, SUM(oi.quantity) AS units, SUM(oi.line_total) AS revenue
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE date(o.created_at) BETWEEN date(?) AND date(?) AND o.status <> 'cancelled'
    GROUP BY oi.product_name ORDER BY revenue DESC LIMIT 10`, f, t);

  const byCategory = await q.all(db, `
    SELECT c.name AS category, SUM(oi.quantity) AS units, SUM(oi.line_total) AS revenue
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    JOIN categories c ON c.id = p.category_id
    WHERE date(o.created_at) BETWEEN date(?) AND date(?) AND o.status <> 'cancelled'
    GROUP BY c.id ORDER BY revenue DESC`, f, t);

  const byHour = await q.all(db, `
    SELECT CAST(strftime('%H', created_at) AS INTEGER) AS hour, COUNT(*) AS orders,
           COALESCE(SUM(total),0) AS revenue
    FROM orders WHERE date(created_at) BETWEEN date(?) AND date(?) AND ${LIVE}
    GROUP BY hour ORDER BY hour`, f, t);

  return {
    period: { from: f, to: t },
    summary: {
      ...summary,
      revenue_rupees: toRupees(summary.revenue),
      discount_rupees: toRupees(summary.discount),
      delivery_rupees: toRupees(summary.delivery),
      tax_rupees: toRupees(summary.tax),
      avg_order_value: summary.orders ? toRupees(Math.round(summary.revenue / summary.orders)) : '0.00',
      cancelled_orders: cancelled,
    },
    daily, paymentMix, topProducts, byCategory, byHour,
  };
}

export async function inventoryReport(db) {
  const summary = await q.get(db, `
    SELECT COUNT(*) AS skus,
           COALESCE(SUM(s.quantity),0) AS units,
           COALESCE(SUM(p.price * s.quantity),0) AS retail_value,
           COALESCE(SUM(p.mrp   * s.quantity),0) AS mrp_value,
           COALESCE(SUM(CASE WHEN s.quantity <= 0 THEN 1 ELSE 0 END),0) AS out_of_stock,
           COALESCE(SUM(CASE WHEN s.quantity > 0 AND s.quantity <= s.reorder_level THEN 1 ELSE 0 END),0) AS low_stock
    FROM products p JOIN stock s ON s.product_id = p.id
    WHERE p.status <> 'discontinued'`);

  const byCategory = await q.all(db, `
    SELECT c.name AS category, c.accent, COUNT(p.id) AS skus,
           COALESCE(SUM(s.quantity),0) AS units,
           COALESCE(SUM(p.price * s.quantity),0) AS value
    FROM categories c
    LEFT JOIN products p ON p.category_id = c.id AND p.status <> 'discontinued'
    LEFT JOIN stock s   ON s.product_id = p.id
    GROUP BY c.id ORDER BY value DESC`);

  const topValue = await q.all(db, `
    SELECT p.name, p.sku, c.name AS category, s.quantity, (p.price * s.quantity) AS value
    FROM products p JOIN stock s ON s.product_id = p.id
    JOIN categories c ON c.id = p.category_id
    WHERE p.status <> 'discontinued' ORDER BY value DESC LIMIT 10`);

  const slowMoving = await q.all(db, `
    SELECT p.name, p.sku, s.quantity, c.name AS category,
           COALESCE((SELECT MAX(o.created_at) FROM order_items oi
                      JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = p.id), 'never') AS last_sold
    FROM products p JOIN stock s ON s.product_id = p.id
    JOIN categories c ON c.id = p.category_id
    WHERE p.status <> 'discontinued'
    ORDER BY (s.quantity * p.price) DESC LIMIT 10`);

  return {
    summary: {
      ...summary,
      retail_value_rupees: toRupees(summary.retail_value),
      mrp_value_rupees: toRupees(summary.mrp_value),
      potential_margin_rupees: toRupees(summary.mrp_value - summary.retail_value),
    },
    byCategory, topValue, slowMoving,
    lowStock: await lowStockList(db, { limit: 25 }),
  };
}

export async function customerReport(db, { limit = 50 } = {}) {
  const customers = await q.all(db, `
    SELECT cu.id, cu.name, cu.phone, cu.city, cu.loyalty_points, cu.total_spent,
           cu.orders_count, cu.created_at,
           (SELECT MAX(o.created_at) FROM orders o WHERE o.customer_id = cu.id) AS last_order
    FROM customers cu ORDER BY cu.total_spent DESC LIMIT ?`, Math.min(200, Number(limit) || 50));

  const stats = await q.get(db, `
    SELECT COUNT(*) AS total,
           COUNT(CASE WHEN date(created_at) >= date('now','-30 day') THEN 1 END) AS new_this_month,
           COALESCE(AVG(CASE WHEN orders_count > 0 THEN total_spent * 1.0 / orders_count END),0) AS avg_lifetime
    FROM customers`);

  return {
    customers: customers.map((c) => ({ ...c, total_spent_rupees: toRupees(c.total_spent) })),
    stats: { ...stats, avg_lifetime_rupees: toRupees(Math.round(stats.avg_lifetime)) },
  };
}

/** Persist a computed report snapshot (the Report entity in the class diagram). */
export async function saveReport(db, { type, period, payload }, userId) {
  const info = await q.run(db,
    `INSERT INTO reports (report_type,period,payload,generated_by) VALUES (?,?,?,?)`,
    type, period, JSON.stringify(payload), userId ?? null);
  return { id: Number(info.lastInsertRowid), report_type: type, period, created_at: new Date().toISOString() };
}

export async function listReports(db, { limit = 25 } = {}) {
  return await q.all(db, `
    SELECT r.id, r.report_type, r.period, r.created_at, u.name AS generated_by
    FROM reports r LEFT JOIN users u ON u.id = r.generated_by
    ORDER BY r.created_at DESC LIMIT ?`, Math.min(100, Number(limit) || 25));
}

export { isPaid };