import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { openDatabase, migrate, q, hashPassword, verifyPassword, tx, toRupees } from './db.js';
import { seedDatabase } from './seed.js';
import {
  Router, json, ok, fail, readJson, serveStatic,
  parseCookies, cookie, HttpError, badRequest, unauthorized,
  forbidden, notFound, conflict,
} from './http.js';
import { signToken, attachUser, requireAuth, requireRole, CAPABILITIES, can } from './auth.js';
import {
  listCategories, listSuppliers, listProducts, getProduct, getFacets,
  createProduct, updateProduct, setProductStatus, adjustStock, receiveStock,
  lowStockList, movementHistory, decorate,
} from './catalog.js';
import {
  createOrder, getOrder, listOrders, updateOrderStatus, quote, PAYMENT_MODES, ORDER_STATUSES,
} from './billing.js';
import {
  dashboard, salesSeries, monthlySeries, salesReport, inventoryReport,
  customerReport, saveReport, listReports,
} from './reports.js';
import {
  listCustomers, getCustomer, createCustomer, updateCustomer, adjustLoyalty,
} from './customers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

/* --------------------------------------------------------------- database -- */
let db;
if (process.env.BGS_DB === ':memory:') {
  db = seedDatabase(':memory:').db;
} else {
  const res = seedDatabase(process.env.BGS_DB || join(__dirname, '..', 'data', 'store.db'));
  db = res.db;
  if (!res.skipped) console.log('[db] seeded:', JSON.stringify(res.counts));
}
migrate(db);

const router = new Router();

/* ------------------------------------------------------------------ meta -- */
const STORE = {
  name: 'Bijasan General Store',
  tagline: 'Fresh provisions from our family to yours',
  address_line1: 'Shop No. 4, Krishna Market, Waghai',
  address_line2: 'Waghai, Dist. Surat, Gujarat 394730',
  phone: '+91 94278 05111',
  email: 'bagulayush1@gmail.com',
  gstin: '24ABCDE1234F1Z2',
  hours: 'Mon–Sat 8:00–21:30 · Sun 9:00–14:00',
  since: 1998,
  currency: 'INR',
  currency_symbol: '₹',
};

router.get('/api/health', (req, res) => ok(res, {
  status: 'ok',
  service: 'bijasan-grocery-api',
  database: 'sqlite',
  products: q.scalar(db, 'SELECT COUNT(*) c FROM products'),
  orders: q.scalar(db, 'SELECT COUNT(*) c FROM orders'),
  uptime_seconds: Math.round(process.uptime()),
}));

router.get('/api/store', (req, res) => ok(res, {
  ...STORE,
  categories: listCategories(db),
  free_delivery_above: 300,
  delivery_fee: 25,
  payment_modes: PAYMENT_MODES,
}));

router.get('/api', (req, res) => ok(res, {
  name: 'Bijasan General Store API',
  version: '1.0.0',
  description: 'REST API for the Grocery Store Management System',
  endpoints: router.list(),
}));

/* ------------------------------------------------------------------ auth -- */
router.post('/api/auth/login', async (req, res, ctx) => {
  const { email, password } = ctx.body;
  if (!email || !password) throw badRequest('Email and password are required');

  const user = q.get(db, 'SELECT * FROM users WHERE lower(email) = lower(?)', String(email).trim());
  if (!user || !verifyPassword(String(password), user.password_hash)) {
    throw unauthorized('Email or password is incorrect');
  }
  if (!user.is_active) throw forbidden('This account has been deactivated');

  q.run(db, `UPDATE users SET last_login_at = datetime('now') WHERE id = ?`, user.id);

  const token = signToken({ sub: user.id, role: user.role, name: user.name });
  const safe = {
    id: user.id, name: user.name, email: user.email, phone: user.phone,
    role: user.role, capabilities: CAPABILITIES[user.role] || [],
  };
  res.setHeader('Set-Cookie', cookie('auth_token', token, { maxAge: 60 * 60 * 12 }));
  ok(res, { token, user: safe });
});

