/**
 * Minimal, dependency-free HTTP layer: router, JSON body parsing,
 * static file serving and cookie helpers.
 */
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.txt':  'text/plain; charset=utf-8',
  '.map':  'application/json; charset=utf-8',
};

export class Router {
  constructor() { this.routes = []; }

  add(method, pattern, handler) {
    // '/api/products/:id' -> regex + param names
    const keys = [];
    const rx = new RegExp('^' + pattern.replace(/\/:([A-Za-z0-9_]+)/g, (_, k) => {
      keys.push(k); return '/([^/]+)';
    }) + '/?$');
    this.routes.push({ method, rx, keys, handler, pattern });
    return this;
  }
  get(p, h)    { return this.add('GET', p, h); }
  post(p, h)   { return this.add('POST', p, h); }
  patch(p, h)  { return this.add('PATCH', p, h); }
  put(p, h)    { return this.add('PUT', p, h); }
  delete(p, h) { return this.add('DELETE', p, h); }

  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = pathname.match(r.rx);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { handler: r.handler, params };
    }
    return null;
  }

  /** Every registered route — powers the live /api endpoint index. */
  list() {
    return this.routes.map((r) => `${r.method.padEnd(6)} ${r.pattern}`);
  }
}

/* ------------------------------------------------------------------ http -- */
export function json(res, status, payload, headers = {}) {
  // guard against a handler replying twice — never throw inside the socket layer
  if (res.writableEnded || res.headersSent) return;
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

export const ok   = (res, data)       => json(res, 200, data);
export const fail = (res, status, msg, extra) => json(res, status, { error: msg, ...extra });

export class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
export const badRequest   = (m, d) => new HttpError(400, m, d);
export const unauthorized = (m = 'Authentication required') => new HttpError(401, m);
export const forbidden    = (m = 'You do not have access to this resource') => new HttpError(403, m);
export const notFound     = (m = 'Resource not found') => new HttpError(404, m);
export const conflict     = (m, d) => new HttpError(409, m, d);

export async function readJson(req, limitBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) { reject(new HttpError(413, 'Payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      const raw = Buffer.concat(chunks).toString('utf8');
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new HttpError(400, 'Malformed JSON body')); }
    });
    req.on('error', reject);
  });
}

/* -------------------------------------------------------------- statics -- */
export function serveStatic(root, res, urlPath) {
  // normalise + containment check so `..` cannot escape the web root
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  let file = join(root, rel);
  if (!file.startsWith(root + sep) && file !== root) return false;

  let st;
  try { st = statSync(file); } catch { return false; }
  if (st.isDirectory()) {
    file = join(file, 'index.html');
    try { st = statSync(file); } catch { return false; }
  }
  const ext = extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': st.size,
    // never serve stale JS/CSS — a cached bundle is a broken app
    'Cache-Control': ['.js', '.mjs', '.css', '.html'].includes(ext)
      ? 'no-cache, must-revalidate'
      : 'public, max-age=3600',
  });
  createReadStream(file).pipe(res);
  return true;
}

/* --------------------------------------------------------------- cookies -- */
export function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookie(name, value, { maxAge = 60 * 60 * 24 * 7, httpOnly = true, sameSite = 'Lax', path = '/' } = {}) {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${path}`,
    `Max-Age=${maxAge}`,
    `SameSite=${sameSite}`,
  ];
  if (httpOnly) bits.push('HttpOnly');
  return bits.join('; ');
}