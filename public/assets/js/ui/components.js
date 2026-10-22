/**
 * Shared UI primitives — the component kit the pages are composed from.
 */
import { h, frag, render, signal, track } from '../core/react.js';
import { icon } from './icons.js';
import {
  toasts, dismissToast, theme, applyTheme, cartOpen, cart, cartCount,
  cartTotals, setQty, removeFromCart,
} from '../data/store.js';
import { navigate } from '../core/router.js';
import { productEmoji, rs } from '../core/format.js';
import { stockChip, statusBadge, Tabs, Avatar, ProgressBar } from './bits.js';

export { Tabs, Avatar, ProgressBar };

/* --------------------------------------------------------------- buttons -- */
export function Button(props = {}, ...kids) {
  const { variant = 'default', size, icon: ic, iconRight, children, ...rest } = props;
  // children may arrive as Button(props, 'label') or Button({ children: 'label' })
  const content = children ?? kids.filter((k) => !(k && typeof k === 'object' && !k.tag));
  const iconOpts = kids.find((k) => k && typeof k === 'object' && !k.tag) || {};
  const cls = ['btn', variant !== 'default' && `btn-${variant}`, size && `btn-${size}`,
    !content && (ic || iconRight) && 'btn-icon', props.class]
    .filter(Boolean).join(' ');
  return h('button', {
    type: props.type || 'button',
    class: cls,
    ...rest,
  }, ic ? icon(ic, { size: size === 'sm' ? 14 : (iconOpts.size ?? 16) }) : null,
     content,
     iconRight ? icon(iconRight, { size: size === 'sm' ? 14 : (iconOpts.size ?? 16) }) : null);
}

/* ---------------------------------------------------------------- badge -- */
export const Badge = (props = {}, ...kids) => h('span', {
  class: ['badge', props.tone && `badge-${props.tone}`, props.class].filter(Boolean).join(' '),
}, props.dot ? h('span.badge-dot') : null, props.children ?? kids);

export { statusBadge, stockChip };

/* ---------------------------------------------------------------- cards -- */
export const Card = (props = {}, ...kids) => h('div.card', {
  class: ['card-pad', props.hover && 'card-hover', props.class].filter(Boolean).join(' '),
}, props.children ?? kids);

export function SectionHead({ eyebrow, title, sub, action }, ...kids) {
  return h('div.section-head', null,
    h('div', null,
      eyebrow ? h('span.eyebrow', null, eyebrow) : null,
      h('h2.section-title', null, title),
      sub ? h('p.section-sub', null, sub) : null),
    action || null,
    kids.length ? kids : null);
}

/* -------------------------------------------------------------- overlay -- */
/** Modal + focus trap + ESC + scroll lock. Returns { el, close }. */
export function openModal({ title, body, footer, size = '', onClose } = {}) {
  const overlay = render(h('div.overlay', {
    onclick: (e) => { if (e.target === overlay) close(); },
  }));

  const close = () => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    if (!document.querySelector('.overlay')) document.body.classList.remove('no-scroll');
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') trapFocus(e, modal);
  };

  const modal = render(h(`div.modal${size ? `.modal-${size}` : ''}`, {
    role: 'dialog', 'aria-modal': 'true', 'aria-label': typeof title === 'string' ? title : 'Dialog',
  },
    h('div.modal-head', null,
      h('h2.modal-title', null, title),
      h('button.icon-btn', { onclick: close, 'aria-label': 'Close' }, icon('x', { size: 18 }))),
    h('div.modal-body', null, body),
    footer ? h('div.modal-foot', null, footer) : null));

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  document.body.classList.add('no-scroll');
  document.addEventListener('keydown', onKey);
  setTimeout(() => modal.querySelector('input,select,textarea,button')?.focus(), 60);

  return { el: modal, close };
}

export function confirmDialog({ title, message, confirmText = 'Confirm', danger = true, onConfirm }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; m.close(); resolve(v); } };
    const m = openModal({
      title,
      body: h('p', { class: 'text-muted', style: { fontSize: 'var(--fs-md)' } }, message),
      footer: frag(
        Button({ variant: 'ghost', onclick: () => done(false) }, 'Cancel'),
        Button({ variant: danger ? 'danger' : 'primary', onclick: async () => {
          try { await onConfirm?.(); done(true); } catch (e) { toast('error', 'Failed', e.message); }
        } }, confirmText)),
      onClose: () => done(false),
    });
  });
}

