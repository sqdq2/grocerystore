/**
 * Authentication & role-based access control.
 *
 * Tokens are stateless HMAC-SHA256 signatures (JWT layout: header.payload.signature)
 * so no session table is required, and the same token works as an httpOnly cookie
 * for the browser or as a Bearer header for API clients.
 *
 * Roles (FR-1 — role-based access):
 *   admin    full control incl. users, suppliers, reports
 *   manager  operations + reports, no user management
 *   staff    billing, inventory day-to-day, no reports/pricing
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { unauthorized, forbidden } from './http.js';
import { q } from './db.js';

const SECRET = process.env.BGS_SECRET || 'bijasan-general-store-dev-secret-change-me';
const TTL_SECONDS = 60 * 60 * 12; // 12h staff shift

const b64u = (buf) => Buffer.from(buf).toString('base64url');

export function signToken(payload, ttl = TTL_SECONDS) {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttl };
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'BGS' }));
  const data = `${head}.${b64u(JSON.stringify(body))}`;
  const sig = createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;
  const expect = createHmac('sha256', SECRET).update(`${head}.${body}`).digest();
  let given;
  try { given = Buffer.from(sig, 'base64url'); } catch { return null; }
  if (given.length !== expect.length || !timingSafeEqual(given, expect)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

/** Pull a token from the Authorization header or the auth cookie. */
function extractToken(req, cookies) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return cookies.auth_token || null;
}

const PUBLIC_USER = 'id, name, email, phone, role, is_active, last_login_at, created_at';

/** Attaches req.user when a valid token is present; never throws. */
export function attachUser(db, cookies) {
  return (req) => {
    const payload = verifyToken(extractToken(req, cookies));
    if (!payload) return;
    const user = q.get(db, `SELECT ${PUBLIC_USER} FROM users WHERE id = ? AND is_active = 1`, payload.sub);
    if (user) req.user = user;
  };
}

/** Require any signed-in staff/admin. */
export function requireAuth(req) {
  if (!req.user) throw unauthorized('Please sign in to continue');
  return req.user;
}

/** Require one of `roles`. */
export function requireRole(...roles) {
  return (req) => {
    const user = requireAuth(req);
    if (!roles.includes(user.role)) {
      throw forbidden(`This action needs ${roles.join(' or ')} access — you are signed in as ${user.role}`);
    }
    return user;
  };
}

/** Fine-grained capability matrix — used by the UI to hide what you cannot do. */
export const CAPABILITIES = {
  admin:   ['catalog:write', 'inventory:write', 'orders:write', 'reports:read', 'users:write', 'suppliers:write', 'customers:write', 'settings:write'],
  manager: ['catalog:write', 'inventory:write', 'orders:write', 'reports:read', 'users:read', 'suppliers:write', 'customers:write', 'settings:read'],
  staff:   ['catalog:read', 'inventory:write', 'orders:write', 'orders:cancel'],
};

export const can = (role, capability) => (CAPABILITIES[role] || []).includes(capability);