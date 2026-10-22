/**
 * Authentication & role-based access control.
 * Tokens are stateless HMAC-SHA256 signatures and work as an httpOnly cookie
 * or a Bearer header for API clients.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { unauthorized, forbidden } from './http.js';
import { q } from './db.js';

const TTL_SECONDS = 60 * 60 * 12;

function getSecret() {
  const secret = process.env.BGS_SECRET;
  if (secret && secret.length >= 32) return secret;
  throw new Error('Set BGS_SECRET to a private random value of at least 32 characters in the environment.');
}

export function assertAuthSecret() {
  getSecret();
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');

export function signToken(payload, ttl = TTL_SECONDS) {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttl };
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'BGS' }));
  const data = `${head}.${b64u(JSON.stringify(body))}`;
  const sig = createHmac('sha256', getSecret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;
  let expect;
  try { expect = createHmac('sha256', getSecret()).update(`${head}.${body}`).digest(); }
  catch { return null; }
  let given;
  try { given = Buffer.from(sig, 'base64url'); } catch { return null; }
  if (given.length !== expect.length || !timingSafeEqual(given, expect)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

function extractToken(req, cookies) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return cookies.auth_token || null;
}

const PUBLIC_USER = 'id, name, email, phone, role, is_active, last_login_at, created_at';

/** Asynchronously attach req.user when a valid token is present; never throws. */
export function attachUser(db, cookies) {
  return async (req) => {
    const payload = verifyToken(extractToken(req, cookies));
    if (!payload) return;
    const user = await q.get(db, `SELECT ${PUBLIC_USER} FROM users WHERE id = ? AND is_active = 1`, payload.sub);
    if (user) req.user = user;
  };
}

export function requireAuth(req) {
  if (!req.user) throw unauthorized('Please sign in to continue');
  return req.user;
}

export function requireRole(...roles) {
  return (req) => {
    const user = requireAuth(req);
    if (!roles.includes(user.role)) {
      throw forbidden(`This action needs ${roles.join(' or ')} access — you are signed in as ${user.role}`);
    }
    return user;
  };
}

export const CAPABILITIES = {
  admin:   ['catalog:write', 'inventory:write', 'orders:write', 'reports:read', 'users:write', 'suppliers:write', 'customers:write', 'settings:write'],
  manager: ['catalog:write', 'inventory:write', 'orders:write', 'reports:read', 'users:read', 'suppliers:write', 'customers:write', 'settings:read'],
  staff:   ['catalog:read', 'inventory:write', 'orders:write', 'orders:cancel'],
};

export const can = (role, capability) => (CAPABILITIES[role] || []).includes(capability);
