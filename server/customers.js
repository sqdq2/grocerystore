/**
 * Customer module — records, loyalty ledger and purchase history.
 * FR requirement: "Maintain customer records for loyalty offers."
 */
import { q, tx, toRupees } from './db.js';
import { badRequest, notFound, conflict } from './http.js';

export function listCustomers(db, { search, limit = 100 } = {}) {
  const where = ['1=1'];
  const args = [];
  if (search) {
    where.push('(name LIKE ? OR phone LIKE ? OR email LIKE ? OR city LIKE ?)');
    const like = `%${search}%`;
    args.push(like, like, like, like);
  }
  const rows = q.all(db, `
    SELECT id, name, email, phone, address, city, postal_code,
           loyalty_points, total_spent, orders_count, is_blocked, created_at
    FROM customers WHERE ${where.join(' AND ')}
    ORDER BY total_spent DESC LIMIT ?`, ...args, Math.min(500, Number(limit) || 100));
  return rows.map((c) => ({ ...c, total_spent_rupees: toRupees(c.total_spent) }));
}

export function getCustomer(db, id) {
  const c = q.get(db, `
    SELECT id,name,email,phone,address,city,postal_code,loyalty_points,total_spent,
           orders_count,is_blocked,created_at
    FROM customers WHERE id = ? OR phone = ?`,
    /^\d+$/.test(String(id)) ? Number(id) : -1, String(id));
  if (!c) throw notFound('Customer not found');

  c.orders = q.all(db, `
    SELECT id, order_no, status, payment_mode, total, created_at,
           (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = orders.id) AS item_count
    FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50`, c.id);

  c.favourites = q.all(db, `
    SELECT oi.product_id, oi.product_name, SUM(oi.quantity) AS times_bought
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.customer_id = ? GROUP BY oi.product_id
    ORDER BY times_bought DESC LIMIT 10`, c.id);

  c.total_spent_rupees = toRupees(c.total_spent);
  return c;
}

const normPhone = (p) => String(p || '').replace(/\D/g, '').slice(-10);

export function createCustomer(db, body) {
  const name = String(body.name || '').trim();
  const phone = normPhone(body.phone);
  if (!name) throw badRequest('Customer name is required');
  if (phone.length !== 10) throw badRequest('A valid 10-digit phone number is required');
  if (q.get(db, 'SELECT id FROM customers WHERE phone = ?', phone)) {
    throw conflict('A customer with that phone number already exists');
  }

  const info = q.run(db, `
    INSERT INTO customers (name,email,phone,address,city,postal_code)
    VALUES (?,?,?,?,?,?)`,
    name, body.email || null, phone, body.address || null,
    body.city || 'Waghai', body.postal_code || '394730');

  return getCustomer(db, Number(info.lastInsertRowid));
}

export function updateCustomer(db, id, body) {
  const existing = q.get(db, 'SELECT * FROM customers WHERE id = ?', id);
  if (!existing) throw notFound('Customer not found');

  const phone = body.phone !== undefined ? normPhone(body.phone) : existing.phone;
  if (phone.length !== 10) throw badRequest('A valid 10-digit phone number is required');
  if (phone !== existing.phone && q.get(db, 'SELECT id FROM customers WHERE phone = ?', phone)) {
    throw conflict('Another customer already uses that phone number');
  }

  const next = {
    name: body.name ?? existing.name,
    email: body.email !== undefined ? body.email : existing.email,
    phone,
    address: body.address !== undefined ? body.address : existing.address,
    city: body.city ?? existing.city,
    postal_code: body.postal_code ?? existing.postal_code,
    is_blocked: body.is_blocked !== undefined ? (body.is_blocked ? 1 : 0) : existing.is_blocked,
  };
  if (!String(next.name).trim()) throw badRequest('Customer name cannot be empty');

  q.run(db, `UPDATE customers SET name=?,email=?,phone=?,address=?,city=?,postal_code=?,is_blocked=?
             WHERE id = ?`,
    next.name, next.email, next.phone, next.address, next.city, next.postal_code, next.is_blocked, id);

  return getCustomer(db, id);
}

export function adjustLoyalty(db, id, points, reason = 'Manual adjustment') {
  const delta = Math.round(Number(points));
  if (!Number.isFinite(delta) || delta === 0) throw badRequest('Loyalty points must be a non-zero number');
  const c = q.get(db, 'SELECT id, name, loyalty_points FROM customers WHERE id = ?', id);
  if (!c) throw notFound('Customer not found');

  tx(db, () => {
    q.run(db, `UPDATE customers SET loyalty_points = MAX(0, loyalty_points + ?) WHERE id = ?`, delta, id);
  });
  q.run(db, `INSERT INTO alerts (product_id,type,message,severity) VALUES (NULL,?,?,?)`,
    'low_stock',
    `${delta > 0 ? 'Awarded' : 'Deducted'} ${Math.abs(delta)} loyalty points ${delta > 0 ? 'to' : 'from'} ${c.name} — ${reason}`,
    'info');

  return getCustomer(db, id);
}

export { normPhone };