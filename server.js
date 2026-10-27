/* =========================================================
   dumpit — static site + waitlist API
   ========================================================= */
'use strict';

require('dotenv').config({ quiet: true });

const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');

const ROOT = __dirname;
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const DATABASE_URL = process.env.DATABASE_URL?.trim();

if (!DATABASE_URL) {
  console.error('DATABASE_URL is required. Set it in .env locally or in your deployment environment.');
  process.exit(1);
}

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error('PORT must be a valid port number.');
  process.exit(1);
}

let parsedDatabaseUrl;
try {
  // Fail early with a clear message instead of an opaque pg error later.
  parsedDatabaseUrl = new URL(DATABASE_URL);
} catch {
  console.error('DATABASE_URL is not a valid PostgreSQL connection string.');
  process.exit(1);
}

if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol)) {
  console.error('DATABASE_URL must start with postgres:// or postgresql://.');
  process.exit(1);
}

const isLocalDatabase = (() => {
  const host = parsedDatabaseUrl.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
})();

// Neon requires TLS. If the connection string does not say how to connect,
// use verified TLS for remote hosts and plain TCP for local development.
if (!isLocalDatabase && !parsedDatabaseUrl.searchParams.has('sslmode')) {
  parsedDatabaseUrl.searchParams.set('sslmode', 'require');
}

// pg currently treats sslmode=require as verify-full. Make that explicit so
// the connection keeps certificate verification and does not emit a warning.
if (parsedDatabaseUrl.searchParams.get('sslmode') === 'require') {
  parsedDatabaseUrl.searchParams.set('sslmode', 'verify-full');
}

const pool = new Pool({
  connectionString: parsedDatabaseUrl.toString(),
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
  query_timeout: 10_000,
  application_name: 'dumpit-waitlist',
});

pool.on('error', (err) => {
  // An idle client failed; pg removes it from the pool automatically.
  console.error('Unexpected PostgreSQL pool error:', err.message);
});

const app = express();

app.disable('x-powered-by');
// One reverse proxy in front of the app (Render, Railway, Fly, Vercel, etc.).
// This makes req.ip and the rate limiter see the real client address. Set
// TRUST_PROXY=0 only when the process is exposed directly to the internet.
const trustProxy = process.env.TRUST_PROXY?.trim();
if (trustProxy === '0' || trustProxy === 'false') {
  app.set('trust proxy', false);
} else if (trustProxy === 'true') {
  app.set('trust proxy', true);
} else if (trustProxy && /^\d+$/.test(trustProxy)) {
  app.set('trust proxy', Number.parseInt(trustProxy, 10));
} else if (trustProxy) {
  app.set('trust proxy', trustProxy);
} else {
  app.set('trust proxy', 1);
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:'],
        mediaSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(compression());

/* ---------- api ---------- */

// Application-level limits are the last line of defence. A real volumetric
// DDoS has to be absorbed at the edge (Cloudflare / Vercel firewall / WAF).
// These limits keep this process, the PostgreSQL pool and the waitlist table
// alive when abusive traffic still reaches the application.
const API_WINDOW_MS = 60 * 1000;
const API_LIMIT = 300;
const HEALTH_WINDOW_MS = 60 * 1000;
const HEALTH_LIMIT = 30;
const WAITLIST_WINDOW_MS = 10 * 60 * 1000;
const WAITLIST_LIMIT = 6;
const WAITLIST_MAX_INFLIGHT = 8;
const KNOWN_EMAIL_TTL_MS = 15 * 60 * 1000;
const KNOWN_EMAIL_MAX = 5000;

const apiLimiter = rateLimit({
  windowMs: API_WINDOW_MS,
  limit: API_LIMIT,
  // A single bucket for this instance. Rejecting a distributed flood here
  // prevents the per-IP store from growing without bound and keeps most of
  // the traffic away from PostgreSQL.
  keyGenerator: () => 'api-global',
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    ok: false,
    error: 'Too many requests. Please try again shortly.',
  },
});