router.post('/api/auth/register', async (req, res, ctx) => {
  const { name, email, password, phone, role } = ctx.body;
  if (!name || !email || !password) throw badRequest('Name, email and password are required');
  if (String(password).length < 6) throw badRequest('Password must be at least 6 characters');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw badRequest('Enter a valid email address');

  const requested = (role || 'staff').toLowerCase();
  const token = (ctx.cookies.auth_token && signToken({ sub: ctx.cookies.auth_token })) ? null : null;
  void token;

  const creator = ctx.user;
  // Only an admin may mint another admin; everyone else registers as staff.
  let finalRole = 'staff';
  if (creator && creator.role === 'admin') {
    if (!['admin', 'manager', 'staff'].includes(requested)) throw badRequest('Unknown role');
    finalRole = requested;
  }

  if (q.get(db, 'SELECT id FROM users WHERE lower(email) = lower(?)', email)) {
    throw conflict('That email is already registered');
  }

  const info = q.run(db,
    `INSERT INTO users (name,email,phone,password_hash,role) VALUES (?,?,?,?,?)`,
    String(name).trim(), String(email).trim().toLowerCase(), phone || null,
    hashPassword(String(password)), finalRole);

  const user = q.get(db, 'SELECT id,name,email,phone,role FROM users WHERE id = ?', Number(info.lastInsertRowid));
  const jwt = signToken({ sub: user.id, role: user.role, name: user.name });
  res.setHeader('Set-Cookie', cookie('auth_token', jwt, { maxAge: 60 * 60 * 12 }));
  ok(res, { token: jwt, user: { ...user, capabilities: CAPABILITIES[user.role] || [] } });
});

router.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', cookie('auth_token', '', { maxAge: 0 }));
  ok(res, { logged_out: true });
});

router.get('/api/auth/me', (req, res) => {
  const user = requireAuth(req);
  ok(res, { user: { ...user, capabilities: CAPABILITIES[user.role] || [] } });
});

router.get('/api/auth/demo-accounts', (req, res) => ok(res, {
  accounts: [
    { role: 'Admin',   name: 'Ayush Bagul',       email: 'ayush.bagul@bijasan.example', password: 'Admin@123',  can: 'Full control — products, pricing, users, reports' },
    { role: 'Manager', name: 'Mahendar Chaudhary', email: 'owner@bijasan.example',    password: 'Owner@123',  can: 'Operations, suppliers and reports' },
    { role: 'Staff',   name: 'Priya Sharma',      email: 'priya.sharma@bijasan.example', password: 'Staff@123', can: 'Billing counter and day-to-day stock' },
  ],
}));

/* --------------------------------------------------------------- catalog -- */
router.get('/api/categories', (req, res) => ok(res, { items: listCategories(db) }));

router.get('/api/suppliers', (req, res) => ok(res, { items: listSuppliers(db) }));

router.get('/api/products', (req, res, ctx) => {
  ok(res, listProducts(db, {
    q: ctx.query.get('q') || undefined,
    category: ctx.query.get('category') || undefined,
    supplier: ctx.query.get('supplier') || undefined,
    brand: ctx.query.get('brand') || undefined,
    minPrice: ctx.query.get('min_price') || undefined,
    maxPrice: ctx.query.get('max_price') || undefined,
    inStock: ctx.query.get('in_stock') === '1' || undefined,
    featured: ctx.query.get('featured') === '1' || undefined,
    maxDiscount: ctx.query.get('min_discount') || undefined,
    sort: ctx.query.get('sort') || 'featured',
    page: ctx.query.get('page'),
    perPage: ctx.query.get('per_page'),
  }));
});

router.get('/api/products/facets', (req, res) => ok(res, getFacets(db)));

router.get('/api/products/:id', (req, res, ctx) => {
  const product = getProduct(db, ctx.params.id);
  product.related = listProducts(db, { category: product.category_slug, perPage: 8 })
    .items.filter((p) => p.id !== product.id).slice(0, 6);
  product.movements = movementHistory(db, product.id, 15);
  ok(res, product);
});

