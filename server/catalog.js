/**
 * Catalog + inventory domain logic.
 * Mirrors the deck's Inventory Module and the Product state machine.
 */
import { q, toPaise } from './db.js';
import { badRequest, notFound, conflict } from './http.js';

/* ---------------------------------------------------------- presentation -- */
const PRODUCT_SELECT = `
  SELECT p.id, p.sku, p.slug, p.name, p.description, p.price, p.mrp, p.unit,
         p.pack_size, p.tax_rate, p.barcode, p.brand, p.image, p.is_featured,
         p.status, p.category_id, p.supplier_id, p.created_at,
         c.slug AS category_slug, c.name AS category_name, c.accent, c.icon,
         s.quantity, s.reorder_level, s.reorder_quantity, s.last_restocked_at,
         sup.name AS supplier_name, sup.phone AS supplier_phone, sup.lead_time_days,
         CASE WHEN p.mrp > p.price
              THEN ROUND(100.0 * (p.mrp - p.price) / p.mrp)
              ELSE 0 END AS discount_pct,
         (p.price * s.quantity) AS stock_value
    FROM products p
    JOIN categories c  ON c.id = p.category_id
    JOIN stock s      ON s.product_id = p.id
    LEFT JOIN suppliers sup ON sup.id = p.supplier_id
`;

/** Attach derived display fields used across the UI. */
export function decorate(row) {
  if (!row) return row;
  const r = { ...row };
  r.is_featured = !!r.is_featured;
  r.in_stock = r.quantity > 0;
  r.stock_state =
    r.status === 'discontinued' ? 'discontinued'
    : r.quantity <= 0          ? 'out_of_stock'
    : r.quantity <= r.reorder_level ? 'low_stock'
    : 'available';
  r.stock_label =
    r.stock_state === 'available'    ? 'In stock'
    : r.stock_state === 'low_stock'  ? `Only ${r.quantity} left`
    : r.stock_state === 'out_of_stock' ? 'Out of stock'
    : 'Discontinued';
  r.discount_pct = r.discount_pct || 0;
  r.price_rupees = r.price / 100;
  r.mrp_rupees = r.mrp / 100;
  r.tax_rupees = Math.round(r.price * (r.tax_rate / 100)) / 100;
  return r;
}

export const decorateAll = (rows) => rows.map(decorate);

/* ------------------------------------------------------------- catalogue -- */
export function listCategories(db) {
  const rows = q.all(db, `
    SELECT c.id, c.slug, c.name, c.description, c.icon, c.accent,
           COUNT(p.id) AS product_count,
           COALESCE(SUM(CASE WHEN s.quantity > 0 THEN 1 ELSE 0 END), 0) AS in_stock_count
    FROM categories c
    LEFT JOIN products p ON p.category_id = c.id AND p.status <> 'discontinued'
    LEFT JOIN stock s   ON s.product_id = p.id
    GROUP BY c.id ORDER BY c.sort_order, c.name`);
  return rows;
}

export function listSuppliers(db) {
  return q.all(db, `
    SELECT sup.*,
           COUNT(DISTINCT p.id) AS product_count,
           COUNT(DISTINCT CASE WHEN s.quantity <= s.reorder_level AND s.quantity > 0 THEN p.id END) AS low_count,
           COUNT(DISTINCT CASE WHEN s.quantity = 0 THEN p.id END) AS out_count
    FROM suppliers sup
    LEFT JOIN products p ON p.supplier_id = sup.id
    LEFT JOIN stock s   ON s.product_id = p.id
    WHERE sup.is_active = 1
    GROUP BY sup.id ORDER BY sup.name`);
}

/**
 * Flexible product search. All filters are optional and composed as
 * parameterised SQL (no string interpolation of user input).
 */
