-- Owner, 2026-10-10: Мндо starts baking at 12:00 — pizza, khachapuri and lahmajo are sold 12:00–23:00 (was 10:00).
update public.products p set sell_from = '12:00', sell_until = '23:00'
  from public.categories c where c.id = p.category_id and c.slug = 'pizza';

create or replace function private.assert_open(p_items jsonb, p_bundle uuid default null)
returns void language plpgsql stable security definer set search_path to ''
as $$
declare v text;
begin
  select string_agg(distinct p.name, ', ') into v
    from public.products p
   where (p.id in (select (e->>'product_id')::uuid from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e where e ? 'product_id')
          or p.id in (select bi.product_id from public.bundle_items bi where bi.bundle_id = p_bundle))
     and not private.product_open(p.sell_from, p.sell_until);
  if v is not null then
    raise exception 'Сейчас не продаётся: %. Ночью (23:00–11:00) — только крепкое и закуска; пиво — с 11:00, пицца, хачапури и ламаджо — с 12:00.', v;
  end if;
end $$;
revoke all on function private.assert_open(jsonb, uuid) from public, anon, authenticated;
