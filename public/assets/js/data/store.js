/**
 * Global application state — auth session, cart, favourites, theme, toasts.
 * Persisted to localStorage so the app survives a refresh.
 */
import { signal } from '../core/react.js';
import { api, setToken, getToken } from '../core/api.js';
import { priceCart } from '../core/format.js';

const LS = {
  cart: 'bgs_cart',
  favs: 'bgs_favs',
  theme: 'bgs_theme',
  user: 'bgs_user',
  recent: 'bgs_recent',
};

const read = (key, fallback) => {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; }
  catch { return fallback; }
};
const write = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / private mode */ }
};

/* ---------------------------------------------------------------- theme -- */
export const theme = signal(localStorage.getItem(LS.theme) || 'light');
export function applyTheme(value) {
  const t = value || (theme.value === 'light' ? 'dark' : 'light');
  theme.value = t;
  document.documentElement.dataset.theme = t;
  localStorage.setItem(LS.theme, t);
}
applyTheme(theme.value);

/* ----------------------------------------------------------------- auth -- */
export const user = signal(read(LS.user, null));

export async function restoreSession() {
  if (!getToken()) { user.value = null; return null; }
  try {
    const res = await api.fresh('/auth/me');
    user.value = res.user;
    write(LS.user, res.user);
    return res.user;
  } catch {
    setToken(null);
    user.value = null;
    write(LS.user, null);
    return null;
  }
}

export async function login(email, password) {
  const res = await api.post('/auth/login', { email, password });
  setToken(res.token);
  user.value = res.user;
  write(LS.user, res.user);
  return res.user;
}

export async function register(payload) {
  const res = await api.post('/auth/register', payload);
  setToken(res.token);
  user.value = res.user;
  write(LS.user, res.user);
  return res.user;
}

export async function logout() {
  try { await api.post('/auth/logout'); } catch { /* best effort */ }
  setToken(null);
  user.value = null;
  write(LS.user, null);
  api.clearCache();
}

export const can = (capability) => Boolean(user.value?.capabilities?.includes(capability));
export const isStaff = () => ['staff', 'manager', 'admin'].includes(user.value?.role);

/* ----------------------------------------------------------------- cart -- */
export const cart = signal(read(LS.cart, []));           // [{ product, quantity }]
export const cartOpen = signal(false);
export const lastAdded = signal(null);                    // product just added (flash)

function commitCart(next) {
  cart.value = next;
  write(LS.cart, next);
  document.dispatchEvent(new CustomEvent('cart:changed', { detail: next }));
}

export const cartCount = () => cart.value.reduce((s, i) => s + i.quantity, 0);

export function cartTotals(discountPct = 0) {
  return priceCart(
    cart.value.map((i) => ({ price: i.product.price, quantity: i.quantity })),
    { discountPct }
  );
}

export function addToCart(product, quantity = 1, { open = false, silent = false } = {}) {
  const existing = cart.value.find((i) => i.product.id === product.id);
  const stock = product.quantity ?? 99;
  const nextQty = (existing?.quantity || 0) + quantity;

  if (nextQty > stock) {
    toast('error', 'Not enough stock',
      stock === 0
        ? `${product.name} is out of stock right now.`
        : `Only ${stock} left in stock for ${product.name}.`);
    return false;
  }

  commitCart(existing
    ? cart.value.map((i) => (i.product.id === product.id ? { ...i, quantity: nextQty } : i))
    : [...cart.value, { product, quantity }]);

  lastAdded.value = { product, at: Date.now() };
  if (!silent) {
    toast('success', 'Added to cart', `${product.name} · ${product.pack_size || '1 pc'}`);
  }
  if (open) cartOpen.value = true;
  return true;
}

export function setQty(productId, quantity) {
  const item = cart.value.find((i) => i.product.id === productId);
  if (!item) return;
  const stock = item.product.quantity ?? 99;
  const q = Math.max(0, Math.min(quantity, stock, 99));
  if (q === 0) return removeFromCart(productId);
  commitCart(cart.value.map((i) => (i.product.id === productId ? { ...i, quantity: q } : i)));
}

export function removeFromCart(productId) {
  const item = cart.value.find((i) => i.product.id === productId);
  commitCart(cart.value.filter((i) => i.product.id !== productId));
  if (item) toast('info', 'Removed', item.product.name);
}

export function clearCart() { commitCart([]); }

/** Refresh in-stock quantities for everything in the cart. */
export async function syncCartStock() {
  if (!cart.value.length) return;
  const products = cart.value.map((i) => i.product);
  try {
    const res = await api.get(`/products?per_page=60`);
    const byId = new Map(res.items.map((p) => [p.id, p]));
    const next = [];
    for (const item of cart.value) {
      const fresh = byId.get(item.product.id);
      if (!fresh) continue;                                   // discontinued / removed
      next.push({ ...item, product: fresh, quantity: Math.min(item.quantity, Math.max(fresh.quantity, 0)) || item.quantity });
    }
    commitCart(next.filter((i) => i.quantity > 0));
  } catch { /* offline — keep the cached cart */ }
}

/* ----------------------------------------------------------- favourites -- */
export const favourites = signal(read(LS.favs, []));
export const isFav = (id) => favourites.value.some((f) => f.id === id);
export function toggleFav(product) {
  const on = isFav(product.id);
  favourites.value = on
    ? favourites.value.filter((f) => f.id !== product.id)
    : [...favourites.value, {
        id: product.id, name: product.name, slug: product.slug,
        price: product.price, price_rupees: product.price_rupees,
        category_slug: product.category_slug, image: product.image,
      }];
  write(LS.favs, favourites.value);
  if (!on) toast('success', 'Saved', product.name);
  return !on;
}

/* -------------------------------------------------------- recently seen -- */
export const recent = signal(read(LS.recent, []));
export function pushRecent(product) {
  const next = [{ id: product.id, name: product.name, slug: product.slug, price_rupees: product.price_rupees, category_slug: product.category_slug, image: product.image },
    ...recent.value.filter((p) => p.id !== product.id)].slice(0, 8);
  recent.value = next;
  write(LS.recent, next);
}

/* --------------------------------------------------------------- toasts -- */
export const toasts = signal([]);
let toastSeq = 0;

export function toast(type, title, msg, ttl = 3600) {
  const id = ++toastSeq;
  toasts.value = [...toasts.value, { id, type, title, msg }];
  setTimeout(() => dismissToast(id), ttl);
  return id;
}
export function dismissToast(id) {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

/* --------------------------------------------------------- store meta -- */
export const store = signal(null);   // fetched once at boot

export async function loadStore() {
  if (store.value) return store.value;
  const res = await api.get('/store');
  store.value = res;
  return res;
}

/* ---------------------------------------------------------- admin flags -- */
export const alertsUnread = signal(0);