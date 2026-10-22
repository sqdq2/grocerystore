/**
 * Product editor — create, edit, discontinue / re-introduce.
 */
import { h, track, signal } from '../../core/react.js';
import { api } from '../../core/api.js';
import { icon } from '../../ui/icons.js';
import { Button, openModal, LoadingButton, Badge } from '../../ui/components.js';
import { toast, can } from '../../data/store.js';
import { rs, titleCase, productEmoji } from '../../core/format.js';

const UNITS = [['pc', 'Piece'], ['pack', 'Pack'], ['kg', 'Kilogram'], ['L', 'Litre'], ['box', 'Box'], ['dozen', 'Dozen']];

/**
 * @param {object|null} product  existing product, or null to create
 * @param {Array} categories     for the category picker
 * @returns {Promise<boolean>}    true when a change was saved
 */
export function openProductEditor(product, categories = []) {
  const isNew = !product;
  const form = {
    name: product?.name || '',
    brand: product?.brand || '',
    category_id: product?.category_id || categories[0]?.id,
    supplier_id: product?.supplier_id || '',
    price: product ? product.price_rupees : '',
    mrp: product ? product.mrp_rupees : '',
    unit: product?.unit || 'pc',
    pack_size: product?.pack_size || '',
    tax_rate: product?.tax_rate ?? 5,
    barcode: product?.barcode || '',
    is_featured: product?.is_featured ?? 0,
    description: product?.description || '',
    quantity: product?.quantity ?? 0,
    reorder_level: product?.reorder_level ?? 10,
  };
  const busy = signal(false);
  const errors = signal({});

  function validate() {
    const e = {};
    if (!form.name.trim()) e.name = 'Give the product a name';
    if (!form.category_id) e.category_id = 'Pick a category';
    const p = Number(form.price);
    if (!Number.isFinite(p) || p < 0) e.price = 'Enter a valid price';
    const m = Number(form.mrp);
    if (form.mrp !== '' && (!Number.isFinite(m) || m < p)) e.mrp = 'MRP must be at least the price';
    const r = Number(form.reorder_level);
    if (!Number.isFinite(r) || r < 0) e.reorder_level = 'Enter a valid reorder level';
    errors.value = e;
    return Object.keys(e).length === 0;
  }

  async function save() {
    if (!validate()) return toast('error', 'Check the form', 'Some fields need attention.');
    busy.value = true;
    try {
      const payload = {
        name: form.name.trim(), brand: form.brand || null,
        category_id: Number(form.category_id),
        supplier_id: form.supplier_id ? Number(form.supplier_id) : null,
        price: Number(form.price), mrp: form.mrp === '' ? Number(form.price) : Number(form.mrp),
        unit: form.unit, pack_size: form.pack_size || null,
        tax_rate: Number(form.tax_rate), barcode: form.barcode || null,
        is_featured: form.is_featured ? 1 : 0,
        description: form.description || null,
        reorder_level: Number(form.reorder_level),
      };
      if (isNew) payload.quantity = Number(form.quantity) || 0;

      if (isNew) {
        await api.post('/products', payload);
        toast('success', 'Product created', form.name);
      } else {
        await api.patch(`/products/${product.id}`, payload);
        toast('success', 'Product updated', form.name);
      }
      api.clearCache();
      m.close();
      resolve(true);
    } catch (e) {
      toast('error', 'Could not save', e.message);
    } finally { busy.value = false; }
  }

  async function toggleStatus() {
    const next = product.status === 'discontinued' ? 'available' : 'discontinued';
    busy.value = true;
    try {
      await api.post(`/products/${product.id}/status`, { status: next });
      api.clearCache();
      toast('success', next === 'discontinued' ? 'Product discontinued' : 'Product re-introduced',
        next === 'discontinued'
          ? 'It stays on old invoices but disappears from the shop.'
          : 'It is back on the shelf with live stock rules.');
      m.close();
      resolve(true);
    } catch (e) {
      toast('error', 'Could not change status', e.message);
    } finally { busy.value = false; }
  }

  let resolve;
  const done = new Promise((r) => { resolve = r; });

  const field = (key, label, props = {}) => h('div.field', null,
    h('label.label', null, label, props.required ? h('span.req', null, '*') : null),
    props.type === 'select'
      ? h('select.select', {
          value: form[key],
          onchange: (e) => { form[key] = e.target.value; },
        }, props.options.map(([v, l]) => h('option', { value: v, selected: String(form[key]) === String(v) }, l)))
      : h('input.input', {
          type: props.inputType || 'text', value: form[key] ?? '',
          placeholder: props.placeholder || '',
          inputmode: props.inputMode,
          step: props.step, min: props.min, max: props.max,
          'aria-invalid': track(errors)[key] ? 'true' : 'false',
          oninput: (e) => {
            const v = props.inputType === 'number' ? e.target.value : e.target.value;
            form[key] = v;
          },
        }),
    track(errors)[key] ? h('span.text-xs.text-danger', null, track(errors)[key]) : null);

  const m = openModal({
    title: isNew ? 'Add a product' : `Edit · ${product.name}`,
    size: 'lg',
    body: h('div.col.gap-4', null,
      isNew
        ? null
        : h('div.row.gap-3', {
            style: { padding: 'var(--sp-3)', background: 'var(--bg-subtle)', borderRadius: 'var(--r-md)' },
          },
            h('div.pos-thumb', { style: { width: '2.75rem', height: '2.75rem', fontSize: '1.3rem' } }, productEmoji(product)),
            h('div.grow', null,
              h('div.row.gap-2', null,
                h('span.font-semibold', null, product.sku),
                product.status === 'discontinued'
                  ? h('span.badge.badge-info', null, 'Discontinued')
                  : h('span.badge', { class: product.stock_state === 'available' ? 'badge-success' : product.stock_state === 'low_stock' ? 'badge-warning' : 'badge-danger' },
                      titleCase(product.stock_state))),
              h('div.text-xs.text-muted', null,
                `${product.quantity} on hand · reorder at ${product.reorder_level} · ₹${(product.stock_value / 100).toLocaleString('en-IN')} at cost`)),
            Button({ variant: 'subtle', size: 'sm', onclick: toggleStatus },
              icon(product.status === 'discontinued' ? 'refresh' : 'x', { size: 14 }),
              product.status === 'discontinued' ? 'Re-introduce' : 'Discontinue')),

      h('div.grid', { style: { gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)' } },
        field('name', 'Product name', { required: true, placeholder: 'e.g. Aashirvaad Whole Wheat Atta' }),
        field('brand', 'Brand', { placeholder: 'e.g. Aashirvaad' })),

      h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' } },
        field('category_id', 'Category', {
          required: true, type: 'select',
          options: categories.map((c) => [c.id, c.name]),
        }),
        field('unit', 'Sold as', { type: 'select', options: UNITS }),
        field('pack_size', 'Pack size', { placeholder: 'e.g. 1 kg' })),

      h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' } },
        field('price', 'Selling price rs', { required: true, inputType: 'number', step: '0.01', min: '0', placeholder: '49.00' }),
        field('mrp', 'MRP rs', { inputType: 'number', step: '0.01', min: '0', placeholder: '60.00' }),
        field('tax_rate', 'GST %', { inputType: 'number', step: '0.5', min: '0', placeholder: '5' }),
        isNew
          ? field('quantity', 'Opening stock', { inputType: 'number', min: '0', placeholder: '0' })
          : field('reorder_level', 'Reorder at', { inputType: 'number', min: '0' })),

      !isNew
        ? h('div.field', null,
            h('label.label', null, 'Reorder level'),
            h('input.input', {
              type: 'number', min: '0', value: form.reorder_level,
              oninput: (e) => { form.reorder_level = e.target.value; },
            }),
            h('p.text-xs.text-muted', null,
              'When stock falls to this number, the system raises a low-stock alert automatically.'))
        : null,

      field('barcode', 'Barcode (optional)', { placeholder: '8901234567890' }),

      h('div.field', null,
        h('label.label', null, 'Description'),
        h('textarea.textarea', {
          value: form.description, placeholder: 'Shelf notes, pack details, storage advice…',
          oninput: (e) => { form.description = e.target.value; },
          style: { minHeight: '64px' },
        })),

      h('label.checkbox', null,
        h('input', {
          type: 'checkbox', checked: Boolean(form.is_featured),
          onchange: (e) => { form.is_featured = e.target.checked ? 1 : 0; },
        }),
        'Feature this on the storefront home page')),
    footer: h('div.row.gap-2', null,
      Button({ variant: 'ghost', onclick: () => { m.close(); resolve(false); } }, 'Cancel'),
      LoadingButton({ variant: 'primary', loading: track(busy), onclick: save },
        isNew ? 'Create product' : 'Save changes')),
    onClose: () => resolve(false),
  });

  return done;
}