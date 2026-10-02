-- Task 13 QA: serialize table closing with guest order creation.
create or replace function public.assert_order_session_open()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform 1
  from public.table_sessions
  where id = new.table_session_id
    and status = 'open'
  for share;

  if not found then
    raise exception 'Table session is closed' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.assert_order_session_open() from public, anon, authenticated;
grant execute on function public.assert_order_session_open() to service_role;

drop trigger if exists orders_require_open_session on public.orders;
create trigger orders_require_open_session
before insert on public.orders
for each row
execute function public.assert_order_session_open();

create or replace function public.close_table_session_if_idle(p_session_id uuid)
returns text
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform 1
  from public.table_sessions
  where id = p_session_id
    and status = 'open'
  for update;

  if not found then
    return 'not_open';
  end if;

  if exists (
    select 1
    from public.orders
    where table_session_id = p_session_id
      and status in ('submitted','accepted','preparing','ready')
  ) then
    return 'active_orders';
  end if;

  update public.table_sessions
  set status = 'closed',
      closed_at = now(),
      updated_at = now()
  where id = p_session_id;

  update public.service_requests
  set status = 'resolved',
      resolved_at = now(),
      updated_at = now()
  where table_session_id = p_session_id
    and status = 'open';

  return 'closed';
end;
$$;

revoke all on function public.close_table_session_if_idle(uuid) from public, anon, authenticated;
grant execute on function public.close_table_session_if_idle(uuid) to service_role;
