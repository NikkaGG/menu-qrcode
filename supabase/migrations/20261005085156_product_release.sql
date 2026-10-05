-- One restaurant per installation. Preserve all existing menu and order records.
alter table public.site_settings add column if not exists timezone text not null default 'Asia/Qyzylorda';
alter table public.site_settings add column if not exists currency text not null default 'KZT';
alter table public.site_settings add column if not exists logo_url text;
alter table public.site_settings add column if not exists banner_url text;
alter table public.site_settings add column if not exists public_menu_enabled boolean not null default false;
alter table public.dishes add column if not exists modifier_groups jsonb not null default '[]';
alter table public.orders add column if not exists paid_at timestamptz;
alter table public.orders add column if not exists paid_role text;
alter table public.order_items add column if not exists modifiers jsonb not null default '[]';
alter table public.order_status_events add column if not exists actor_role text;
alter table public.order_status_events add column if not exists device_id text;

create table if not exists public.role_access (
  role text primary key check (role in ('admin','waiter','kitchen')),
  pin_hash text not null, updated_at timestamptz not null default now()
);
create table if not exists public.operation_events (
  id bigint generated always as identity primary key,
  role text not null, device_id text, action text not null,
  entity_id text, created_at timestamptz not null default now()
);
create table if not exists public.incidents (
  id bigint generated always as identity primary key,
  source text not null, message text not null, fingerprint text not null,
  occurrences integer not null default 1, first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(), resolved_at timestamptz
);
create unique index if not exists incidents_open_fingerprint on public.incidents(fingerprint) where resolved_at is null;
create table if not exists public.request_budgets (
  key text primary key, bucket timestamptz not null, hits integer not null
);
create table if not exists public.private_config (key text primary key, value jsonb not null);
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(), endpoint text not null unique,
  role text not null check(role in ('admin','waiter','kitchen')),
  subscription jsonb not null, device_id text, created_at timestamptz not null default now()
);
create table if not exists public.shifts (
  id bigint generated always as identity primary key,
  opened_at timestamptz not null default now(), closed_at timestamptz,
  device_id text, summary jsonb
);
create unique index if not exists shifts_one_open on public.shifts((true)) where closed_at is null;
alter table public.orders add column if not exists paid_shift_id bigint references public.shifts(id);
create index if not exists operation_events_created_idx on public.operation_events(created_at desc);
create index if not exists orders_paid_idx on public.orders(paid_at) where paid_at is not null;
create index if not exists orders_unpaid_session_idx on public.orders(table_session_id) where paid_at is null and status<>'cancelled';

