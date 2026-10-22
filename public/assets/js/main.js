/**
 * Application bootstrap — registers every route, mounts the shell
 * and starts the app. This is the only entry point.
 */
import { h, render, mount, track, signal } from './core/react.js';
import { route, setNotFound, initRouter, setNavigateHandler, navigate, currentRoute } from './core/router.js';
import { api } from './core/api.js';
import { icon } from './ui/icons.js';
import { Button, EmptyState, PageLoader } from './ui/components.js';
import { consoleSidebar, consoleTop, requireConsole, refreshAlertCount } from './ui/console.js';
import { store, loadStore, restoreSession, user, toast, loadStore as _ls } from './data/store.js';
import { installGlobalChrome, StoreHeader, Footer, MobileMenu } from './ui/shell.js';
import { homePage } from './pages/home.js';
import { shopPage, dealsPage } from './pages/shop.js';
import { productPage } from './pages/product.js';
import { cartPage, checkoutPage, orderPage } from './pages/cart.js';
import { loginPage } from './pages/auth.js';
import { accountPage, ordersPage, trackPage } from './pages/account.js';
import { dashboardPage } from './pages/admin/dashboard.js';
import { billingPage } from './pages/admin/billing.js';
import { ordersPage as adminOrdersPage } from './pages/admin/orders.js';
import { inventoryPage, alertsPage } from './pages/admin/inventory.js';
import { reportsPage } from './pages/admin/reports.js';
import { suppliersPage, customersPage, usersPage } from './pages/admin/people.js';

const app = document.getElementById('app');
const outlet = document.getElementById('view');
const chrome = document.getElementById('chrome');

const menuOpen = signal(false);
let currentConsole = null;   // { dispose, title, actions }

const CONSOLE_ROUTES = [
  ['/admin', dashboardPage, 'Dashboard'],
  ['/admin/billing', billingPage, 'Billing counter'],
  ['/admin/orders', adminOrdersPage, 'Orders'],
  ['/admin/inventory', inventoryPage, 'Inventory'],
  ['/admin/alerts', alertsPage, 'Alerts'],
  ['/admin/reports', reportsPage, 'Reports'],
  ['/admin/suppliers', suppliersPage, 'Suppliers'],
  ['/admin/customers', customersPage, 'Customers'],
  ['/admin/users', usersPage, 'Staff & roles'],
];

/* ---------------------------------------------------------- chrome bar -- */
/**
 * The shell owns the page furniture; the router owns the page body.
 * `#chrome` is a sibling of `#view` at all times — the outlet element is
 * never moved, which keeps the router and the layout independent.
 */
const STAFF_ROLES = ['admin', 'manager', 'staff'];

function applySidebar(open) {
  const sb = document.querySelector('.sidebar');
  if (sb) sb.classList.toggle('open', open);
  const scrim = document.querySelector('.sidebar-scrim');
  if (scrim) scrim.remove();
  if (open && !scrim) {
    const el = render(h('div.sidebar-scrim', { onclick: () => applySidebar(false) }));
    document.getElementById('app')?.prepend(el);
  }
}

function renderChrome() {
  const path = location.pathname;
  const me = track(user);
  const isConsole = path.startsWith('/admin') && me && STAFF_ROLES.includes(me.role);
  const app = document.getElementById('app');
  app?.classList.toggle('is-console', Boolean(isConsole));

  if (isConsole) {
    const sidebar = render(consoleSidebar({
      open: track(menuOpen),
      onClose: () => { menuOpen.value = false; applySidebar(false); },
    }));
    chrome.replaceChildren(sidebar);
    if (outlet.parentElement !== app) app.appendChild(outlet);
    return;
  }

  const mainSlot = render(h('main'));
  chrome.replaceChildren(render(h(StoreHeader)), mainSlot, render(h(Footer)));
  // the outlet lives inside <main> for the storefront; move it back and forth
  // without ever losing the element itself
  if (outlet.parentElement !== mainSlot) mainSlot.appendChild(outlet);
}

