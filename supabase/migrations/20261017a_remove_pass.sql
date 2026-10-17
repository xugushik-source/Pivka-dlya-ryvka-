-- The delivery subscription is gone (owner, 17.10). Delivery stays: day 3 ₾, free from 50 ₾; from 23:00 — 7 ₾, free from 80 ₾.
create or replace function private.delivery_quote(p_zone uuid, p_phone text, p_fulfillment text, p_subtotal numeric default null)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_policy jsonb; v_mode text; v_local time; v_night boolean; v_free_from numeric; v_fee numeric;
begin
  select value into v_policy from public.store_settings where key = 'delivery_policy';
  v_mode := coalesce(v_policy->>'mode', 'CHARGE');
  if p_fulfillment is distinct from 'delivery' then return jsonb_build_object('fee', 0, 'reason', 'PICKUP', 'mode', v_mode); end if;
  if v_mode in ('FREE', 'HIDDEN') then return jsonb_build_object('fee', 0, 'reason', v_mode, 'mode', v_mode); end if;
  if not exists (select 1 from public.delivery_zones where id = p_zone and active) then
    return jsonb_build_object('fee', 0, 'reason', 'NO_ZONE', 'mode', v_mode);
  end if;
  v_local := (private.order_at() at time zone 'Asia/Tbilisi')::time;
  v_night := private.in_window(v_local, coalesce(v_policy->>'night_from', '23:00')::time, coalesce(v_policy->>'night_to', '08:00')::time);
  v_fee := case when v_night then coalesce((v_policy->>'night_fee')::numeric, 7) else coalesce((v_policy->>'day_fee')::numeric, 3) end;
  v_free_from := case when v_night then coalesce((v_policy->>'night_free_from')::numeric, 80) else coalesce((v_policy->>'day_free_from')::numeric, 50) end;
  if coalesce(p_subtotal, 0) >= v_free_from then
    return jsonb_build_object('fee', 0, 'reason', 'FREE_FROM', 'mode', v_mode, 'free_from', v_free_from, 'night', v_night);
  end if;
  return jsonb_build_object('fee', v_fee, 'reason', 'ZONE', 'mode', v_mode, 'free_from', v_free_from, 'night', v_night);
end $$;

create or replace function public.customer_summary(p_phone text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare c uuid; o record;
begin
  select id into c from public.customers where phone = private.norm_phone(p_phone);
  if not found then return jsonb_build_object('found', false); end if;
  select id, order_number, total, created_at into o from public.orders
   where customer_id = c and status not in ('CANCELLED', 'REFUNDED') order by created_at desc limit 1;
  return jsonb_build_object('found', true, 'last_order_id', o.id, 'last_order_number', o.order_number,
                            'last_order_total', o.total, 'last_order_at', o.created_at);
end $$;

update public.store_settings
   set value = value - 'pass_from' - 'pass_to' - 'pass_fee' - 'pass_price' - 'pass_free_from' - 'pass_night_fee' - 'pass_night_price'
 where key = 'delivery_policy';

-- Dropped by the owner in the SQL editor (17.10):
drop function if exists public.start_pass(text, text);
drop function if exists public.start_pass(text, text, text);
drop table if exists public.pass_subscriptions;