export function listProducts(db, opts = {}) {
  const {
    q: search, category, minPrice, maxPrice, inStock, sort = 'featured',
    page = 1, perPage = 12, supplier, brand, featured, maxDiscount,
  } = opts;

  const where = ["p.status <> 'discontinued'"];
  const args = [];

  if (search) {
    where.push('(p.name LIKE ? OR p.brand LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR c.name LIKE ?)');
    const like = `%${search}%`;
    args.push(like, like, like, like, like);
  }
  if (category) { where.push('c.slug = ?'); args.push(category); }
  if (supplier) { where.push('sup.name = ?'); args.push(supplier); }
  if (brand)    { where.push('p.brand = ?'); args.push(brand); }
  if (inStock)  where.push('s.quantity > 0');
  if (featured) where.push('p.is_featured = 1');
  if (minPrice != null && minPrice !== '') { where.push('p.price >= ?'); args.push(toPaise(minPrice)); }
  if (maxPrice != null && maxPrice !== '') { where.push('p.price <= ?'); args.push(toPaise(maxPrice)); }
  if (maxDiscount) {
    where.push('CASE WHEN p.mrp > p.price THEN ROUND(100.0 * (p.mrp - p.price) / p.mrp) ELSE 0 END >= ?');
    args.push(Number(maxDiscount));
  }

  const ORDER = {
    featured:   'p.is_featured DESC, p.name ASC',
    newest:     'p.created_at DESC, p.id DESC',
    'price-asc':  'p.price ASC',
    'price-desc': 'p.price DESC',
    'name-asc':   'p.name ASC',
    'name-desc':  'p.name DESC',
    discount:   'discount_pct DESC',
    rating:     'p.name ASC',
  };
  const orderBy = ORDER[sort] || ORDER.featured;

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const total = q.scalar(db, `
    SELECT COUNT(*) FROM products p
    JOIN categories c ON c.id = p.category_id
    JOIN stock s ON s.product_id = p.id
    LEFT JOIN suppliers sup ON sup.id = p.supplier_id
    ${whereSql}`, ...args);

  const per = Math.min(Math.max(1, Number(perPage) || 12), 60);
  const pg  = Math.max(1, Number(page) || 1);
  const offset = (pg - 1) * per;

  const rows = q.all(db,
    `${PRODUCT_SELECT} ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    ...args, per, offset);

  return {
    items: decorateAll(rows),
    total,
    page: pg,
    per_page: per,
    total_pages: Math.max(1, Math.ceil(total / per)),
  };
}

export function getProduct(db, ident) {
  const by = /^\d+$/.test(ident) ? 'p.id = ?' : 'p.slug = ?';
  const row = q.get(db, `${PRODUCT_SELECT} WHERE ${by}`, Number(ident) || ident);
  if (!row) throw notFound(`No product matches "${ident}"`);
  return decorate(row);
}

export function getFacets(db) {
  const brands = q.all(db,
    `SELECT brand AS name, COUNT(*) AS count FROM products
     WHERE brand IS NOT NULL AND status <> 'discontinued'
     GROUP BY brand ORDER BY count DESC, brand`);
  const suppliers = listSuppliers(db).map((s) => s.name);
  const range = q.get(db,
    `SELECT MIN(price) AS min, MAX(price) AS max FROM products WHERE status <> 'discontinued'`);
  return {
    brands,
    suppliers,
    price_min: (range?.min ?? 0) / 100,
    price_max: (range?.max ?? 0) / 100,
  };
}

/* -------------------------------------------------------------- mutations -- */
export function createProduct(db, body, userId) {
  const name = String(body.name || '').trim();
  if (!name) throw badRequest('Product name is required');

  const categoryId = Number(body.category_id) || null;
  if (!categoryId) throw badRequest('A category must be selected');
  if (!q.get(db, 'SELECT id FROM categories WHERE id = ?', categoryId)) {
    throw badRequest('That category does not exist');
  }

  const price = toPaise(body.price);
  const mrp   = toPaise(body.mrp ?? body.price);
  if (price < 0) throw badRequest('Price cannot be negative');

  const sku = body.sku || nextSku(db);
  const slug = uniqueSlug(db, String(body.slug || name));

  const info = q.run(db, `
    INSERT INTO products (sku,slug,name,description,category_id,supplier_id,price,mrp,unit,
                          pack_size,tax_rate,barcode,brand,is_featured)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    sku, slug, name, body.description || null, categoryId,
    body.supplier_id ? Number(body.supplier_id) : null,
    price, mrp, body.unit || 'pc', body.pack_size || null,
    Number(body.tax_rate ?? 5), body.barcode || null, body.brand || null,
    body.is_featured ? 1 : 0);

  const id = Number(info.lastInsertRowid);
  const reorder = Number(body.reorder_level ?? 10);
  const opening = Number(body.quantity ?? 0);
  q.run(db, `INSERT INTO stock (product_id,quantity,reorder_level,reorder_quantity) VALUES (?,?,?,?)`,
    id, Math.max(0, opening), Math.max(0, reorder), Math.max(0, Number(body.reorder_quantity ?? reorder * 3)));
  q.run(db, `INSERT INTO stock_movements (product_id,change,balance_after,reason,user_id) VALUES (?,?,?,?,?)`,
    id, opening, opening, 'opening', userId ?? null);

  return getProduct(db, id);
}

