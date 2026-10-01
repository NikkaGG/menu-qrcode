# Menu QR

QR-menu for a restaurant with table sessions, ordering, an admin panel, and statistics.

## Architecture

This repository is one Vercel project, not a multi-service deployment.

- `index.html` / `menu.html` — customer-facing QR menu.
- `qr-ordering.js` — customer ordering/session state helpers.
- `admin-app/` — React 19 + TypeScript + Vite admin UI.
- `admin-dist/` — generated admin build output.
- `api/router.js` — the single Vercel Function entrypoint for nested API routes.
- `server/api/` — Node.js route handlers used by the router.
- `sql/` — PostgreSQL migrations.
- PostgreSQL/Neon — persistent menu, table, session, order, and analytics data.

The former Python/Telegram bot is intentionally not part of this repository anymore. Orders are persisted directly in PostgreSQL. Admin-only order/session operations are available under `/api/admin/...` so they can be connected to an Orders screen later.

## Customer flow

1. The admin creates a table and downloads its QR code.
2. The QR points to `/t/<table-token>`.
3. Opening the link resolves the table and opens or reuses its active table session.
4. The customer loads the menu from `/api/menu`, builds a cart, and submits it to `POST /api/orders`.
5. The server validates current dish availability, stores the order and order items, and returns the created order.
6. The customer UI polls order/table data to display current order state.

## Admin flow

The React admin UI is available under `/admin` and currently contains:

- menu/category management;
- dish availability and pricing;
- table management and QR generation;
- statistics.

Admin authentication uses the `admin_session` HTTP-only cookie. Order status/session endpoints are already protected by the same admin session and live under:

- `POST /api/admin/orders/:id/status`
- `GET /api/admin/sessions/open`
- `GET /api/admin/sessions/:id/bill`
- `POST /api/admin/sessions/:id/close`

They are intentionally not wired into an Orders page yet.

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

Apply the SQL migrations in `sql/` to the target PostgreSQL database before using ordering/admin features.

## Vercel

Deploy the repository root as a single Vercel project. Do not configure a Python service and do not add service bindings.

Set these project environment variables:

- `DATABASE_URL`
- `STATS_PASSWORD`
- `STATS_SESSION_SECRET`
- `ADMIN_LOGIN`
- `ADMIN_PASSWORD_HASH`
- `ADMIN_SESSION_SECRET`
- `APP_URL` — the public production origin used when generating table QR codes.

Do not manually override `NODE_ENV` in Vercel.

The root `vercel.json` runs `npm run build`, serves the static customer menu, serves the generated Vite admin bundle from `admin-dist/`, and rewrites all nested API requests to `api/router.js`.
