-- Applied 2026-09-30 (migration "delivery_outer_zones_rule").
-- City zones: zone fee; PASS (10 ₾ / 30 days) makes city delivery free 12:00–22:00 (Asia/Tbilisi).
-- Other zones (outskirts, villages): free from 40 ₾, otherwise 5 ₾. PASS does not apply there.
alter table public.delivery_zones add column if not exists is_city boolean not null default false;
update public.delivery_zones set is_city = (name ilike '%— город%');
update public.store_settings set value = value || '{"outer_fee":5,"outer_free_from":40}'::jsonb where key = 'delivery_policy';

drop function if exists public.delivery_quote(uuid, text, text);
drop function if exists private.apply_order_delivery(jsonb, uuid, text, text);
drop function if exists private.delivery_quote(uuid, text, text);

create function private.delivery_quote(p_zone uuid, p_phone text, p_fulfillment text, p_subtotal numeric default null)
returns jsonb language plpgsql stable security definer set search_path to ''
as $$
declare v_policy jsonb; v_mode text; z record; v_pass boolean := false; v_local time; v_fee numeric;
begin
  select value into v_policy from public.store_settings where key = 'delivery_policy';
  v_mode := coalesce(v_policy->>'mode', 'CHARGE');
  if p_fulfillment is distinct from 'delivery' then return jsonb_build_object('fee', 0, 'reason', 'PICKUP', 'mode', v_mode); end if;
  if v_mode in ('FREE', 'HIDDEN') then return jsonb_build_object('fee', 0, 'reason', v_mode, 'mode', v_mode); end if;
  select fee, is_city into z from public.delivery_zones where id = p_zone and active;
  if not found then return jsonb_build_object('fee', 0, 'reason', 'NO_ZONE', 'mode', v_mode); end if;
  if not z.is_city then
    if coalesce(p_subtotal, 0) >= coalesce((v_policy->>'outer_free_from')::numeric, 40) then
      return jsonb_build_object('fee', 0, 'reason', 'FREE_FROM', 'mode', v_mode, 'free_from', coalesce((v_policy->>'outer_free_from')::numeric, 40));
    end if;
    v_fee := coalesce((v_policy->>'outer_fee')::numeric, 5);
    return jsonb_build_object('fee', v_fee, 'reason', 'OUTER', 'mode', v_mode, 'free_from', coalesce((v_policy->>'outer_free_from')::numeric, 40));
  end if;
  v_local := (now() at time zone 'Asia/Tbilisi')::time;
  select exists(select 1 from public.pass_subscriptions s join public.customers c on c.id = s.customer_id
                 where c.phone = trim(coalesce(p_phone, '')) and s.status = 'ACTIVE' and s.ends_at > now()) into v_pass;
  if v_pass and v_local >= coalesce(v_policy->>'pass_from', '12:00')::time and v_local < coalesce(v_policy->>'pass_to', '22:00')::time then
    return jsonb_build_object('fee', 0, 'reason', 'PASS', 'mode', v_mode);
  end if;
  return jsonb_build_object('fee', coalesce(z.fee, 0), 'reason', 'ZONE', 'mode', v_mode);
end $$;

create function public.delivery_quote(p_zone uuid default null, p_phone text default null, p_fulfillment text default 'delivery', p_subtotal numeric default null)
returns jsonb language sql stable security definer set search_path to ''
as $$ select private.delivery_quote(p_zone, p_phone, p_fulfillment, p_subtotal) $$;
grant execute on function public.delivery_quote(uuid, text, text, numeric) to anon, authenticated;

create function private.apply_order_delivery(p_result jsonb, p_zone uuid, p_phone text, p_fulfillment text)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare q jsonb; v_fee numeric; v_order uuid := (p_result->>'order_id')::uuid; v_total numeric; v_sub numeric;
begin
  select total into v_sub from public.orders where id = v_order;
  q := private.delivery_quote(p_zone, p_phone, p_fulfillment, v_sub);
  v_fee := coalesce((q->>'fee')::numeric, 0);
  update public.orders set delivery_fee = v_fee, delivery_zone_id = case when p_fulfillment = 'delivery' then p_zone end, total = total + v_fee
   where id = v_order returning total into v_total;
  return p_result || jsonb_build_object('delivery_fee', v_fee, 'delivery_reason', q->>'reason', 'total', v_total);
end $$;
