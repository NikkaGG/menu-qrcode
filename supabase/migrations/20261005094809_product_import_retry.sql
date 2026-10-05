create table public.menu_import_batches(request_id uuid primary key,payload_hash text not null,imported integer not null,created_at timestamptz not null default now());
alter table public.menu_import_batches enable row level security;
revoke all on public.menu_import_batches from anon,authenticated;
grant all on public.menu_import_batches to service_role;
create policy "server only" on public.menu_import_batches for all to anon,authenticated using(false) with check(false);
create or replace function public.import_menu_once(p_rows jsonb,p_request_id uuid)
returns integer language plpgsql security invoker set search_path=public as $$
declare previous public.menu_import_batches%rowtype; imported_count integer; begin
  if p_request_id is null then raise exception 'Invalid import request' using errcode='23514'; end if;
  perform pg_advisory_xact_lock(hashtext(p_request_id::text));
  select * into previous from menu_import_batches where request_id=p_request_id;
  if found then
    if previous.payload_hash<>md5(p_rows::text) then raise exception 'Import contents changed' using errcode='23514'; end if;
    return previous.imported;
  end if;
  imported_count=import_menu_rows(p_rows);
  insert into menu_import_batches(request_id,payload_hash,imported) values(p_request_id,md5(p_rows::text),imported_count);
  return imported_count;
end $$;
revoke all on function public.import_menu_once(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.import_menu_once(jsonb,uuid) to service_role;
