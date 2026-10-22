/**
 * Operations console shell — sidebar navigation, top bar, outlet.
 * Rendered once for every /admin/* route.
 */
import { h, track, signal } from '../core/react.js';
import { api } from '../core/api.js';
import { icon } from '../ui/icons.js';
import { user, store, logout, toast, can, alertsUnread, theme, applyTheme } from '../data/store.js';
import { navigate } from '../core/router.js';
import { Avatar } from './bits.js';
import { titleCase } from '../core/format.js';

const NAV = [
  { group: 'Counter', items: [
    { href: '/admin', label: 'Dashboard', icon: 'home', exact: true },
    { href: '/admin/billing', label: 'Billing counter', icon: 'receipt', cap: 'orders:write' },
    { href: '/admin/orders', label: 'Orders', icon: 'package', cap: 'orders:read' },
  ] },
  { group: 'Inventory', items: [
    { href: '/admin/inventory', label: 'Stock', icon: 'box', cap: 'inventory:write' },
    { href: '/admin/alerts', label: 'Alerts', icon: 'bell', badge: 'alerts' },
    { href: '/admin/products', label: 'Catalogue', icon: 'layers', cap: 'catalog:write' },
    { href: '/admin/suppliers', label: 'Suppliers', icon: 'truck', cap: 'reports:read' },
  ] },
  { group: 'Insight', items: [
    { href: '/admin/reports', label: 'Reports', icon: 'chart', cap: 'reports:read' },
    { href: '/admin/customers', label: 'Customers', icon: 'users', cap: 'customers:write' },
  ] },
  { group: 'System', items: [
    { href: '/admin/users', label: 'Staff & roles', icon: 'shield', cap: 'users:read' },
    { href: '/', label: 'Storefront', icon: 'cart' },
  ] },
];

export function consoleSidebar({ open, onClose }) {
  const me = track(user);
  if (!me) return null;

  const path = location.pathname;
  const alertCount = track(alertsUnread);

  return h(`div.sidebar${open ? '.open' : ''}`, null,
    h('div.sidebar-head', null,
      h('a.brand', { href: '/admin', onclick: onClose },
        h('div.brand-mark', null, icon('package', { size: 18 })),
        h('div.brand-text', null,
          h('span.brand-name', { style: { fontSize: '0.98rem' } }, 'Bijasan Ops'),
          h('span.brand-sub', null, 'Console')))),

    h('nav.sidebar-nav', { 'aria-label': 'Console sections' },
      NAV.map((group) => {
        const visible = group.items.filter((it) => !it.cap || can(it.cap) || ['admin'].includes(me.role));
        if (!visible.length) return null;
        return h('div', null,
          h('div.sidebar-group-title', null, group.group),
          visible.map((it) => {
            const active = it.exact ? path === it.href : path.startsWith(it.href);
            return h('a.side-link', {
              href: it.href, class: active ? 'active' : '', onclick: onClose,
              'aria-current': active ? 'page' : null,
            }, icon(it.icon, { size: 16 }), it.label,
              it.badge === 'alerts' && alertCount
                ? h('span.pill', null, alertCount > 99 ? '99+' : alertCount) : null);
          }));
      })),

    h('div.sidebar-foot', null,
      h('a.side-link', { href: '/', onclick: onClose }, icon('home', { size: 16 }), 'View storefront'),
      h('button.side-link', {
        style: { width: '100%', marginTop: '2px' },
        onclick: () => { logout().then(() => navigate('/')); },
      }, icon('logout', { size: 16 }), 'Sign out')));
}

export function consoleTop({ onMenu, title, actions }) {
  const me = track(user);
  const meta = track(store);

  return h('div.console-top', null,
    h('button.icon-btn', {
      onclick: onMenu, 'aria-label': 'Toggle navigation',
      style: { display: window.innerWidth <= 1024 ? 'grid' : 'none' },
    }, icon('menu', { size: 18 })),
    h('div.grow', null,
      h('div.row.gap-2', null,
        h('span', { style: { fontSize: '0.95rem', fontWeight: '650' } }, title || 'Dashboard'),
        me ? h('span.badge', { class: me.role === 'admin' ? 'badge-brand' : 'badge-info' }, titleCase(me.role)) : null)),
    actions || null,

    h('div.row.gap-2', { style: { marginLeft: 'auto' } },
      meta?.hours ? h('span.badge.hidden-mobile', { title: 'Store hours' },
        icon('clock', { size: 12 }), meta.hours.split('·')[0].trim()) : null,
      h('a.icon-btn', { href: '/', 'aria-label': 'Storefront', title: 'Open storefront' },
        icon('cart', { size: 17 })),
      h('button.icon-btn', {
        onclick: () => applyTheme(theme.value === 'light' ? 'dark' : 'light'),
        'aria-label': 'Toggle theme', title: 'Toggle theme',
      }, icon(theme.value === 'light' ? 'moon' : 'sun', { size: 17 })),
      me ? h('a.icon-btn', { href: '/account', title: me.name }, Avatar({ name: me.name })) : null));
}

/** Refresh the unread-alert pill (called by pages that change alert state). */
export async function refreshAlertCount() {
  try {
    const res = await api.fresh('/alerts?unread=1');
    alertsUnread.value = res.unread;
  } catch { /* ignore */ }
}

/** Guard used by the router: staff-only area. */
export function requireConsole() {
  const me = user.value;
  if (!me) { navigate('/login', { replace: true }); return false; }
  if (!['admin', 'manager', 'staff'].includes(me.role)) {
    toast('error', 'No access', 'The operations console is for store staff only.');
    navigate('/', { replace: true });
    return false;
  }
  return true;
}