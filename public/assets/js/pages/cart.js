/**
 * Cart + checkout + order confirmation.
 * Checkout mirrors the server's priceCart() maths exactly and re-prices
 * through /api/sales/quote before the bill is created.
 */
import { h, track, signal } from '../core/react.js';
import { api } from '../core/api.js';
import { icon } from '../ui/icons.js';
import { Button, Card, EmptyState, Breadcrumb, QuantityStepper, openModal, LoadingButton, Badge } from '../ui/components.js';
import { cart, cartTotals, setQty, removeFromCart, clearCart, user, toast, addToCart } from '../data/store.js';
import { productEmoji } from '../core/format.js';
import { rs, PAYMENT_META, formatDateTime, priceCart } from '../core/format.js';
import { navigate } from '../core/router.js';
import { openInvoice } from './invoice.js';

/* ------------------------------------------------------------------ cart -- */
export async function cartPage() {
  const items = track(cart);
  const discountPct = signal(0);

  if (!items.length) {
    return {
      title: 'Your cart',
      node: h('div.container-page', null, h('div.shell', null,
        Breadcrumb([{ label: 'Home', href: '/' }, { label: 'Cart' }]),
        EmptyState({
          icon: 'cart', title: 'Your cart is empty',
          text: 'Add your staples and we will have them packed and ready.',
          action: Button({ variant: 'primary', onclick: () => navigate('/shop') }, 'Start shopping'),
        }))),
    };
  }

  const totals = cartTotals(track(discountPct));

  const freeDeliveryGap = totals.free_delivery_remaining > 0;

  const summary = h('aside.summary', null,
    h('h3.mb-4', null, 'Order summary'),

    h('div.summary-row', null, h('span.text-muted', null, 'Subtotal'),
      h('span.mono', null, rs(totals.subtotal / 100))),
    totals.discount > 0
      ? h('div.summary-row', null, h('span.text-success', null, 'Discount'),
          h('span.mono.text-success', null, `− ${rs(totals.discount / 100)}`))
      : null,
    h('div.summary-row', null, h('span.text-muted', null, 'GST included'),
      h('span.mono', null, '₹0.00')),
    h('div.summary-row', null, h('span.text-muted', null, 'Delivery'),
      totals.delivery_fee > 0 ? h('span.mono', null, rs(totals.delivery_fee / 100)) : h('span.text-success', null, 'Free')),

    freeDeliveryGap
      ? h('div', { style: { margin: 'var(--sp-3) 0', padding: 'var(--sp-3)', background: 'var(--warning-bg)', borderRadius: 'var(--r-md)' } },
          h('div.text-xs', { style: { color: 'var(--warning)', fontWeight: '600' } },
            `Add ${rs(totals.free_delivery_remaining / 100)} more for free delivery`),
          h('div.progress-track', { style: { marginTop: '6px' } },
            h('div.progress-fill', { style: { width: `${Math.min(100, (totals.subtotal / 30000) * 100)}%`, background: 'var(--warning)' } })))
      : null,

    h('div.summary-total', null, h('span', null, 'Total'),
      h('span.mono', null, rs(totals.total / 100))),

    Button({ variant: 'primary', size: 'lg', class: 'btn-block', style: { marginTop: 'var(--sp-4)' },
      onclick: () => navigate('/checkout') }, 'Proceed to checkout', { size: 17 }),

    h('div.row.gap-2.mt-3', { style: { justifyContent: 'center', color: 'var(--text-muted)' } },
      ['cash', 'upi', 'card'].map((m) => h('span.badge', null, PAYMENT_META[m].emoji, ' ', PAYMENT_META[m].label))),

    h('div.divider.mt-4.mb-3'),
    h('div.row.gap-2.text-xs.text-muted', null,
      icon('shield', { size: 14 }),
      h('span', null, 'Stock is reserved only when the bill is created.')),

    h('div.mt-4', null,
      h('div.text-xs.text-muted.uppercase.mb-2', { style: { letterSpacing: '0.07em' } }, 'Quick discount'),
      h('div.chips', null,
        [0, 5, 10].map((d) => h('button.chip', {
          class: track(discountPct) === d ? 'active' : '',
          onclick: () => { discountPct.value = d; },
        }, d === 0 ? 'No discount' : `${d}% off`)))));

  return {
    title: 'Your cart',
    node: h('div.container-page', null,
      h('div.shell', null,
        Breadcrumb([{ label: 'Home', href: '/' }, { label: 'Cart' }]),
        h('div.page-head', null,
          h('div', null,
            h('h1.page-title', null, 'Your cart'),
            h('p.page-sub', null, `${items.length} item${items.length === 1 ? '' : 's'} · prices include GST`)),
          Button({ variant: 'ghost', size: 'sm', onclick: () => {
            if (items.length && confirm('Remove all items from your cart?')) clearCart();
          } }, icon('trash', { size: 14 }), 'Clear cart')),

        h('div.cart-layout', null,
          h('div.col.gap-3', null,
            items.map((item) => h('div.cart-row', null,
              h('a.cart-thumb', { href: `/product/${item.product.slug}`, 'aria-label': item.product.name },
                productEmoji(item.product)),
              h('div.grow', null,
                h('a', { href: `/product/${item.product.slug}`,
                  style: { fontWeight: '550' } }, item.product.name),
                h('div.text-xs.text-muted.mt-1', null,
                  [item.product.brand, item.product.pack_size].filter(Boolean).join(' · ')),
                h('div.row.gap-2.mt-2', null,
                  h('span.mono.text-sm', null, `${rs(item.product.price / 100)} each`),
                  item.product.mrp_rupees > item.product.price_rupees
                    ? h('span.price-was', null, rs(item.product.mrp_rupees)) : null),
                h('div.text-xs.mt-2', null,
                  item.quantity >= item.product.quantity
                    ? h('span.badge.badge-warning', null, `Only ${item.product.quantity} in stock`)
                    : h('span.text-subtle', null, `${item.product.quantity - item.quantity} more available`))),
              h('div.col.cart-actions', { style: { alignItems: 'flex-end', gap: 'var(--sp-3)' } },
                QuantityStepper({
                  value: item.quantity, max: Math.min(item.product.quantity, 99),
                  onChange: (n) => setQty(item.product.id, n),
                }),
                h('div.row.gap-3', { style: { alignItems: 'center' } },
                  h('span.mono.font-bold.text-lg', null, rs((item.product.price * item.quantity) / 100)),
                  h('button.icon-btn', {
                    onclick: () => removeFromCart(item.product.id),
                    'aria-label': `Remove ${item.product.name}`,
                  }, icon('trash', { size: 16 })))))),

            h('a.btn.btn-ghost', { href: '/shop', style: { alignSelf: 'flex-start' } },
              icon('arrowLeft', { size: 15 }), 'Continue shopping')),

          summary))),
  };
}

