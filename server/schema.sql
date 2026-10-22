-- ============================================================================
--  Bijasan General Store — Grocery Store Management System
--  Relational schema (SQLite) — derived from the project Class Diagram:
--    User (Admin|Staff) · Category · Product · Stock · Supplier
--    Sale/Transaction · Invoice · Report · Customer
--
--  Design notes
--   * Money is stored as INTEGER paise (₹ * 100) — never REAL. Avoids float drift.
--   * Product availability is a derived state (state machine from the deck):
--        AVAILABLE / LOW_STOCK / OUT_OF_STOCK / DISCONTINUED
--     computed by `trg_product_stock_state` and cached on products.status.
--   * Every stock movement is journalled in stock_movements (audit trail).
--   * Sale totals are snapshotted on order_items so historical invoices never
--     change when a product is later renamed or repriced.
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- users ----
-- FR-1  Secure login for Admin and Staff with role-based registration access
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  phone         TEXT,
  password_hash TEXT    NOT NULL,           -- scrypt: salt$hash
  role          TEXT    NOT NULL DEFAULT 'staff'
                        CHECK (role IN ('admin','staff','manager')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ------------------------------------------------------------ categories ---
CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  description TEXT,
  icon        TEXT    NOT NULL DEFAULT 'package',
  accent      TEXT    NOT NULL DEFAULT 'emerald',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------- suppliers ---
CREATE TABLE IF NOT EXISTS suppliers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  contact     TEXT,
  phone       TEXT,
  email       TEXT,
  address     TEXT,
  gst_number  TEXT,
  lead_time_days INTEGER NOT NULL DEFAULT 3,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- -------------------------------------------------------------- products ---
-- Class Diagram: Product { productId, name, price } ; Category groups Product
CREATE TABLE IF NOT EXISTS products (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sku           TEXT    NOT NULL UNIQUE,
  slug          TEXT    NOT NULL UNIQUE,
  name          TEXT    NOT NULL,
  description   TEXT,
  category_id   INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  supplier_id   INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  price         INTEGER NOT NULL CHECK (price >= 0),     -- paise
  mrp           INTEGER NOT NULL DEFAULT 0,              -- paise (strike-through)
  unit          TEXT    NOT NULL DEFAULT 'pc',           -- pc / kg / L / pack
  pack_size     TEXT,                                     -- '1 kg', '500 g'
  tax_rate      REAL    NOT NULL DEFAULT 5.0,             -- percent
  barcode       TEXT,
  brand         TEXT,
  image         TEXT,                                     -- emoji/svg hint
  is_featured   INTEGER NOT NULL DEFAULT 0,
  status        TEXT    NOT NULL DEFAULT 'available'
                        CHECK (status IN ('available','low_stock','out_of_stock','discontinued')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_products_status   ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_search   ON products(name, brand);

-- ----------------------------------------------------------------- stock ---
-- Class Diagram: Stock { supplierId, quantity, reorderLevel }
CREATE TABLE IF NOT EXISTS stock (
  product_id      INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  quantity        INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reorder_level   INTEGER NOT NULL DEFAULT 10 CHECK (reorder_level >= 0),
  reorder_quantity INTEGER NOT NULL DEFAULT 24 CHECK (reorder_quantity >= 0),
  last_restocked_at TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Append-only audit trail of every quantity change.
CREATE TABLE IF NOT EXISTS stock_movements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  change       INTEGER NOT NULL,            -- +received  -sold  +adjust
  balance_after INTEGER NOT NULL,
  reason       TEXT    NOT NULL,            -- sale | restock | adjustment | return | opening
  reference    TEXT,                        -- e.g. invoice no
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_movements_product ON stock_movements(product_id, created_at DESC);

-- ------------------------------------------------------------- customers ---
CREATE TABLE IF NOT EXISTS customers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  email        TEXT    UNIQUE,
  phone        TEXT    NOT NULL UNIQUE,
  address      TEXT,
  city         TEXT,
  postal_code  TEXT,
  loyalty_points INTEGER NOT NULL DEFAULT 0,
  total_spent  INTEGER NOT NULL DEFAULT 0,   -- paise
  orders_count INTEGER NOT NULL DEFAULT 0,
  is_blocked   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

-- ---------------------------------------------------------------- orders ---
-- Sale / Transaction  (Class Diagram: saleId, date, userId, totalAmount)
CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no       TEXT    NOT NULL UNIQUE,
  customer_id    INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,   -- cashier
  status         TEXT    NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','confirmed','packed','out_for_delivery','delivered','cancelled')),
  payment_mode   TEXT    NOT NULL DEFAULT 'cash'
                         CHECK (payment_mode IN ('cash','upi','card')),
  payment_status TEXT    NOT NULL DEFAULT 'pending'
                         CHECK (payment_status IN ('pending','paid','refunded','failed')),
  subtotal       INTEGER NOT NULL DEFAULT 0,
  discount       INTEGER NOT NULL DEFAULT 0,
  tax            INTEGER NOT NULL DEFAULT 0,
  delivery_fee   INTEGER NOT NULL DEFAULT 0,
  total          INTEGER NOT NULL DEFAULT 0,
  note           TEXT,
  address        TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_date   ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_cust   ON orders(customer_id);

CREATE TABLE IF NOT EXISTS order_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id    INTEGER REFERENCES products(id) ON DELETE SET NULL,
  -- snapshots so the invoice is immutable
  product_name  TEXT    NOT NULL,
  sku           TEXT    NOT NULL,
  pack_size     TEXT,
  unit_price    INTEGER NOT NULL,      -- paise, pre-tax
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  tax_rate      REAL    NOT NULL DEFAULT 0,
  line_total    INTEGER NOT NULL       -- paise, tax inclusive
);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);

-- -------------------------------------------------------------- invoices ---
CREATE TABLE IF NOT EXISTS invoices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no    TEXT    NOT NULL UNIQUE,
  order_id      INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  amount        INTEGER NOT NULL,
  payment_mode  TEXT    NOT NULL,
  issued_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------- alerts ---
CREATE TABLE IF NOT EXISTS alerts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER REFERENCES products(id) ON DELETE CASCADE,
  type        TEXT    NOT NULL CHECK (type IN ('low_stock','out_of_stock','restocked')),
  message     TEXT    NOT NULL,
  severity    TEXT    NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  is_read     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_alerts_unread ON alerts(is_read, created_at DESC);

-- --------------------------------------------------------------- reports ---
-- (Class Diagram: Report { reportType, period })
CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  report_type TEXT    NOT NULL,     -- sales_daily | sales_monthly | inventory | low_stock
  period      TEXT    NOT NULL,     -- '2026-10-22' | '2026-10'
  payload     TEXT    NOT NULL,     -- JSON snapshot of computed figures
  generated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reports_type ON reports(report_type, period);

-- --------------------------------------------------------- app migrations ---
-- The seed content is a one-time bootstrap migration, not per-request data.
CREATE TABLE IF NOT EXISTS app_migrations (
  name       TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------- state machine --
-- Available → Low Stock → Out of Stock → (restock) Available
-- Available/Low/Out → Discontinued → Available
-- Enforced as a trigger so status can never drift from quantity.
CREATE TRIGGER IF NOT EXISTS trg_sync_stock_status
AFTER INSERT ON stock
WHEN NEW.quantity <= 0
BEGIN
  UPDATE products SET status = 'out_of_stock', updated_at = datetime('now')
   WHERE id = NEW.product_id AND status <> 'discontinued';
END;

CREATE TRIGGER IF NOT EXISTS trg_stock_state_after_update
AFTER UPDATE OF quantity ON stock
BEGIN
  UPDATE products
     SET status = CASE
            WHEN status = 'discontinued'  THEN 'discontinued'
            WHEN NEW.quantity <= 0        THEN 'out_of_stock'
            WHEN NEW.quantity <= NEW.reorder_level THEN 'low_stock'
            ELSE 'available' END,
         updated_at = datetime('now')
   WHERE id = NEW.product_id;
END;
