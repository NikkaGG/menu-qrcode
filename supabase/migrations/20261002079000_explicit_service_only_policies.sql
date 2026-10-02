-- Task 13 QA: make the intentional "service-role only" posture explicit.
drop policy if exists "deny direct client access" on public.staff_members;
create policy "deny direct client access"
on public.staff_members
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists "deny direct client access" on public.order_status_events;
create policy "deny direct client access"
on public.order_status_events
for all
to anon, authenticated
using (false)
with check (false);
