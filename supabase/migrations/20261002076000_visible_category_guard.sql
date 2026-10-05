-- Task 13 QA: a dish is public/orderable only when both the dish and its category are visible.
drop policy if exists "public can read available dishes" on public.dishes;

create policy "public can read available dishes"
on public.dishes
for select
to anon, authenticated
using (
  is_available = true
  and exists (
    select 1
    from public.categories
    where categories.id = dishes.category_id
      and categories.is_visible = true
  )
);
