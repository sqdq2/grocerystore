/**
 * Printable GST invoice — thermal-friendly layout that also works on screen.
 */
import { h } from '../core/react.js';
import { icon } from '../ui/icons.js';
import { openModal, Button } from '../ui/components.js';
import { store } from '../data/store.js';
import { rs, formatDateTime, PAYMENT_META } from '../core/format.js';

export function invoiceDoc(order) {
  const meta = store.value || {};
  const pay = PAYMENT_META[order.payment_mode] || { label: order.payment_mode, emoji: '•' };

  return h('div.invoice-doc', null,
    /* header */
    h('div.inv-head', null,
      h('div', null,
        h('div.inv-title', null, meta.name || 'Bijasan General Store'),
        h('div.text-xs.text-muted', null, meta.tagline || ''),
        h('div.text-xs.mt-2', null,
          meta.address_line1, h('br'), meta.address_line2),
        h('div.text-xs.mt-1', null,
          icon('phone', { size: 11 }), ' ', meta.phone, '  ·  ',
          icon('mail', { size: 11 }), ' ', meta.email),
        h('div.text-xs.mt-1', null, 'GSTIN: ', h('span.mono', null, meta.gstin || '—'))),
      h('div.inv-meta', null,
        h('div.inv-meta-label', null, 'Tax invoice'),
        h('div.inv-meta-value.mono', null, order.invoice_no || 'Pending'),
        h('div.inv-meta-label.mt-3', null, 'Order number'),
        h('div.inv-meta-value.mono', null, order.order_no),
        h('div.inv-meta-label.mt-3', null, 'Date'),
        h('div.inv-meta-value', null, formatDateTime(order.created_at)),
        h('div.inv-meta-label.mt-3', null, 'Billed by'),
        h('div.inv-meta-value', null, order.cashier_name || 'Store counter'))),

    /* parties */
    h('div.inv-parties', null,
      h('div', null,
        h('div.inv-party-label', null, 'Customer'),
        h('div', { style: { fontWeight: '550' } }, order.customer_name || 'Walk-in customer'),
        order.customer_phone ? h('div.text-xs.text-muted', null, order.customer_phone) : null,
        order.address ? h('div.text-xs.text-muted.mt-1', null, order.address) : null),
      h('div', null,
        h('div.inv-party-label', null, 'Payment'),
        h('div', { style: { fontWeight: '550' } }, `${pay.emoji} ${pay.label}`),
        h('div.text-xs.text-muted', { style: { textTransform: 'capitalize' } }, order.payment_status),
        order.note ? h('div.text-xs.text-muted.mt-1', null, order.note) : null)),

    /* items */
    h('div.table-wrap', { style: { marginTop: 'var(--sp-4)' } },
      h('table.tbl', null,
        h('thead', null, h('tr', null,
          h('th', { style: { width: '36px' } }, '#'),
          h('th', null, 'Item'),
          h('th', { style: { width: '96px' } }, 'SKU'),
          h('th.tbl-num', { style: { width: '80px' } }, 'Rate'),
          h('th.tbl-num', { style: { width: '54px' } }, 'Qty'),
          h('th.tbl-num', { style: { width: '70px' } }, 'GST'),
          h('th.tbl-num', { style: { width: '100px' } }, 'Amount'))),
        h('tbody', null,
          order.items.map((it, i) => h('tr', null,
            h('td.text-subtle', null, i + 1),
            h('td', null,
              h('div.font-semibold', null, it.product_name),
              it.pack_size ? h('div.text-xs.text-muted', null, it.pack_size) : null),
            h('td.mono.text-xs', null, it.sku),
            h('td.tbl-num', null, rs(it.unit_price / 100)),
            h('td.tbl-num', null, it.quantity),
            h('td.tbl-num', null, `${it.tax_rate}%`),
            h('td.tbl-num', null, rs(it.line_total / 100))))))),

    /* totals */
    h('div.inv-totals.mt-4', null,
      h('div.inv-total-row', null, h('span', null, 'Subtotal'), h('span.mono', null, rs(order.totals_rupees.subtotal))),
      order.discount > 0
        ? h('div.inv-total-row', null, h('span', null, 'Discount'), h('span.mono', null, `− ₹${order.totals_rupees.discount}`))
        : null,
      h('div.inv-total-row', null, h('span', null, 'Delivery'),
        h('span.mono', null, order.delivery_fee > 0 ? `₹${order.totals_rupees.delivery_fee}` : 'Free')),
      h('div.inv-total-row.grand', null, h('span', null, 'Total'), h('span.mono', null, `₹${order.totals_rupees.total}`)),
      h('div.text-xs.text-muted.mt-2', { style: { textAlign: 'right' } },
        'Amount in words: ', amountInWords(order.totals_rupees.total))),

    h('div.divider.mt-6'),
    h('div.row-between.mt-4', { style: { fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' } },
      h('div', null, 'Goods once sold are exchangeable within 24 hours with this invoice.'),
      h('div.text-right', null,
        'For ', meta.name || 'Bijasan General Store', h('br'),
        h('span.mt-6', { style: { display: 'inline-block', borderTop: '1px solid var(--border-strong)', paddingTop: '4px', width: '180px' } },
          'Authorised signatory'))),
  );
}

export function openInvoice(order) {
  const doc = invoiceDoc(order);
  openModal({
    title: `Invoice ${order.invoice_no || order.order_no}`,
    size: 'xl',
    body: doc,
    footer: h('div.row.gap-2', null,
      Button({ variant: 'default', onclick: () => window.print() }, icon('printer', { size: 15 }), 'Print'),
      Button({ variant: 'primary', onclick: () => window.print() }, icon('download', { size: 15 }), 'Save as PDF')),
  });
}

/* ------------------------------------------------- amount in words ------ */
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n) {
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
}

export function amountInWords(rupeesStr) {
  const rupees = Math.floor(Number(rupeesStr || 0));
  const paise = Math.round((Number(rupeesStr || 0) - rupees) * 100);
  if (rupees === 0 && paise === 0) return 'Zero Rupees Only';

  const parts = [];
  const units = [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand'], [100, 'Hundred']];
  let n = rupees;
  for (const [value, name] of units) {
    const count = Math.floor(n / value);
    if (count > 0) { parts.push(`${twoDigits(count)} ${name}`); n %= value; }
  }
  if (n > 0) parts.push(twoDigits(n));

  let out = `${parts.join(' ')} Rupees`.trim();
  if (paise > 0) out += ` and ${twoDigits(paise)} Paise`;
  return `${out} Only`;
}