const healthLimiter = rateLimit({
  windowMs: HEALTH_WINDOW_MS,
  limit: HEALTH_LIMIT,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests.' },
});

const waitlistLimiter = rateLimit({
  windowMs: WAITLIST_WINDOW_MS,
  limit: WAITLIST_LIMIT,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    ok: false,
    error: 'Too many attempts. Please try again later.',
  },
});

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Run before body parsing so even malformed or oversized requests are capped.
app.use('/api', apiLimiter);

app.get('/api/health', healthLimiter, async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length < 5 || email.length > 254) return null;
  if (!EMAIL_PATTERN.test(email)) return null;
  return email;
}

// Recently accepted addresses short-circuit repeat requests without a database
// round trip. This is an optimisation only: the unique index below is the
// source of truth and survives restarts and other instances.
const knownEmails = new Map();
const pendingEmails = new Map();
let waitlistInflight = 0;

function hasKnownEmail(email) {
  const expiresAt = knownEmails.get(email);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    knownEmails.delete(email);
    return false;
  }
  return true;
}

function rememberEmail(email) {
  if (!knownEmails.has(email) && knownEmails.size >= KNOWN_EMAIL_MAX) {
    const oldest = knownEmails.keys().next().value;
    if (oldest !== undefined) knownEmails.delete(oldest);
  }
  knownEmails.set(email, Date.now() + KNOWN_EMAIL_TTL_MS);
}

async function addToWaitlist(email) {
  if (hasKnownEmail(email)) return;

  // Coalesce simultaneous submissions for the same address into one insert.
  const pending = pendingEmails.get(email);
  if (pending) {
    await pending;
    return;
  }

  if (waitlistInflight >= WAITLIST_MAX_INFLIGHT) {
    const busy = new Error('Waitlist is busy.');
    busy.code = 'WAITLIST_BUSY';
    throw busy;
  }

  waitlistInflight += 1;
  const request = pool
    .query(
      `INSERT INTO waitlist (email)
       VALUES ($1)
       ON CONFLICT DO NOTHING`,
      [email]
    )
    .then(() => {
      rememberEmail(email);
    })
    .finally(() => {
      waitlistInflight -= 1;
      pendingEmails.delete(email);
    });

  pendingEmails.set(email, request);
  await request;
}

app.post(
  '/api/waitlist',
  waitlistLimiter,
  express.json({ limit: '2kb', strict: true }),
  async (req, res) => {
    if (!req.is('application/json')) {
      return res.status(415).json({ ok: false, error: 'Send the email as JSON.' });
    }

    const email = normalizeEmail(req.body?.email);
    if (!email) {
      return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
    }

    try {
      await addToWaitlist(email);
      // New and existing addresses deliberately receive an identical response.
      // The endpoint is idempotent and does not leak who is already on the list.
      return res.status(200).json({
        ok: true,
        message: 'You’re on the list.',
      });
    } catch (err) {
      if (err.code === 'WAITLIST_BUSY') {
        res.set('Retry-After', '2');
        return res.status(503).json({
          ok: false,
          error: 'The waitlist is busy. Please try again in a moment.',
        });
      }
      // Safety net for a concurrent insert if another instance won the race.
      if (err.code === '23505') {
        rememberEmail(email);
        return res.status(200).json({
          ok: true,
          message: 'You’re on the list.',
        });
      }
      throw err;
    }
  }
);

app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: 'Not found.' });
});

/* ---------- static site ---------- */
// Everything the browser needs lives in public/. Vercel serves that directory
// from its CDN; Express does the same in local development. Server code,
// package files, environment files and design references stay private.
const PUBLIC = path.join(ROOT, 'public');

const staticOptions = {
  dotfiles: 'deny',
  etag: true,
  maxAge: '1h',
  fallthrough: true,
  index: false,
};

app.use(express.static(PUBLIC, staticOptions));

app.get(['/', '/index.html'], (req, res) => {
  // The filename is not fingerprinted, so revalidate on each load.
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(PUBLIC, 'index.html'));
});

