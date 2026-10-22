/**
 * API client — fetch wrapper with auth, error normalisation,
 * request de-duplication and a tiny in-memory cache.
 */

const BASE = '/api';
let token = localStorage.getItem('bgs_token') || null;
const inflight = new Map();   // key -> Promise (GET de-duplication)
const cache = new Map();      // key -> { data, at }
const CACHE_TTL = 20_000;

export function setToken(t) {
  token = t;
  if (t) localStorage.setItem('bgs_token', t);
  else localStorage.removeItem('bgs_token');
}
export function getToken() { return token; }

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request(method, path, body, { cacheable = false, signal } = {}) {
  const key = `${method} ${path}`;
  if (cacheable) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL) return hit.data;
    if (inflight.has(key)) return inflight.get(key);
  }

  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const p = (async () => {
    let res;
    try {
      res = await fetch(BASE + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      throw new ApiError(0, 'Cannot reach the store server. Check your connection.');
    }

    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { data = { raw: text }; } }

    if (!res.ok) {
      const msg = data?.error || `Request failed (${res.status})`;
      throw new ApiError(res.status, msg, data?.details);
    }
    if (cacheable) cache.set(key, { data, at: Date.now() });
    return data;
  })();

  if (cacheable) {
    inflight.set(key, p);
    p.finally(() => inflight.delete(key));
  }
  return p;
}

export const api = {
  get:  (p, o) => request('GET', p, undefined, { cacheable: true, ...o }),
  post: (p, b, o) => request('POST', p, b ?? {}, o),
  patch:(p, b, o) => request('PATCH', p, b ?? {}, o),
  del:  (p, o) => request('DELETE', p, undefined, o),
  /** Force a fresh read (used after mutations). */
  fresh: (p, o) => { cache.delete(`GET ${p}`); return request('GET', p, undefined, { cacheable: true, ...o }); },
  clearCache: () => cache.clear(),
};

/* --------------------------------------------------------- query helper -- */
export function qs(params) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}