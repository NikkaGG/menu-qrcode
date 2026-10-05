# Menu-QR product release

Approved on 2026-10-05. One restaurant per configurable installation.

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
- [ ] Browser and real-Postgres verification, production deployment and smoke check.

## Explicitly deferred decisions
- Scheduled private backups, selected retention and an actual restore drill are required before commercial handoff.
- Real restaurant/device acceptance, including background delivery, remains to be performed.
- Actual dish variants and upcharges must be supplied by the owner; none were invented for the real menu.
- Partial payments, splitting amounts, discounts, tips and service fees need a separate design.
- Internet-only operation is approved for now. LAN ordering is deferred; no local server will be installed in this release.
- Background delivery uses Web Push and requires browser permission; support depends on the device/browser.

## Data preservation
Keep existing real dishes, prices, photos, tables and order history. Additive schema changes only. Validation data must be isolated or rolled back.
