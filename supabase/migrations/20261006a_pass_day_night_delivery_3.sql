-- Owner, 2026-10-06. Delivery and two kinds of PASS.
-- Without PASS: 08:00–23:00 3 ₾, free from 50 ₾; 23:00–08:00 7 ₾, free from 80 ₾.
-- PASS «Дневной» (20 ₾ / month): 12:00–23:00 free from 30 ₾, below 30 ₾ — 2 ₾. Other hours: as without PASS.
-- PASS «Ночной» (40 ₾ / month): the same by day, and also 23:00–08:00: free from 30 ₾, below 30 ₾ — 5 ₾.
-- Existing subscriptions are «Дневной».
alter table public.pass_subscriptions add column if not exists plan text not null default 'DAY';
alter table public.pass_subscriptions drop constraint if exists pass_subscriptions_plan_check;
alter table public.pass_subscriptions add constraint pass_subscriptions_plan_check check (plan in ('DAY', 'NIGHT'));

update public.store_settings
   set value = value || '{"day_fee":3,"day_free_from":50,"night_fee":7,"night_free_from":80,"night_from":"23:00","night_to":"08:00",
                          "pass_from":"12:00","pass_to":"23:00","pass_free_from":30,"pass_fee":2,"pass_night_fee":5,
                          "pass_price":20,"pass_night_price":40}'::jsonb
 where key = 'delivery_policy';

create or replace function private.delivery_quote(p_zone uuid, p_phone text, p_fulfillment text, p_subtotal numeric default null)
returns jsonb language plpgsql stable security definer set search_path to ''
as $$
declare v_policy jsonb; v_mode text; v_plan text; v_local time; v_night boolean; v_free_from numeric; v_fee numeric;
        v_pass_from numeric; v_pass_fee numeric; v_pass_window boolean;
begin
  select value into v_policy from public.store_settings where key = 'delivery_policy';
  v_mode := coalesce(v_policy->>'mode', 'CHARGE');
  if p_fulfillment is distinct from 'delivery' then return jsonb_build_object('fee', 0, 'reason', 'PICKUP', 'mode', v_mode); end if;
  if v_mode in ('FREE', 'HIDDEN') then return jsonb_build_object('fee', 0, 'reason', v_mode, 'mode', v_mode); end if;
  if not exists (select 1 from public.delivery_zones where id = p_zone and active) then
    return jsonb_build_object('fee', 0, 'reason', 'NO_ZONE', 'mode', v_mode);
  end if;
  v_local := (now() at time zone 'Asia/Tbilisi')::time;
  v_night := private.in_window(v_local, coalesce(v_policy->>'night_from', '23:00')::time, coalesce(v_policy->>'night_to', '08:00')::time);
  v_fee := case when v_night then coalesce((v_policy->>'night_fee')::numeric, 7) else coalesce((v_policy->>'day_fee')::numeric, 3) end;
  v_free_from := case when v_night then coalesce((v_policy->>'night_free_from')::numeric, 80) else coalesce((v_policy->>'day_free_from')::numeric, 50) end;

  -- The best active PASS of this phone (NIGHT covers everything DAY does).
  select s.plan into v_plan from public.pass_subscriptions s join public.customers c on c.id = s.customer_id
   where c.phone = private.norm_phone(p_phone) and s.status = 'ACTIVE' and s.ends_at > now()
   order by (s.plan = 'NIGHT') desc limit 1;
  if v_plan is not null then
    v_pass_from := coalesce((v_policy->>'pass_free_from')::numeric, 30);
    v_pass_window := private.in_window(v_local, coalesce(v_policy->>'pass_from', '12:00')::time, coalesce(v_policy->>'pass_to', '23:00')::time);
    if v_pass_window then
      v_pass_fee := coalesce((v_policy->>'pass_fee')::numeric, 2);
    elsif v_plan = 'NIGHT' and v_night then
      v_pass_fee := coalesce((v_policy->>'pass_night_fee')::numeric, 5);
    end if;
    if v_pass_fee is not null then
      if coalesce(p_subtotal, 0) >= v_pass_from then
        return jsonb_build_object('fee', 0, 'reason', 'PASS', 'mode', v_mode, 'free_from', v_pass_from, 'plan', v_plan);
      end if;
      return jsonb_build_object('fee', v_pass_fee, 'reason', 'PASS_SMALL', 'mode', v_mode, 'free_from', v_pass_from, 'plan', v_plan);
    end if;
  end if;
  if coalesce(p_subtotal, 0) >= v_free_from then
    return jsonb_build_object('fee', 0, 'reason', 'FREE_FROM', 'mode', v_mode, 'free_from', v_free_from, 'night', v_night);
  end if;
  return jsonb_build_object('fee', v_fee, 'reason', 'ZONE', 'mode', v_mode, 'free_from', v_free_from, 'night', v_night);
end $$;

-- PASS request: «Дневной» 20 ₾ or «Ночной» 40 ₾ (staff switch it on after the transfer, as before).
create or replace function public.start_pass(p_name text, p_phone text, p_plan text)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare c uuid; s uuid; v_price numeric; v_plan text := case when upper(coalesce(p_plan, '')) = 'NIGHT' then 'NIGHT' else 'DAY' end;
begin
  if coalesce(trim(p_phone), '') = '' then raise exception 'Phone required'; end if;
  select case when v_plan = 'NIGHT' then coalesce((value->>'pass_night_price')::numeric, 40) else coalesce((value->>'pass_price')::numeric, 20) end
    into v_price from public.store_settings where key = 'delivery_policy';
  v_price := coalesce(v_price, case when v_plan = 'NIGHT' then 40 else 20 end);
  insert into public.customers(phone, full_name, last_order_at) values (trim(p_phone), nullif(trim(p_name), ''), now())
  on conflict (phone) do update set full_name = coalesce(excluded.full_name, public.customers.full_name) returning id into c;
  insert into public.pass_subscriptions(customer_id, price, status, payment_status, plan) values (c, v_price, 'PENDING', 'PENDING', v_plan) returning id into s;
  return jsonb_build_object('subscription_id', s, 'price', v_price, 'plan', v_plan, 'payment_required', true);
end $$;
grant execute on function public.start_pass(text, text, text) to anon, authenticated;

-- The old two-argument call keeps working (a «Дневной» request).
create or replace function public.start_pass(p_name text, p_phone text)
returns jsonb language sql security definer set search_path to ''
as $$ select public.start_pass(p_name, p_phone, 'DAY') $$;
