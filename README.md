# dumpit

The dumpit landing page plus a small waitlist API.

## Run locally

```bash
npm install
```

Create a `.env` file with the Neon connection string:

```env
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
```

Then start the server:

```bash
npm start
```

The site is available at `http://localhost:3000`. The server listens on `PORT`
when the platform provides one. `TRUST_PROXY` controls how client IPs are read
behind a reverse proxy; it defaults to one proxy hop, which is correct for
Vercel/Render/Railway/Fly. Set `TRUST_PROXY=0` only when Node is exposed
directly to the internet.

## API

### `POST /api/waitlist`

```json
{ "email": "you@example.com" }
```

`Content-Type: application/json` is required and the body is limited to 2 KB.

- `200` — email is on the list (new and existing addresses get the same body)
- `400` — invalid email or JSON
- `413` — request body is too large
- `415` — request body was not JSON
- `429` — per-IP waitlist limit reached
- `503` — the insert queue is busy; retry shortly

The endpoint is idempotent and intentionally does not reveal whether an address
was already registered. Emails are trimmed and lowercased before insertion.

### `GET /api/health`

Returns `{ "ok": true }` when the server can reach PostgreSQL.

## Abuse limits

These limits protect the process and the database; they are not a substitute
for volumetric DDoS protection at the edge.

| Scope | Limit |
| --- | --- |
| All `/api` routes, per instance | 300 requests/min |
| `GET /api/health`, per IP | 30 requests/min |
| `POST /api/waitlist`, per IP | 6 requests/10 min |
| JSON waitlist body | 2 KB |
| Concurrent waitlist inserts | 8 |
| Node request / headers timeout | 15 s / 12 s |

Repeated known addresses are answered from a short-lived in-memory cache, and
simultaneous requests for the same address are coalesced into one insert. The
database remains authoritative, so these optimisations are safe across
restarts and multiple instances.

## Database

The server creates this table on startup if it does not exist:

```sql
CREATE TABLE IF NOT EXISTS waitlist (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

It then ensures a unique index on the normalized address:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_email_lower_key
ON waitlist (lower(email));
```

On first startup against an older table the migration:

1. takes a PostgreSQL advisory lock so simultaneous instances cannot race;
2. removes case-insensitive duplicates, keeping the earliest row;
3. trims and lowercases every stored address;
4. builds the unique index;
5. verifies the index is unique, valid, unfiltered and built on `lower(email)`,
   and refuses to start otherwise.

The deployment's database role therefore needs permission to create tables and
indexes. If that is not desirable in production, run the migration once with a
privileged role before deploying.

## Browser cache

After a successful submission the page stores up to 20 normalized addresses in
`localStorage` under `dumpit_waitlist`. Re-submitting one of those addresses
shows the normal success state without a network request. This is only a
convenience guard: clearing storage or using another device still cannot create
a duplicate because the database index enforces uniqueness.

## Deployment

Set `DATABASE_URL` in the hosting provider's environment variables and run:

```bash
npm start
```

The platform's `PORT` variable is used automatically. Static files live in
`public/`; Vercel serves them from its CDN and Express serves the same directory
locally. Server code, package files, and `.env` are not exposed.

### DDoS and edge protection

`express-rate-limit` uses an in-memory store by default. A multi-instance
deployment needs a shared store (for example Redis) or, preferably, rate
limiting at the edge. Enable the hosting platform's WAF/firewall and a
volumetric DDoS service (Cloudflare, Vercel Firewall, or equivalent) in front of
the app. Application limits only reduce the impact of traffic that reaches
Node; they cannot absorb a large flood.
