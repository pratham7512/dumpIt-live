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
// This makes req.ip and the rate limiter see the real client address.
app.set('trust proxy', 1);

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

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.get('/api/health', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.use('/api', express.json({ limit: '8kb', strict: true }));

const waitlistLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    ok: false,
    error: 'Too many attempts. Please try again in a few minutes.',
  },
});

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length < 5 || email.length > 254) return null;
  if (!EMAIL_PATTERN.test(email)) return null;
  return email;
}

app.post('/api/waitlist', waitlistLimiter, async (req, res) => {
  if (!req.is('application/json')) {
    return res.status(415).json({ ok: false, error: 'Send the email as JSON.' });
  }

  const email = normalizeEmail(req.body?.email);
  if (!email) {
    return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO waitlist (email)
       VALUES ($1)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [email]
    );

    const alreadyRegistered = result.rowCount === 0;

    return res.status(alreadyRegistered ? 200 : 201).json({
      ok: true,
      alreadyRegistered,
      message: alreadyRegistered
        ? 'You’re already on the list.'
        : 'You’re on the list.',
    });
  } catch (err) {
    // A concurrent request can win the unique constraint race after
    // ON CONFLICT has already checked; treat that as a duplicate too.
    if (err.code === '23505') {
      return res.status(200).json({
        ok: true,
        alreadyRegistered: true,
        message: 'You’re already on the list.',
      });
    }
    throw err;
  }
});

app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: 'Not found.' });
});

/* ---------- static site ---------- */
// Only the files the page actually needs are public. Server code, package
// files, environment files, screenshots and design references stay private.
const staticOptions = {
  dotfiles: 'deny',
  etag: true,
  maxAge: '1h',
  fallthrough: true,
};

app.use('/assets', express.static(path.join(ROOT, 'assets'), staticOptions));
app.use('/audio', express.static(path.join(ROOT, 'audio'), staticOptions));

const pageFiles = ['styles.css', 'theme.css', 'script.js', 'app.js'];

app.get(['/', '/index.html'], (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(ROOT, 'index.html'));
});

for (const file of pageFiles) {
  app.get(`/${file}`, (req, res) => {
    // These filenames are not fingerprinted, so revalidate them on each load.
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(ROOT, file));
  });
}

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

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS waitlist (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
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
  await ensureSchema();

  server = app.listen(PORT, () => {
    console.log(`dumpit listening on http://localhost:${PORT}`);
  });
}

start().catch(async (err) => {
  console.error('Failed to start dumpit:', err.stack || err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
