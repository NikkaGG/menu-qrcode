-- Task 13 QA: create an order and its immutable item snapshot in one transaction.
create or replace function public.create_table_order_atomic(
  p_table_session_id uuid,
  p_guest_token uuid,
  p_client_request_id uuid,
  p_payment_method text,
  p_comment text,
  p_total integer,
  p_items jsonb
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order_id bigint;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Invalid order items' using errcode = '23514';
  end if;

  insert into public.orders (
    table_session_id,
    guest_token,
    client_request_id,
    status,
    payment_method,
    comment,
    total
  )
  values (
    p_table_session_id,
    p_guest_token,
    p_client_request_id,
    'submitted',
    p_payment_method,
    nullif(trim(p_comment), ''),
    p_total
  )
  returning id into v_order_id;

  insert into public.order_items (
    order_id,
    dish_id,
    name,
    quantity,
    unit_price,
    line_total,
    item_comment
  )
  select
    v_order_id,
    item.dish_id,
    item.name,
    item.quantity,
    item.unit_price,
    item.line_total,
    item.item_comment
  from jsonb_to_recordset(p_items) as item(
    dish_id integer,
    name text,
    quantity integer,
    unit_price integer,
    line_total integer,
    item_comment text
  );

  return v_order_id;
end;
$$;

revoke all on function public.create_table_order_atomic(uuid, uuid, uuid, text, text, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_table_order_atomic(uuid, uuid, uuid, text, text, integer, jsonb)
  to service_role;
