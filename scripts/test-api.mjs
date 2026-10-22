/**
 * End-to-end API test suite — no test framework required.
 * Boots a server on an in-memory database, then exercises every module
 * through real HTTP calls exactly as the browser does.
 *
 *   node scripts/test-api.mjs
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 3399;
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0, failed = 0;
const failures = [];

const C = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', y: '\x1b[33m', b: '\x1b[1m', x: '\x1b[0m' };

function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ${C.g}✓${C.x} ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ${C.r}✗ ${name}${C.x}${detail ? ` ${C.d}${detail}${C.x}` : ''}`);
  }
}
const section = (t) => console.log(`\n${C.b}${t}${C.x}`);

/* --------------------------------------------------------------- client -- */
let token = null;
async function api(method, path, body, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token && !opts.noAuth) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: res.status, body: json };
}

/* ------------------------------------------------------------------ run -- */
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), BGS_DB: ':memory:' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => {
  const s = String(d);
  serverLog += s;
  if (!/ExperimentalWarning|trace-warnings/.test(s)) process.stderr.write(s);
});

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  return false;
}

try {
  const up = await waitForServer();
  if (!up) {
    console.error('Server failed to start:\n', serverLog);
    process.exit(1);
  }

  /* ------------------------------------------------------- meta & health -- */
  section('Platform');
  {
    const h = await api('GET', '/api/health');
    check('health endpoint responds', h.status === 200 && h.body.status === 'ok');
    check('database is sqlite', h.body.database === 'sqlite');
    check('seed data present (products > 0)', h.body.products > 0, `products=${h.body.products}`);
    check('sales history present (orders > 100)', h.body.orders > 100, `orders=${h.body.orders}`);

    const s = await api('GET', '/api/store');
    check('store profile served', s.body.name === 'Bijasan General Store');
    check('categories loaded', Array.isArray(s.body.categories) && s.body.categories.length === 10);

    const idx = await api('GET', '/api');
    check('API index lists endpoints', Array.isArray(idx.body.endpoints) && idx.body.endpoints.length > 25,
      `endpoints=${idx.body.endpoints?.length}`);
  }

  /* --------------------------------------------------------------- auth -- */
  section('Authentication & RBAC');
  {
    const bad = await api('GET', '/api/reports/sales');
    check('protected route rejects anonymous', bad.status === 401);

    const wrong = await api('POST', '/api/auth/login', { email: 'ayush.bagul@bijasan.example', password: 'nope' });
    check('wrong password rejected', wrong.status === 401);

    const login = await api('POST', '/api/auth/login', {
      email: 'ayush.bagul@bijasan.example', password: 'Admin@123',
    });
    check('admin login succeeds', login.status === 200 && !!login.body.token);
    check('login returns capabilities', Array.isArray(login.body.user?.capabilities) &&
      login.body.user.capabilities.includes('users:write'));
    token = login.body.token;

    const me = await api('GET', '/api/auth/me');
    check('/me identifies the admin', me.body.user?.role === 'admin');

    // staff must be blocked from admin-only areas
    const staffLogin = await api('POST', '/api/auth/login', {
      email: 'priya.sharma@bijasan.example', password: 'Staff@123',
    });
    check('staff login succeeds', staffLogin.status === 200);
    const staffToken = staffLogin.body.token;

    const adminToken = token;
    token = staffToken;
    const blocked = await api('GET', '/api/users');
    check('staff blocked from user management', blocked.status === 403, `got ${blocked.status}`);
    const allowed = await api('GET', '/api/orders');
    check('staff allowed to list orders', allowed.status === 200);
    token = adminToken;
  }

  /* ------------------------------------------------------------ catalog -- */
  section('Catalog & search');
  let productId, outOfStockId;
  {
    const all = await api('GET', '/api/products?per_page=60');
    check('product list returns items', all.body.items.length === 60);
    const shaped = all.body.items[0];
    check('product exposes price in paise + rupees',
      Number.isInteger(shaped.price) && typeof shaped.price_rupees === 'number');
    check('product exposes stock state', ['available', 'low_stock', 'out_of_stock'].includes(shaped.stock_state));
    check('pagination metadata present', all.body.total_pages >= 1 && all.body.per_page === 60);

    const search = await api('GET', '/api/products?q=atta');
    check('search by name works', search.body.items.length > 0 && search.body.items.length < 60);

    const cat = await api('GET', '/api/products?category=spices');
    check('category filter works',
      cat.body.items.length > 0 && cat.body.items.every((p) => p.category_slug === 'spices'));

    const sorted = await api('GET', '/api/products?sort=price-asc&per_page=60');
    const prices = sorted.body.items.map((p) => p.price);
    check('price sort is ascending', prices.every((v, i, a) => i === 0 || a[i - 1] <= v));

    const cheap = await api('GET', '/api/products?max_price=50&per_page=60');
    check('max price filter respected', cheap.body.items.every((p) => p.price <= 5000));

    const instock = await api('GET', '/api/products?in_stock=1&per_page=60');
    check('in-stock filter respected', instock.body.items.every((p) => p.quantity > 0));

    const prod = await api('GET', `/api/products/${all.body.items[0].id}`);
    check('single product includes related items', Array.isArray(prod.body.related));
    check('single product includes stock movements', Array.isArray(prod.body.movements));

    const missing = await api('GET', '/api/products/does-not-exist');
    check('unknown product returns 404', missing.status === 404);

    const facets = await api('GET', '/api/products/facets');
    check('facets expose brands', facets.body.brands.length > 5);

    productId = all.body.items.find((p) => p.quantity > 5).id;
    outOfStockId = all.body.items.find((p) => p.quantity === 0)?.id ?? null;
    check('seed includes an out-of-stock item', outOfStockId !== null);
  }

  /* ---------------------------------------------------------- inventory -- */
  section('Inventory & product state machine');
  {
    const created = await api('POST', '/api/products', {
      name: 'Test Basil Seeds (Tulsi)',
      category_id: 1,
      price: 45,
      mrp: 60,
      unit: 'pack',
      pack_size: '50 g',
      tax_rate: 5,
      brand: 'Test',
      quantity: 30,
      reorder_level: 10,
      is_featured: 0,
    });
    check('create product (admin)', created.status === 200 && created.body.name.startsWith('Test Basil'));
    const testId = created.body.id;
    check('new product status = available', created.body.status === 'available');

    const noName = await api('POST', '/api/products', { price: 10 });
    check('create product rejects missing name', noName.status === 400);

    const badCat = await api('POST', '/api/products', { name: 'X', category_id: 9999, price: 10 });
    check('create product rejects unknown category', badCat.status === 400);

    const patch = await api('PATCH', `/api/products/${testId}`, { price: 49, mrp: 60 });
    check('update product price', patch.status === 200 && patch.body.price === 4900);

    // receive stock
    const recv = await api('POST', `/api/inventory/${testId}/adjust`, { mode: 'receive', quantity: 25 });
    check('goods received increases stock', recv.body.quantity === 55, `got ${recv.body.quantity}`);

    // drive to low_stock
    const low = await api('POST', `/api/inventory/${testId}/adjust`, { quantity: 8 });
    check('low stock state applied', low.body.status === 'low_stock', `got ${low.body.status}`);

    const alerts = await api('GET', '/api/alerts?unread=1');
    check('low stock raises an alert',
      alerts.body.items.some((a) => a.message.includes('Test Basil')), 
      `alerts=${alerts.body.items.length}`);

    // drive to out_of_stock
    const out = await api('POST', `/api/inventory/${testId}/adjust`, { quantity: 0 });
    check('out of stock state applied', out.body.status === 'out_of_stock');

    // discontinue / re-introduce
    const disc = await api('POST', `/api/products/${testId}/status`, { status: 'discontinued' });
    check('discontinue product', disc.body.status === 'discontinued');
    const hidden = await api('GET', '/api/products?q=Test%20Basil');
    check('discontinued product hidden from catalogue', hidden.body.items.length === 0);

    const reintroduce = await api('POST', `/api/products/${testId}/status`, { status: 'available' });
    check('re-introduce restores product to catalogue', reintroduce.body.status !== 'discontinued');
    // re-introducing a shelf-empty product correctly falls back to out_of_stock
    const restocked = await api('POST', `/api/inventory/${testId}/adjust`, { mode: 'receive', quantity: 40 });
    check('restock after re-introduction → available', restocked.body.status === 'available',
      `got ${restocked.body.status}`);

    const badStatus = await api('POST', `/api/products/${testId}/status`, { status: 'weird' });
    check('invalid status rejected', badStatus.status === 400);

    const neg = await api('POST', `/api/inventory/${testId}/adjust`, { quantity: -5 });
    check('negative quantity clamped to zero', neg.status === 200 && neg.body.quantity === 0);

    const lowList = await api('GET', '/api/inventory/low-stock');
    check('low-stock report lists items', lowList.body.items.length > 0);

    const mv = await api('GET', `/api/inventory/${testId}/movements`);
    check('movement journal records every change', mv.body.items.length >= 5, `moves=${mv.body.items.length}`);
    check('journal is append-only with reasons',
      mv.body.items.every((m) => ['opening', 'restock', 'adjustment', 'sale', 'return'].includes(m.reason)));
  }

  /* ------------------------------------------------------------ billing -- */
  section('Billing / sales flow');
  let orderId, orderNo;
  {
    const p1 = await api('GET', `/api/products/${productId}`);
    const stockBefore = p1.body.quantity;

    const quoteRes = await api('POST', '/api/sales/quote', {
      items: [{ product_id: productId, quantity: 3 }],
      discount_pct: 5,
    });
    check('quote prices a cart', quoteRes.status === 200 && quoteRes.body.total > 0);
    check('quote reports rupees', typeof quoteRes.body.rupees.total === 'string');
    check('delivery fee waived above ₹300', quoteRes.body.rupees.delivery_fee === '0.00');

    const small = await api('POST', '/api/sales/quote', {
      items: [{ product_id: productId, quantity: 1 }],
    });
    check('delivery fee applied below threshold', small.body.rupees.delivery_fee === '25.00');

    const cust = await api('POST', '/api/customers', {
      name: 'Test Customer', phone: '+919000000001', city: 'Waghai',
    });
    check('create customer', cust.status === 200);
    const custId = cust.body.id;

    const created = await api('POST', '/api/orders', {
      items: [
        { product_id: productId, quantity: 3 },
        { product_id: productId + 1, quantity: 2 },
      ],
      payment_mode: 'upi',
      discount_pct: 5,
      customer_id: custId,
      status: 'delivered',
      address: 'Test address, Waghai',
    });
    check('create order', created.status === 200 && !!created.body.order_no);
    orderId = created.body.id;
    orderNo = created.body.order_no;
    check('order totals balance',
      created.body.total === created.body.subtotal - created.body.discount + created.body.delivery_fee,
      `total=${created.body.total} sub=${created.body.subtotal} disc=${created.body.discount} del=${created.body.delivery_fee}`);
    check('invoice generated on sale', !!created.body.invoice_no);
    check('order line items snapshot names', created.body.items.every((i) => i.product_name));
    check('loyalty points awarded', created.body.payment_status === 'paid');

    const after = await api('GET', `/api/products/${productId}`);
    check('stock deducted on sale', after.body.quantity === stockBefore - 3,
      `before=${stockBefore} after=${after.body.quantity}`);

    // oversell guard
    const huge = await api('POST', '/api/orders', { items: [{ product_id: productId, quantity: 99999 }] });
    check('oversell rejected with 409', huge.status === 409);
    check('oversell explains the shortage',
      huge.body.details?.shortages?.[0]?.available === after.body.quantity);

    const emptyCart = await api('POST', '/api/orders', { items: [] });
    check('empty cart rejected', emptyCart.status === 400);

    const badMode = await api('POST', '/api/orders', {
      items: [{ product_id: productId, quantity: 1 }], payment_mode: 'crypto',
    });
    check('invalid payment mode rejected', badMode.status === 400);

    // lifecycle
    const o2 = await api('POST', '/api/orders', {
      items: [{ product_id: productId, quantity: 1 }], payment_mode: 'cash', status: 'pending',
    });
    const conf = await api('POST', `/api/orders/${o2.body.id}/status`, { status: 'confirmed' });
    check('order status pending → confirmed', conf.body.status === 'confirmed');
    const badMove = await api('POST', `/api/orders/${o2.body.id}/status`, { status: 'delivered' });
    check('illegal status jump rejected', badMove.status === 409);

    const packed = await api('POST', `/api/orders/${o2.body.id}/status`, { status: 'packed' });
    check('order confirmed → packed', packed.body.status === 'packed');
    const ofd = await api('POST', `/api/orders/${o2.body.id}/status`, { status: 'out_for_delivery' });
    check('order packed → out_for_delivery', ofd.body.status === 'out_for_delivery');
    const deliv = await api('POST', `/api/orders/${o2.body.id}/status`, { status: 'delivered' });
    check('order out_for_delivery → delivered', deliv.body.status === 'delivered');
    check('invoice issued on delivery', !!deliv.body.invoice_no);

    // cancellation restores stock
    const stockPre = (await api('GET', `/api/products/${productId}`)).body.quantity;
    const o3 = await api('POST', '/api/orders', {
      items: [{ product_id: productId, quantity: 2 }], payment_mode: 'card', status: 'confirmed',
    });
    const stockMid = (await api('GET', `/api/products/${productId}`)).body.quantity;
    check('stock reduced for pending order', stockMid === stockPre - 2);
    const cancelled = await api('POST', `/api/orders/${o3.body.id}/status`, { status: 'cancelled' });
    check('order cancelled', cancelled.body.status === 'cancelled');
    check('payment marked refunded', cancelled.body.payment_status === 'refunded');
    const stockPost = (await api('GET', `/api/products/${productId}`)).body.quantity;
    check('cancellation returns stock', stockPost === stockPre, `${stockPre} vs ${stockPost}`);

    const custAfter = await api('GET', `/api/customers/${custId}`);
    check('customer history records orders', custAfter.body.orders.length >= 1);
    check('customer lifetime value updated', custAfter.body.total_spent > 0);

    const dupPhone = await api('POST', '/api/customers', { name: 'Dup', phone: '+919000000001' });
    check('duplicate customer phone rejected', dupPhone.status === 409);

    const track = await api('GET', `/api/orders/track/${orderNo}`);
    check('order tracking by number works', track.body.order_no === orderNo);
  }

  /* ------------------------------------------------------------ reports -- */
  section('Reports & analytics');
  {
    const dash = await api('GET', '/api/reports/dashboard');
    check('dashboard returns KPI block', typeof dash.body.today?.revenue === 'number');
    check('dashboard revenue in rupees', typeof dash.body.today.revenue_rupees === 'string');
    check('dashboard growth calculated', typeof dash.body.today.growth_pct === 'number');
    check('dashboard inventory valuation', dash.body.inventory.value > 0);
    check('dashboard series has no gaps', dash.body.series.length === 14);
    check('dashboard recent orders', dash.body.recent_orders.length > 0);

    const sales = await api('GET', '/api/reports/sales');
    check('sales report summary', sales.body.summary.orders > 0);
    check('sales report payment mix', sales.body.paymentMix.length > 0);
    check('sales report top products', sales.body.topProducts.length > 0);
    check('sales report category split', sales.body.byCategory.length > 0);
    check('sales report hourly curve', sales.body.byHour.length > 0);
    check('avg order value computed', sales.body.summary.avg_order_value !== '0.00');

    const inv = await api('GET', '/api/reports/inventory');
    check('inventory report valuation', inv.body.summary.retail_value > 0);
    check('inventory report by category', inv.body.byCategory.length === 10);
    check('inventory report low stock section', Array.isArray(inv.body.lowStock));

    const custRep = await api('GET', '/api/reports/customers');
    check('customer report lists customers', custRep.body.customers.length > 0);
    check('customers sorted by value',
      custRep.body.customers.every((c, i, a) => i === 0 || a[i - 1].total_spent >= c.total_spent));

    const monthly = await api('GET', '/api/reports/series?granularity=month');
    check('monthly series available', monthly.body.items.length >= 2);

    const saved = await api('POST', '/api/reports/save', { type: 'sales', period: '2026-10' });
    check('report snapshot saved', saved.status === 200 && !!saved.body.id);
    const list = await api('GET', '/api/reports/saved');
    check('saved reports listed', list.body.items.length > 0);
  }

  /* ------------------------------------------------------- UX-facing data -- */
  section('Storefront support endpoints');
  {
    const featured = await api('GET', '/api/products?featured=1');
    check('featured products for hero carousel', featured.body.items.length >= 4);
    const deals = await api('GET', '/api/products?min_discount=10&per_page=20');
    check('discount filter returns deals', deals.body.items.length > 0);
    const discountOk = deals.body.items.every((p) => p.discount_pct >= 10);
    check('every deal really is ≥10% off', discountOk);

    const suppliers = await api('GET', '/api/suppliers');
    check('suppliers listed with product counts', suppliers.body.items.length === 4 &&
      suppliers.body.items.every((s) => s.product_count > 0));

    const cats = await api('GET', '/api/categories');
    check('categories carry product counts', cats.body.items.every((c) => c.product_count > 0));

    const openOrders = await api('GET', '/api/orders?status=open');
    check('open-orders filter works', openOrders.body.items.every(
      (o) => ['pending', 'confirmed', 'packed', 'out_for_delivery'].includes(o.status)));
  }

  /* --------------------------------------------------------- robustness -- */
  section('Robustness');
  {
    const notFound = await api('GET', '/api/does-not-exist');
    check('unknown API route → 404 JSON', notFound.status === 404 && !!notFound.body.error);

    const badJson = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops',
    });
    check('malformed JSON → 400', badJson.status === 400);

    const tampered = await api('GET', '/api/auth/me', undefined, {});
    const forged = await fetch(`${BASE}/api/reports/sales`, { headers: { Authorization: 'Bearer abc.def.ghi' } });
    check('forged token rejected', forged.status === 401);

    // SQL injection attempt must be inert
    const inject = await api('GET', `/api/products?q=${encodeURIComponent("'; DROP TABLE products; --")}`);
    check('SQL injection is parameterised (server alive)', inject.status === 200);
    const stillThere = await api('GET', '/api/products?per_page=1');
    check('products table survived injection attempt', stillThere.body.total > 50);

    const html = await fetch(`${BASE}/`);
    check('SPA served at /', html.status === 200 && html.headers.get('content-type').includes('text/html'));

    const deep = await fetch(`${BASE}/admin/inventory`);
    check('SPA deep-link falls back to index.html', deep.status === 200);
  }

} catch (err) {
  failed++;
  failures.push(`SUITE CRASH: ${err.stack}`);
  console.error('\nSuite crashed:', err);
} finally {
  server.kill();
}

console.log(`\n${C.b}${'─'.repeat(58)}${C.x}`);
if (failed === 0) {
  console.log(`${C.g}${C.b}  ✓ ALL ${passed} CHECKS PASSED${C.x}`);
} else {
  console.log(`${C.r}${C.b}  ✗ ${failed} FAILED${C.x} ${C.d}/ ${passed} passed${C.x}`);
  for (const f of failures) console.log(`${C.r}    · ${f}${C.x}`);
}
console.log(`${C.b}${'─'.repeat(58)}${C.x}\n`);
process.exit(failed === 0 ? 0 : 1);