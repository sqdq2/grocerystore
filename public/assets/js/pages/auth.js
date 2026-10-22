/**
 * Login / register — staff & admin access with role hints,
 * plus a demo-account picker so the system is explorable immediately.
 */
import { h, track, signal } from '../core/react.js';
import { api } from '../core/api.js';
import { icon } from '../ui/icons.js';
import { Button, Card, Breadcrumb, LoadingButton, openModal } from '../ui/components.js';
import { login, register, user, toast, store } from '../data/store.js';
import { navigate } from '../core/router.js';
import { Avatar } from '../ui/bits.js';

export async function loginPage({ query }) {
  if (track(user)) { navigate('/', { replace: true }); return { node: h('div') }; }

  const mode = signal(query.get('mode') === 'register' ? 'register' : 'login');
  const form = { email: '', password: '', name: '', phone: '', role: 'staff' };
  const busy = signal(false);
  const showPass = signal(false);
  const error = signal('');

  let demoAccounts = [];
  try { demoAccounts = (await api.get('/auth/demo-accounts')).accounts; } catch { /* offline */ }

  async function submit(e) {
    e?.preventDefault();
    error.value = '';
    busy.value = true;
    try {
      const u = mode.value === 'login'
        ? await login(form.email.trim(), form.password)
        : await register({ ...form, email: form.email.trim().toLowerCase() });
      toast('success', `Welcome, ${u.name.split(' ')[0]}!`, `Signed in as ${u.role}`);
      navigate(['admin', 'manager', 'staff'].includes(u.role) ? '/admin' : '/account');
    } catch (err) {
      error.value = err.message || 'Could not sign you in';
    } finally {
      busy.value = false;
    }
  }

  const quickFill = (acc) => {
    form.email = acc.email; form.password = acc.password;
    const em = document.querySelector('#login-email');
    const pw = document.querySelector('#login-password');
    if (em) em.value = acc.email;
    if (pw) pw.value = acc.password;
    error.value = '';
    toast('info', 'Credentials filled', `Tap “Sign in” to continue as ${acc.role}`);
  };

  const benefits = [
    ['grid', 'Operations console', 'Live sales, stock and low-stock alerts in one screen.'],
    ['receipt', 'Counter billing', 'Bill a customer in seconds with UPI, card or cash.'],
    ['trendingDown', 'Reorder before you run out', 'Automatic alerts the moment stock hits the reorder level.'],
    ['chart', 'Reports that mean something', 'Daily and monthly sales, inventory valuation and margins.'],
  ];

  return {
    title: mode.value === 'login' ? 'Sign in' : 'Create account',
    node: h('div', { style: { minHeight: 'calc(100dvh - var(--header-h))' } },
      h('div.shell', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-12)', paddingBlock: 'var(--sp-12)', alignItems: 'center' } },
        h('div.hide-mobile', { class: 'hide-mobile' },
          h('span.eyebrow', null, 'Grocery Store Management System'),
          h('h1', { style: { fontFamily: 'var(--font-display)', fontSize: 'var(--fs-4xl)', marginTop: 'var(--sp-3)' } },
            'Everything the counter needs, in one sign-in.'),
          h('p.text-muted.mt-4', { style: { fontSize: 'var(--fs-lg)', maxWidth: '44ch' } },
            'Staff bill customers, managers watch the books, and the owner sees the whole shop. Roles decide what each person can touch.'),
          h('div.col.gap-4.mt-8', null,
            benefits.map(([ic, t, d]) => h('div.row.gap-3', null,
              h('div.feature-icon', { style: { width: '2.25rem', height: '2.25rem' } }, icon(ic, { size: 16 })),
              h('div', null,
                h('div.font-semibold', null, t),
                h('div.text-sm.text-muted', null, d)))))),

        h('div', { style: { maxWidth: '440px', width: '100%', justifySelf: 'center' } },
          h('div.card.card-pad', null,
            h('div.row.between.mb-4', null,
              h('div.tabs', { style: { border: 'none', flex: '1' } },
                h('button.tab', {
                  class: track(mode) === 'login' ? 'active' : '',
                  onclick: () => { mode.value = 'login'; error.value = ''; },
                }, 'Sign in'),
                h('button.tab', {
                  class: track(mode) === 'register' ? 'active' : '',
                  onclick: () => { mode.value = 'register'; error.value = ''; },
                }, 'Register'))),

            track(error)
              ? h('div', { style: { padding: 'var(--sp-3)', background: 'var(--danger-bg)', borderRadius: 'var(--r-md)', marginBottom: 'var(--sp-4)' } },
                  h('div.row.gap-2', { style: { color: 'var(--danger)' } },
                    icon('alert', { size: 16 }),
                    h('span.text-sm.font-semibold', null, track(error))))
              : null,

            h('form.col.gap-4', { onsubmit: submit },
              track(mode) === 'register'
                ? h('div.field', null,
                    h('label.label', null, 'Full name', h('span.req', null, '*')),
                    h('input.input', { value: form.name, required: true, autocomplete: 'name',
                      placeholder: 'e.g. Priya Sharma',
                      oninput: (e) => { form.name = e.target.value; } }))
                : null,

              h('div.field', null,
                h('label.label', null, 'Email address', h('span.req', null, '*')),
                h('div.input-group', null,
                  h('span.input-icon', null, icon('mail', { size: 15 })),
                  h('input.input#login-email', { type: 'email', value: form.email, required: true,
                    autocomplete: 'email', placeholder: 'you@bijasan.example',
                    oninput: (e) => { form.email = e.target.value; } }))),

              track(mode) === 'register'
                ? h('div.grid', { style: { gridTemplateColumns: '1fr 1fr' } },
                    h('div.field', null,
                      h('label.label', null, 'Mobile'),
                      h('input.input', { value: form.phone, inputmode: 'numeric', placeholder: '98765 43210',
                        oninput: (e) => { form.phone = e.target.value; } })),
                    h('div.field', null,
                      h('label.label', null, 'Role'),
                      h('select.select', { value: form.role,
                        onchange: (e) => { form.role = e.target.value; } },
                        [['staff', 'Staff — billing counter'], ['manager', 'Manager — operations'],
                         ['admin', 'Admin — full control']].map(([v, l]) => h('option', { value: v }, l)))))
                : null,

              h('div.field', null,
                h('label.label', null, 'Password', h('span.req', null, '*')),
                h('div.input-group', null,
                  h('span.input-icon', null, icon('lock', { size: 15 })),
                  h('input.input#login-password', {
                    type: track(showPass) ? 'text' : 'password', value: form.password, required: true,
                    autocomplete: track(mode) === 'login' ? 'current-password' : 'new-password',
                    placeholder: '••••••••',
                    oninput: (e) => { form.password = e.target.value; },
                  }),
                  h('button', {
                    type: 'button',
                    style: { position: 'absolute', right: '0.6rem', color: 'var(--text-subtle)', display: 'grid' },
                    onclick: () => { showPass.value = !track(showPass); },
                    'aria-label': track(showPass) ? 'Hide password' : 'Show password',
                  }, icon(track(showPass) ? 'eyeOff' : 'eye', { size: 15 })))),

              LoadingButton({ variant: 'primary', size: 'lg', class: 'btn-block', type: 'submit',
                loading: track(busy), onclick: (e) => { e.preventDefault(); submit(e); } },
                track(busy) ? 'Please wait…' : (track(mode) === 'login' ? 'Sign in' : 'Create account')),

              h('p.text-xs.text-muted.text-center', null,
                'Admin accounts can be created from the console under Users.')),

            track(mode) === 'register'
              ? h('p.text-sm.text-muted.mt-4', { style: { textAlign: 'center' } },
                  'Already have an account? ',
                  h('a', { href: '/login', style: { color: 'var(--primary)', fontWeight: '600' } }, 'Sign in'))
              : h('p.text-sm.text-muted.mt-4', { style: { textAlign: 'center' } },
                  'New staff member? ',
                  h('a', { href: '/login?mode=register', style: { color: 'var(--primary)', fontWeight: '600' } }, 'Create an account'))),

          demoAccounts.length
            ? h('div.card.card-pad.mt-4', { style: { background: 'var(--surface-2)' } },
                h('div.row.gap-2.mb-3', null,
                  icon('key', { size: 15 }),
                  h('span.text-sm.font-semibold', null, 'Demo accounts'),
                  h('span.badge.badge-brand', null, 'Try a role')),
                h('div.col.gap-2', null,
                  demoAccounts.map((acc) => h('button', {
                    onclick: () => quickFill(acc),
                    style: {
                      display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', width: '100%',
                      padding: 'var(--sp-2) var(--sp-3)', borderRadius: 'var(--r-md)',
                      border: '1px solid var(--border)', background: 'var(--surface)', textAlign: 'left',
                    },
                  },
                    Avatar({ name: acc.name }),
                    h('div.grow', null,
                      h('div.row.gap-2', null,
                        h('span.text-sm.font-semibold', null, acc.role),
                        h('span.text-xs.text-muted', null, '·', acc.name)),
                      h('div.text-xs.text-subtle.truncate', null, acc.can)),
                    icon('arrowRight', { size: 14 })))),
                h('p.text-xs.text-subtle.mt-3', null,
                  'Each role unlocks a different part of the system — try them in order.'))
            : null))),
  };
}