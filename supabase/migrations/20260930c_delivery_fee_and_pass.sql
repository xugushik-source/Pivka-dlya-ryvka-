-- Delivery fee is now stored in the order (was only shown in the browser), with an owner switch,
-- and PASS: 10 ₾ / month, free delivery for orders placed 12:00–22:00 (Asia/Tbilisi).

-- 1. Owner switch: CHARGE (fee charged and shown), FREE (0 ₾, shown as free), HIDDEN (0 ₾, price not shown).
insert into public.store_settings(key, value)
values ('delivery_policy', '{"mode":"CHARGE","pass_from":"12:00","pass_to":"22:00"}'::jsonb)
on conflict (key) do nothing;

-- 2. One place that decides the fee.
create or replace function private.delivery_quote(p_zone uuid, p_phone text, p_fulfillment text)
returns jsonb language plpgsql stable security definer set search_path to ''
as $$
declare v_policy jsonb; v_mode text; v_fee numeric := 0; v_pass boolean := false; v_local time;
begin
  select value into v_policy from public.store_settings where key = 'delivery_policy';
  v_mode := coalesce(v_policy->>'mode', 'CHARGE');
  if p_fulfillment is distinct from 'delivery' then
    return jsonb_build_object('fee', 0, 'reason', 'PICKUP', 'mode', v_mode);
  end if;
  if v_mode in ('FREE', 'HIDDEN') then
    return jsonb_build_object('fee', 0, 'reason', v_mode, 'mode', v_mode);
  end if;
  select coalesce(fee, 0) into v_fee from public.delivery_zones where id = p_zone and active;
  v_fee := coalesce(v_fee, 0);
  v_local := (now() at time zone 'Asia/Tbilisi')::time;
  select exists(
    select 1 from public.pass_subscriptions s join public.customers c on c.id = s.customer_id
     where c.phone = trim(coalesce(p_phone, '')) and s.status = 'ACTIVE' and s.ends_at > now()
  ) into v_pass;
  if v_pass and v_fee > 0
     and v_local >= coalesce(v_policy->>'pass_from', '12:00')::time
     and v_local <  coalesce(v_policy->>'pass_to', '22:00')::time then
    return jsonb_build_object('fee', 0, 'reason', 'PASS', 'mode', v_mode, 'zone_fee', v_fee);
  end if;
  return jsonb_build_object('fee', v_fee, 'reason', 'ZONE', 'mode', v_mode, 'pass', v_pass);
end $$;

-- Storefront preview (same rule the order uses). Returns only the fee and why.
create or replace function public.delivery_quote(p_zone uuid default null, p_phone text default null, p_fulfillment text default 'delivery')
returns jsonb language sql stable security definer set search_path to ''
as $$ select private.delivery_quote(p_zone, p_phone, p_fulfillment) - 'pass' $$;
grant execute on function public.delivery_quote(uuid, text, text) to anon, authenticated;

create or replace function private.apply_order_delivery(p_result jsonb, p_zone uuid, p_phone text, p_fulfillment text)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare q jsonb; v_fee numeric; v_order uuid := (p_result->>'order_id')::uuid; v_total numeric;
begin
  q := private.delivery_quote(p_zone, p_phone, p_fulfillment);
  v_fee := coalesce((q->>'fee')::numeric, 0);
  update public.orders
     set delivery_fee = v_fee,
         delivery_zone_id = case when p_fulfillment = 'delivery' then p_zone end,
         total = total + v_fee
   where id = v_order
  returning total into v_total;
  return p_result || jsonb_build_object('delivery_fee', v_fee, 'delivery_reason', q->>'reason', 'total', v_total);
end $$;

-- 3. Order functions get an optional p_zone. The old bodies are kept as private "core" functions.
alter function public.create_store_order(text, text, text, text, text, text, jsonb) set schema private;
alter function private.create_store_order(text, text, text, text, text, text, jsonb) rename to create_store_order_core;
revoke all on function private.create_store_order_core(text, text, text, text, text, text, jsonb) from public, anon, authenticated;

create function public.create_store_order(p_name text, p_phone text, p_fulfillment text, p_address text, p_payment text,
                                          p_comment text, p_items jsonb, p_zone uuid default null)
returns jsonb language plpgsql security definer set search_path to ''
as $$
begin
  return private.apply_order_delivery(
    private.create_store_order_core(p_name, p_phone, p_fulfillment, p_address, p_payment, p_comment, p_items),
    p_zone, p_phone, p_fulfillment);
end $$;
grant execute on function public.create_store_order(text, text, text, text, text, text, jsonb, uuid) to anon, authenticated;

alter function public.create_bundle_order(text, text, text, text, text, text, uuid, uuid, jsonb) set schema private;
alter function private.create_bundle_order(text, text, text, text, text, text, uuid, uuid, jsonb) rename to create_bundle_order_core;
revoke all on function private.create_bundle_order_core(text, text, text, text, text, text, uuid, uuid, jsonb) from public, anon, authenticated;

create function public.create_bundle_order(p_name text, p_phone text, p_fulfillment text, p_address text, p_payment text,
                                           p_comment text, p_bundle uuid, p_city uuid default null,
                                           p_items jsonb default '[]'::jsonb, p_zone uuid default null)
returns jsonb language plpgsql security definer set search_path to ''
as $$
begin
  return private.apply_order_delivery(
    private.create_bundle_order_core(p_name, p_phone, p_fulfillment, p_address, p_payment, p_comment, p_bundle, p_city, p_items),
    p_zone, p_phone, p_fulfillment);
end $$;
grant execute on function public.create_bundle_order(text, text, text, text, text, text, uuid, uuid, jsonb, uuid) to anon, authenticated;

-- 4. PASS costs 10 ₾ / month. Still created as PENDING; staff activate it after payment (admin → PASS).
create or replace function public.start_pass(p_name text, p_phone text)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare c uuid; s uuid;
begin
  if coalesce(trim(p_phone), '') = '' then raise exception 'Phone required'; end if;
  insert into public.customers(phone, full_name, last_order_at) values (trim(p_phone), nullif(trim(p_name), ''), now())
  on conflict (phone) do update set full_name = coalesce(excluded.full_name, public.customers.full_name) returning id into c;
  insert into public.pass_subscriptions(customer_id, price, status, payment_status) values (c, 10, 'PENDING', 'PENDING') returning id into s;
  return jsonb_build_object('subscription_id', s, 'price', 10, 'payment_required', true);
end $$;
