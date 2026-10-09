-- Read business-flow verification. Test writes are rolled back; no persistent orders.
-- Run only against the existing alien_jambull_demo schema.
begin;
do $check$
declare t uuid; guest uuid:=gen_random_uuid(); req uuid:=gen_random_uuid(); first_order jsonb; second_order jsonb; retry jsonb; selected jsonb; price integer; sid uuid; oid bigint; failed boolean; result text;
begin
 select qr_token into t from alien_jambull_demo.restaurant_tables where table_number='1';
 select d.price into price from alien_jambull_demo.dishes d where id=2;
 selected:=jsonb_build_array(jsonb_build_object('id',2,'quantity',1,'unitPrice',price,'modifiers',jsonb_build_array(jsonb_build_object('groupId','bread','optionId','bread_0'))));
 failed:=false;
 begin perform alien_jambull_demo.place_guest_order(t,guest,gen_random_uuid(),null,'cash','test',jsonb_build_array(jsonb_build_object('id',2,'quantity',1,'unitPrice',price)));
 exception when check_violation then failed:=true; end;
 if not failed then raise exception 'Required bread option accepted without selection'; end if;
 failed:=false;
 begin perform alien_jambull_demo.place_guest_order(t,guest,gen_random_uuid(),null,'cash','test',jsonb_set(selected,'{0,unitPrice}',to_jsonb(price+1)));
 exception when check_violation then failed:=true; end;
 if not failed then raise exception 'Stale price accepted'; end if;
 first_order:=alien_jambull_demo.place_guest_order(t,guest,req,null,'cash','Test only',selected);
 sid:=(first_order->>'sessionId')::uuid;oid:=(first_order->>'orderId')::bigint;
 if (select item_comment from alien_jambull_demo.order_items where order_id=oid limit 1) is distinct from 'Ржаной' then raise exception 'Option missing from kitchen comment'; end if;
 retry:=alien_jambull_demo.place_guest_order(t,guest,req,sid,'cash','Test only',selected);
 if retry->>'orderId' is distinct from first_order->>'orderId' or retry->>'duplicate' is distinct from 'true' then raise exception 'Retry duplicated order'; end if;
 second_order:=alien_jambull_demo.place_guest_order(t,gen_random_uuid(),gen_random_uuid(),null,'card','Second guest',selected);
 if second_order->>'sessionId' is distinct from first_order->>'sessionId' then raise exception 'Guests failed to share session'; end if;
 result:=alien_jambull_demo.close_table_session_if_idle(sid);
 if result is distinct from 'active_orders' then raise exception 'Active table closed: %',result; end if;
 update alien_jambull_demo.orders set status='preparing' where id in(oid,(second_order->>'orderId')::bigint);
 update alien_jambull_demo.orders set status='ready' where id in(oid,(second_order->>'orderId')::bigint);
 update alien_jambull_demo.orders set status='served' where id in(oid,(second_order->>'orderId')::bigint);
 if alien_jambull_demo.close_table_session_if_idle(sid) is distinct from 'unpaid_orders' then raise exception 'Unpaid table closed'; end if;
 if alien_jambull_demo.confirm_order_payment(oid,'cash','waiter','test-only') is distinct from 'paid' then raise exception 'Payment failed'; end if;
 if alien_jambull_demo.confirm_order_payment(oid,'cash','waiter','test-only') is distinct from 'already_paid' then raise exception 'Payment retry failed'; end if;
 perform alien_jambull_demo.confirm_order_payment((second_order->>'orderId')::bigint,'card','waiter','test-only');
 if alien_jambull_demo.close_table_session_if_idle(sid) is distinct from 'closed' then raise exception 'Completed table did not close'; end if;
end $check$;
rollback;
select 'PASS: required choice, stale price, kitchen option, order retry, shared session, active guard, unpaid guard, payment retry, close; transaction rolled back' as result,
(select count(*) from alien_jambull_demo.orders) as remaining_demo_orders;