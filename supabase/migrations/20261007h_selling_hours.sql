-- Owner, 2026-10-06: selling hours (Asia/Tbilisi).
--   Day 11:00–23:00 — everything (beer is sold by the brewery until 23:00, from 11:00).
--   Hot food (Мндо works 10:00–23:30, ~30 min to bake) — orders 10:00–23:00.
--   Night 23:00–11:00 — only what is kept in the car: Jack Daniel's, FORTUNA GOLD / PREMIUM, Царская Оригинальная / Золотая,
--   Absolut, and a short snack set: smoked chicken, sausages (Лидер, ATENK), ATENK «Гюмри».
-- products.sell_from / sell_until: null = always. The window may wrap past midnight.
-- Enforced on the server: an order with a closed product is refused; a Рывок with a closed product is unavailable.
alter table public.products add column if not exists sell_from time;
alter table public.products add column if not exists sell_until time;

create or replace function private.product_open(p_from time, p_until time, p_at timestamptz default now())
returns boolean language sql stable set search_path to ''
as $$ select p_from is null or p_until is null or private.in_window((p_at at time zone 'Asia/Tbilisi')::time, p_from, p_until) $$;

update public.products set sell_from = '11:00', sell_until = '23:00';
update public.products p set sell_from = '10:00', sell_until = '23:00'
  from public.categories c where c.id = p.category_id and c.slug = 'pizza';
update public.products set sell_from = null, sell_until = null
 where sku in ('KRI-WHI-JD-050', 'KRI-VOD-FOR-PREM-050', 'KRI-VOD-FOR-MOON-050', 'KRI-VOD-TSAR-ORIG-050', 'KRI-VOD-TSAR-GOLD-050',
               'KRI-VOD-ABS-050', 'KRI-MEAT-CHICKEN-SMOKED-1000', 'KRI-MEAT-SAUS-LIDER-500', 'KRI-MEAT-SAUS-ATENK', 'KRI-MEAT-GYUMRI-600');

-- Refuse an order (products on top and the Рывок's lines) that contains something not sold right now.
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
    raise exception 'Сейчас не продаётся: %. Ночью (23:00–11:00) — только крепкое и закуска; пиво — с 11:00, пицца и хачапури — с 10:00.', v;
  end if;
end $$;
revoke all on function private.assert_open(jsonb, uuid) from public, anon, authenticated;

create or replace function public.create_store_order(p_name text, p_phone text, p_fulfillment text, p_address text, p_payment text,
                                                     p_comment text, p_items jsonb, p_zone uuid default null)
returns jsonb language plpgsql security definer set search_path to ''
as $$
begin
  perform private.assert_open(p_items);
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
  perform private.assert_open(p_items, p_bundle);
  return private.apply_order_delivery(private.apply_night_price(
    private.create_bundle_order_core(p_name, p_phone, p_fulfillment, p_address, p_payment, p_comment, p_bundle, p_city, p_items)),
    p_zone, p_phone, p_fulfillment);
end $$;

-- A Рывок with a product that is not sold right now is unavailable (reason CLOSED_NOW).
do $$
declare d text := pg_get_functiondef('private.bundle_calc(uuid)'::regprocedure);
begin
  if position('CLOSED_NOW' in d) = 0 then
    execute replace(d, $r$when not p.active then 'PRODUCT_INACTIVE'$r$,
                       $r$when not p.active then 'PRODUCT_INACTIVE'
           when not private.product_open(p.sell_from, p.sell_until) then 'CLOSED_NOW'$r$);
  end if;
end $$;