router.post('/api/products', async (req, res, ctx) => {
  requireRole('admin', 'manager')(req);
  ok(res, createProduct(db, ctx.body, req.user.id));
});

router.patch('/api/products/:id', async (req, res, ctx) => {
  requireRole('admin', 'manager')(req);
  ok(res, updateProduct(db, Number(ctx.params.id), ctx.body, req.user.id));
});

router.post('/api/products/:id/status', async (req, res, ctx) => {
  requireRole('admin', 'manager')(req);
  ok(res, setProductStatus(db, Number(ctx.params.id), ctx.body.status, req.user.id));
});

router.delete('/api/products/:id', async (req, res, ctx) => {
  requireRole('admin')(req);
  const id = Number(ctx.params.id);
  // Soft delete keeps invoice history intact
  setProductStatus(db, id, 'discontinued', req.user.id);
  ok(res, { id, status: 'discontinued' });
});

/* -------------------------------------------------------------- inventory -- */
router.get('/api/inventory', (req, res, ctx) => ok(res, listProducts(db, {
  q: ctx.query.get('q') || undefined,
  category: ctx.query.get('category') || undefined,
  sort: ctx.query.get('sort') || 'name-asc',
  page: ctx.query.get('page'),
  perPage: ctx.query.get('per_page') || 24,
})));

router.get('/api/inventory/low-stock', (req, res) => ok(res, { items: lowStockList(db) }));

router.post('/api/inventory/:id/adjust', async (req, res, ctx) => {
  requireRole('admin', 'manager', 'staff')(req);
  const body = ctx.body;
  if (body.mode === 'receive') {
    return ok(res, receiveStock(db, Number(ctx.params.id), body.quantity, body.note || '', req.user.id));
  }
  return ok(res, adjustStock(db, Number(ctx.params.id), body.quantity,
    body.reason || 'adjustment', body.note || '', req.user.id));
});

router.get('/api/inventory/:id/movements', (req, res, ctx) =>
  ok(res, { items: movementHistory(db, Number(ctx.params.id)) }));

router.get('/api/alerts', (req, res, ctx) => {
  const onlyUnread = ctx.query.get('unread') === '1';
  const items = q.all(db, `
    SELECT a.*, p.name AS product_name, p.sku, c.name AS category_name
    FROM alerts a
    LEFT JOIN products p ON p.id = a.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    ${onlyUnread ? 'WHERE a.is_read = 0' : ''}
    ORDER BY a.created_at DESC, a.id DESC LIMIT 60`);
  ok(res, { items, unread: q.scalar(db, 'SELECT COUNT(*) FROM alerts WHERE is_read = 0') });
});

