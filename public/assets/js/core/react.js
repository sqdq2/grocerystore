/**
 * Tiny reactive core — signals, effects and a hyperscript renderer.
 *
 * Zero framework dependencies, but with modern ergonomics:
 *   const count = signal(0);
 *   autoEffect(() => node.textContent = track(count));   // re-runs on change
 *
 * The renderer builds real DOM once per effect run. Effects are scoped, so
 * when a component's container is replaced the old subscriptions are dropped.
 */

/* --------------------------------------------------------------- signals -- */
export function signal(initial) {
  let value = initial;
  const subs = new Set();
  return {
    get value() { return value; },
    set value(next) {
      if (Object.is(next, value)) return;
      value = next;
      for (const fn of [...subs]) fn(next);
    },
    /** Read + subscribe without triggering a re-run (for writes) */
    peek() { return value; },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}

let currentCollector = null;
let activeEffect = null;

/**
 * Register `fn` as an effect. It re-runs whenever a signal read via
 * `track()` (or a bare `.value` read) changes.
 * Returns a disposer.
 */
export function effect(fn) {
  let disposers = [];
  const run = () => {
    while (disposers.length) disposers.pop()?.();
    const prevCollector = currentCollector;
    const prevActive = activeEffect;
    currentCollector = { bind: (sig) => disposers.push(sig.subscribe(run)) };
    activeEffect = run;
    try {
      const cleanup = fn();
      if (typeof cleanup === 'function') disposers.push(cleanup);
    } finally {
      currentCollector = prevCollector;
      activeEffect = prevActive;
    }
  };
  run();
  return () => { while (disposers.length) disposers.pop()?.(); };
}

/**
 * Read a signal inside an effect and register the dependency.
 * Outside a collector it is just a plain read.
 */
export function track(sig) {
  if (currentCollector && typeof sig?.subscribe === 'function') currentCollector.bind(sig);
  return sig.value;
}

/** Batch multiple writes so effects run once at the end. */
export function batch(fn) {
  batching = (batching || 0) + 1;
  try { return fn(); }
  finally {
    batching--;
    if (batching === 0) { const q = flushQueue.splice(0); q.forEach((f) => f()); }
  }
}
let batching = 0;
let flushQueue = [];

export function enqueue(fn) {
  if (batching > 0) flushQueue.push(fn); else fn();
}

/* ---------------------------------------------------------------- vdom --- */
/**
 * h('div.card', { onclick, class: 'extra' }, child, 'text')
 * Shorthand:  h('button#save.primary', …)
 */
export function h(tag, props, ...children) {
  if (typeof tag === 'function') return tag({ ...(props || {}), children });

  let id = null;
  const classes = [];
  let selector = tag;
  if (/[.#]/.test(tag)) {
    const parts = tag.split(/(?=[.#])/);
    selector = parts.shift() || 'div';
    for (const p of parts) {
      if (p[0] === '.') classes.push(p.slice(1));
      else if (p[0] === '#') id = p.slice(1);
    }
  }

  const p = props || {};
  if (p.class) classes.push(...String(p.class).split(/\s+/).filter(Boolean));

  return {
    tag: selector,
    props: p,
    id,
    className: classes,
    children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== true),
  };
}

export function frag(...children) {
  return { tag: '#fragment', className: [], props: {}, children: children.flat(Infinity).filter(Boolean) };
}

/* ------------------------------------------------------------- renderer -- */
const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon',
  'g', 'text', 'tspan', 'defs', 'linearGradient', 'stop', 'use', 'ellipse', 'clipPath',
  'foreignObject', 'feGaussianBlur', 'feDropShadow', 'filter', 'mask', 'animate']);

export function render(vnode) {
  if (vnode === null || vnode === undefined || vnode === false || vnode === true) {
    return document.createComment('');
  }
  if (typeof vnode === 'string' || typeof vnode === 'number') return document.createTextNode(String(vnode));
  if (vnode.node) return vnode.node;
  if (typeof Node !== 'undefined' && vnode instanceof Node) return vnode;
  if (vnode.text !== undefined) return document.createTextNode(String(vnode.text));

  if (vnode.tag === '#fragment') {
    const f = document.createDocumentFragment();
    for (const c of vnode.children) f.appendChild(render(c));
    return f;
  }

  const kids = Array.isArray(vnode.children) ? vnode.children : [];
  const isSvg = SVG_TAGS.has(vnode.tag);
  const el = isSvg ? document.createElementNS(SVG_NS, vnode.tag) : document.createElement(vnode.tag);

  if (vnode.id) el.id = vnode.id;
  if (vnode.className?.length) el.classList.add(...vnode.className);

  const { class: _cls, key: _key, ref, html: rawHtml, dataset, children: _kids, ...rest } = vnode.props || {};

  for (const [key, value] of Object.entries(rest)) {
    if (key === 'style' && value && typeof value === 'object') {
      for (const [prop, val] of Object.entries(value)) {
        if (val === null || val === undefined) continue;
        if (prop.startsWith('--')) el.style.setProperty(prop, String(val));
        else el.style[prop] = Array.isArray(val) ? val.join(';') : String(val);
      }
      continue;
    }
    if (key === 'className') { el.classList.add(...String(value).split(/\s+/).filter(Boolean)); continue; }
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
      continue;
    }
    if (key === 'value') { el.value = value ?? ''; el.setAttribute('value', value ?? ''); continue; }
    if (key === 'checked' || key === 'disabled' || key === 'selected' || key === 'readOnly' || key === 'multiple') {
      el[key] = Boolean(value);
      if (value) el.setAttribute(key.toLowerCase(), ''); else el.removeAttribute(key.toLowerCase());
      continue;
    }
    if (key === 'dataset' && value && typeof value === 'object') {
      for (const [dk, dv] of Object.entries(value)) if (dv != null) el.dataset[dk] = String(dv);
      continue;
    }
    if (value === false || value === null || value === undefined) el.removeAttribute(key);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }

  if (rawHtml) el.innerHTML = rawHtml;
  for (const c of kids) el.appendChild(render(c));
  if (typeof ref === 'function') ref(el);
  return el;
}

export function mount(vnode, container) {
  container.replaceChildren();
  container.appendChild(render(vnode));
  return container;
}

/**
 * Reactive region: rebuild `container` whenever a tracked signal changes.
 * Nested effects created during the build are disposed before each rebuild.
 */
export function reactive(container, build) {
  let disposers = [];
  const rerender = () => {
    disposers.forEach((d) => d?.());
    disposers = [];
    container.replaceChildren();
    const prev = currentCollector;
    const prevActive = activeEffect;
    currentCollector = {
      bind(sig) {
        const unsub = sig.subscribe(rerender);
        disposers.push(unsub);
      },
    };
    activeEffect = rerender;
    try {
      const cleanup = build(container);
      if (typeof cleanup === 'function') disposers.push(cleanup);
    } finally {
      currentCollector = prev;
      activeEffect = prevActive;
    }
  };
  rerender();
  return { dispose: () => disposers.forEach((d) => d?.()) };
}

/* --------------------------------------------------------------- utils --- */
export function debounce(fn, ms = 250) {
  let t;
  const wrapped = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export function throttle(fn, ms = 100) {
  let last = 0, timer;
  return (...a) => {
    const now = Date.now();
    const remain = ms - (now - last);
    if (remain <= 0) { last = now; fn(...a); }
    else { clearTimeout(timer); timer = setTimeout(() => { last = Date.now(); fn(...a); }, remain); }
  };
}

export function uid(prefix = 'id') {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}