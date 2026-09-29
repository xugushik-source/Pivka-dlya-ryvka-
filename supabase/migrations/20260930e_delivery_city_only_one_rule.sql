-- Applied 2026-09-30 (migration "delivery_city_only_one_rule"). Supersedes the outskirts/villages rule.
-- Delivery only inside the city (no outskirts, no villages). One rule for everybody:
-- PASS holder, order placed 12:00–22:00 (Asia/Tbilisi) → 0 ₾; otherwise order from 40 ₾ → 0 ₾, below 40 ₾ → 5 ₾.
update public.delivery_zones set active = (name ilike '%— город%');
update public.delivery_zones set fee = 5 where name ilike '%— город%';
update public.store_settings
   set value = (value - 'outer_fee' - 'outer_free_from') || '{"fee":5,"free_from":40}'::jsonb
 where key = 'delivery_policy';

create or replace function private.delivery_quote(p_zone uuid, p_phone text, p_fulfillment text, p_subtotal numeric default null)
returns jsonb language plpgsql stable security definer set search_path to ''
as $$
declare v_policy jsonb; v_mode text; z record; v_pass boolean := false; v_local time; v_free_from numeric; v_fee numeric;
begin
  select value into v_policy from public.store_settings where key = 'delivery_policy';
  v_mode := coalesce(v_policy->>'mode', 'CHARGE');
  if p_fulfillment is distinct from 'delivery' then return jsonb_build_object('fee', 0, 'reason', 'PICKUP', 'mode', v_mode); end if;
  if v_mode in ('FREE', 'HIDDEN') then return jsonb_build_object('fee', 0, 'reason', v_mode, 'mode', v_mode); end if;
  select fee into z from public.delivery_zones where id = p_zone and active;
  if not found then return jsonb_build_object('fee', 0, 'reason', 'NO_ZONE', 'mode', v_mode); end if;
  v_free_from := coalesce((v_policy->>'free_from')::numeric, 40);
  v_fee := coalesce(z.fee, (v_policy->>'fee')::numeric, 5);
  v_local := (now() at time zone 'Asia/Tbilisi')::time;
  select exists(select 1 from public.pass_subscriptions s join public.customers c on c.id = s.customer_id
                 where c.phone = trim(coalesce(p_phone, '')) and s.status = 'ACTIVE' and s.ends_at > now()) into v_pass;
  if v_pass and v_local >= coalesce(v_policy->>'pass_from', '12:00')::time and v_local < coalesce(v_policy->>'pass_to', '22:00')::time then
    return jsonb_build_object('fee', 0, 'reason', 'PASS', 'mode', v_mode, 'free_from', v_free_from);
  end if;
  if coalesce(p_subtotal, 0) >= v_free_from then
    return jsonb_build_object('fee', 0, 'reason', 'FREE_FROM', 'mode', v_mode, 'free_from', v_free_from);
  end if;
  return jsonb_build_object('fee', v_fee, 'reason', 'ZONE', 'mode', v_mode, 'free_from', v_free_from);
end $$;
