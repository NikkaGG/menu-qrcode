-- Task 13 QA: make order and service submission idempotent under retries/races.
alter table public.orders
  add column if not exists client_request_id uuid;

create unique index if not exists orders_guest_request_unique
  on public.orders (table_session_id, guest_token, client_request_id)
  where client_request_id is not null;

create unique index if not exists service_requests_one_open_per_guest_kind
  on public.service_requests (table_session_id, guest_token, kind)
  where status = 'open';
