-- Fresh-install baseline. Existing installations already have these tables.
create table if not exists public.categories(id text primary key,name text not null unique,sort_order integer not null default 0,is_visible boolean not null default true,updated_at timestamptz not null default now());
create table if not exists public.dishes(id integer primary key,category_id text not null references public.categories(id) on update cascade on delete restrict,name text not null,weight text,description text,price integer not null check(price>=0),image_url text,detail_image_url text,is_available boolean not null default true,is_popular boolean not null default false,popular_order smallint check(popular_order>0),sort_order integer not null default 0,updated_at timestamptz not null default now());
create table if not exists public.site_settings(id smallint primary key default 1 check(id=1),restaurant_name text not null default 'Суши Крейзи',subtitle text,city text,schedule_open text,schedule_close text,delivery_text text,whatsapp_number text,phone_number text,instagram_handle text,instagram_url text,address_text text,map_url text,map_embed_url text,canonical_url text,updated_at timestamptz not null default now());
create table if not exists public.restaurant_tables(id uuid primary key default gen_random_uuid(),table_number text not null unique,qr_token uuid not null unique default gen_random_uuid(),label text,is_active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index if not exists dishes_category_sort_idx on public.dishes(category_id,sort_order,id);
alter table public.categories enable row level security;
alter table public.dishes enable row level security;
alter table public.site_settings enable row level security;
grant select on public.categories,public.dishes,public.site_settings to anon,authenticated;
create policy "visible categories" on public.categories for select to anon,authenticated using(is_visible);
create policy "available dishes" on public.dishes for select to anon,authenticated using(is_available);
create policy "restaurant settings" on public.site_settings for select to anon,authenticated using(id=1);
insert into public.site_settings(id) values(1) on conflict(id) do nothing;
