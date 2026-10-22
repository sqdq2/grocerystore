/**
 * Application shell — top bar, header, cart drawer, toasts, footer.
 * Shared by the storefront and the console (which renders its own sidebar).
 */
import { h, frag, track, signal } from '../core/react.js';
import { icon } from './icons.js';
import {
  store, user, cart, cartCount, cartOpen, theme, applyTheme,
  logout, loadStore, syncCartStock, toast,
} from '../data/store.js';
import { navigate } from '../core/router.js';
import { Button, ToastHost, ThemeToggle, CartDrawer } from './components.js';
import { Avatar } from './bits.js';
import { titleCase, initials } from '../core/format.js';

const NAV = [
  { href: '/', label: 'Home', match: (p) => p === '/' },
  { href: '/shop', label: 'Shop', match: (p) => p.startsWith('/shop') },
  { href: '/deals', label: 'Deals', match: (p) => p.startsWith('/deals') },
  { href: '/track', label: 'Track order', match: (p) => p.startsWith('/track') },
];

export function StoreHeader() {
  const path = location.pathname;
  const meta = track(store);
  const u = track(user);
  const count = track(cartCount);
  const searchOpen = signal(false);

  return h('header.header', { id: 'site-header' },
    h('div.topbar', null,
      h('div.shell', null,
        h('span.topbar-item', null, icon('truckFast', { size: 13 }),
          `Free delivery over ₹300 · Same-day inside Waghai`),
        h('span.topbar-item.optional', null, icon('clock', { size: 13 }),
          meta?.hours || 'Mon–Sat 8:00–21:30 · Sun 9:00–14:00'),
        h('span.topbar-item.optional', null, icon('phone', { size: 13 }),
          meta?.phone || '+91 94278 05111'))),

    h('div.shell', null,
      h('a.brand', { href: '/', 'aria-label': 'Bijasan General Store — home' },
        h('div.brand-mark', null, icon('package', { size: 20 })),
        h('div.brand-text', null,
          h('span.brand-name', null, 'Bijasan General'),
          h('span.brand-sub', null, 'Store · Waghai'))),

      h('nav.nav.nav-desktop', { 'aria-label': 'Main' },
        NAV.map((n) => h('a.nav-link', {
          href: n.href,
          class: n.match(path) ? 'active' : '',
          'aria-current': n.match(path) ? 'page' : null,
        }, n.label))),

      h('div.header-actions', null,
        // inline quick search
        h('a.icon-btn', { href: '/shop', 'aria-label': 'Search products', title: 'Search products' },
          icon('search', { size: 18 })),

        u && ['admin', 'manager', 'staff'].includes(u.role)
          ? h('a.icon-btn', { href: '/admin', 'aria-label': 'Open operations console', title: 'Operations console' },
              icon('grid', { size: 18 }))
          : null,

        ThemeToggle(),

        h('button.icon-btn', {
          onclick: () => { cartOpen.value = true; },
          'aria-label': `Open cart, ${count} item${count === 1 ? '' : 's'}`,
          title: 'Cart',
        }, icon('cart', { size: 18 }),
          count > 0 ? h('span.count', null, count > 99 ? '99+' : count) : null),

        u
          ? h('div.row.gap-2', { style: { marginLeft: '4px' } },
              h('a.icon-btn', { href: '/account', 'aria-label': 'Your account', title: u.name }, Avatar({ name: u.name })))
          : h('div', { style: { marginLeft: '4px' } },
              Button({ variant: 'ghost', size: 'sm', onclick: () => navigate('/login') }, 'Sign in'),
              Button({ variant: 'primary', size: 'sm', class: 'hidden-sm', onclick: () => navigate('/login') }, 'Sign in')))));
}

