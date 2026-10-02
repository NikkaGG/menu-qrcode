-- Task 13 QA: service calls cannot race with closing a table session.
drop trigger if exists service_requests_require_open_session on public.service_requests;

create trigger service_requests_require_open_session
before insert on public.service_requests
for each row
execute function public.assert_order_session_open();