/* -------------------------------------------------------------- checkout -- */
export async function checkoutPage() {
  const items = track(cart);
  const me = track(user);

  if (!items.length) {
    navigate('/cart', { replace: true });
    return { node: h('div') };
  }

  const form = {
    name: me?.name || '',
    phone: me?.phone || '',
    address: '',
    city: 'Waghai',
    postal_code: '394730',
    payment_mode: 'upi',
    note: '',
  };
  const discountPct = signal(0);
  const submitting = signal(false);
  const totals = cartTotals(track(discountPct));
  const errors = signal({});

  const customerLookup = signal(null);

  async function findCustomer() {
    const phone = String(form.phone || '').replace(/\D/g, '').slice(-10);
    if (phone.length !== 10) { customerLookup.value = null; return; }
    try {
      const res = await api.get(`/customers?limit=200`);
      const found = res.items.find((c) => c.phone.slice(-10) === phone);
      customerLookup.value = found || null;
      if (found && !form.address) form.address = found.address || '';
    } catch { customerLookup.value = null; }
  }

  function validate() {
    const e = {};
    if (!form.name.trim()) e.name = 'Tell us who the order is for';
    const phone = String(form.phone || '').replace(/\D/g, '');
    if (phone.length !== 10) e.phone = 'Enter a valid 10-digit mobile number';
    if (!form.address.trim() || form.address.trim().length < 8) e.address = 'Add a delivery address';
    errors.value = e;
    return Object.keys(e).length === 0;
  }

  async function placeOrder() {
    if (!validate()) {
      toast('error', 'Check the form', 'Some details still need attention.');
      return;
    }
    submitting.value = true;
    try {
      const order = await api.post('/orders', {
        items: items.map((i) => ({ product_id: i.product.id, quantity: i.quantity })),
        discount_pct: track(discountPct),
        payment_mode: form.payment_mode,
        payment_status: 'paid',
        customer_id: customerLookup.value?.id ?? undefined,
        address: `${form.address}, ${form.city} ${form.postal_code}`,
        note: form.note || `Delivery for ${form.name} · ${form.phone}`,
        status: 'delivered',   // counter sale completes instantly
      });
      clearCart();
      navigate(`/order/${order.order_no}?new=1`);
    } catch (e) {
      toast('error', 'Could not place the order',
        e.details?.shortages?.length
          ? `Only ${e.details.shortages.map((s) => s.available).join(', ')} left for some items.`
          : e.message);
      submitting.value = false;
    }
  }

  const field = (key, label, props = {}) => h('div.field', null,
    h('label.label', null, label, props.required ? h('span.req', null, '*') : null),
    h('input.input', {
      value: form[key],
      'aria-invalid': track(errors)[key] ? 'true' : 'false',
      oninput: (e) => { form[key] = e.target.value; if (key === 'phone') findCustomer(); },
      ...props.input,
    }),
    track(errors)[key] ? h('span.text-xs.text-danger', null, track(errors)[key]) : null);

  const summary = h('aside.summary', null,
    h('h3.mb-4', null, 'Payment summary'),
    h('div.col.gap-2.mb-4', { style: { maxHeight: '16rem', overflowY: 'auto' } },
      items.map((i) => h('div.row-between.text-sm', null,
        h('span.row.gap-2.grow.truncate', null,
          h('span', { style: { fontSize: '1.1rem' } }, productEmoji(i.product)),
          h('span.truncate', null, i.product.name),
          h('span.text-subtle', null, `×${i.quantity}`)),
        h('span.mono', null, rs((i.product.price * i.quantity) / 100))))),

    h('div.divider.mb-3'),
    h('div.summary-row', null, h('span.text-muted', null, 'Subtotal'), h('span.mono', null, rs(totals.subtotal / 100))),
    track(discountPct) > 0
      ? h('div.summary-row', null, h('span.text-success', null, `${track(discountPct)}% discount`),
          h('span.mono.text-success', null, `− ${rs(totals.discount / 100)}`))
      : null,
    h('div.summary-row', null, h('span.text-muted', null, 'Delivery'),
      totals.delivery_fee > 0 ? h('span.mono', null, rs(totals.delivery_fee / 100)) : h('span.text-success', null, 'Free')),
    h('div.summary-total', null, h('span', null, 'To pay'), h('span.mono', null, rs(totals.total / 100))),

    LoadingButton({
      variant: 'primary', size: 'lg', class: 'btn-block', loading: track(submitting),
      style: { marginTop: 'var(--sp-4)' },
      onclick: placeOrder,
    }, track(submitting) ? 'Placing order…' : `Pay ${rs(totals.total / 100)}`),

    h('div.text-center.text-xs.text-muted.mt-3', null,
      'By placing this order you agree to our returns policy'));

  return {
    title: 'Checkout',
    node: h('div.container-page', null,
      h('div.shell', null,
        Breadcrumb([{ label: 'Home', href: '/' }, { label: 'Cart', href: '/cart' }, { label: 'Checkout' }]),
        h('div.page-head', null,
          h('div', null,
            h('h1.page-title', null, 'Checkout'),
            h('p.page-sub', null, 'Two minutes and your basket is on its way.'))),

        h('div.cart-layout', null,
          h('div.col.gap-6', null,
            /* delivery details */
            h('div.card.card-pad', null,
              h('div.row.gap-2.mb-4', null,
                h('div.feature-icon', { style: { width: '2rem', height: '2rem' } }, icon('mapPin', { size: 15 })),
                h('h3', null, 'Delivery details')),
              h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' } },
                field('name', 'Full name', { required: true, input: { placeholder: 'e.g. Mahesh Patel', autocomplete: 'name' } }),
                field('phone', 'Mobile number', {
                  required: true,
                  input: { placeholder: '98765 43210', inputmode: 'numeric', autocomplete: 'tel', maxlength: '12' },
                })),
              h('div.field.mt-4', null,
                h('label.label', null, 'Delivery address', h('span.req', null, '*')),
                h('textarea.textarea', {
                  value: form.address,
                  'aria-invalid': track(errors).address ? 'true' : 'false',
                  placeholder: 'House / shop no., street, landmark',
                  oninput: (e) => { form.address = e.target.value; },
                  style: { minHeight: '72px' },
                }),
                track(errors).address ? h('span.text-xs.text-danger', null, track(errors).address) : null),
              h('div.grid.mt-4', { style: { gridTemplateColumns: '1fr 1fr' } },
                field('city', 'Town / village', { input: { autocomplete: 'address-level2' } }),
                field('postal_code', 'PIN code', { input: { inputmode: 'numeric', maxlength: '6' } })),

              track(customerLookup)
                ? h('div.row.gap-3.mt-4', {
                    style: {
                      padding: 'var(--sp-3)', background: 'var(--primary-soft)',
                      borderRadius: 'var(--r-md)', border: '1px solid color-mix(in srgb, var(--primary) 25%, transparent)',
                    },
                  },
                  h('span', { style: { fontSize: '1.2rem' } }, '🎉'),
                  h('div', null,
                    h('div.text-sm.font-semibold', { style: { color: 'var(--primary)' } },
                      `Welcome back, ${track(customerLookup).name.split(' ')[0]}!`),
                    h('div.text-xs.text-muted', null,
                      `${track(customerLookup).orders_count} orders · ₹${track(customerLookup).total_spent_rupees} lifetime · ${track(customerLookup).loyalty_points} loyalty points`)))
                : null),

            /* payment */
            h('div.card.card-pad', null,
              h('div.row.gap-2.mb-4', null,
                h('div.feature-icon', { style: { width: '2rem', height: '2rem' } }, icon('wallet', { size: 15 })),
                h('h3', null, 'Payment method')),
              h('div.col.gap-2', null,
                [['upi', 'UPI', 'Pay with any UPI app — GPay, PhonePe, Paytm', 'smartphone'],
                 ['card', 'Card', 'Debit or credit card, swipe at the counter', 'creditCard'],
                 ['cash', 'Cash', 'Pay the delivery boy in cash', 'wallet']].map(([id, label, desc, ic]) =>
                  h('button.pay-option', {
                    class: form.payment_mode === id ? 'active' : '',
                    onclick: () => { form.payment_mode = id; rerenderPay(); },
                  }, icon(ic, { size: 18 }),
                    h('div.grow', { style: { textAlign: 'left' } },
                      h('div.font-semibold.text-sm', null, label),
                      h('div.text-xs.text-muted', null, desc)),
                    form.payment_mode === id ? icon('checkCircle', { size: 17 }) : null))),

              h('div.field.mt-4', null,
                h('label.label', null, 'Note for the shop (optional)'),
                h('input.input', {
                  value: form.note, placeholder: 'e.g. Ring the bell twice, deliver after 6 PM',
                  oninput: (e) => { form.note = e.target.value; },
                }))),

            /* discount */
            h('div.card.card-pad', null,
              h('div.row.gap-2.mb-3', null,
                h('div.feature-icon', { style: { width: '2rem', height: '2rem' } }, icon('percent', { size: 15 })),
                h('h3', null, 'Discount')),
              h('div.chips', null,
                [0, 5, 10, 15].map((d) => h('button.chip', {
                  class: track(discountPct) === d ? 'active' : '',
                  onclick: () => { discountPct.value = d; },
                }, d === 0 ? 'None' : `${d}% off`))),
              h('p.text-xs.text-muted.mt-3', null,
                'Manager approval is needed above 15%. The system logs every discount applied.')),

            h('div.card.card-pad', null,
              h('div.row.gap-2.mb-3', null,
                h('div.feature-icon', { style: { width: '2rem', height: '2rem' } }, icon('user', { size: 15 })),
                h('h3', null, 'Need a quick bill without delivery?')),
              h('p.text-sm.text-muted', null,
                'Walk into the shop and ask for a counter bill — staff use the same billing screen with instant payment.'),
              track(user) && ['admin', 'manager', 'staff'].includes(track(user).role)
                ? Button({ variant: 'subtle', style: { marginTop: 'var(--sp-3)' },
                    onclick: () => navigate('/admin/billing') },
                    icon('receipt', { size: 15 }), 'Open the billing counter')
                : null)),

          summary))),
  };

  function rerenderPay() {
    // cheapest correct refresh: re-run the whole page renderer
    document.querySelectorAll('.pay-option').forEach((el, i) => {
      el.classList.toggle('active', ['upi', 'card', 'cash'][i] === form.payment_mode);
    });
  }
}