/* -------------------------------------------------------------- footer -- */
export function Footer() {
  const meta = track(store);
  return h('footer.footer', null,
    h('div.shell', null,
      h('div.footer-grid', null,
        h('div', null,
          h('div.row.gap-2', { style: { marginBottom: 'var(--sp-3)' } },
            h('div.brand-mark', { style: { width: '2rem', height: '2rem' } }, icon('package', { size: 17 })),
            h('span.brand-name', { style: { color: 'var(--text-inv)' } }, 'Bijasan General Store')),
          h('p', { style: { fontSize: 'var(--fs-sm)', opacity: '0.72', maxWidth: '32ch' } },
            'A family kirana in Waghai since 1998 — fresh provisions, honest weights and a bill you can trust.'),
          h('div.row.gap-2.mt-4.wrap', null,
            h('span.badge', null, '🛍️', 'Family owned'),
            h('span.badge', null, '✅', 'GST billing'),
            h('span.badge', null, '💳', 'UPI · Card · Cash'))),

        h('div', null,
          h('h4', null, 'Shop'),
          h('ul.col.gap-2', { style: { fontSize: 'var(--fs-sm)' } },
            h('li', null, h('a', { href: '/shop' }, 'All products')),
            h('li', null, h('a', { href: '/deals' }, 'Weekly deals')),
            h('li', null, h('a', { href: '/shop?category=staples' }, 'Rice & grains')),
            h('li', null, h('a', { href: '/shop?category=spices' }, 'Spices')),
            h('li', null, h('a', { href: '/shop?category=dairy' }, 'Dairy & chilled')))),

        h('div', null,
          h('h4', null, 'Help'),
          h('ul.col.gap-2', { style: { fontSize: 'var(--fs-sm)' } },
            h('li', null, h('a', { href: '/track' }, 'Track your order')),
            h('li', null, h('a', { href: '/shop' }, 'Search stock')),
            h('li', null, h('a', { href: '/account' }, 'My account')),
            h('li', null, h('a', { href: '/login' }, 'Staff sign in'))),

        h('div', null,
          h('h4', null, 'Visit us'),
          h('div.col.gap-2', { style: { fontSize: 'var(--fs-sm)' } },
            h('div.row.gap-2', null, icon('mapPin', { size: 14 }), meta?.address_line1 || 'Shop No. 4, Krishna Market, Waghai'),
            h('div.row.gap-2', null, icon('mapPin', { size: 14 }), meta?.address_line2 || 'Waghai, Dist. Surat, Gujarat 394730'),
            h('div.row.gap-2', null, icon('phone', { size: 14 }), meta?.phone || '+91 94278 05111'),
            h('div.row.gap-2', null, icon('clock', { size: 14 }), meta?.hours || 'Mon–Sat 8:00–21:30')))),

      h('div.footer-bottom', null,
        h('span', null, `© ${new Date().getFullYear()} Bijasan General Store · Waghai, Gujarat`),
        h('span', null, 'Grocery Store Management System · Built on Node.js + SQLite')))));
}

/* -------------------------------------------------------- mobile menu -- */
export function MobileMenu({ open, onClose }) {
  if (!open) return null;
  return h('div', { style: { position: 'fixed', inset: '0', zIndex: '130' } },
    h('div', {
      style: { position: 'absolute', inset: '0', background: 'rgb(0 0 0 / 0.45)' },
      onclick: onClose,
    }),
    h('div', {
      style: {
        position: 'absolute', top: '0', left: '0', bottom: '0', width: 'min(280px, 84vw)',
        background: 'var(--surface)', borderRight: '1px solid var(--border)',
        padding: 'var(--sp-4)', animation: 'slide-in 240ms var(--ease-out)',
        transform: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)',
      },
      onclick: (e) => e.stopPropagation(),
    },
      h('div.row-between.mb-4', null,
        h('div.brand', null,
          h('div.brand-mark', null, icon('package', { size: 18 })),
          h('div.brand-text', null, h('span.brand-name', { style: { fontSize: '0.95rem' } }, 'Bijasan General'))),
        h('button.icon-btn', { onclick: onClose, 'aria-label': 'Close menu' }, icon('x', { size: 18 }))),
      NAV.map((n) => h('a.nav-link', {
        href: n.href, onclick: onClose,
        class: n.match(location.pathname) ? 'active' : '',
        style: { padding: '0.625rem 0.75rem' },
      }, n.label)),
      h('div.divider.mt-2'),
      h('a.nav-link', { href: '/admin', onclick: onClose, style: { padding: '0.625rem 0.75rem' } },
        icon('grid', { size: 16 }), 'Operations console'),
      h('div.grow'),
      h('div.row.gap-2', { style: { marginTop: 'auto' } },
        track(user)
          ? frag(
              Button({ variant: 'ghost', class: 'btn-block', onclick: () => { logout().then(() => { onClose(); navigate('/'); }); } },
                'Sign out'),
              Button({ variant: 'primary', class: 'btn-block', onclick: () => { onClose(); navigate('/account'); } }, 'My account'))
          : Button({ variant: 'primary', class: 'btn-block', onclick: () => { onClose(); navigate('/login'); } }, 'Sign in'))));
}

/* --------------------------------------------------------- boot chrome -- */
export function installGlobalChrome() {
  // header shadow on scroll
  const header = document.getElementById('site-header');
  if (header) {
    const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 4);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // reveal on scroll
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold: 0.08, rootMargin: '0px 0px -40px' });
  document.addEventListener('route:changed', () => {
    requestAnimationFrame(() => {
      document.querySelectorAll('.reveal:not(.in)').forEach((el) => io.observe(el));
    });
  });

  // keep cart stock honest
  document.addEventListener('route:changed', () => syncCartStock());

  // ESC closes the cart drawer
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && cartOpen.value) cartOpen.value = false;
  });

  // global unhandled-error guard so a bug never leaves a blank screen
  window.addEventListener('unhandledrejection', (e) => {
    console.error('[unhandled]', e.reason);
    toast('error', 'Something went wrong', e.reason?.message || 'Please try again.');
  });
}

export function ToastHostMount() { return ToastHost(); }
export function CartMount() { return CartDrawer(); }