do $$ declare t text; begin
  foreach t in array array['role_access','operation_events','incidents','request_budgets','private_config','push_subscriptions','shifts'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    execute format('create policy "server only" on public.%I for all to anon,authenticated using(false) with check(false)',t);
  end loop;
end $$;
grant usage,select on all sequences in schema public to service_role;

-- Shared initial PIN 1 retained as explicitly requested; configurable per role.
insert into public.role_access(role,pin_hash) values
('admin','6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b'),
('waiter','6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b'),
('kitchen','6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b') on conflict(role) do nothing;

create or replace function public.consume_request_budget(p_key text,p_limit integer)
returns boolean language plpgsql security invoker set search_path=public as $$
declare n integer; begin
  insert into request_budgets(key,bucket,hits) values(p_key,date_trunc('minute',now()),1)
  on conflict(key) do update set bucket=excluded.bucket,
    hits=case when request_budgets.bucket=excluded.bucket then request_budgets.hits+1 else 1 end
  returning hits into n;
  delete from request_budgets where bucket<now()-interval '1 day';
  return n<=p_limit;
end $$;

create or replace function public.record_incident(p_source text,p_message text,p_fingerprint text)
returns void language plpgsql security invoker set search_path=public as $$ begin
  insert into incidents(source,message,fingerprint) values(left(p_source,100),left(p_message,500),p_fingerprint)
  on conflict(fingerprint) where resolved_at is null do update
  set occurrences=incidents.occurrences+1,last_seen_at=now();
end $$;

create or replace function public.enforce_order_lifecycle()
returns trigger language plpgsql security invoker set search_path=public as $$ begin
  if (new.table_session_id,new.guest_token,new.client_request_id,new.comment,new.total,new.created_at)
     is distinct from (old.table_session_id,old.guest_token,old.client_request_id,old.comment,old.total,old.created_at) then
    raise exception 'Submitted orders are immutable' using errcode='23514';
  end if;
  if old.paid_at is not null and (new.paid_at,new.paid_role,new.paid_shift_id,new.payment_method)
     is distinct from (old.paid_at,old.paid_role,old.paid_shift_id,old.payment_method) then
    raise exception 'Confirmed payments are immutable' using errcode='23514';
  end if;
  if old.status is distinct from new.status then
    if not ((old.status='submitted' and new.status in('accepted','preparing','cancelled'))
       or (old.status='accepted' and new.status in('preparing','cancelled'))
       or (old.status='preparing' and new.status='ready')
       or (old.status='ready' and new.status='served')) then
      raise exception 'Invalid order transition' using errcode='23514';
    end if;
    if new.status='cancelled' and old.paid_at is not null then
      raise exception 'Paid orders cannot be cancelled' using errcode='23514';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists orders_enforce_lifecycle on public.orders;
create trigger orders_enforce_lifecycle before update on public.orders for each row execute function public.enforce_order_lifecycle();

create or replace function public.close_table_session_if_idle(p_session_id uuid)
returns text language plpgsql security invoker set search_path=public as $$
declare t uuid; begin
  select table_id into t from table_sessions where id=p_session_id;
  perform 1 from restaurant_tables where id=t for update;
  perform 1 from table_sessions where id=p_session_id and status='open' for update;
  if not found then return 'not_open'; end if;
  if exists(select 1 from orders where table_session_id=p_session_id and status in('submitted','accepted','preparing','ready')) then return 'active_orders'; end if;
  if exists(select 1 from orders where table_session_id=p_session_id and status<>'cancelled' and paid_at is null) then return 'unpaid_orders'; end if;
  if exists(select 1 from service_requests where table_session_id=p_session_id and status='open') then return 'open_requests'; end if;
  update table_sessions set status='closed',closed_at=now(),updated_at=now() where id=p_session_id;
  return 'closed';
end $$;

create or replace function public.confirm_order_payment(p_order_id bigint,p_method text,p_role text,p_device text)
returns text language plpgsql security invoker set search_path=public as $$
declare o public.orders%rowtype; shift_id bigint; begin
  perform pg_advisory_xact_lock(51005);
  if p_role not in('waiter','admin') or p_method not in('cash','card','kaspi') then raise exception 'Invalid payment'; end if;
  select * into o from orders where id=p_order_id for update;
  if not found then return 'not_found'; end if;
  if o.status='cancelled' then return 'cancelled'; end if;
  if o.paid_at is not null then return 'already_paid'; end if;
  select id into shift_id from shifts where closed_at is null;
  update orders set paid_at=now(),paid_role=p_role,paid_shift_id=shift_id,payment_method=p_method,updated_at=now() where id=p_order_id;
  insert into operation_events(role,device_id,action,entity_id) values(p_role,p_device,'confirm-payment',p_order_id::text);
  return 'paid';
end $$;

create or replace function public.place_guest_order(
  p_table_token uuid,p_guest_token uuid,p_request_id uuid,p_session_id uuid,
  p_payment_method text,p_comment text,p_items jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  t public.restaurant_tables%rowtype; s public.table_sessions%rowtype; d public.dishes%rowtype;
  row_data jsonb; choice jsonb; grp jsonb; opt jsonb; selected jsonb; snapshot jsonb;
  prepared jsonb='[]'; option_snapshot jsonb; item_price integer; qty integer; subtotal integer=0;
  oid bigint; existing public.orders%rowtype; count_options integer; ids text[]; label text;
begin
  perform pg_advisory_xact_lock(51005);
  if p_request_id is null or p_guest_token is null or p_payment_method not in('cash','card','kaspi')
     or p_payment_method is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'Invalid order items' using errcode='23514';
  end if;
  select * into t from restaurant_tables where qr_token=p_table_token and is_active for update;
  if not found then raise exception 'Table not found or QR disabled' using errcode='23514'; end if;
  select o.* into existing from orders o join table_sessions ts on ts.id=o.table_session_id
    where ts.table_id=t.id and o.guest_token=p_guest_token and o.client_request_id=p_request_id limit 1;
  if found then return jsonb_build_object('orderId',existing.id,'sessionId',existing.table_session_id,'duplicate',true); end if;
  if p_session_id is not null then
    select * into s from table_sessions where id=p_session_id and table_id=t.id and status='open' for update;
    if not found then raise exception 'Table session is closed' using errcode='23514'; end if;
  else
    select * into s from table_sessions where table_id=t.id and status='open' for update;
  end if;
  -- Validate every price, option and availability before creating the session.
  for row_data in select value from jsonb_array_elements(p_items) loop
    qty=(row_data->>'quantity')::integer;
    if qty is null or qty not between 1 and 20 then raise exception 'Invalid order items' using errcode='23514'; end if;
    select x.* into d from dishes x join categories c on c.id=x.category_id
      where x.id=(row_data->>'id')::integer and x.is_available and c.is_visible for share of x,c;
    if not found then raise exception 'One or more dishes are unavailable' using errcode='23514'; end if;
    item_price=d.price; option_snapshot='[]'; selected=coalesce(row_data->'modifiers','[]'); ids=array[]::text[];
    if jsonb_typeof(selected) is distinct from 'array' or jsonb_array_length(selected)>60 then raise exception 'Invalid dish options' using errcode='23514'; end if;
    for choice in select value from jsonb_array_elements(selected) loop
      label=(choice->>'groupId')||':'||(choice->>'optionId');
      if label=any(ids) then raise exception 'Invalid dish options' using errcode='23514'; end if;
      ids=array_append(ids,label);
      select value into grp from jsonb_array_elements(d.modifier_groups) where value->>'id'=choice->>'groupId';
      if not found then raise exception 'Invalid dish options' using errcode='23514'; end if;
      select value into opt from jsonb_array_elements(grp->'options') where value->>'id'=choice->>'optionId' and coalesce((value->>'is_available')::boolean,true);
      if not found then raise exception 'Invalid dish options' using errcode='23514'; end if;
      item_price=item_price+coalesce((opt->>'price_delta')::integer,0);
      option_snapshot=option_snapshot||jsonb_build_array(jsonb_build_object('groupId',grp->>'id','optionId',opt->>'id','name',opt->>'name','price_delta',coalesce((opt->>'price_delta')::integer,0)));
    end loop;
    for grp in select value from jsonb_array_elements(d.modifier_groups) loop
      select count(*) into count_options from jsonb_array_elements(selected) where value->>'groupId'=grp->>'id';
      if count_options<coalesce((grp->>'min')::integer,0) or count_options>coalesce((grp->>'max')::integer,1) then raise exception 'Choose dish options' using errcode='23514'; end if;
    end loop;
    if item_price<0 or (row_data->>'unitPrice') is null or item_price<>(row_data->>'unitPrice')::integer then raise exception 'Menu prices changed' using errcode='23514'; end if;
    subtotal=subtotal+qty*item_price;
    select string_agg(value->>'name',', ') into label from jsonb_array_elements(option_snapshot);
    prepared=prepared||jsonb_build_array(jsonb_build_object('dish_id',d.id,'name',d.name,'quantity',qty,'unit_price',item_price,'line_total',qty*item_price,'item_comment',label,'modifiers',option_snapshot));
  end loop;
  if s.id is null then insert into table_sessions(table_id) values(t.id) returning * into s; end if;
  insert into orders(table_session_id,guest_token,client_request_id,status,payment_method,comment,total)
    values(s.id,p_guest_token,p_request_id,'submitted',p_payment_method,nullif(left(trim(p_comment),1000),''),subtotal) returning id into oid;
  insert into order_items(order_id,dish_id,name,quantity,unit_price,line_total,item_comment,modifiers)
    select oid,x.dish_id,x.name,x.quantity,x.unit_price,x.line_total,x.item_comment,x.modifiers
    from jsonb_to_recordset(prepared) x(dish_id integer,name text,quantity integer,unit_price integer,line_total integer,item_comment text,modifiers jsonb);
  return jsonb_build_object('orderId',oid,'sessionId',s.id,'duplicate',false);
end $$;

do $$ declare f regprocedure; begin
  for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace
    and proname in('consume_request_budget','record_incident','enforce_order_lifecycle','confirm_order_payment','place_guest_order','close_table_session_if_idle') loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('restaurant-media','restaurant-media',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;

create or replace function public.import_menu_rows(p_rows jsonb)
returns integer language plpgsql security invoker set search_path=public as $$
declare r jsonb; cid text; n integer=0; begin
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'Invalid import'; end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    select id into cid from categories where name=r->>'category';
    if not found then
      cid='c_'||replace(gen_random_uuid()::text,'-','');
      insert into categories(id,name,sort_order) values(cid,r->>'category',coalesce((select max(sort_order)+1 from categories),0))
      on conflict(name) do update set name=excluded.name returning id into cid;
    end if;
    -- Import adds dishes; it never silently overwrites the real menu.
    insert into dishes(category_id,name,price,weight,description,image_url,is_available)
      values(cid,r->>'name',(r->>'price')::integer,r->>'weight',r->>'description',r->>'image_url',coalesce((r->>'is_available')::boolean,true));
    n=n+1;
  end loop;
  return n;
end $$;
revoke all on function public.import_menu_rows(jsonb) from public,anon,authenticated;
grant execute on function public.import_menu_rows(jsonb) to service_role;

create or replace function public.manage_shift(p_action text,p_device text)
returns bigint language plpgsql security invoker set search_path=public as $$
declare s public.shifts%rowtype; result_id bigint; begin
  perform pg_advisory_xact_lock(51005);
  select * into s from shifts where closed_at is null for update;
  if p_action='open' then
    if s.id is not null then return s.id; end if;
    insert into shifts(device_id) values(p_device) returning id into result_id;
  elsif p_action='close' then
    if s.id is null then raise exception 'Открытой смены нет' using errcode='23514'; end if;
    if exists(select 1 from orders where status<>'cancelled' and paid_at is null)
       or exists(select 1 from orders where status in('submitted','accepted','preparing','ready'))
       or exists(select 1 from service_requests where status='open') then
      raise exception 'Сначала завершите заказы, оплату и запросы гостей' using errcode='23514';
    end if;
    update shifts set closed_at=now(),summary=(select jsonb_build_object('paid',coalesce(sum(total),0),'orders',count(*)) from orders where paid_shift_id=s.id) where id=s.id;
    result_id=s.id;
  else raise exception 'Invalid shift action'; end if;
  insert into operation_events(role,device_id,action,entity_id) values('admin',p_device,p_action||'-shift',result_id::text);
  return result_id;
end $$;
revoke all on function public.manage_shift(text,text) from public,anon,authenticated;
grant execute on function public.manage_shift(text,text) to service_role;

create or replace function public.request_guest_service(p_session_id uuid,p_guest_token uuid,p_kind text)
returns boolean language plpgsql security invoker set search_path=public as $$
declare t uuid; begin
  select table_id into t from table_sessions where id=p_session_id;
  perform 1 from restaurant_tables where id=t for update;
  perform 1 from table_sessions where id=p_session_id and status='open' for update;
  if not found then raise exception 'Table session is closed' using errcode='23514'; end if;
  if p_kind is null or p_kind not in('waiter','bill','cutlery') or p_guest_token is null then raise exception 'Invalid service request' using errcode='23514'; end if;
  if exists(select 1 from service_requests where table_session_id=p_session_id and kind=p_kind and status='open') then return false; end if;
  insert into service_requests(table_session_id,guest_token,kind) values(p_session_id,p_guest_token,p_kind);
  return true;
end $$;
revoke all on function public.request_guest_service(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.request_guest_service(uuid,uuid,text) to service_role;

create or replace function public.capture_order_status_change()
returns trigger language plpgsql security invoker set search_path=public as $$ begin
  if old.status is distinct from new.status then
    insert into order_status_events(order_id,from_status,to_status,created_at,actor_role,device_id)
    values(new.id,old.status,new.status,now(),nullif(current_setting('menu.actor_role',true),''),nullif(current_setting('menu.device_id',true),''));
  end if;
  return new;
end $$;

create or replace function public.change_order_status(p_order_id bigint,p_expected text,p_next text,p_role text,p_device text)
returns text language plpgsql security invoker set search_path=public as $$
declare o public.orders%rowtype; begin
  select * into o from orders where id=p_order_id for update;
  if not found then return 'not_found'; end if;
  if o.status<>p_expected then return 'changed'; end if;
  if not (p_role='admin' or (p_role='waiter' and o.status='ready' and p_next='served')
    or (p_role='kitchen' and ((o.status in('submitted','accepted') and p_next in('preparing','cancelled')) or (o.status='preparing' and p_next='ready')))) then
    raise exception 'Недостаточно прав' using errcode='23514';
  end if;
  perform set_config('menu.actor_role',p_role,true);perform set_config('menu.device_id',left(p_device,100),true);
  update orders set status=p_next,updated_at=now() where id=p_order_id;
  insert into operation_events(role,device_id,action,entity_id) values(p_role,left(p_device,100),'update-order:'||p_next,p_order_id::text);
  return 'updated';
end $$;
revoke all on function public.change_order_status(bigint,text,text,text,text) from public,anon,authenticated;
grant execute on function public.change_order_status(bigint,text,text,text,text) to service_role;
