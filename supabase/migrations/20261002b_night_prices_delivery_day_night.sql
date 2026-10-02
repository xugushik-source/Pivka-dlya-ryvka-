-- Owner, 2026-10-02.
-- 1) Night prices: orders placed 00:00–08:00 (Asia/Tbilisi) cost +10 % — every product and every Рывок. Each night
--    price is rounded UP to a 0.50 ₾ step (7.40 → 7.50, 8.80 → 9.00). Purchase prices and supplier totals do not change.
--    The order functions keep their day logic; the night price is applied to the created order before delivery is
--    counted (so «бесплатно от …» sees the night sum). A Рывок is raised as a whole and the new price is spread over
--    its lines in proportion. Items added later while editing an order get the night price too.
-- 2) Delivery: day (08:00–22:00) 4 ₾, free from 50 ₾; evening/night (22:00–08:00) 7 ₾, free from 80 ₾.
--    PASS keeps its rule (12:00–22:00: from 20 ₾ free, below 3 ₾) and now costs 20 ₾ / month.
-- Everything is in store_settings, so the owner can change the numbers without code.

insert into public.store_settings(key, value)
values ('night_pricing', '{"from":"00:00","to":"08:00","percent":10,"step":0.5}'::jsonb)
on conflict (key) do update set value = excluded.value;

update public.store_settings
   set value = (value - 'fee' - 'free_from')
            || '{"day_fee":4,"day_free_from":50,"night_fee":7,"night_free_from":80,"night_from":"22:00","night_to":"08:00","pass_price":20}'::jsonb
 where key = 'delivery_policy';

-- Is a Tbilisi local time inside [from, to)? Windows may wrap past midnight (22:00–08:00).
create or replace function private.in_window(p_local time, p_from time, p_to time)
returns boolean language sql immutable set search_path to ''
as $$ select case when p_from <= p_to then p_local >= p_from and p_local < p_to else p_local >= p_from or p_local < p_to end $$;

-- Night markup in percent right now (0 in the day).
create or replace function private.night_percent(p_at timestamptz default now())
returns numeric language sql stable security definer set search_path to ''
as $$
  select case when private.in_window((p_at at time zone 'Asia/Tbilisi')::time,
                                     coalesce(s.value->>'from', '00:00')::time, coalesce(s.value->>'to', '08:00')::time)
              then coalesce((s.value->>'percent')::numeric, 0) else 0 end
    from public.store_settings s where s.key = 'night_pricing'
$$;

-- Price with the night markup, rounded up to the step. Day: unchanged.
create or replace function private.night_price(p_price numeric, p_at timestamptz default now())
returns numeric language sql stable security definer set search_path to ''
as $$
  select case when coalesce(p_price, 0) <= 0 or private.night_percent(p_at) = 0 then p_price
              else ceil(round(p_price * (1 + private.night_percent(p_at) / 100) / st, 6)) * st end
    from (select coalesce((value->>'step')::numeric, 0.5) st from public.store_settings where key = 'night_pricing') x
$$;

-- Storefront: the rule and the server clock, so the shop shows the same prices the order will get.
create or replace function public.night_pricing()
returns jsonb language sql stable security definer set search_path to ''
as $$
  select (select value from public.store_settings where key = 'night_pricing')
         || jsonb_build_object('active', private.night_percent() > 0, 'now', now())
         || jsonb_build_object('delivery', (select value - 'mode' from public.store_settings where key = 'delivery_policy'))
$$;
grant execute on function public.night_pricing() to anon, authenticated;

-- Raise a freshly created order to night prices (no-op in the day).
create or replace function private.apply_night_price(p_result jsonb)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare v_order uuid := (p_result->>'order_id')::uuid; v_b numeric; v_b2 numeric; v_total numeric;
begin
  if v_order is null or private.night_percent() = 0 then return p_result; end if;
  -- Products bought on top (gifts stay 0).
  update public.order_items i set unit_price_snapshot = private.night_price(i.unit_price_snapshot),
         line_total = private.night_price(i.unit_price_snapshot) * i.quantity
   where i.order_id = v_order and i.item_type = 'PRODUCT' and not i.is_gift and i.unit_price_snapshot > 0;
  -- The Рывок: whole price raised, spread over its lines in proportion.
  select coalesce(sum(line_total), 0) into v_b from public.order_items where order_id = v_order and item_type = 'BUNDLE';
  if v_b > 0 then
    v_b2 := private.night_price(v_b);
    update public.order_items set line_total = round(line_total * v_b2 / v_b, 2),
                                  unit_price_snapshot = round(round(line_total * v_b2 / v_b, 2) / quantity, 4)
     where order_id = v_order and item_type = 'BUNDLE';
    -- Rounding remainder goes to the largest line.
    update public.order_items set line_total = line_total + (v_b2 - (select sum(line_total) from public.order_items where order_id = v_order and item_type = 'BUNDLE'))
     where id = (select id from public.order_items where order_id = v_order and item_type = 'BUNDLE' order by line_total desc limit 1);
  end if;
  update public.orders o
     set subtotal = o.subtotal + (x.goods - (o.total - o.delivery_fee)),
         total = x.goods + o.delivery_fee,
         gross_profit = x.goods - o.cogs_total
    from (select coalesce(sum(line_total), 0) goods from public.order_items where order_id = v_order and not is_gift) x
   where o.id = v_order
  returning o.total into v_total;
  return p_result || jsonb_build_object('total', v_total, 'night', true)
                  || case when v_b > 0 then jsonb_build_object('bundle_price', v_b2,
                       'regular_total', (select subtotal from public.orders where id = v_order)) else '{}'::jsonb end;
