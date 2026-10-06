# Menu-QR product release

Approved on 2026-10-05. One restaurant per configurable installation.

Commercial handoff: the seller prepares the customer's menu, tables and branding before delivery. Notifications must be accepted on both Android and iPhone. On 2026-10-06 the owner decided to retain the existing Vercel Hobby installation; Cloudflare Pages migration is stopped. Hobby's non-commercial-use restriction remains a commercial-launch constraint, not an exception granted by this decision. R2 setup is stopped; private off-site backups still need a destination, schedule and restore verification.

## Approved rules
- Sushi Crazy, Kazakhstan, KZT, UTC+5 (Asia/Qyzylorda).
- Table ordering only; public browse link cannot place orders.
- Anonymous guests with a table QR; kitchen receives orders immediately.
- A session starts atomically with the first valid order, not with a QR scan.
- Everyone at the same table sees the current table orders.
- Cash/card/Kaspi; waiter confirms payment; unpaid tables cannot close.
- No cancellation once cooking begins. Submitted orders are immutable.
- Kitchen, waiter and administrator can cancel unpaid orders before cooking starts; guests cannot.
- Calendar shifts rotate automatically at local midnight. Outstanding tables/orders carry forward; payments belong to the day they are confirmed.
- Stop list and configurable dish options/add-ons.
- Admin/waiter/kitchen use shared role PINs; no individual staff accounts in this release.
- Role activity is measurable; individual productivity cannot be inferred from shared PINs.
- Compact image upload and Excel import, restaurant settings, paid/unpaid reports.
- Publish verified releases to the existing production site.

## Release work
- [x] Reconcile guest, operations, SQL and Edge Functions.
- [x] Atomic first order, retries, table-wide visibility, payments and closing.
- [x] Shared role access and race-safe cancellation.
- [x] Restaurant setup, branding, dish options, image uploads and Excel import.
- [x] Paid revenue, unpaid balances, preparation time, shifts and role activity.
- [x] Administrator incident inbox and staff notification subscription.
- [x] Reproducible deployment, automated checks and documented backup/restore procedure.
- [x] Browser and real-Postgres verification, production deployment and read-only smoke check.

## Verified Release
- Cloudflare migration preparation: 12 adapter/build checks passed, 13 product scenarios passed through the actual local Pages runtime against isolated fixtures, and all 9 read-only menu/staff checks passed through Pages against the existing real database. Migration was stopped by the owner on 2026-10-06; no Cloudflare publication or hostname switch was made.
- 2026-10-05: production frontend and all three backend functions published.
- 17 embedded-PostgreSQL checks cover fresh schema, retries, payment/closing, cancellation, options and midnight shift rotation.
- Browser flows cover guest, administrator, waiter and kitchen, responsive layouts, import/uploads and failure recovery.
- The production read-only smoke check passed all 9 checks; real menu count remained 61 and historical unpaid amount remained 13,050 KZT.
- The database daily-shift schedule is active and its actual executions succeeded. Physical-device notification delivery and backup restore are not yet verified.

## Explicitly deferred decisions
- Vercel Hobby is retained; do not resume Cloudflare publication, change QR hostnames or switch staff PWA origins without a new owner decision. Resolve Hobby's commercial-use restriction before paid restaurant handoff.
- Scheduled private backups, selected retention and an actual restore drill are required before commercial handoff.
- Real restaurant/device acceptance, including background delivery, remains to be performed.
- Actual dish variants and upcharges must be supplied by the owner; none were invented for the real menu.
- Partial payments, splitting amounts, discounts, tips and service fees need a separate design.
- Internet-only operation is approved for now. LAN ordering is deferred; no local server will be installed in this release.
- Background delivery uses Web Push and requires browser permission; support depends on the device/browser.

## Data preservation
Keep existing real dishes, prices, photos, tables and order history. Additive schema changes only. Validation data must be isolated or rolled back.
