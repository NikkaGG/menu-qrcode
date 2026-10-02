-- Task 13 QA: let PostgreSQL allocate dish ids atomically.
create sequence if not exists public.dishes_id_seq;

select setval(
  'public.dishes_id_seq',
  coalesce((select max(id) from public.dishes), 0) + 1,
  false
);

alter sequence public.dishes_id_seq owned by public.dishes.id;

alter table public.dishes
  alter column id set default nextval('public.dishes_id_seq');
