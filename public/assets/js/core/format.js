/**
 * Formatting + shared domain helpers.
 * Money is stored as paise; everything user-facing is rupees.
 */

export const rs = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Compact money for dashboard tiles: ₹1.2L, ₹34.5K */
export function rsShort(paise) {
  const r = Number(paise || 0) / 100;
  const abs = Math.abs(r);
  if (abs >= 10000000) return `₹${(r / 10000000).toFixed(2)}Cr`;
  if (abs >= 100000) return `₹${(r / 100000).toFixed(2)}L`;
  if (abs >= 1000) return `₹${(r / 1000).toFixed(1)}K`;
  return `₹${r.toFixed(0)}`;
}

export const num = (n) => Number(n || 0).toLocaleString('en-IN');

export function pct(n, digits = 1) {
  const v = Number(n || 0);
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

export function paiseToRupees(p) { return Number(p || 0) / 100; }
export function rupeesToPaise(r) { return Math.round(Number(r || 0) * 100); }

/* -------------------------------------------------------------- dates --- */
export function formatDate(iso, opts = {}) {
  if (!iso) return '—';
  const d = new Date(String(iso).includes('T') ? iso : `${String(iso).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', ...opts });
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(String(iso).includes('T') ? iso : `${String(iso).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

export function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(String(iso).includes('T') ? iso : `${String(iso).replace(' ', 'T')}Z`);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

/** '3 min ago', '2 h ago', 'yesterday' */
export function relativeTime(iso) {
  if (!iso) return '—';
  const d = new Date(String(iso).includes('T') ? iso : `${String(iso).replace(' ', 'T')}Z`);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (Number.isNaN(diff)) return '—';
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  if (diff < 172800) return 'yesterday';
  if (diff < 604800) return `${Math.round(diff / 86400)} d ago`;
  return formatDate(iso);
}

/** Day label for chart axes */
export function shortDay(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/* -------------------------------------------------------------- text ---- */
export function initials(name) {
  return String(name || '?')
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => w[0]).join('').toUpperCase();
}

export const titleCase = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function truncate(s, n = 80) {
  const str = String(s || '');
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}

/** Deterministic pastel pair from a string — used for avatar/colour fallbacks. */
const ACCENTS = ['emerald', 'amber', 'rose', 'sky', 'violet', 'teal', 'orange', 'lime', 'indigo', 'fuchsia'];
export function accentFor(str) {
  let h = 0;
  for (let i = 0; i < String(str).length; i++) h = (h * 31 + String(str).charCodeAt(i)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}

/* ----------------------------------------------------------- domain ----- */
export const ORDER_STATUS_META = {
  pending:          { label: 'Pending',          tone: 'warning', emoji: '🕓' },
  confirmed:        { label: 'Confirmed',        tone: 'info',    emoji: '✅' },
  packed:           { label: 'Packed',           tone: 'brand',   emoji: '📦' },
  out_for_delivery: { label: 'Out for delivery', tone: 'brand',   emoji: '🛵' },
  delivered:        { label: 'Delivered',        tone: 'success', emoji: '🎉' },
  cancelled:        { label: 'Cancelled',        tone: 'danger',  emoji: '✖️' },
};

export const STOCK_STATE_META = {
  available:    { label: 'In stock',      tone: 'success', emoji: '✓' },
  low_stock:    { label: 'Low stock',     tone: 'warning', emoji: '!' },
  out_of_stock: { label: 'Out of stock',  tone: 'danger',  emoji: '✕' },
  discontinued: { label: 'Discontinued',  tone: 'info',    emoji: '⊘' },
};

export const PAYMENT_META = {
  cash: { label: 'Cash', emoji: '💵' },
  upi:  { label: 'UPI',  emoji: '📱' },
  card: { label: 'Card', emoji: '💳' },
};

/** Emoji per category slug — gives every shelf a recognisable face. */
export const CATEGORY_EMOJI = {
  staples: '🌾', pulses: '🫘', spices: '🌶️', oils: '🫒', dairy: '🥛',
  snacks: '🍪', beverages: '☕', household: '🧴', personal: '🧼', baby: '🍼',
};

/** Fallback emoji for a product, derived from its category. */
export function productEmoji(product) {
  if (product?.image) return product.image;
  return CATEGORY_EMOJI[product?.category_slug] || '🛍️';
}

export const MAX_QTY = 99;

/** Local cart maths that mirrors the server's priceCart() exactly. */
export function priceCart(items, { discountPct = 0, deliveryFee = 2500, freeAbove = 30000 } = {}) {
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const tax = 0; // Indian retail MRP is tax-inclusive
  const gross = subtotal + tax;
  const discount = Math.round(subtotal * (Math.min(Math.max(discountPct, 0), 100) / 100));
  const afterDiscount = gross - discount;
  const delivery = afterDiscount > 0 && afterDiscount < freeAbove ? deliveryFee : 0;
  return {
    subtotal, tax, discount,
    delivery_fee: delivery,
    total: afterDiscount + delivery,
    saved: discount,
    free_delivery_remaining: Math.max(0, freeAbove - afterDiscount),
  };
}

export const clsx = (...a) => a.flat(Infinity).filter(Boolean).join(' ');