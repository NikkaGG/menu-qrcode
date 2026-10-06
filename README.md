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

## Cloudflare Pages Migration
**Stopped by the owner on 2026-10-06. The existing Vercel Hobby installation is retained.** Do not publish to Cloudflare, change QR hostnames or switch PWA origins without a new owner decision. Prepared local adapter/build files remain available but are not an active deployment plan. No Cloudflare site was published. Vercel Hobby's non-commercial-use restriction remains unresolved for commercial restaurant handoff; retaining the plan does not waive provider terms. See https://vercel.com/docs/plans/hobby.

The following is reference material for the stopped migration, initially approved on 2026-10-05. It is a hosting migration, not a database migration. Supabase data, staff functions, QR tokens and order history remain unchanged. R2 setup is stopped; off-site backups are still not configured.

The Pages build reuses the four existing HTTP handlers through a request-local adapter. Only `/api/*`, `/product/*` and the dynamic manifest invoke Pages Functions. Static HTML, images and scripts do not consume that Functions quota. Public assets are copied from an explicit allowlist; database source, tests, private configuration and dependencies are excluded.

```powershell
npm ci
npm run test:pages
npm run build:pages
npx wrangler pages dev dist-pages --port 4175
```
Unlike `npm run dev`, that Pages preview uses the configured real Supabase by default. Do not place test orders there. Use `npm run test:production` with `MENU_PRODUCTION_ORIGIN=http://127.0.0.1:4175` for read-only checks. For mutating checks, start the isolated fixture server first, start Pages on another port with `--binding MENU_SUPABASE_URL=http://127.0.0.1:4173 --binding MENU_SUPABASE_PUBLISHABLE_KEY=local-only`, and run `test:product` with both `MENU_TEST_ORIGIN` (Pages) and `MENU_FIXTURE_ORIGIN` (fixture) set. Mutating tests reject non-local fixture hosts.

Git-connected Pages setup: select only the `NikkaGG/menu-qrcode` repository, production branch `main`, framework preset `None`, build command `npm run build:pages`, output directory `dist-pages`. Keep Workers on the Free plan; do not enable paid upgrades. `wrangler.jsonc` pins the compatibility date. For another restaurant, set `MENU_SUPABASE_URL` and `MENU_SUPABASE_PUBLISHABLE_KEY` to its separate database in both production and preview environment settings. Never enter a service-role key in these frontend settings.

After publication, verify QR gating, all menu photos, all three staff roles, manifest and product metadata at the actual Pages URL. Then review canonical URLs, regenerate printed QR URLs for the new hostname, and reinstall/re-enable staff PWA notifications on the new origin. Browser permissions, installed apps and local guest identity do not transfer automatically between domains. Avoid a switch during an active service. Do not delete old deployments or rewrite existing order/payment records as part of this migration.

Free hosting remains subject to quotas and provider terms; it is not a promise of unlimited capacity or a paid availability guarantee. Before selling an installation, measure database/Functions/traffic usage and complete backup/restore and physical-device acceptance. Supabase Free project limits also constrain the number of separately hosted customer installations under one owner.

Official guides: https://developers.cloudflare.com/pages/functions/advanced-mode/ and https://developers.cloudflare.com/pages/functions/pricing/.

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
