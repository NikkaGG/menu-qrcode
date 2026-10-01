# Menu QR

QR-menu website with a customer menu, table QR codes, an admin panel, statistics, and PostgreSQL storage.

## Stack

- Customer menu: HTML, CSS, JavaScript
- Admin panel: React 19, TypeScript, Vite, Tailwind CSS
- API: Node.js 20 Vercel Function
- Database: PostgreSQL / Neon
- QR generation: `qrcode`

## Project structure

- `index.html` / `menu.html` — customer menu
- `qr-ordering.js` — QR/table ordering helpers
- `admin-app/` — React admin application
- `admin-dist/` — generated admin build
- `api/router.js` — Vercel API entrypoint
- `server/api/` — API handlers
- `sql/` — database migrations

The repository is deployed as one Vercel project from the repository root.

## Local setup

Requires Node.js 20.19.x.

```bash
npm ci
cp .env.example .env
npm run build
npm test
```

To generate `ADMIN_PASSWORD_HASH`:

```bash
printf '%s' 'your-password' | node scripts/hash-admin-password.js
```

Apply the SQL migrations from `sql/` to the PostgreSQL database.

## Vercel

Import the repository root as one Vercel project.

Set these environment variables:

- `DATABASE_URL`
- `STATS_PASSWORD`
- `STATS_SESSION_SECRET`
- `ADMIN_LOGIN`
- `ADMIN_PASSWORD_HASH`
- `ADMIN_SESSION_SECRET`
- `APP_URL`

`APP_URL` must contain the public production origin, for example `https://your-project.vercel.app`. It is used when table QR codes are generated.

Do not set `NODE_ENV` manually in Vercel.

The root `vercel.json` builds the admin application, serves the customer menu and admin pages, and routes `/api/*` requests to `api/router.js`.
