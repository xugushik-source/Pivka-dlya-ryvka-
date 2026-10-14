-- assert_open: a separate message when the chosen pre-order time is outside selling hours
create or replace function private.assert_open(p_items jsonb, p_bundle uuid default null)
returns void language plpgsql stable security definer set search_path to '' as $$
declare v text;
begin
  select string_agg(distinct p.name, ', ') into v
    from public.products p
   where (p.id in (select (e->>'product_id')::uuid from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e where e ? 'product_id')
          or p.id in (select bi.product_id from public.bundle_items bi where bi.bundle_id = p_bundle))
     and not private.product_open(p.sell_from, p.sell_until);
  if v is not null then
    if coalesce(current_setting('pivka.at', true), '') <> '' then
      raise exception 'На выбранное время не продаётся: %. Магазин — с 10:00 до 23:00, пиво, пицца, хачапури и ламаджо — с 12:00 до 23:00.', v;
    end if;
    raise exception 'Сейчас не продаётся: %. Ночью (23:00–10:00) — только крепкое и закуска; магазин — с 10:00, пиво, пицца, хачапури и ламаджо — с 12:00.', v;
  end if;
end $$;
