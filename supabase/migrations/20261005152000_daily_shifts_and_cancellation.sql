alter table public.shifts add column if not exists service_day date;
create unique index if not exists shifts_service_day_key on public.shifts(service_day) where service_day is not null;
create index if not exists orders_paid_shift_idx on public.orders(paid_shift_id) where paid_at is not null;

create or replace function public.ensure_daily_shift(p_at timestamptz default now())
returns bigint language plpgsql security invoker set search_path=public as $$
declare zone text; day date; start_at timestamptz; previous public.shifts%rowtype; current_id bigint;
begin
  perform pg_advisory_xact_lock(51005);
  select coalesce(timezone,'Asia/Qyzylorda') into zone from site_settings where id=1;
  zone:=coalesce(zone,'Asia/Qyzylorda');
  day:=(p_at at time zone zone)::date;
  start_at:=day::timestamp at time zone zone;
  for previous in select * from shifts where closed_at is null and opened_at<start_at for update loop
    update shifts set closed_at=((coalesce(previous.service_day,(previous.opened_at at time zone zone)::date)+1)::timestamp at time zone zone),
      summary=jsonb_build_object('paid',(select coalesce(sum(total),0) from orders where paid_shift_id=previous.id and paid_at is not null),
                                'orders',(select count(*) from orders where paid_shift_id=previous.id and paid_at is not null))
      where id=previous.id;
  end loop;
  select id into current_id from shifts where service_day=day;
  if found then return current_id; end if;
  select id into current_id from shifts where closed_at is null;
  if found then
    update shifts set service_day=day where id=current_id;
  else
    insert into shifts(opened_at,service_day,device_id) values(start_at,day,'automatic') returning id into current_id;
  end if;
  return current_id;
end $$;
revoke all on function public.ensure_daily_shift(timestamptz) from public,anon,authenticated;
grant execute on function public.ensure_daily_shift(timestamptz) to service_role;

create or replace function public.confirm_order_payment(p_order_id bigint,p_method text,p_role text,p_device text)
returns text language plpgsql security invoker set search_path=public as $$
declare o public.orders%rowtype; shift_id bigint; begin
  perform pg_advisory_xact_lock(51005);
  if p_role not in('waiter','admin') or p_method not in('cash','card','kaspi') then raise exception 'Invalid payment'; end if;
  select * into o from orders where id=p_order_id for update;
  if not found then return 'not_found'; end if;
  if o.status='cancelled' then return 'cancelled'; end if;
  if o.paid_at is not null then return 'already_paid'; end if;
  shift_id:=ensure_daily_shift();
  update orders set paid_at=now(),paid_role=p_role,paid_shift_id=shift_id,payment_method=p_method,updated_at=now() where id=p_order_id;
  insert into operation_events(role,device_id,action,entity_id) values(p_role,p_device,'confirm-payment',p_order_id::text);
  return 'paid';
end $$;

create or replace function public.manage_shift(p_action text,p_device text)
returns bigint language plpgsql security invoker set search_path=public as $$
begin
  raise exception 'Смены открываются и закрываются автоматически по времени ресторана' using errcode='23514';
end $$;

create or replace function public.rotate_daily_shift()
returns void language plpgsql security invoker set search_path=public as $$
begin
  perform ensure_daily_shift();
exception when others then
  perform record_incident('daily-shift','Не удалось открыть ежедневную смену','daily-shift:rotation');
end $$;
revoke all on function public.rotate_daily_shift() from public,anon,authenticated;
grant execute on function public.rotate_daily_shift() to service_role;

create or replace function public.change_order_status(p_order_id bigint,p_expected text,p_next text,p_role text,p_device text)
returns text language plpgsql security invoker set search_path=public as $$
declare o public.orders%rowtype; begin
  select * into o from orders where id=p_order_id for update;
  if not found then return 'not_found'; end if;
  if o.status<>p_expected then return 'changed'; end if;
  if not (p_role='admin' or (p_role='waiter' and ((o.status='ready' and p_next='served') or (o.status in('submitted','accepted') and p_next='cancelled')))
    or (p_role='kitchen' and ((o.status in('submitted','accepted') and p_next in('preparing','cancelled')) or (o.status='preparing' and p_next='ready')))) then
    raise exception 'Недостаточно прав' using errcode='23514';
  end if;
  perform set_config('menu.actor_role',p_role,true);perform set_config('menu.device_id',left(p_device,100),true);
  update orders set status=p_next,updated_at=now() where id=p_order_id;
  insert into operation_events(role,device_id,action,entity_id) values(p_role,left(p_device,100),'update-order:'||p_next,p_order_id::text);
  return 'updated';
end $$;
