/**
 * SQLite-compatible data access for local development and serverless production.
 * Local runs use Node's built-in synchronous SQLite. Netlify uses Turso/libSQL,
 * whose database is durable across function instances.
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const dbDirectory = dirname(fileURLToPath(import.meta.url));
let DatabaseSync;

async function loadLocalSqlite() {
  if (DatabaseSync) return DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
    return DatabaseSync;
  } catch {
    throw new Error(`node:sqlite is unavailable on ${process.version}; local development requires Node 22.5 or newer.`);
  }
}

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

export async function openDatabase(file = join(dbDirectory, '..', 'data', 'store.db')) {
  const url = process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN;

  if (url) {
    const remote = /^(libsql|https):\/\//i.test(url);
    if ((process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME) && !remote) {
      throw new Error('Netlify requires a remote durable Turso/libSQL URL, not a local file: database.');
    }
    if (remote && !authToken) {
      throw new Error('Set TURSO_AUTH_TOKEN (or LIBSQL_AUTH_TOKEN) for the configured remote libSQL database.');
    }
    const { createClient } = await import('@libsql/client');
    const client = createClient({ url, authToken });
    Object.defineProperty(client, '__libsql', { value: true });
    Object.defineProperty(client, '__libsqlRemote', { value: remote });
    return client;
  }

  if (process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    throw new Error('Netlify requires TURSO_DATABASE_URL and TURSO_AUTH_TOKEN (or LIBSQL_URL and LIBSQL_AUTH_TOKEN) for durable database storage.');
  }

  const SQLite = await loadLocalSqlite();
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new SQLite(file);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');
  return db;
}

export async function migrate(db) {
  const schemaCandidates = [
    join(dbDirectory, 'schema.sql'),
    join(process.cwd(), 'server', 'schema.sql'),
    join(process.cwd(), 'schema.sql'),
    join(dbDirectory, 'server', 'schema.sql'),
  ];
  let schema;
  for (const path of schemaCandidates) {
    try { schema = readFileSync(path, 'utf8'); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!schema) throw new Error(`Could not locate server/schema.sql. Tried: ${schemaCandidates.join(', ')}`);
  for (let attempt = 0; ; attempt++) {
    try {
      if (db.__libsql) await db.executeMultiple(schema);
      else db.exec(schema);
      return;
    } catch (error) {
      if (attempt >= 7 || !isRetryableTransactionError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(50 * (2 ** attempt), 1600)));
    }
  }
}

/** Run fn atomically, awaiting each query for both local and remote adapters. */
export async function tx(db, fn) {
  for (let attempt = 0; ; attempt++) {
    let transaction;
    try {
      if (db.__libsql) {
        transaction = await db.transaction('write');
        if (db.__libsqlRemote) remoteBatchTransactions.add(transaction);
        const out = await fn(transaction);
        await flushBatch(transaction);
        await transaction.commit();
        return out;
      }

      db.exec('BEGIN IMMEDIATE');
      const out = await fn(db);
      db.exec('COMMIT');
      return out;
    } catch (err) {
      if (db.__libsql) {
        if (transaction) {
          try { await transaction.rollback(); } catch { /* transaction may already be closed */ }
        }
      } else {
        try { db.exec('ROLLBACK'); } catch { /* transaction may already be closed */ }
      }
      if (attempt >= 7 || !isRetryableTransactionError(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, Math.min(50 * (2 ** attempt), 1600)));
    }
  }
}

const normalizeRows = (rows) => rows.map((row) => ({ ...row }));
const normalizeInsertId = (value) => value == null ? null : Number(value);
const isLibsql = (db) => Boolean(db?.__libsql || typeof db?.execute === 'function');
const pendingBatches = new WeakMap();
const remoteBatchTransactions = new WeakSet();

function isRetryableTransactionError(error) {
  const message = `${error?.code || ''} ${error?.message || ''}`;
  return /SQLITE_BUSY|SQLITE_LOCKED|TRANSACTION_CONFLICT|database is locked|write transaction conflict/i.test(message);
}

async function flushBatch(db) {
  const pending = pendingBatches.get(db);
  if (!pending?.length) return;
  while (pending.length) {
    const statements = pending.splice(0, 250);
    const resultSets = await db.batch(statements);
    await Promise.all(resultSets);
  }
}

/** Query helpers return plain row objects; libSQL operations are asynchronous. */
export const q = {
  startBatch(db) {
    if (remoteBatchTransactions.has(db) && typeof db.batch === 'function') pendingBatches.set(db, []);
  },
  all(db, sql, ...args) {
    if (isLibsql(db)) return (async () => {
      await flushBatch(db);
      const result = await db.execute({ sql, args });
      return normalizeRows(result.rows);
    })();
    return db.prepare(sql).all(...args);
  },
  get(db, sql, ...args) {
    if (isLibsql(db)) return (async () => {
      await flushBatch(db);
      const result = await db.execute({ sql, args });
      return result.rows[0] ? { ...result.rows[0] } : undefined;
    })();
    return db.prepare(sql).get(...args);
  },
  run(db, sql, ...args) {
    if (isLibsql(db)) {
      const pending = pendingBatches.get(db);
      if (pending) {
        pending.push({ sql, args });
        return Promise.resolve({ lastInsertRowid: null, rowsAffected: 0 });
      }
      return db.execute({ sql, args }).then((result) => ({
        ...result,
        lastInsertRowid: normalizeInsertId(result.lastInsertRowid),
      }));
    }
    return db.prepare(sql).run(...args);
  },
  async scalar(db, sql, ...args) {
    const row = await q.get(db, sql, ...args);
    return row ? Object.values(row)[0] : null;
  },
};

/** paise -> ₹ string, e.g. 1999 -> "19.99" */
export const toRupees = (paise) => ((paise ?? 0) / 100).toFixed(2);

/** ₹ string -> integer paise */
export const toPaise = (rupees) => Math.round(Number(rupees || 0) * 100);

export { dbDirectory as __dirname };