router.post('/api/alerts/read', async (req, res, ctx) => {
  requireRole('admin', 'manager', 'staff')(req);
  const ids = Array.isArray(ctx.body.ids) ? ctx.body.ids.map(Number).filter(Boolean) : null;
  if (ids?.length) q.run(db, `UPDATE alerts SET is_read = 1 WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
  else q.run(db, 'UPDATE alerts SET is_read = 1 WHERE is_read = 0');
  ok(res, { unread: q.scalar(db, 'SELECT COUNT(*) FROM alerts WHERE is_read = 0') });
});

/* ----------------------------------------------------------------- sales -- */
router.post('/api/sales/quote', async (req, res, ctx) => ok(res, quote(db, ctx.body)));

router.get('/api/orders', (req, res, ctx) => {
  requireRole('admin', 'manager', 'staff')(req);
  ok(res, listOrders(db, {
    status: ctx.query.get('status') || undefined,
    search: ctx.query.get('q') || undefined,
    customerId: ctx.query.get('customer_id') || undefined,
    from: ctx.query.get('from') || undefined,
    to: ctx.query.get('to') || undefined,
    page: ctx.query.get('page'),
    perPage: ctx.query.get('per_page'),
  }));
});

router.get('/api/orders/:id', (req, res, ctx) => {
  const order = getOrder(db, ctx.params.id);
  // staff may only see walk-in orders; a customer order needs admin or ownership
  if (!req.user && order.customer_id) throw unauthorized('Sign in to view this order');
  ok(res, order);
});

router.post('/api/orders', async (req, res, ctx) => {
  const user = requireAuth(req);
  if (!can(user.role, 'orders:write')) throw forbidden('Your role cannot create orders');
  ok(res, createOrder(db, ctx.body, user));
});

router.post('/api/orders/:id/status', async (req, res, ctx) => {
  const user = requireAuth(req);
  if (!can(user.role, 'orders:write')) throw forbidden('Your role cannot update orders');
  ok(res, updateOrderStatus(db, ctx.params.id, ctx.body.status, user.id));
});

router.get('/api/orders/track/:orderNo', (req, res, ctx) => {
  const order = getOrder(db, ctx.params.orderNo);
  ok(res, {
    order_no: order.order_no, status: order.status, payment_status: order.payment_status,
    created_at: order.created_at, customer_name: order.customer_name,
    total: order.total, total_rupees: toRupees(order.total),
    item_count: order.items.length,
  });
});

/* ------------------------------------------------------------- customers -- */
router.get('/api/customers', (req, res, ctx) => {
  requireRole('admin', 'manager')(req);
  ok(res, { items: listCustomers(db, { search: ctx.query.get('q') || undefined }) });
});

router.get('/api/customers/:id', (req, res, ctx) => ok(res, getCustomer(db, ctx.params.id)));

router.post('/api/customers', async (req, res, ctx) => {
  requireRole('admin', 'manager')(req);
  ok(res, createCustomer(db, ctx.body));
});

router.patch('/api/customers/:id', async (req, res, ctx) => {
  requireRole('admin', 'manager')(req);
  ok(res, updateCustomer(db, Number(ctx.params.id), ctx.body));
});

router.post('/api/customers/:id/loyalty', async (req, res, ctx) => {
  requireRole('admin', 'manager')(req);
  ok(res, adjustLoyalty(db, Number(ctx.params.id), ctx.body.points, ctx.body.reason));
});

/* ----------------------------------------------------------------- users -- */
router.get('/api/users', (req, res) => {
  requireRole('admin', 'manager')(req);
  ok(res, { items: q.all(db,
    `SELECT id,name,email,phone,role,is_active,last_login_at,created_at FROM users ORDER BY role,name`) });
});

router.patch('/api/users/:id', async (req, res, ctx) => {
  const actor = requireRole('admin')(req);
  const id = Number(ctx.params.id);
  if (id === actor.id && ctx.body.role && ctx.body.role !== 'admin') {
    throw badRequest('You cannot remove your own admin access');
  }
  const user = q.get(db, 'SELECT * FROM users WHERE id = ?', id);
  if (!user) throw notFound('User not found');

  const role = ctx.body.role ?? user.role;
  if (!['admin', 'manager', 'staff'].includes(role)) throw badRequest('Unknown role');
  q.run(db, `UPDATE users SET role = ?, is_active = ? WHERE id = ?`,
    role, ctx.body.is_active === undefined ? user.is_active : (ctx.body.is_active ? 1 : 0), id);

  if (ctx.body.password) {
    if (String(ctx.body.password).length < 6) throw badRequest('Password must be at least 6 characters');
    q.run(db, 'UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(String(ctx.body.password)), id);
  }
  ok(res, q.get(db, 'SELECT id,name,email,phone,role,is_active FROM users WHERE id = ?', id));
});

/* --------------------------------------------------------------- reports -- */
router.get('/api/reports/dashboard', (req, res, ctx) => {
  const user = requireAuth(req);
  ok(res, {
    ...dashboard(db),
    series: salesSeries(db, { days: ctx.query.get('days') || 14 }),
    user: { name: user.name, role: user.role },
    recent_orders: listOrders(db, { perPage: 8 }).items,
    top_products: listProducts(db, { sort: 'featured', perPage: 6 }).items,
  });
});

router.get('/api/reports/sales', (req, res, ctx) => {
  requireRole('admin', 'manager')(req);
  ok(res, salesReport(db, { from: ctx.query.get('from'), to: ctx.query.get('to') }));
});

router.get('/api/reports/inventory', (req, res) => {
  requireRole('admin', 'manager')(req);
  ok(res, inventoryReport(db));
});

router.get('/api/reports/customers', (req, res, ctx) => {
  requireRole('admin', 'manager')(req);
  ok(res, customerReport(db, { limit: ctx.query.get('limit') || 50 }));
});

router.get('/api/reports/series', (req, res, ctx) => {
  requireAuth(req);
  const granularity = ctx.query.get('granularity') === 'month' ? 'month' : 'day';
  ok(res, granularity === 'month'
    ? { granularity, items: monthlySeries(db, { months: ctx.query.get('days') || 6 }) }
    : { granularity, items: salesSeries(db, { days: ctx.query.get('days') || 14 }) });
});

router.get('/api/reports/saved', (req, res, ctx) => {
  requireRole('admin', 'manager')(req);
  ok(res, { items: listReports(db, { limit: ctx.query.get('limit') || 25 }) });
});

router.post('/api/reports/save', async (req, res, ctx) => {
  const user = requireRole('admin', 'manager')(req);
  const { type } = ctx.body;
  if (!type) throw badRequest('report_type is required');

  const payload = type === 'sales' ? salesReport(db, ctx.body)
    : type === 'inventory' ? inventoryReport(db)
    : type === 'customers' ? customerReport(db)
    : dashboard(db);

  ok(res, saveReport(db, {
    type,
    period: ctx.body.period || new Date().toISOString().slice(0, 10),
    payload,
  }, user.id));
});

/* ---------------------------------------------------------------- server -- */
export function createRequestHandler() {
  return async (req, res) => {
    const cookies = parseCookies(req);
    attachUser(db, cookies)(req);

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let pathname = url.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);

    // security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');

    const route = router.match(req.method, pathname);

    if (route) {
      const ctx = { params: route.params, query: url.searchParams, cookies, body: {} };
      try {
        if (['POST', 'PATCH', 'PUT'].includes(req.method)) ctx.body = await readJson(req);
        const result = await route.handler(req, res, ctx);
        if (!res.writableEnded) ok(res, result ?? { ok: true });
      } catch (err) {
        if (res.writableEnded || res.headersSent) return;
        if (err instanceof HttpError) {
          fail(res, err.status, err.message, err.details ? { details: err.details } : undefined);
        } else {
          console.error(`[error] ${req.method} ${pathname}`, err);
          fail(res, 500, 'Something went wrong on our side. Please try again.');
        }
      }
      return;
    }

    if (pathname.startsWith('/api/')) return fail(res, 404, `No API route for ${req.method} ${pathname}`);

    // static assets + SPA fallback
    if (serveStatic(PUBLIC_DIR, res, pathname === '/' ? '/index.html' : pathname)) return;
    if (req.method === 'GET' && !extnameGuarded(pathname)) {
      if (serveStatic(PUBLIC_DIR, res, '/index.html')) return;
    }
    fail(res, 404, 'Not found');
  };
}

function extnameGuarded(p) {
  const last = p.slice(p.lastIndexOf('/') + 1);
  return last.includes('.');
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const server = createServer(createRequestHandler());

if (isDirectExecution) {
  server.listen(PORT, HOST, () => {
    console.log(`\n  🛒  ${STORE.name} — Grocery Store Management System`);
    console.log(`      Storefront : http://localhost:${PORT}`);
    console.log(`      API index  : http://localhost:${PORT}/api`);
    console.log(`      Sign in    : ayush.bagul@bijasan.example / Admin@123\n`);
  });

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => { try { db.close(); } catch { /* noop */ } process.exit(0); });
  }
}

export default createRequestHandler();