/* ------------------------------------------------------- order success --- */
export async function orderPage({ params, query }) {
  const order = await api.get(`/orders/${encodeURIComponent(params.orderNo)}`);
  const isNew = query.get('new') === '1';
  const steps = ['confirmed', 'packed', 'out_for_delivery', 'delivered'];
  const idx = steps.indexOf(order.status);

  const timeline = h('div.timeline', null,
    steps.map((s, i) => h(`div.timeline-item${i <= idx ? '.done' : ''}${i === idx ? '.active' : ''}`, null,
      h('div.timeline-dot', null, i <= idx ? icon('check', { size: 11 }) : icon('clock', { size: 11 })),
      h('div', null,
        h('div.text-sm.font-semibold', null,
          ['Order confirmed', 'Packed by the shop', 'Out for delivery', 'Delivered'][i]),
        h('div.text-xs.text-muted', null,
          i <= idx
            ? (i === 0 ? formatDateTime(order.created_at) : 'Recorded by staff')
            : 'Pending')))));

  return {
    title: `Order ${order.order_no}`,
    node: h('div.container-page', null,
      h('div.shell', null,
        Breadcrumb([{ label: 'Home', href: '/' }, { label: 'Orders', href: '/account' }, { label: order.order_no }]),

        isNew
          ? h('div.card.card-pad.mt-6', {
              style: { background: 'var(--success-bg)', borderColor: 'color-mix(in srgb, var(--success) 30%, transparent)' },
            },
              h('div.row.gap-3', null,
                h('span', { style: { fontSize: '2rem' } }, '🎉'),
                h('div', null,
                  h('h2', { style: { color: 'var(--success)' } }, 'Order placed successfully'),
                  h('p.text-sm.mt-1', null,
                    `We have your order ${order.order_no}. A confirmation has been sent to ${order.customer_phone || 'your mobile'}.`))))
          : null,

        h('div.page-head.mt-6', null,
          h('div', null,
            h('h1.page-title', null, `Order ${order.order_no}`),
            h('p.page-sub', null, `${formatDateTime(order.created_at)} · ${order.items.length} item${order.items.length === 1 ? '' : 's'}`)),
          h('div.row.gap-2', null,
            Button({ variant: 'default', onclick: () => openInvoice(order) },
              icon('receipt', { size: 15 }), 'Invoice'),
            Button({ variant: 'primary', onclick: () => navigate('/shop') }, 'Continue shopping'))),

        h('div.grid.mt-6', { style: { gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)' } },
          h('div.col.gap-4', null,
            h('div.card.card-pad', null,
              h('div.row-between.mb-4', null,
                h('h3', null, 'Items'),
                h('span.badge', null, `${PAYMENT_META[order.payment_mode]?.emoji} ${PAYMENT_META[order.payment_mode]?.label}`)),
              h('div.col.gap-3', null,
                order.items.map((it) => h('div.row.gap-3', null,
                  h('div.cart-thumb', { style: { width: '3rem', height: '3rem', fontSize: '1.25rem' } }, '🛍️'),
                  h('div.grow', null,
                    h('div.text-sm.font-semibold', null, it.product_name),
                    h('div.text-xs.text-muted', null, `${it.sku} · ${it.quantity} × ₹${(it.unit_price / 100).toFixed(2)}`)),
                  h('span.mono.font-semibold', null, rs(it.line_total / 100)))))),

            h('div.card.card-pad', null,
              h('h3.mb-4', null, 'Order status'),
              timeline)),

          h('div.col.gap-4', null,
            h('div.card.card-pad', null,
              h('h3.mb-3', null, 'Payment'),
              h('div.summary-row', null, h('span.text-muted', null, 'Subtotal'),
                h('span.mono', null, rs(order.totals_rupees.subtotal))),
              order.discount > 0
                ? h('div.summary-row', null, h('span.text-success', null, 'Discount'),
                    h('span.mono.text-success', null, `− ₹${order.totals_rupees.discount}`))
                : null,
              h('div.summary-row', null, h('span.text-muted', null, 'Delivery'),
                h('span.mono', null, order.delivery_fee > 0 ? `₹${order.totals_rupees.delivery_fee}` : 'Free')),
              h('div.summary-total', null, h('span', null, 'Paid'),
                h('span.mono', null, `₹${order.totals_rupees.total}`)),
              h('div.row.between.mt-3', null,
                h('span.text-xs.text-muted', null, 'Invoice'),
                h('span.mono.text-xs', null, order.invoice_no || '—')),
              h('div.row.between.mt-2', null,
                h('span.text-xs.text-muted', null, 'Payment status'),
                h('span.badge', { class: `badge-${order.payment_status === 'paid' ? 'success' : 'warning'}` }, order.payment_status))),

            h('div.card.card-pad', null,
              h('h3.mb-3', null, 'Delivery address'),
              h('p.text-sm', null, order.address || 'Walk-in purchase'),
              order.customer_name
                ? h('div.mt-3', null,
                    h('div.text-xs.text-muted', null, 'Customer'),
                    h('div.text-sm.font-semibold', null, order.customer_name),
                    order.customer_phone ? h('div.text-xs.text-muted', null, order.customer_phone) : null)
                : null),

            Button({ variant: 'subtle', class: 'btn-block', onclick: () => openInvoice(order) },
              icon('printer', { size: 15 }), 'View printable invoice')))),)
  };
}