/**
 * Client-side router — History API with pattern matching, params, guards,
 * scroll restoration and lazy page loading.
 */

import { render } from './react.js';

const routes = [];
let outlet = null;
let notFoundView = null;
let currentPath = null;
let currentCleanup = null;
let onNavigate = null;

/** '/products/:slug' → regex + ['slug'] */
function compile(pattern) {
  const keys = [];
  const rx = new RegExp('^' + pattern
    .replace(/\/([:*])(\w+)/g, (_, kind, key) => {
      keys.push({ kind, key });
      return kind === ':' ? '/([^/]+)' : '/(.*)';
    })
    .replace(/\//g, '\\/') + '\\/?$');
  return { rx, keys };
}

export function route(pattern, loader, opts = {}) {
  routes.push({ pattern, ...compile(pattern), loader, ...opts });
}

export function setNotFound(loader) { notFoundView = loader; }

export function currentRoute() {
  const path = location.pathname;
  for (const r of routes) {
    const m = path.match(r.rx);
    if (!m) continue;
    const params = {};
    r.keys.forEach(({ kind, key }, i) => {
      params[key] = kind === ':' ? decodeURIComponent(m[i + 1]) : (m[i + 1] || '').split('/').map(decodeURIComponent);
    });
    return { route: r, params, query: new URLSearchParams(location.search) };
  }
  return null;
}

export function navigate(to, { replace = false, keepScroll = false } = {}) {
  const url = new URL(to, location.origin);
  const same = url.pathname === location.pathname && url.search === location.search;
  if (same) return;
  if (replace) history.replaceState({}, '', url);
  else history.pushState({}, '', url);
  if (!keepScroll) window.scrollTo({ top: 0, behavior: 'instant' });
  resolve();
}

export function setNavigateHandler(fn) { onNavigate = fn; }

let renderToken = 0;

export async function resolve() {
  if (!outlet) return;
  const token = ++renderToken;
  const matched = currentRoute();

  // release the previous page's effects/listeners
  try { currentCleanup?.(); } catch (e) { console.warn(e); }
  currentCleanup = null;

  const path = location.pathname + location.search;
  const isSamePage = path === currentPath;
  currentPath = path;

  document.dispatchEvent(new CustomEvent('route:changed', { detail: { path, matched } }));
  onNavigate?.(matched, path);

  if (!matched) {
    outlet.replaceChildren();
    const node = await notFoundView?.();
    if (token !== renderToken) return;
    outlet.replaceChildren(node);
    document.title = 'Page not found · Bijasan General Store';
    return;
  }

  const { route: r, params, query } = matched;
  const loader = typeof r.loader === 'function' ? r.loader : r.loader;

  let view;
  try {
    view = await loader({ params, query, path: matched.path });
  } catch (err) {
    console.error('[router] loader failed', err);
    view = { __error: err };
  }
  if (token !== renderToken) return; // a newer navigation won

  outlet.replaceChildren();
  // support { node, cleanup, title } — the node may be a vnode or a DOM element
  if (view && view.node !== undefined) {
    outlet.appendChild(view.node.nodeType ? view.node : render(view.node));
    currentCleanup = view.cleanup || null;
    if (view.title) document.title = `${view.title} · Bijasan General Store`;
  } else {
    outlet.appendChild(view.nodeType ? view : render(view));
    currentCleanup = null;
    if (r.title) document.title = `${r.title} · Bijasan General Store`;
  }

  if (!isSamePage) window.scrollTo({ top: 0, behavior: 'instant' });
}

/** Intercept in-app link clicks. */
export function initRouter(mountEl, { fallback } = {}) {
  outlet = mountEl;
  notFoundView = fallback;

  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest?.('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('http') || href.startsWith('//') || href.startsWith('#')) return;
    if (a.target === '_blank' || a.hasAttribute('download')) return;
    e.preventDefault();
    navigate(href);
  });

  window.addEventListener('popstate', () => resolve());
  resolve();
}

export const href = (path) => path;