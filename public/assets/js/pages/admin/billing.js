/**
 * Billing counter (POS) — search, add items, apply discount,
 * take payment and print the invoice, exactly like the deck's
 * Process Sale use case.
 */
import { h, render, track, signal } from '../../core/react.js';
import { api } from '../../core/api.js';
import { icon } from '../../ui/icons.js';
import { Button, Card, EmptyState, QuantityStepper, LoadingButton, openModal, Badge } from '../../ui/components.js';
import { CompactProductRow } from '../components-store.js';
import { openInvoice } from '../invoice.js';
import { pageHead, consoleRow } from './lib.js';
import { user, toast } from '../../data/store.js';
import { productEmoji } from '../../core/format.js';
import { rs, PAYMENT_META, priceCart, titleCase } from '../../core/format.js';
import { debounce } from '../../core/react.js';
import { navigate } from '../../core/router.js';

const DELIVERY_FEE = 2500;      // paise
const FREE_ABOVE = 30000;       // paise

export async function billingPage() {
  const me = track(user);
  /* basket state */
  const lines = signal([]);            // [{ product, quantity }]
  const discountPct = signal(0);
  const payment = signal('upi');
  const collectDelivery = signal(false);
  const submitting = signal(false);
  const search = signal('');
  const results = signal([]);
  const selected = signal(0);
  const customer = signal(null);
  const phone = signal('');
  const customerSearch = signal('');

  function paintResults() {
    const list = track(results);
    resultsHost.replaceChildren(...(list.length
      ? [render(h('div', null, list.map((pr, i) => h('div.pos-search-result', {
          class: i === track(selected) ? 'sel' : '',
          onclick: () => { add(pr, 1); search.value = ''; results.value = []; paintResults(); },
        },
          h('div.pos-thumb', null, productEmoji(pr)),
          h('div.grow', null,
            h('div.text-sm.font-semibold.truncate', null, pr.name),
            h('div.text-xs.text-muted', null,
              `${pr.sku} \u00b7 ${pr.quantity} in stock \u00b7 ${pr.stock_state === 'out_of_stock' ? 'OUT OF STOCK' : pr.category_name}`)),
          h('span.mono.font-semibold', null, `\u20b9${pr.price_rupees}`)))))]
      : []));
    resultsHost.style.display = list.length ? '' : 'none';
  }

  const searchProducts = debounce(async (q) => {
    if (!q || q.length < 1) { results.value = []; paintResults(); return; }
    try {
      const res = await api.get(`/products?q=${encodeURIComponent(q)}&per_page=10`);
      results.value = res.items;
      selected.value = 0;
    } catch { results.value = []; }
    paintResults();
  }, 220);

  const searchCustomers = debounce(async (q) => {
    if (!q || q.length < 2) { customerSearch.value = ''; return; }
    try {
      const res = await api.get(`/customers?limit=200`);
      const m = res.items.find((c) =>
        c.name.toLowerCase().includes(q.toLowerCase()) || c.phone.includes(q));
      customerSearch.value = m || null;
    } catch { customerSearch.value = ''; }
  }, 260);

  const items = track(lines);
  const resultsHost = render(h('div', { style: { padding: 'var(--sp-2)', borderBottom: '1px solid var(--border)', maxHeight: '17rem', overflowY: 'auto' } }));
  const basketHost = render(h('div'));
  const totalsHost = render(h('div'));

  function add(product, qty = 1) {
    const existing = lines.value.find((l) => l.product.id === product.id);
    const nextQty = (existing?.quantity || 0) + qty;
    if (nextQty > product.quantity) {
      toast('warning', 'Not enough stock', `Only ${product.quantity} left for ${product.name}`);
      return;
    }
    lines.value = existing
      ? lines.value.map((l) => (l.product.id === product.id ? { ...l, quantity: nextQty } : l))
      : [...lines.value, { product, quantity: qty }];
    paint();
  }

  function setQty(id, q) {
    if (q <= 0) { lines.value = lines.value.filter((l) => l.product.id !== id); paint(); return; }
    const line = lines.value.find((l) => l.product.id === id);
    if (q > line.product.quantity) {
      toast('warning', 'Not enough stock', `Only ${line.product.quantity} left`);
      return;
    }
    lines.value = lines.value.map((l) => (l.product.id === id ? { ...l, quantity: q } : l));
    paint();
  }

  const totals = priceCart(
    items.map((l) => ({ price: l.product.price, quantity: l.quantity })),
    { discountPct: track(discountPct), deliveryFee: DELIVERY_FEE, freeAbove: FREE_ABOVE }
  );
  const unitCount = items.reduce((s, i) => s + i.quantity, 0);

  async function completeSale() {
    const live = lines.value;
    if (!live.length) return toast('error', 'Empty bill', 'Add at least one item first.');
    submitting.value = true;
    try {
      const order = await api.post('/orders', {
        items: live.map((l) => ({ product_id: l.product.id, quantity: l.quantity })),
        discount_pct: track(discountPct),
        payment_mode: track(payment),
        payment_status: 'paid',
        customer_id: track(customer)?.id,
        address: track(collectDelivery) ? 'Delivery' : 'Walk-in — counter sale',
        note: track(customer) ? `Customer: ${track(customer).name}` : 'Walk-in customer',
        status: 'delivered',
      });

      // allow printing / a new bill immediately
      openInvoice(order);
      toast('success', `Bill ${order.invoice_no}`,
        `${live.length} line${live.length === 1 ? '' : 's'} · ₹${order.totals_rupees.total}`);

      // reset for the next customer
      lines.value = [];
      discountPct.value = 0;
      customer.value = null;
      phone.value = '';
      results.value = [];
      search.value = '';
      submitting.value = false;
      paint();
    } catch (e) {
      submitting.value = false;
      toast('error', 'Could not complete the sale',
        e.details?.shortages
          ? `Stock changed — only ${e.details.shortages.map((s) => `${s.available}× ${s.name}`).join(', ')} left.`
          : e.message);
    }
  }

  /* keyboard: Enter adds the highlighted search result */
  const onKey = (e) => {
    if (e.key === 'Enter' && track(results).length && document.activeElement?.id === 'pos-search') {
      e.preventDefault();
      const pick = track(results)[track(selected)];
      if (pick) { add(pick, 1); search.value = ''; results.value = []; }
    }
  };
  document.addEventListener('keydown', onKey);

  function currentTotals() {
    return priceCart(
      lines.value.map((l) => ({ price: l.product.price, quantity: l.quantity })),
      { discountPct: track(discountPct), deliveryFee: DELIVERY_FEE, freeAbove: FREE_ABOVE }
    );
  }

  function paint() {
    const live = lines.value;
    const t = currentTotals();
    const unitCount = live.reduce((s2, i) => s2 + i.quantity, 0);

    basketHost.replaceChildren(render(live.length
      ? h('div.col.gap-2', null, live.map((l) => h('div.row.gap-3', {
          style: { padding: 'var(--sp-2) var(--sp-3)', borderRadius: 'var(--r-md)',
                   border: '1px solid var(--border)', background: 'var(--surface-2)' },
        },
          h('div.pos-thumb', null, productEmoji(l.product)),
          h('div.grow', null,
            h('div.text-sm.font-semibold.truncate', null, l.product.name),
            h('div.text-xs.text-muted', null,
              `\u20b9${l.product.price_rupees} \u00d7 ${l.quantity} \u00b7 ${l.product.sku}`)),
          QuantityStepper({ value: l.quantity, small: true, max: l.product.quantity,
            onChange: (n) => { setQty(l.product.id, n); paint(); } }),
          h('span.mono.font-bold', { style: { minWidth: '4.5rem', textAlign: 'right' } },
            `\u20b9${((l.product.price * l.quantity) / 100).toFixed(2)}`),
          h('button.icon-btn', {
            onclick: () => { setQty(l.product.id, 0); paint(); },
            'aria-label': `Remove ${l.product.name}`,
            style: { width: '1.6rem', height: '1.6rem' },
          }, icon('trash', { size: 13 })))))
      : EmptyState({ icon: 'receipt', title: 'Start a new bill',
          text: 'Search or scan a product to add it. Nothing is charged until you complete the sale.' })));

    totalsHost.replaceChildren(render(
      h('div.card.card-pad', { style: { marginTop: 'auto' } },
        h('div.row.between.mb-3', null,
          h('h4', null, 'Bill summary'),
          live.length
            ? h('button.btn.btn-ghost.btn-sm', { onclick: () => { lines.value = []; paint(); }, title: 'Clear the bill' },
                icon('x', { size: 13 }), 'Clear')
            : null),
        consoleRow({ label: `Items (${unitCount})`, value: `\u20b9${(t.subtotal / 100).toFixed(2)}` }),
        track(discountPct) > 0
          ? h('div.row-between', null,
              h('span.text-sm.text-success', null, `Discount ${track(discountPct)}%`),
              h('span.mono.text-sm.text-success', null, `\u2212 \u20b9${(t.discount / 100).toFixed(2)}`))
          : null,
        consoleRow({ label: 'Delivery',
          value: t.delivery_fee > 0 ? `\u20b9${(t.delivery_fee / 100).toFixed(2)}` : 'Free' }),
        h('div.summary-total', null, h('span', null, 'Total'),
          h('span.mono', null, `\u20b9${(t.total / 100).toFixed(2)}`)),
        h('div.mt-3', null,
          h('div.text-xs.text-muted.uppercase.mb-2', { style: { letterSpacing: '0.07em' } }, 'Discount'),
          h('div.chips', null, [0, 5, 10, 15].map((d) => h('button.chip', {
            class: track(discountPct) === d ? 'active' : '',
            onclick: () => { discountPct.value = d; paint(); },
          }, d === 0 ? 'None' : `${d}%`)))),
        h('button.btn.btn-primary.btn-lg.btn-block', {
          style: { marginTop: 'var(--sp-4)' },
          disabled: !live.length,
          onclick: completeSale,
        }, track(submitting) ? 'Saving\u2026' : `Complete sale \u00b7 \u20b9${(t.total / 100).toFixed(2)}`),
        h('div.row.gap-2.mt-2', { style: { justifyContent: 'center' } },
          h('span.text-xs.text-muted', null, 'Creates the invoice and deducts stock atomically')))));
  }

  const searchPanel = h('div.card', null,
    h('div', { style: { padding: 'var(--sp-4)', borderBottom: '1px solid var(--border)' } },
      h('div.input-group', null,
        h('span.input-icon', null, icon('scan', { size: 17 })),
        h('input.input#pos-search', {
          type: 'search', placeholder: 'Scan barcode or search by name / SKU…',
          value: track(search), autocomplete: 'off',
          oninput: (e) => { search.value = e.target.value; searchProducts(e.target.value); },
          onfocus: (e) => { if (e.target.value) searchProducts(e.target.value); },
        }),
        track(search)
          ? h('button', {
              style: { position: 'absolute', right: '0.6rem', color: 'var(--text-subtle)' },
              onclick: () => { search.value = ''; results.value = []; },
              'aria-label': 'Clear',
            }, icon('x', { size: 15 }))
          : null),
      h('p.text-xs.text-muted.mt-2', null,
        icon('info', { size: 11 }), ' Press ', h('kbd', null, 'Enter'), ' to add the highlighted item.')),

    resultsHost,

    h('div', { style: { padding: 'var(--sp-4)', maxHeight: '22rem', overflowY: 'auto' } }, basketHost),
  );

  const customerPanel = h('div.card.card-pad', null,
    h('div.row.between.mb-3', null,
      h('h4', null, 'Customer'),
      track(customer)
        ? h('button.btn.btn-ghost.btn-sm', {
            onclick: () => { customer.value = null; customerSearch.value = ''; phone.value = ''; },
          }, 'Clear')
        : null),

    track(customer)
      ? h('div.row.gap-3', {
          style: { padding: 'var(--sp-3)', background: 'var(--primary-soft)', borderRadius: 'var(--r-md)' },
        },
          h('span', { style: { fontSize: '1.4rem' } }, '🎉'),
          h('div', null,
            h('div.font-semibold.text-sm', null, track(customer).name),
            h('div.text-xs.text-muted', null,
              `${track(customer).phone} · ${track(customer).orders_count} orders · ${track(customer).loyalty_points} pts`)))
      : h('div', null,
          h('input.input', {
            placeholder: 'Phone number or name (optional)',
            value: track(phone),
            oninput: (e) => { phone.value = e.target.value; searchCustomers(e.target.value); },
          }),
          track(customerSearch) && String(track(customerSearch).phone).slice(-10) === String(track(phone)).slice(-10)
            ? h('button', {
                onclick: () => { customer.value = track(customerSearch); customerSearch.value = ''; },
                style: {
                  marginTop: 'var(--sp-2)', width: '100%', padding: 'var(--sp-2) var(--sp-3)',
                  borderRadius: 'var(--r-md)', border: '1px solid var(--primary)',
                  background: 'var(--primary-soft)', textAlign: 'left',
                },
              },
                h('div.text-sm.font-semibold', null, track(customerSearch).name),
                h('div.text-xs.text-muted', null,
                  `${track(customerSearch).phone} · ₹${track(customerSearch).total_spent_rupees} lifetime`))
            : null));

  const payPanel = h('div.card.card-pad', null,
    h('h4.mb-3', null, 'Payment'),
    h('div.col.gap-2', null,
      Object.entries(PAYMENT_META).map(([id, meta]) =>
        h('button.pay-option', {
          class: track(payment) === id ? 'active' : '',
          onclick: () => { payment.value = id; syncPaymentUI(); },
        }, h('span', { style: { fontSize: '1.1rem' } }, meta.emoji),
          h('div.grow', { style: { textAlign: 'left' } },
            h('div.text-sm.font-semibold', null, meta.label),
            h('div.text-xs.text-muted', null,
              id === 'upi' ? 'GPay · PhonePe · Paytm' : id === 'card' ? 'Debit / credit' : 'Cash at counter')),
          track(payment) === id ? icon('checkCircle', { size: 16 }) : null))),

    h('label.checkbox.mt-3', null,
      h('input', {
        type: 'checkbox', checked: track(collectDelivery),
        onchange: (e) => { collectDelivery.value = e.target.checked; },
      }),
      'This is a home delivery'),

    track(discountPct) > 0
      ? h('div.text-xs.text-muted.mt-2', null,
          `Discount logged for ${me?.name} (${me?.role}). Manager policy applies above 15%.`)
      : null);

  function syncPaymentUI() {
    document.querySelectorAll('.pay-option').forEach((el) => el.classList.remove('active'));
  }

  paint();

  return {
    title: 'Billing counter',
    cleanup: () => document.removeEventListener('keydown', onKey),
    node: h('div', null,
      pageHead({
        title: 'Billing counter',
        sub: 'Scan or search to build the bill — stock updates the moment the sale is saved.',
        actions: [
          Button({ variant: 'default', onclick: () => navigate('/admin/orders') },
            icon('package', { size: 15 }), 'Orders'),
          Button({ variant: 'subtle', onclick: () => navigate('/admin/inventory') },
            icon('box', { size: 15 }), 'Stock'),
        ],
      }),
      h('div.pos-layout', null,
        h('div.col.gap-4', null, searchPanel, customerPanel),
        h('div.col.gap-4', { style: { position: 'sticky', top: 'calc(60px + var(--sp-4))' } }, payPanel, totalsHost))),
  };
}