export function updateProduct(db, id, body, userId) {
  const existing = q.get(db, 'SELECT * FROM products WHERE id = ?', id);
  if (!existing) throw notFound('Product not found');

  const fields = {
    name:        body.name !== undefined ? String(body.name).trim() : existing.name,
    description: body.description !== undefined ? body.description : existing.description,
    category_id: body.category_id !== undefined ? Number(body.category_id) : existing.category_id,
    supplier_id: body.supplier_id !== undefined
      ? (body.supplier_id ? Number(body.supplier_id) : null) : existing.supplier_id,
    price:       body.price !== undefined ? toPaise(body.price) : existing.price,
    mrp:         body.mrp !== undefined ? toPaise(body.mrp) : existing.mrp,
    unit:        body.unit ?? existing.unit,
    pack_size:   body.pack_size !== undefined ? body.pack_size : existing.pack_size,
    tax_rate:    body.tax_rate !== undefined ? Number(body.tax_rate) : existing.tax_rate,
    barcode:     body.barcode !== undefined ? body.barcode : existing.barcode,
    brand:       body.brand !== undefined ? body.brand : existing.brand,
    is_featured: body.is_featured !== undefined ? (body.is_featured ? 1 : 0) : existing.is_featured,
    status:      body.status ?? existing.status,
  };
  if (!fields.name) throw badRequest('Product name cannot be empty');
  if (fields.price < 0) throw badRequest('Price cannot be negative');
  if (!['available', 'low_stock', 'out_of_stock', 'discontinued'].includes(fields.status)) {
    throw badRequest('Unknown product status');
  }

  q.run(db, `
    UPDATE products SET name=?,description=?,category_id=?,supplier_id=?,price=?,mrp=?,unit=?,
                        pack_size=?,tax_rate=?,barcode=?,brand=?,is_featured=?,status=?,
                        updated_at=datetime('now')
     WHERE id = ?`,
    fields.name, fields.description, fields.category_id, fields.supplier_id,
    fields.price, fields.mrp, fields.unit, fields.pack_size, fields.tax_rate,
    fields.barcode, fields.brand, fields.is_featured, fields.status, id);

  if (body.reorder_level !== undefined) {
    q.run(db, `UPDATE stock SET reorder_level = ?, updated_at = datetime('now') WHERE product_id = ?`,
      Math.max(0, Number(body.reorder_level)), id);
  }

  /* quantity change through the product form = an adjustment movement */
  if (body.quantity !== undefined && Number(body.quantity) !== undefined) {
    adjustStock(db, id, Number(body.quantity), 'adjustment', body.reason || 'Manual adjustment', userId);
  }

  return getProduct(db, id);
}

/**
 * State machine transition. Discontinuing a product keeps its history but
 * hides it from the catalogue; re-introducing restores normal stock rules.
 */
export function setProductStatus(db, id, status, userId) {
  const p = q.get(db, 'SELECT id, status FROM products WHERE id = ?', id);
  if (!p) throw notFound('Product not found');
  if (!['available', 'discontinued'].includes(status)) {
    // allow low/out states to be driven by quantity only
    throw badRequest('Status must be "available" or "discontinued"');
  }
  q.run(db, `UPDATE products SET status = ?, updated_at = datetime('now') WHERE id = ?`, status, id);
  if (status === 'discontinued') {
    q.run(db, `INSERT INTO alerts (product_id,type,message,severity) VALUES (?,?,?,?)`,
      id, 'low_stock', `${p.name} was discontinued`, 'info');
  } else {
    syncStatusFromQuantity(db, id);
    q.run(db, `INSERT INTO alerts (product_id,type,message,severity) VALUES (?,?,?,?)`,
      id, 'restocked', `${p.name} re-introduced to the catalogue`, 'info');
  }
  void userId;
  return getProduct(db, id);
}

/* ----------------------------------------------------------------- stock -- */
function syncStatusFromQuantity(db, productId) {
  const row = q.get(db, `SELECT quantity, reorder_level, (SELECT status FROM products WHERE id=?) AS cur
                         FROM stock WHERE product_id = ?`, productId, productId);
  if (!row) return;
  const next = row.quantity <= 0 ? 'out_of_stock'
    : row.quantity <= row.reorder_level ? 'low_stock' : 'available';
  q.run(db, `UPDATE products SET status = ?, updated_at = datetime('now') WHERE id = ? AND status <> 'discontinued'`,
    next, productId);
}

