/**
 * Browser smoke test — drives the real UI in headless Chromium,
 * captures console errors and writes screenshots.
 *
 *   node scripts/screenshot.mjs [baseUrl]
 */
import { chromium } from '/usr/local/lib/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:3400';
const OUT = '/workspace/grocery/docs/screenshots';
const EXE = '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome';

mkdirSync(OUT, { recursive: true });

const errors = [];
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});

const ctx = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  deviceScaleFactor: 1,
  locale: 'en-IN',
});

const page = await ctx.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') {
    const t = m.text();
    if (/favicon|fonts.googleapis|fonts.gstatic|ERR_(NAME|INTERNET|CONNECTION)/i.test(t)) return;
    errors.push(`[console] ${t}`);
  }
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => {
  const u = r.url();
  if (/fonts\.(googleapis|gstatic)/.test(u)) return;
  errors.push(`[requestfailed] ${u} — ${r.failure()?.errorText}`);
});

const shot = async (name, opts = {}) => {
  await page.waitForTimeout(opts.wait ?? 700);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: opts.full ?? false });
  console.log(`  📸 ${name}`);
};

async function go(path, { waitFor } = {}) {
  await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 20000 });
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 12000 });
  await page.waitForTimeout(500);
}

try {
console.log('\n▶ Storefront');
await go('/', { waitFor: '.product-card' });
await shot('01-home-hero');
await shot('01-home-full', { full: true });

await go('/shop', { waitFor: '.product-card' });
await shot('02-shop');

await page.goto(`${BASE}/shop?q=atta`, { waitUntil: 'networkidle' });
await page.waitForSelector('.product-card', { timeout: 10000 });
await shot('03-shop-search');

await go('/deals', { waitFor: '.product-card' });
await shot('04-deals');

const firstProduct = await page.locator('.product-card').first();
await go('/shop', { waitFor: '.product-card' });
await page.locator('.product-card .product-name').first().click();
await page.waitForSelector('.pdp-title', { timeout: 12000 });
await shot('05-product');

console.log('\n▶ Cart & checkout');
await page.locator('.add-btn').first().click();
await page.waitForTimeout(500);
await shot('06-toast');

await go('/cart', { waitFor: '.cart-row' });
await shot('07-cart');

await go('/checkout', { waitFor: '.summary' });
await shot('08-checkout');

console.log('\n▶ Auth');
await go('/login', { waitFor: '.card' });
await shot('09-login');

// sign in as admin via the demo account panel
await page.locator('button:has-text("Admin")').first().click();
await page.waitForTimeout(300);
await page.locator('button[type="submit"]').first().click();
await page.waitForURL('**/admin', { timeout: 15000 });
await page.waitForSelector('.kpi', { timeout: 15000 });
await page.waitForTimeout(1200);
await shot('10-console-dashboard');
await shot('10-console-dashboard-full', { full: true });

console.log('\n▶ Console pages');
const pages = [
  ['/admin/billing', '.pos-layout', '11-billing-counter'],
  ['/admin/orders', '.table-wrap, .empty', '12-orders'],
  ['/admin/inventory', '.table-wrap, .empty', '13-inventory'],
  ['/admin/alerts', '.kpi-grid', '14-alerts'],
  ['/admin/reports', '.kpi-grid', '15-reports'],
  ['/admin/reports?x=1', '.kpi-grid', '15-reports-inventory'],
  ['/admin/suppliers', '.table-wrap', '16-suppliers'],
  ['/admin/customers', '.table-wrap', '17-customers'],
  ['/admin/users', '.table-wrap', '18-users'],
];
for (const [path, sel, name] of pages) {
  await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForSelector(sel, { timeout: 12000 }).catch(() => errors.push(`[selector] ${name} missing ${sel}`));
  await page.waitForTimeout(900);
  await shot(name);
}

// product modal
await go('/admin/inventory', { waitFor: '.table-wrap' });
await page.locator('button[title="Receive / adjust"]').first().click();
await page.waitForSelector('.modal', { timeout: 8000 });
await shot('19-stock-adjust');
await page.keyboard.press('Escape');

// order detail modal
await go('/admin/orders', { waitFor: '.table-wrap' });
await page.locator('tbody tr').first().click();
await page.waitForSelector('.modal', { timeout: 8000 });
await shot('20-order-detail');
await page.keyboard.press('Escape');

console.log('\n▶ Interaction test — full sale flow');
await go('/admin/billing', { waitFor: '#pos-search' });
await page.fill('#pos-search', 'atta');
await page.waitForTimeout(700);
await page.locator('.pos-search-result').first().click();
await page.waitForTimeout(300);
await page.fill('#pos-search', 'dal');
await page.waitForTimeout(700);
await page.locator('.pos-search-result').first().click();
await page.waitForTimeout(300);
await page.fill('#pos-search', 'milk');
await page.waitForTimeout(700);
await page.locator('.pos-search-result').first().click();
await page.waitForTimeout(500);
await shot('21-billing-cart-filled');

await page.locator('button:has-text("Complete sale")').click();
await page.waitForSelector('.invoice-doc', { timeout: 12000 });
await page.waitForTimeout(700);
await shot('22-invoice');
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
await shot('23-billing-after-sale');

console.log('\n▶ Cart flow via storefront');
await go('/shop', { waitFor: '.product-card' });
for (let i = 0; i < 3; i++) {
  const btns = page.locator('.add-btn:not(.in-cart)');
  if (await btns.count() > 0) { await btns.first().click(); await page.waitForTimeout(350); }
}
await page.locator('button[aria-label*="Open cart"]').click();
await page.waitForSelector('.drawer', { timeout: 8000 });
await shot('24-cart-drawer');

console.log('\n▶ Order tracking');
await go('/track', { waitFor: 'form' });
await page.fill('input[placeholder="BGS-2610-1042"]', 'BGS-2609-1001');
await page.locator('button[type="submit"]').click();
await page.waitForTimeout(1200);
await shot('25-track-order');

console.log('\n▶ Dark mode');
await go('/', { waitFor: '.product-card' });
await page.locator('button[aria-label*="dark mode"]').click();
await page.waitForTimeout(700);
await shot('26-home-dark');
await go('/shop', { waitFor: '.product-card' });
await shot('27-shop-dark');
await go('/admin', { waitFor: '.kpi' });
await shot('28-console-dark');
await page.locator('button[aria-label="Toggle theme"]').click();
await page.waitForTimeout(400);

console.log('\n▶ Mobile');
const mob = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'en-IN',
});
const mp = await mob.newPage();
mp.on('pageerror', (e) => errors.push(`[mobile pageerror] ${e.message}`));
const mshot = async (path, name, waitFor) => {
  await mp.goto(BASE + path, { waitUntil: 'networkidle', timeout: 20000 });
  if (waitFor) await mp.waitForSelector(waitFor, { timeout: 12000 }).catch(() => errors.push(`[m] ${name} ${waitFor}`));
  await mp.waitForTimeout(800);
  await mp.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  📱 ${name}`);
};
await mshot('/', '29-mobile-home', '.hero');
await mshot('/shop', '30-mobile-shop', '.product-card');
await mshot('/cart', '31-mobile-cart', '.shell');

/* accessibility / layout audit */
console.log('\n▶ Layout audit');
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const audit = await page.evaluate(() => {
  const out = { overflowX: document.documentElement.scrollWidth > window.innerWidth + 1, offenders: [], tiny: [], noAlt: 0 };
  const vw = window.innerWidth;
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > vw + 2 && getComputedStyle(el).position !== 'fixed') {
      out.offenders.push(`${el.tagName}.${String(el.className).slice(0, 40)} right=${Math.round(r.right)}`);
    }
  }
  for (const el of document.querySelectorAll('a,button,[role="button"]')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.height < 24 && !el.closest('.ticker')) {
      out.tiny.push(`${el.tagName}.${String(el.className).slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
  }
  out.offenders = [...new Set(out.offenders)].slice(0, 8);
  out.tiny = [...new Set(out.tiny)].slice(0, 8);
  return out;
});
if (audit.overflowX) errors.push(`[layout] horizontal overflow on / — ${audit.offenders.join(' | ')}`);
if (audit.tiny.length) console.log(`  ℹ small tap targets: ${audit.tiny.join(' | ')}`);

} catch (e) { console.log('SCRIPT ERROR:', e.message.split('\n')[0]); errors.push('screenshot: ' + e.message.split('\n')[0]); }

await browser.close();

console.log(`\n${'─'.repeat(58)}`);
if (errors.length) {
  console.log(`\x1b[31m✗ ${errors.length} issue(s):\x1b[0m`);
  [...new Set(errors)].forEach((e) => console.log(`  ${e}`));
  process.exit(1);
} else {
  console.log('\x1b[32m✓ No console errors, no layout overflow.\x1b[0m');
}
console.log(`${'─'.repeat(58)}\n`);