/* ------------------------------------------------------------- routes -- */
const S = (page) => ({ params, query }) => page({ params, query, path: location.pathname });

route('/', homePage);
route('/shop', S(shopPage));
route('/deals', S(dealsPage));
route('/product/:slug', S(productPage));
route('/cart', S(cartPage));
route('/checkout', S(checkoutPage));
route('/order/:orderNo', S(orderPage));
route('/login', S(loginPage));
route('/account', S(accountPage));
route('/orders', S(ordersPage));
route('/track', S(trackPage));

for (const [prefix, page, title] of CONSOLE_ROUTES) {
  route(prefix, async (ctx) => {
    if (!requireConsole()) return { node: PageLoader() };
    currentConsole = { title };
    document.title = `${title} · Bijasan Console`;
    return page(ctx);
  });
}

setNotFound(() => {
  document.title = 'Page not found · Bijasan General Store';
  return h('div.container-page', null, h('div.shell', null,
    EmptyState({
      icon: 'search', title: '404 — page not found',
      text: 'That shelf is empty. Try the shop, or head back home.',
      action: h('div.row.gap-2', null,
        Button({ variant: 'default', onclick: () => history.back() }, 'Go back'),
        Button({ variant: 'primary', onclick: () => navigate('/') }, 'Home')),
    })));
});

/* ------------------------------------------------------------- boot ---- */
async function boot() {
  document.body.appendChild(render(
    h('div', { style: { position: 'fixed', inset: '0', display: 'grid', placeItems: 'center', zIndex: '999',
                        background: 'var(--bg)', transition: 'opacity 240ms' }, id: 'boot' },
      h('div.col', { style: { alignItems: 'center', gap: '1rem' } },
        h('div.loader-mark', { style: { width: '3.5rem', height: '3.5rem' } }, icon('package', { size: 26 })),
        h('div.col', { style: { alignItems: 'center', gap: '0.25rem' } },
          h('span', { style: { fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: '600' } }, 'Bijasan General Store'),
          h('span.text-sm.text-muted', null, 'Opening the shop…'))))
    ));

  // 1. store profile + session, in parallel
  try {
    await Promise.all([loadStore(), restoreSession()]);
  } catch (err) {
    console.error('[boot]', err);
  }

  // 2. paint the chrome and start routing
  installGlobalChrome();
  renderChrome();
  setNavigateHandler(() => renderChrome());
  initRouter(outlet);

  // 3. warm the alert counter for staff
  if (user.value && ['admin', 'manager', 'staff'].includes(user.value.role)) {
    refreshAlertCount();
    setInterval(refreshAlertCount, 60_000);
  }

  // 4. reveal
  const bootEl = document.getElementById('boot');
  if (bootEl) {
    bootEl.style.opacity = '0';
    setTimeout(() => bootEl.remove(), 260);
  }
}

/* keep the console top-bar title in sync and close the mobile menu on nav */
document.addEventListener('route:changed', () => { menuOpen.value = false; });

boot().catch((err) => {
  console.error('[boot] fatal', err);
  document.body.innerHTML = `
    <div style="display:grid;place-items:center;min-height:100dvh;padding:2rem;font-family:system-ui,sans-serif;text-align:center">
      <div style="max-width:44ch">
        <h1 style="font-size:1.5rem;margin:0 0 .5rem">The shop could not open</h1>
        <p style="color:#666;margin:0 0 1rem">${String(err.message || err)}</p>
        <p style="color:#999;font-size:.85rem">Make sure the server is running (<code>npm start</code>) and reload.</p>
        <button onclick="location.reload()" style="margin-top:1rem;padding:.6rem 1.1rem;border:0;border-radius:8px;background:#059669;color:#fff;font-weight:600;cursor:pointer">Reload</button>
      </div>
    </div>`;
});