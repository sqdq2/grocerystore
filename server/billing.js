/**
 * Sales / Billing module.
 *
 * Implements the deck's activity & sequence diagrams end-to-end:
 *   select products → check stock → accept payment → generate invoice → deduct stock
 *
 * All writes run inside one IMMEDIATE transaction so a bill can never be
 * half-created: invoice + stock movements + ledger updates commit together.
 */
import { q, tx, toPaise, toRupees } from './db.js';
import { badRequest, notFound, conflict } from './http.js';
import { raiseStockAlerts } from './catalog.js';

export const PAYMENT_MODES = ['cash', 'upi', 'card'];
export const ORDER_STATUSES = ['pending', 'confirmed', 'packed', 'out_for_delivery', 'delivered', 'cancelled'];

const FREE_DELIVERY_ABOVE = toPaise(300);   // ₹300
const DELIVERY_FEE        = toPaise(25);
const TAX_INCLUDED        = true;            // Indian retail: MRP is tax-inclusive

/* ------------------------------------------------------------ price calc -- */
/** Single source of truth for money maths, shared by the API and the UI. */
export function priceCart(lines, { discountPct = 0, delivery = true } = {}) {
  const items = lines.map((l) => {
    const lineTax = TAX_INCLUDED ? 0 : Math.round(l.unit_price * l.quantity * (l.tax_rate / 100));
    const gross = l.unit_price * l.quantity + lineTax;
    return {
      product_id: l.product_id ?? null,
      product_name: l.product_name,
      sku: l.sku,
      pack_size: l.pack_size ?? null,
      unit_price: l.unit_price,
      quantity: l.quantity,
      tax_rate: l.tax_rate ?? 0,
      line_total: gross,
    };
  });

  const subtotal = items.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  const tax = items.reduce((s, i) => s + i.line_total - i.unit_price * i.quantity, 0);
  const gross = items.reduce((s, i) => s + i.line_total, 0);
  const discount = Math.round(subtotal * (Math.min(Math.max(discountPct, 0), 100) / 100));
  const afterDiscount = gross - discount;
  const deliveryFee = delivery && afterDiscount > 0 && afterDiscount < FREE_DELIVERY_ABOVE ? DELIVERY_FEE : 0;

  return {
    items,
    subtotal, discount, tax,
    delivery_fee: deliveryFee,
    total: afterDiscount + deliveryFee,
    free_delivery_above: FREE_DELIVERY_ABOVE,
  };
}

/* ------------------------------------------------------------ order read -- */
export function listOrders(db, opts = {}) {
  const { status, search, customerId, from, to, page = 1, perPage = 20 } = opts;
  const where = ['1=1'];
  const args = [];

  if (status) {
    if (status === 'open') where.push("o.status IN ('pending','confirmed','packed','out_for_delivery')");
    else if (ORDER_STATUSES.includes(status)) { where.push('o.status = ?'); args.push(status); }
  }
  if (customerId) { where.push('o.customer_id = ?'); args.push(Number(customerId)); }
  if (search) {
    where.push('(o.order_no LIKE ? OR cu.name LIKE ? OR cu.phone LIKE ?)');
    const like = `%${search}%`;
    args.push(like, like, like);
  }
  if (from) { where.push('date(o.created_at) >= date(?)'); args.push(from); }
  if (to)   { where.push('date(o.created_at) <= date(?)'); args.push(to); }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const total = q.scalar(db, `SELECT COUNT(*) FROM orders o LEFT JOIN customers cu ON cu.id=o.customer_id ${whereSql}`, ...args);
  const per = Math.min(Math.max(1, Number(perPage) || 20), 100);
  const pg = Math.max(1, Number(page) || 1);

  const rows = q.all(db, `
    SELECT o.id, o.order_no, o.status, o.payment_mode, o.payment_status,
           o.subtotal, o.discount, o.tax, o.delivery_fee, o.total,
           o.created_at, o.updated_at, o.address,
           cu.id AS customer_id, cu.name AS customer_name, cu.phone AS customer_phone,
           u.name AS cashier_name,
           i.invoice_no,
           (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
    FROM orders o
    LEFT JOIN customers cu ON cu.id = o.customer_id
    LEFT JOIN users u     ON u.id = o.user_id
    LEFT JOIN invoices i  ON i.order_id = o.id
    ${whereSql}
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT ? OFFSET ?`, ...args, per, (pg - 1) * per);

  return {
    items: rows.map((r) => ({ ...r, total_rupees: toRupees(r.total) })),
    total, page: pg, per_page: per, total_pages: Math.max(1, Math.ceil(total / per)),
  };
}

