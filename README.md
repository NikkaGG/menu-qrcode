# Menu-QR

One configurable restaurant installation. Current production: https://menu-qrcode-lt1q.vercel.app.

## Daily Operation
- A guest scans the table QR. Scanning alone does not open a session. The first valid order opens it atomically and goes directly to the kitchen.
- Guests at a table see all its current orders. Delivery, takeaway and guest accounts are not part of this release.
- Kitchen: start cooking, mark ready, or cancel before cooking starts. Waiter: serve, receive cash/card/Kaspi, explicitly confirm payment, resolve guest requests, close a paid and fully served table.
- A submitted order cannot be edited. A repeat submission with the same request ID does not create another order.
- Kitchen, waiter and admin can cancel unpaid orders before cooking. Guests cannot cancel. At local midnight the calendar shift rotates automatically; outstanding table orders remain open and payments are counted in the shift of their confirmation.
- Admin: actual paid/unpaid amounts, order/preparation reports, shifts, role activity, tables/QR, stop list, dish options, image upload, Excel import, restaurant settings and incident inbox.
- Shared role PINs are currently `1`, retained at the owner's request. Set distinct shared PINs per role before handing an installation to paying customers. Equal PINs do not provide meaningful separation between people who know the common code.
- Background notifications require the bell button, permission, HTTPS and a supported browser. Physical-device delivery still needs acceptance testing. The open-screen sound must be enabled using its sound button.

## Local Verification
```powershell
npm ci
npm test
npm run test:postgres
node scripts/check-source.cjs
npm run dev
```
Preview: http://127.0.0.1:4173. It uses isolated memory data and does not send orders to production. In another terminal run, sequentially:
```powershell
npm run test:browser
npm run test:controls
npm run test:product
npm run test:palette
```
Set `CHROME_PATH` when Chrome is not at the default Windows path. Do not run browser suites concurrently: they share the isolated fixture store. SQL tests execute the actual migrations, triggers and functions in embedded PostgreSQL; they do not establish real multi-connection load capacity.

## Deployment
No separate public testing site is required. Verify locally, apply additive database changes, deploy all three Edge Functions, then publish the frontend and check the production URLs.

Current database: `gelezvudpcsnhqgjaqkl`. Vercel project: `menu-qrcode-lt1q`.

After applying the daily-shift migration, apply `supabase/cron/daily-shift.sql` once to install the database schedule. Its one-minute check follows the restaurant timezone, opens the initial day, and logs rotation failures to the admin incident inbox. Payment confirmation also ensures the current day transactionally, so midnight payments do not depend on scheduler timing. See https://supabase.com/docs/guides/cron/quickstart.

For an existing installation, apply only the unapplied release SQL files. Historical files include an aggregate bootstrap whose timestamps differ from the existing remote migration history; **do not blindly replay them with `db push --include-all`**. Preserve the menu, QR tokens and order history. A migration rollback must not remove payment/history data.

With a configured Supabase CLI account:
```powershell
npx supabase functions deploy table-api staff-orders admin-api --project-ref YOUR_PROJECT_REF --no-verify-jwt --use-api
```
JWT gateway verification is intentionally off: staff functions implement role/PIN checks and rate limits; guest requests validate a table QR and a guest/request UUID. Server-only tables and RPCs deny anonymous access. Never place a service-role key in frontend configuration.

GitHub Actions runs isolated checks on pushes and pull requests. It does not itself migrate/deploy the database. Vercel's production Git integration publishes `main`; run the same checks locally before pushing.

`npm run test:production` runs a read-only browser smoke check against the live site. It rejects mutations before sending them. Set `MENU_PRODUCTION_ORIGIN`, `MENU_TABLE_TOKEN` and the three `MENU_*_PIN` variables for another installation. It never places a real order or changes menu/payment data.

## Another Restaurant
Create a separate Supabase/Vercel installation. Bootstrap the schema from the SQL files in order on an empty database, provision service-role grants, deploy the functions, then configure these public Vercel variables:
- `MENU_SUPABASE_URL`
- `MENU_SUPABASE_PUBLISHABLE_KEY`

`restaurant-config.js` is the public default for this first installation. `/api/config` uses environment overrides. Configure the restaurant name, contacts, timezone, logo and cover in the admin settings. Import the new menu; do not copy this restaurant's real menu into a customer's installation. Add/rotate QR tokens in admin, especially the initial demonstration table. Change the shared PINs. Review the canonical URL, PWA icon and photo/font rights before handoff.

Excel `.xlsx`: first sheet, up to 500 rows and 5 MB. Required headers: `Название`, `Категория`, `Цена`; optional: `Вес`, `Описание`, `Фото`, `Доступно`. English field names are accepted. Prices are integer KZT. Import previews rows and adds dishes without replacing existing ones. Repeating the same confirmed import request is idempotent. Photos: JPEG/PNG/WebP, up to 5 MB, validated by content and stored in `restaurant-media`.

## Backups And Restore
Database backup scheduling and off-site retention are not configured by this release. Before commercial handoff, choose retention/access, take a real backup and complete a restore drill. A code snapshot or a screenshot is not a database backup.

Use the Supabase backup facility available on the project's plan, or authenticated CLI database dumps to private storage. For a linked project and configured database credentials:
```powershell
npx supabase db dump --linked --role-only --file roles.sql
npx supabase db dump --linked --file schema.sql
npx supabase db dump --linked --data-only --use-copy --file data.sql
```
Keep these dumps private: they include operational tokens and PIN hashes. Back up Storage object bytes separately, especially `restaurant-media`: database backups contain metadata, not the uploaded image files. Keep the Git revision, deployment configuration and private VAPID keys with the recovery plan, not in a public repository.

Restore into an isolated recovery project, not over the only live copy. Restore roles/schema/data in the supported Supabase restore order, recover Storage objects, verify row counts, dish prices/options, payment totals, staff access, QR sessions, and push subscriptions. Repoint a recovery frontend only after checks pass. Never infer historical paid amounts from old `payment_method` values; explicitly reconcile unconfirmed historical orders.

Official backup guidance: https://supabase.com/docs/guides/platform/backups.

## Deferred Scope
Partial payments, split bills, discounts, tips and service fees need a separate design. Equal shared PINs cannot identify individual employee performance. The current reports identify role/device activity only.

Internet-only operation is approved for now. Cloud hosting does not accept orders when the restaurant loses internet. The offline screen states this explicitly. LAN operation is deferred; it would require a local always-on server, connection discovery, local persistence, conflict/idempotency rules and recovery tests. Online acquiring is intentionally out of scope. Do not treat the current pilot as an unattended commercial rollout before staff/device, backup and real-service acceptance tests.
