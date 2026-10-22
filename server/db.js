/**
 * SQLite data-access layer built on Node 22's built-in `node:sqlite`.
 * No native dependencies — the whole stack is zero-install.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

/* -------------------------------------------------------------- passwords -- */
export function hashPassword(plain) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(plain, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(plain, stored) {
  try {
    const [scheme, salt, hash] = String(stored).split('$');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const a = Buffer.from(hash, 'hex');
    const b = scryptSync(plain, salt, 64);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------ connection -- */
export function openDatabase(file = join(__dirname, '..', 'data', 'store.db')) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');
  return db;
}

export function migrate(db) {
  db.exec(readFileSync(join(__dirname, 'schema.sql'), 'utf8'));
}

/** Run `fn` inside an IMMEDIATE transaction; rolls back on throw. */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw err;
  }
}

/* ------------------------------------------------------------ query help -- */
export const q = {
  all:   (db, sql, ...p) => db.prepare(sql).all(...p),
  get:   (db, sql, ...p) => db.prepare(sql).get(...p),
  run:   (db, sql, ...p) => db.prepare(sql).run(...p),
  scalar:(db, sql, ...p) => { const r = db.prepare(sql).get(...p); return r ? Object.values(r)[0] : null; },
};

/* ---------------------------------------------------------------- money -- */
/** paise -> ₹ string, e.g. 1999 -> "19.99" */
export const toRupees = (paise) => ((paise ?? 0) / 100).toFixed(2);

/** ₹ string -> integer paise */
export const toPaise = (rupees) => Math.round(Number(rupees || 0) * 100);

export { __dirname };