export function getOrder(db, id) {
  const order = q.get(db, `
    SELECT o.*, cu.name AS customer_name, cu.phone AS customer_phone, cu.email AS customer_email,
           cu.loyalty_points, u.name AS cashier_name, i.invoice_no
    FROM orders o
    LEFT JOIN customers cu ON cu.id = o.customer_id
    LEFT JOIN users u     ON u.id = o.user_id
    LEFT JOIN invoices i  ON i.order_id = o.id
    WHERE o.id = ? OR o.order_no = ?`,
    /^\d+$/.test(String(id)) ? Number(id) : -1, String(id));
  if (!order) throw notFound(`Order ${id} was not found`);

  order.items = q.all(db, 'SELECT * FROM order_items WHERE order_id = ? ORDER BY id', order.id);
  order.totals_rupees = {
    subtotal: toRupees(order.subtotal),
    discount: toRupees(order.discount),
    tax: toRupees(order.tax),
    delivery_fee: toRupees(order.delivery_fee),
    total: toRupees(order.total),
  };
  return order;
}

/* ------------------------------------------------------------ order write -- */
export function createOrder(db, body, user) {
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length) throw badRequest('A bill needs at least one item');

  const paymentMode = String(body.payment_mode || 'cash').toLowerCase();
  if (!PAYMENT_MODES.includes(paymentMode)) {
    throw badRequest(`Payment mode must be one of ${PAYMENT_MODES.join(', ')}`);
  }

  // ---- resolve products from the database (never trust client prices) ----
  const resolved = rawItems.map((it) => {
    const pid = Number(it.product_id ?? it.id);
    if (!pid) throw badRequest('Every line item needs a product_id');
    const p = q.get(db, `SELECT p.*, s.quantity, s.reorder_level FROM products p
                         JOIN stock s ON s.product_id = p.id WHERE p.id = ?`, pid);
    if (!p) throw badRequest(`Product #${pid} does not exist`);
    if (p.status === 'discontinued') throw conflict(`${p.name} has been discontinued and cannot be sold`);

    const qty = Math.floor(Number(it.quantity));
    if (!(qty > 0)) throw badRequest(`Quantity for ${p.name} must be at least 1`);

    return {
      product_id: p.id, product_name: p.name, sku: p.sku, pack_size: p.pack_size,
      unit_price: p.price, quantity: qty, tax_rate: p.tax_rate,
      available: p.quantity, reorder_level: p.reorder_level,
    };
  });

  // ---- stock check (deck activity diagram: "Check stock availability?") ----
  const short = resolved.filter((r) => r.quantity > r.available);
  if (short.length) {
    throw conflict('Some items are short in stock', {
      code: 'INSUFFICIENT_STOCK',
      shortages: short.map((s) => ({
        product_id: s.product_id, name: s.product_name,
        requested: s.quantity, available: s.available,
      })),
    });
  }

  const discountPct = Number(body.discount_pct ?? body.discountPct ?? 0);
  const totals = priceCart(resolved, { discountPct });

  const orderNo = nextOrderNo(db);
  const now = new Date().toISOString();
  const paid = body.payment_status !== 'pending' && body.paid !== false;

  const result = tx(db, () => {
    const info = q.run(db, `
      INSERT INTO orders (order_no,customer_id,user_id,status,payment_mode,payment_status,
                          subtotal,discount,tax,delivery_fee,total,note,address,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      orderNo,
      body.customer_id ? Number(body.customer_id) : null,
      user?.id ?? null,
      body.status && ORDER_STATUSES.includes(body.status) ? body.status : 'delivered',
      paymentMode, paid ? 'paid' : 'pending',
      totals.subtotal, totals.discount, totals.tax, totals.delivery_fee, totals.total,
      body.note || null, body.address || body.note || null, now, now);
    const orderId = Number(info.lastInsertRowid);

    for (const it of totals.items) {
      q.run(db, `INSERT INTO order_items
                   (order_id,product_id,product_name,sku,pack_size,unit_price,quantity,tax_rate,line_total)
                 VALUES (?,?,?,?,?,?,?,?,?)`,
        orderId, it.product_id, it.product_name, it.sku, it.pack_size,
        it.unit_price, it.quantity, it.tax_rate, it.line_total);

      // ---- deduct stock + journal the movement ----
      q.run(db, `UPDATE stock SET quantity = quantity - ?, updated_at = ? WHERE product_id = ?`,
        it.quantity, now, it.product_id);
      const bal = q.get(db, 'SELECT quantity, reorder_level FROM stock WHERE product_id = ?', it.product_id);
      q.run(db, `INSERT INTO stock_movements (product_id,change,balance_after,reason,reference,user_id,created_at)
                 VALUES (?,?,?,?,?,?,?)`,
        it.product_id, -it.quantity, bal.quantity, 'sale', orderNo, user?.id ?? null, now);
    }

    // ---- invoice (only for completed sales) ----
    if (body.status !== 'pending') {
      q.run(db, `INSERT INTO invoices (invoice_no,order_id,amount,payment_mode,issued_at) VALUES (?,?,?,?,?)`,
        nextInvoiceNo(db), orderId, totals.total, paymentMode, now);
    }

    // ---- customer ledger ----
    if (body.customer_id) {
      q.run(db, `UPDATE customers SET orders_count = orders_count + 1, total_spent = total_spent + ?,
                                   loyalty_points = loyalty_points + ? WHERE id = ?`,
        totals.total, Math.floor(totals.total / 10000), Number(body.customer_id));
    }

    // ---- alerts for anything that just crossed its threshold ----
    for (const it of totals.items) raiseStockAlerts(db, it.product_id);

    return orderId;
  });

  return getOrder(db, result);
}

/** Advance an order through the fulfilment lifecycle. */
export function updateOrderStatus(db, id, status, userId) {
  const order = q.get(db, 'SELECT id, order_no, status, payment_status, total FROM orders WHERE id = ? OR order_no = ?',
    /^\d+$/.test(String(id)) ? Number(id) : -1, String(id));
  if (!order) throw notFound('Order not found');
  if (!ORDER_STATUSES.includes(status)) throw badRequest(`Unknown status "${status}"`);
  if (order.status === status) return getOrder(db, order.id);

  const ALLOWED = {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['packed', 'cancelled'],
    packed: ['out_for_delivery', 'cancelled'],
    out_for_delivery: ['delivered'],
    delivered: [],
    cancelled: [],
  };
  if (!ALLOWED[order.status].includes(status)) {
    throw conflict(`Cannot move an order from ${order.status} to ${status}`);
  }

  tx(db, () => {
    q.run(db, `UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`, status, order.id);

    // cancellation returns the stock to the shelf
    if (status === 'cancelled') {
      const items = q.all(db, 'SELECT product_id, quantity FROM order_items WHERE order_id = ?', order.id);
      const now = new Date().toISOString();
      for (const it of items) {
        if (!it.product_id) continue;
        q.run(db, `UPDATE stock SET quantity = quantity + ?, updated_at = ? WHERE product_id = ?`,
          it.quantity, now, it.product_id);
        const bal = q.get(db, 'SELECT quantity FROM stock WHERE product_id = ?', it.product_id);
        q.run(db, `INSERT INTO stock_movements (product_id,change,balance_after,reason,reference,user_id,created_at)
                   VALUES (?,?,?,?,?,?,?)`,
          it.product_id, it.quantity, bal.quantity, 'return', order.order_no, userId ?? null, now);
      }
      if (order.payment_status === 'paid') {
        q.run(db, `UPDATE orders SET payment_status = 'refunded' WHERE id = ?`, order.id);
      }
    }

    // reaching "delivered" issues the invoice if it was not issued yet
    if (status === 'delivered' && order.payment_status === 'pending') {
      q.run(db, `UPDATE orders SET payment_status = 'paid' WHERE id = ?`, order.id);
    }
    if (status === 'delivered') {
      const inv = q.get(db, 'SELECT id FROM invoices WHERE order_id = ?', order.id);
      if (!inv) {
        q.run(db, `INSERT INTO invoices (invoice_no,order_id,amount,payment_mode,issued_at) VALUES (?,?,?,?,?)`,
          nextInvoiceNo(db), order.id, order.total,
          q.scalar(db, 'SELECT payment_mode FROM orders WHERE id = ?', order.id), new Date().toISOString());
      }
    }
  });

  return getOrder(db, order.id);
}

/* ---------------------------------------------------------- quote helper -- */
/** Price a cart without saving — powers the live billing screen. */
export function quote(db, body) {
  const items = (body.items || []).map((it) => {
    const p = q.get(db, `SELECT p.id,p.name,p.sku,p.pack_size,p.price,p.tax_rate,s.quantity
                         FROM products p JOIN stock s ON s.product_id=p.id WHERE p.id = ?`,
      Number(it.product_id ?? it.id));
    if (!p) return null;
    const quantity = Math.max(1, Math.floor(Number(it.quantity) || 1));
    return { ...p, product_name: p.name, unit_price: p.price, quantity, available: p.quantity };
  }).filter(Boolean);

  if (!items.length) throw badRequest('Nothing to price — cart is empty');
  const totals = priceCart(items, { discountPct: Number(body.discount_pct || 0) });
  return {
    ...totals,
    rupees: {
      subtotal: toRupees(totals.subtotal), discount: toRupees(totals.discount),
      tax: toRupees(totals.tax), delivery_fee: toRupees(totals.delivery_fee),
      total: toRupees(totals.total),
    },
    warnings: totals.items
      .map((it) => ({ product_id: it.product_id, requested: it.quantity }))
      .filter((it) => {
        const src = items.find((i) => i.product_id === it.product_id);
        return src && it.requested > src.available;
      })
      .map((it) => {
        const src = items.find((i) => i.product_id === it.product_id);
        return { product_id: it.product_id, name: src.product_name, requested: it.requested, available: src.available };
      }),
  };
}

/* ------------------------------------------------------------- numbering -- */
function nextOrderNo(db) {
  const prefix = `BGS-${new Date().getFullYear().toString().slice(2)}${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const last = q.scalar(db, `SELECT order_no FROM orders WHERE order_no LIKE ? ORDER BY id DESC LIMIT 1`, `${prefix}%`);
  const n = last ? parseInt(String(last).split('-').pop(), 10) : 1000;
  return `${prefix}-${(Number.isFinite(n) ? n + 1 : 1001)}`;
}

function nextInvoiceNo(db) {
  const prefix = `INV-${new Date().getFullYear().toString().slice(2)}`;
  const last = q.scalar(db, `SELECT invoice_no FROM invoices WHERE invoice_no LIKE ? ORDER BY id DESC LIMIT 1`, `${prefix}%`);
  const n = last ? parseInt(String(last).split('-').pop(), 10) : 10000;
  return `${prefix}-${(Number.isFinite(n) ? n + 1 : 10001)}`;
}

export { nextOrderNo, nextInvoiceNo };