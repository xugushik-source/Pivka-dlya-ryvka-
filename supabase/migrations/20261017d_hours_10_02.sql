-- Opening hours (owner, 17.10): every day 10:00–02:00 Tbilisi. Orders for 02:00–10:00 are refused (pre-order is fine).
-- Delivery after 23:00 — 7 ₾ (free from 80 ₾), night prices +10 % from 00:00: both now end at closing, 02:00.
update public.store_settings set value = jsonb_build_object(
  'daily', jsonb_build_object('from', '02:00', 'to', '10:00'),
  'message', 'Работаем каждый день с 10:00 до 02:00. Сейчас закрыто — откроемся в 10:00. Можно собрать корзину или оформить предзаказ.')
 where key = 'pause';
update public.store_settings set value = value || jsonb_build_object('to', '02:00') where key = 'night_pricing';
update public.store_settings set value = value || jsonb_build_object('night_to', '02:00') where key = 'delivery_policy';
-- a gap in the opening hours: store_paused already says «закрыто до 10:00»; this one is for products closed inside them
create or replace function private.assert_open(p_items jsonb, p_bundle uuid default null)
returns void language plpgsql stable security definer set search_path to '' as $$
declare v text;
begin
  if private.store_paused() then
    raise exception '%', coalesce((select value->>'message' from public.store_settings where key = 'pause'), 'Сейчас не работаем');
  end if;
  select string_agg(distinct p.name, ', ') into v
    from public.products p
   where (p.id in (select (e->>'product_id')::uuid from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e where e ? 'product_id')
          or p.id in (select bi.product_id from public.bundle_items bi where bi.bundle_id = p_bundle))
     and not private.product_open(p.sell_from, p.sell_until);
  if v is not null then
    if coalesce(current_setting('pivka.at', true), '') <> '' then
      raise exception 'На выбранное время не продаётся: %. Уберите эти позиции или выберите другое время.', v;
    end if;
    raise exception 'Сейчас не продаётся: %. Уберите эти позиции из корзины или оформите предзаказ на время, когда они в продаже.', v;
  end if;
end $$;
update public.store_settings set value = value || jsonb_build_object('night_fee', 5) where key = 'delivery_policy';  -- owner, 17.10: night delivery 5 ₾ (prices are already +10 %)