/** Set stock to an absolute quantity, journalling the delta. */
export function adjustStock(db, productId, newQty, reason = 'adjustment', note = '', userId = null) {
  const row = q.get(db, 'SELECT quantity FROM stock WHERE product_id = ?', productId);
  if (!row) throw notFound('No stock record for this product');
  const target = Math.max(0, Math.floor(Number(newQty)));
  if (!Number.isFinite(target)) throw badRequest('Quantity must be a number');

  const delta = target - row.quantity;
  q.run(db, `UPDATE stock SET quantity = ?, updated_at = datetime('now') WHERE product_id = ?`, target, productId);
  if (reason === 'restock') {
    q.run(db, `UPDATE stock SET last_restocked_at = datetime('now') WHERE product_id = ?`, productId);
  }
  q.run(db, `INSERT INTO stock_movements (product_id,change,balance_after,reason,reference,user_id) VALUES (?,?,?,?,?,?)`,
    productId, delta, target, reason, note || null, userId);

  syncStatusFromQuantity(db, productId);
  raiseStockAlerts(db, productId);
  return getProduct(db, productId);
}

/** Receive `qty` units on top of current stock (goods received note). */
export function receiveStock(db, productId, qty, note = '', userId = null) {
  const row = q.get(db, 'SELECT quantity FROM stock WHERE product_id = ?', productId);
  if (!row) throw notFound('No stock record for this product');
  const amount = Math.floor(Number(qty));
  if (!(amount > 0)) throw badRequest('Received quantity must be greater than zero');
  return adjustStock(db, productId, row.quantity + amount, 'restock', note, userId);
}

export function lowStockList(db, { limit = 50 } = {}) {
  return decorateAll(q.all(db, `
    ${PRODUCT_SELECT}
    WHERE s.quantity <= s.reorder_level AND p.status <> 'discontinued'
    ORDER BY (s.quantity * 1.0 / NULLIF(s.reorder_level,0)) ASC, p.name ASC
    LIMIT ?`, Math.min(200, Number(limit) || 50)));
}

export function movementHistory(db, productId, limit = 40) {
  return q.all(db, `
    SELECT m.id, m.change, m.balance_after, m.reason, m.reference, m.created_at,
           u.name AS user_name
    FROM stock_movements m
    LEFT JOIN users u ON u.id = m.user_id
    WHERE m.product_id = ?
    ORDER BY m.created_at DESC, m.id DESC LIMIT ?`, productId, Math.min(200, Number(limit) || 40));
}

/** Create / clear an alert when a product crosses its reorder threshold. */
export function raiseStockAlerts(db, productId) {
  const row = q.get(db, `
    SELECT p.id, p.name, p.status, s.quantity, s.reorder_level,
           (SELECT COUNT(*) FROM alerts a
             WHERE a.product_id = p.id AND a.is_read = 0) AS open_alerts
    FROM products p JOIN stock s ON s.product_id = p.id WHERE p.id = ?`, productId);
  if (!row || row.status === 'discontinued' || row.open_alerts > 0) return;

  if (row.quantity <= 0) {
    q.run(db, `INSERT INTO alerts (product_id,type,message,severity) VALUES (?,?,?,?)`,
      productId, 'out_of_stock', `${row.name} is out of stock — reorder required`, 'critical');
  } else if (row.quantity <= row.reorder_level) {
    q.run(db, `INSERT INTO alerts (product_id,type,message,severity) VALUES (?,?,?,?)`,
      productId, 'low_stock',
      `${row.name} is low — ${row.quantity} left (reorder at ${row.reorder_level})`, 'warning');
  }
}

/* -------------------------------------------------------------- helpers --- */
function nextSku(db) {
  const last = q.scalar(db, `SELECT sku FROM products ORDER BY id DESC LIMIT 1`) || 'BGS-0000';
  const n = parseInt(String(last).replace(/\D+/g, ''), 10) || 0;
  return `BGS-${String(n + 1).padStart(4, '0')}`;
}

function uniqueSlug(db, base) {
  const clean = String(base).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'product';
  let slug = clean, i = 1;
  while (q.get(db, 'SELECT id FROM products WHERE slug = ?', slug)) slug = `${clean}-${++i}`;
  return slug;
}

export { PRODUCT_SELECT };