end $$;
revoke all on function private.apply_night_price(jsonb) from public, anon, authenticated;

create or replace function public.create_store_order(p_name text, p_phone text, p_fulfillment text, p_address text, p_payment text,
                                                     p_comment text, p_items jsonb, p_zone uuid default null)
returns jsonb language plpgsql security definer set search_path to ''
as $$
begin
  return private.apply_order_delivery(private.apply_night_price(
    private.create_store_order_core(p_name, p_phone, p_fulfillment, p_address, p_payment, p_comment, p_items)),
    p_zone, p_phone, p_fulfillment);
end $$;

create or replace function public.create_bundle_order(p_name text, p_phone text, p_fulfillment text, p_address text, p_payment text,
                                                      p_comment text, p_bundle uuid, p_city uuid default null,
                                                      p_items jsonb default '[]'::jsonb, p_zone uuid default null)
returns jsonb language plpgsql security definer set search_path to ''
as $$
begin
  return private.apply_order_delivery(private.apply_night_price(
    private.create_bundle_order_core(p_name, p_phone, p_fulfillment, p_address, p_payment, p_comment, p_bundle, p_city, p_items)),
    p_zone, p_phone, p_fulfillment);
end $$;

-- Editing an order: a product added at night gets the night price (kept lines keep the price they were bought at).
do $$
declare d text := pg_get_functiondef('private.order_edit_apply(uuid,jsonb,boolean,text,text,text)'::regprocedure);
begin
  if position('v_price := p.sale_price;' in d) > 0 then
    execute replace(d, 'v_price := p.sale_price;', 'v_price := private.night_price(p.sale_price);');
  end if;
end $$;

-- Delivery: day / evening-night fee and free-from; PASS unchanged.
create or replace function private.delivery_quote(p_zone uuid, p_phone text, p_fulfillment text, p_subtotal numeric default null)
returns jsonb language plpgsql stable security definer set search_path to ''
as $$
declare v_policy jsonb; v_mode text; v_pass boolean := false; v_local time; v_night boolean; v_free_from numeric; v_fee numeric;
        v_pass_from numeric; v_pass_fee numeric;
begin
  select value into v_policy from public.store_settings where key = 'delivery_policy';
  v_mode := coalesce(v_policy->>'mode', 'CHARGE');
  if p_fulfillment is distinct from 'delivery' then return jsonb_build_object('fee', 0, 'reason', 'PICKUP', 'mode', v_mode); end if;
  if v_mode in ('FREE', 'HIDDEN') then return jsonb_build_object('fee', 0, 'reason', v_mode, 'mode', v_mode); end if;
  if not exists (select 1 from public.delivery_zones where id = p_zone and active) then
    return jsonb_build_object('fee', 0, 'reason', 'NO_ZONE', 'mode', v_mode);
  end if;
  v_local := (now() at time zone 'Asia/Tbilisi')::time;
  v_night := private.in_window(v_local, coalesce(v_policy->>'night_from', '22:00')::time, coalesce(v_policy->>'night_to', '08:00')::time);
  v_fee := case when v_night then coalesce((v_policy->>'night_fee')::numeric, 7) else coalesce((v_policy->>'day_fee')::numeric, 4) end;
  v_free_from := case when v_night then coalesce((v_policy->>'night_free_from')::numeric, 80) else coalesce((v_policy->>'day_free_from')::numeric, 50) end;
  v_pass_from := coalesce((v_policy->>'pass_free_from')::numeric, 20);
  v_pass_fee := coalesce((v_policy->>'pass_fee')::numeric, 3);
  select exists(select 1 from public.pass_subscriptions s join public.customers c on c.id = s.customer_id
                 where c.phone = private.norm_phone(p_phone) and s.status = 'ACTIVE' and s.ends_at > now()) into v_pass;
  if v_pass and private.in_window(v_local, coalesce(v_policy->>'pass_from', '12:00')::time, coalesce(v_policy->>'pass_to', '22:00')::time) then
    if coalesce(p_subtotal, 0) >= v_pass_from then
      return jsonb_build_object('fee', 0, 'reason', 'PASS', 'mode', v_mode, 'free_from', v_pass_from);
    end if;
    return jsonb_build_object('fee', v_pass_fee, 'reason', 'PASS_SMALL', 'mode', v_mode, 'free_from', v_pass_from);
  end if;
  if coalesce(p_subtotal, 0) >= v_free_from then
    return jsonb_build_object('fee', 0, 'reason', 'FREE_FROM', 'mode', v_mode, 'free_from', v_free_from, 'night', v_night);
  end if;
  return jsonb_build_object('fee', v_fee, 'reason', 'ZONE', 'mode', v_mode, 'free_from', v_free_from, 'night', v_night);
end $$;

-- PASS: 20 ₾ / month (new subscriptions; active ones are not touched).
create or replace function public.start_pass(p_name text, p_phone text)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare c uuid; s uuid; v_price numeric;
begin
  if coalesce(trim(p_phone), '') = '' then raise exception 'Phone required'; end if;
  select coalesce((value->>'pass_price')::numeric, 20) into v_price from public.store_settings where key = 'delivery_policy';
  v_price := coalesce(v_price, 20);
  insert into public.customers(phone, full_name, last_order_at) values (trim(p_phone), nullif(trim(p_name), ''), now())
  on conflict (phone) do update set full_name = coalesce(excluded.full_name, public.customers.full_name) returning id into c;
  insert into public.pass_subscriptions(customer_id, price, status, payment_status) values (c, v_price, 'PENDING', 'PENDING') returning id into s;
  return jsonb_build_object('subscription_id', s, 'price', v_price, 'payment_required', true);
end $$;