function trapFocus(e, container) {
  const f = [...container.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])')]
    .filter((el) => el.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/* --------------------------------------------------------------- toasts -- */
export function ToastHost() {
  const items = track(toasts);
  return h('div.toast-host', { 'aria-live': 'polite' },
    items.map((t) => h('div.toast', { class: `toast-${t.type}`, onclick: () => dismissToast(t.id) },
      h('span.toast-icon', null, icon(
        t.type === 'success' ? 'checkCircle' : t.type === 'error' ? 'alert' : t.type === 'warning' ? 'alert' : 'info', { size: 17 })),
      h('div', null,
        h('div.toast-title', null, t.title),
        t.msg ? h('div.toast-msg', null, t.msg) : null))));
}

/* ------------------------------------------------------------- empty UI -- */
export function EmptyState({ icon: ic = 'package', title, text, action }) {
  return h('div.empty', null,
    h('div.empty-icon', null, icon(ic, { size: 28 })),
    h('div.empty-title', null, title),
    text ? h('p.empty-text', null, text) : null,
    action || null);
}

export function PageLoader({ label = 'Loading' }) {
  return h('div.page-loader', null,
    h('div.loader-mark', null, icon('package', { size: 22 })),
    h('span.text-sm.text-muted', null, `${label}…`));
}

/** Skeleton placeholders that match the real layout to avoid layout shift. */
export const ProductSkeleton = () => h('div.product-card', { 'aria-hidden': 'true' },
  h('div.product-media', null, h('div.skeleton', { style: { width: '68px', height: '68px', borderRadius: '50%' } })),
  h('div.product-body', null,
    h('div.skeleton.skeleton-line', { style: { width: '40%', height: '9px' } }),
    h('div.skeleton.skeleton-line', { style: { width: '85%', height: '13px', marginTop: '8px' } }),
    h('div.skeleton.skeleton-line', { style: { width: '55%', height: '11px', marginTop: '8px' } }),
    h('div.row-between', { style: { marginTop: '14px' } },
      h('div.skeleton.skeleton-line', { style: { width: '52px', height: '17px' } }),
      h('div.skeleton', { style: { width: '30px', height: '30px', borderRadius: 'var(--r-md)' } }))));

export const Skeletons = (n = 8) => h('div.product-grid', null, Array.from({ length: n }, ProductSkeleton));

/* ---------------------------------------------------------------- empty -- */
export const Spinner = ({ size = 16 }) =>
  h('span.spinner', { style: { width: `${size}px`, height: `${size}px` }, role: 'status', 'aria-label': 'Loading' });

export function LoadingButton(props, ...children) {
  const { loading, ...rest } = props;
  return Button({ ...rest, disabled: loading || props.disabled },
    loading ? Spinner({ size: 14 }) : null, ...children);
}

/* --------------------------------------------------------------- inputs -- */
export function SearchInput({ value, onInput, placeholder = 'Search…', autofocus, ...rest }) {
  return h('div.search-bar', null,
    h('span.input-icon', null, icon('search', { size: 16 })),
    h('input.input', {
      type: 'search', value: value || '', placeholder, autofocus,
      oninput: (e) => onInput?.(e.target.value),
      ...rest,
    }),
    value ? h('button.search-clear', {
      onclick: () => onInput?.(''), 'aria-label': 'Clear search',
    }, icon('x', { size: 14 })) : null);
}

export function QuantityStepper({ value, onChange, min = 1, max = 99, small = false }) {
  return h(`div.qty${small ? '.qty-sm' : ''}`, null,
    h('button', {
      onclick: () => onChange?.(Math.max(min, value - 1)), disabled: value <= min,
      'aria-label': 'Decrease quantity',
    }, icon('minus', { size: small ? 11 : 13 })),
    h('input', {
      type: 'number', value, min, max, inputmode: 'numeric',
      'aria-label': 'Quantity',
      onchange: (e) => {
        const n = parseInt(e.target.value, 10);
        onChange?.(Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min);
      },
    }),
    h('button', {
      onclick: () => onChange?.(Math.min(max, value + 1)), disabled: value >= max,
      'aria-label': 'Increase quantity',
    }, icon('plus', { size: small ? 11 : 13 })));
}

/* ---------------------------------------------------------- theme toggle -- */
export function ThemeToggle() {
  const t = track(theme);
  return h('button.icon-btn', {
    onclick: () => applyTheme(t),
    'aria-label': t === 'light' ? 'Switch to dark mode' : 'Switch to light mode',
    title: t === 'light' ? 'Dark mode' : 'Light mode',
  }, icon(t === 'light' ? 'moon' : 'sun', { size: 18 }));
}

/* ------------------------------------------------------------ cart drawer -- */
export function CartDrawer() {
  const open = track(cartOpen);
  const items = track(cart);
  const count = track(cartCount);
  if (!open) return null;

  const totals = cartTotals();
  const close = () => { cartOpen.value = false; };

  const body = items.length
    ? h('div.col.gap-3', { style: { padding: 'var(--sp-4)' } },
        items.map((item) => h('div.cart-row', { style: { gridTemplateColumns: '3.5rem 1fr auto', padding: 'var(--sp-3)' } },
          h('div.cart-thumb', { style: { width: '3.5rem', height: '3.5rem', fontSize: '1.5rem' } }, productEmoji(item.product)),
          h('div.grow', null,
            h('div.text-sm.font-semibold.clamp-2', null, item.product.name),
            h('div.text-xs.text-muted', { style: { marginTop: '2px' } },
              `${rs(item.product.price / 100)} × ${item.quantity}`)),
          h('div.col', { style: { alignItems: 'flex-end', gap: '6px' } },
            QuantityStepper({ value: item.quantity, small: true, max: item.product.quantity ?? 99,
              onChange: (n) => setQty(item.product.id, n) }),
            h('div.row', { style: { gap: '6px' } },
              h('span.text-sm.mono.font-semibold', null, rs((item.product.price * item.quantity) / 100)),
              h('button.icon-btn', {
                onclick: () => removeFromCart(item.product.id), 'aria-label': `Remove ${item.product.name}`,
                style: { width: '1.5rem', height: '1.5rem' },
              }, icon('trash', { size: 13 })))))))
    : h('div', { style: { padding: 'var(--sp-8) var(--sp-5)' } },
        EmptyState({
          icon: 'cart', title: 'Your cart is empty',
          text: 'Add your staples and we will get them packed right away.',
          action: Button({ variant: 'primary', onclick: () => { close(); navigate('/shop'); } }, 'Start shopping'),
        }));

  const drawer = h('div.drawer', {
    role: 'dialog', 'aria-label': 'Shopping cart',
    onclick: (e) => e.stopPropagation(),
  },
    h('div.modal-head', null,
      h('div', null,
        h('h2.modal-title', null, 'Your cart'),
        h('div.text-xs.text-muted', null, `${count} item${count === 1 ? '' : 's'}`)),
      h('button.icon-btn', { onclick: close, 'aria-label': 'Close cart' }, icon('x', { size: 18 }))),
    h('div.grow', { style: { overflowY: 'auto' } }, body),
    items.length
      ? h('div', { style: { padding: 'var(--sp-4)', borderTop: '1px solid var(--border)', background: 'var(--surface-2)' } },
          h('div.summary-row', null, h('span.text-muted', null, 'Subtotal'),
            h('span.mono', null, rs(totals.subtotal / 100))),
          totals.delivery_fee
            ? h('div.summary-row', null, h('span.text-muted', null, 'Delivery'),
                h('span.mono', null, rs(totals.delivery_fee / 100)))
            : h('div.summary-row', null,
                h('span.text-success', null, 'Free delivery'),
                icon('check', { size: 14 })),
          h('div.summary-total', null, h('span', null, 'Total'),
            h('span.mono', null, rs(totals.total / 100))),
          Button({ variant: 'primary', size: 'lg', class: 'btn-block', style: { marginTop: 'var(--sp-3)' },
            onclick: () => { close(); navigate('/checkout'); } }, 'Checkout', { size: 16 }),
          h('div.text-center.text-xs.text-muted', { style: { marginTop: 'var(--sp-2)' } },
            'Cash · UPI · Card accepted'))
      : null);

  const scrim = h('div', {
    style: { position: 'fixed', inset: '0', background: 'rgb(0 0 0 / 0.45)', zIndex: '109' },
    onclick: close,
  });

  return h('div', { style: { position: 'fixed', inset: '0', zIndex: '110', pointerEvents: 'none' } },
    h('div', { style: { position: 'absolute', inset: '0', pointerEvents: 'auto' } }, scrim),
    h('div', { style: { position: 'absolute', inset: '0', pointerEvents: 'none' } }, drawer));

  // make the drawer itself interactive
  queueMicrotask(() => { drawer.style.pointerEvents = 'auto'; });
}

/* ------------------------------------------------------------- star row -- */
export function Stars({ value = 4, size = 13 }) {
  return h('span.row', { style: { gap: '1px' } },
    Array.from({ length: 5 }, (_, i) =>
      icon('star', { size, stroke: false, fill: i < value ? 'currentColor' : 'none' })));
}

/* ----------------------------------------------------------- breadcrumb -- */
export function Breadcrumb(items) {
  return h('nav.breadcrumb', { 'aria-label': 'Breadcrumb' },
    items.flatMap((item, i) => [
      i > 0 ? h('span.sep', null, '/') : null,
      item.href
        ? h('a', { href: item.href }, item.label)
        : h('span', { style: { color: 'var(--text)' } }, item.label),
    ]));
}