app.use((req, res) => {
  res.status(404).type('text/plain').send('Not found');
});

/* ---------- errors ---------- */

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, error: 'Invalid JSON body.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, error: 'Request body is too large.' });
  }

  console.error('Request failed:', err.stack || err.message);
  return res.status(500).json({ ok: false, error: 'Something went wrong. Please try again.' });
});

/* ---------- startup ---------- */

let server;

const SCHEMA_LOCK = "SELECT pg_advisory_lock(hashtext('dumpit-waitlist-schema'))";
const SCHEMA_UNLOCK = "SELECT pg_advisory_unlock(hashtext('dumpit-waitlist-schema'))";

async function ensureSchema() {
  const client = await pool.connect();
  let migrated = false;

  try {
    // Serialise migrations when several instances start at once.
    await client.query(SCHEMA_LOCK);
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS waitlist (
        id BIGSERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const existingIndex = await client.query(`
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema()
        AND c.relname = 'waitlist_email_lower_key'
        AND c.relkind = 'i'
    `);

    if (existingIndex.rowCount === 0) {
      // Repair old tables that predate the unique index: keep the earliest
      // row for each case-insensitive address, then normalise every address.
      const removed = await client.query(`
        WITH ranked AS (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY lower(btrim(email))
                   ORDER BY created_at ASC, id ASC
                 ) AS row_num
          FROM waitlist
        )
        DELETE FROM waitlist w
        USING ranked r
        WHERE w.id = r.id AND r.row_num > 1
      `);

      await client.query(`
        UPDATE waitlist
        SET email = lower(btrim(email))
        WHERE email <> lower(btrim(email))
      `);

      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS waitlist_email_lower_key
        ON waitlist (lower(email))
      `);

      migrated = true;
      if (removed.rowCount > 0) {
        console.warn(`Removed ${removed.rowCount} duplicate waitlist email(s) during migration.`);
      }
    }

    // Fail startup rather than serving writes into a table that cannot
    // guarantee the duplicate-email invariant. A same-named but invalid,
    // partial, or multi-column index must not pass this check.
    const verified = await client.query(`
      SELECT i.indisunique,
             i.indisvalid,
             i.indisready,
             i.indnkeyatts,
             i.indpred IS NULL AS unfiltered,
             pg_get_indexdef(i.indexrelid) AS definition
      FROM pg_class c
      JOIN pg_index i ON i.indexrelid = c.oid
      JOIN pg_class t ON t.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = current_schema()
        AND t.relname = 'waitlist'
        AND c.relname = 'waitlist_email_lower_key'
    `);

    const index = verified.rows[0];
    if (
      index?.indisunique !== true ||
      index.indisvalid !== true ||
      index.indisready !== true ||
      index.indnkeyatts !== 1 ||
      index.unfiltered !== true ||
      !/lower\(email\)/i.test(index.definition)
    ) {
      throw new Error('waitlist email uniqueness is not enforced by the database');
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.query(SCHEMA_UNLOCK).catch(() => {});
    client.release();
  }

  return migrated;
}

let shuttingDown = false;

async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received — shutting down.`);

  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }

  try {
    await pool.end();
  } catch (err) {
    console.error('Error closing the database pool:', err.message);
  }

  clearTimeout(forceExit);
  process.exit(exitCode);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  void shutdown('unhandledRejection', 1);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  void shutdown('uncaughtException', 1);
});

async function start() {
  await pool.query('SELECT 1');
  const migrated = await ensureSchema();

  server = app.listen(PORT, () => {
    if (migrated) {
      console.log('waitlist schema migrated: unique email index created.');
    }
    console.log(`dumpit listening on http://localhost:${PORT}`);
  });

  // Slow or stuck clients must not hold sockets forever. These are the Node
  // defaults tightened for a tiny JSON API behind a reverse proxy.
  server.requestTimeout = 15_000;
  server.headersTimeout = 12_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
}

start().catch(async (err) => {
  console.error('Failed to start dumpit:', err.stack || err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
