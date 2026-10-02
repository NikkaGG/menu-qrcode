-- Task 13 QA: database-level idempotency and duplicate-action guards.
-- The table API already sends client_request_id; persist it and make the
-- request key unique per guest/table session so simultaneous retries cannot
-- create duplicate orders.

alter table public.orders
  add column if not exists client_request_id uuid;

create unique index if not exists orders_guest_request_unique
  on public.orders (table_session_id, guest_token, client_request_id)
  where client_request_id is not null;

-- A guest may have only one open request of each kind for one table session.
-- This turns rapid repeated taps / multiple tabs into one service request.
create unique index if not exists service_requests_one_open_kind_per_guest
  on public.service_requests (table_session_id, guest_token, kind)
  where status = 'open';
