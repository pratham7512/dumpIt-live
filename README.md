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

The site is available at `http://localhost:3000`.

## API

### `POST /api/waitlist`

```json
{ "email": "you@example.com" }
```

- `201` — new email added
- `200` — email was already on the list
- `400` — invalid email or JSON
- `415` — request body was not JSON
- `429` — too many attempts

### `GET /api/health`

Returns `{ "ok": true }` when the server can reach PostgreSQL.

## Database

The server creates this table on startup if it does not exist:

```sql
CREATE TABLE IF NOT EXISTS waitlist (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## Deployment

Set `DATABASE_URL` in the hosting provider's environment variables and run:

```bash
npm start
```

The platform's `PORT` variable is used automatically. Static files are served
from this folder, but server code, package files, and `.env` are not exposed.
