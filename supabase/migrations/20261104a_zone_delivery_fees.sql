-- Владелец, 04.11.2026: доставка зависит от зоны.
-- Днём: город 4 ₾, Городок первый 6 ₾. После 23:00: город 7 ₾, Городок 9 ₾.
-- Дневная цена = delivery_zones.fee; ночью + (night_fee - day_fee) из политики (+3 ₾).
-- Бесплатная доставка от 50/80 ₾ — без изменений.

update public.store_settings
   set value = value || jsonb_build_object('day_fee', 4, 'night_fee', 7)
 where key = 'delivery_policy';

update public.delivery_zones set fee = 4 where is_city and name like '% — город';

insert into public.delivery_zones (name, fee, minimum_order, active, sort_order, city_id, is_city)
select 'Ахалкалаки — Городок первый', 6, 20, true, 15, 'b93c37c8-0ef8-490e-842d-80c11450bc80', true
 where not exists (select 1 from public.delivery_zones where name = 'Ахалкалаки — Городок первый');

create or replace function private.delivery_quote(p_zone uuid, p_phone text, p_fulfillment text, p_subtotal numeric default null::numeric)
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare v_policy jsonb; v_mode text; v_local time; v_night boolean; v_free_from numeric; v_fee numeric; v_zone_fee numeric;
begin
  select value into v_policy from public.store_settings where key = 'delivery_policy';
  v_mode := coalesce(v_policy->>'mode', 'CHARGE');
  if p_fulfillment is distinct from 'delivery' then return jsonb_build_object('fee', 0, 'reason', 'PICKUP', 'mode', v_mode); end if;
  if v_mode in ('FREE', 'HIDDEN') then return jsonb_build_object('fee', 0, 'reason', v_mode, 'mode', v_mode); end if;
  select fee into v_zone_fee from public.delivery_zones where id = p_zone and active;
  if not found then
    return jsonb_build_object('fee', 0, 'reason', 'NO_ZONE', 'mode', v_mode);
  end if;
  v_local := (private.order_at() at time zone 'Asia/Tbilisi')::time;
  v_night := private.in_window(v_local, coalesce(v_policy->>'night_from', '23:00')::time, coalesce(v_policy->>'night_to', '08:00')::time);
  v_fee := coalesce(v_zone_fee, coalesce((v_policy->>'day_fee')::numeric, 4));
  if v_night then
    v_fee := v_fee + greatest(coalesce((v_policy->>'night_fee')::numeric, 7) - coalesce((v_policy->>'day_fee')::numeric, 4), 0);
  end if;
  v_free_from := case when v_night then coalesce((v_policy->>'night_free_from')::numeric, 80) else coalesce((v_policy->>'day_free_from')::numeric, 50) end;
  if coalesce(p_subtotal, 0) >= v_free_from then
    return jsonb_build_object('fee', 0, 'reason', 'FREE_FROM', 'mode', v_mode, 'free_from', v_free_from, 'night', v_night);
  end if;
  return jsonb_build_object('fee', v_fee, 'reason', 'ZONE', 'mode', v_mode, 'free_from', v_free_from, 'night', v_night);
end $function$;
