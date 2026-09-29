-- Master spec, stages 3–6 and 10 (data + storage). Pricing stays dynamic: private.bundle_calc sums current sale_price.

-- 1. Short ideas for the existing Рывки (shown on the card).
update public.bundles b set description = v.d, badge_text = v.badge, updated_at = now()
  from (values
    ('Рывок на двоих', 'Пиво, рыба и сыр — вечер на двоих', 'ВЫГОДНО'),
    ('Рыбный рывок',   'Для тех, кто пьёт пиво с рыбой',     'КЛАССИКА'),
    ('Большой рывок',  '6 л пива и закуски на компанию',     'КОМПАНИЯ')
  ) v(name, d, badge)
 where b.name = v.name;

-- 2. New Рывки on real active SKUs only.
insert into public.bundles(name, description, badge_text, discount_type, discount_value, sort_order, active)
select v.name, v.d, v.badge, 'FIXED', v.discount, v.ord, true
  from (values
    ('Футбольный рывок', 'Матч, 6 л пива и закуски на оба тайма', 'ФУТБОЛ', 4, 40),
    ('ЁРШ',              'Водка без пива — деньги на ветер',      'КРЕПКО', 3, 50)
  ) v(name, d, badge, discount, ord)
 where not exists (select 1 from public.bundles b where b.name = v.name);

delete from public.bundle_items bi using public.bundles b
 where b.id = bi.bundle_id and b.name in ('Футбольный рывок', 'ЁРШ');
with spec(bundle, sku, qty) as (values
  ('Футбольный рывок', 'DAV-BEER-002', 6), ('Футбольный рывок', 'KRI-SNACK-MARTIN-150', 1),
  ('Футбольный рывок', 'KRI-MEAT-JERKY-CHK-030', 2), ('Футбольный рывок', 'KRI-MEAT-JERKY-PORK-030', 2),
  ('ЁРШ', 'KRI-VOD-UGL-050', 1), ('ЁРШ', 'DAV-BEER-001', 2),
  ('ЁРШ', 'KRI-MEAT-JERKY-MIX-060', 1), ('ЁРШ', 'KRI-WATER-NABEGLAVI-050', 1)
)
insert into public.bundle_items(bundle_id, product_id, quantity)
select b.id, p.id, s.qty from spec s
join public.bundles b on b.name = s.bundle
join public.products p on p.sku = s.sku and p.active;

-- Transitional mirror for any old client still reading bundles.price.
update public.bundles b set price = x.bundle_price, compare_at_price = x.regular_total
  from private.bundle_calc(null) x where x.bundle_id = b.id;

-- 3. Upsell matrix (two-way). Category rules + product rules for wine types and drink types.
delete from public.upsell_rules;
with c as (select slug, id from public.categories),
cat_rules(src, tgt, prio) as (values
  ('draft','fish',10),('draft','cheese',20),('draft','meat-snacks',30),('draft','snacks',40),('draft','chips',45),('draft','nuts',50),
  ('fish','draft',10),('fish','soft-drinks',20),
  ('cheese','draft',10),('cheese','wine',20),
  ('meat-snacks','draft',10),('meat-snacks','vodka',20),
  ('vodka','meat-snacks',10),('vodka','soft-drinks',20),
  ('strong','meat-snacks',10),('strong','soft-drinks',20),
  ('whisky','soft-drinks',10),('whisky','nuts',20),('whisky','chocolate',30),
  ('brandy','chocolate',10),('brandy','nuts',20),('brandy','cheese',30),
  ('wine','cheese',10),('wine','nuts',20),('wine','chocolate',30),
  ('snacks','draft',10),
  ('chips','draft',10),('chips','soft-drinks',20),
  ('nuts','draft',10),('nuts','whisky',20),('nuts','brandy',30),
  ('chocolate','brandy',10),('chocolate','whisky',20),
  ('soft-drinks','snacks',10),('soft-drinks','chips',20),('soft-drinks','nuts',30),
  ('energy','snacks',10),('energy','chips',20),
  ('gin','tonic',10),('gin','citrus',20),('rum','soft-drinks',10),('rum','citrus',20),
  ('tequila','citrus',10),('tequila','soft-drinks',20)
)
insert into public.upsell_rules(source_category_id, target_category_id, priority, active)
select s.id, t.id, r.prio, true from cat_rules r join c s on s.slug = r.src join c t on t.slug = r.tgt;

with c as (select slug, id from public.categories),
prod_rules(sku, tgt, prio) as (values
  -- red wine → cheese → meat → nuts
  ('KRI-WINE-MUKUZANI-075','cheese',10),('KRI-WINE-MUKUZANI-075','meat-snacks',20),('KRI-WINE-MUKUZANI-075','nuts',30),
  ('KRI-WINE-SAPERAVI-075','cheese',10),('KRI-WINE-SAPERAVI-075','meat-snacks',20),('KRI-WINE-SAPERAVI-075','nuts',30),
  ('KRI-WINE-SM-SAP-075','cheese',10),('KRI-WINE-SM-SAP-075','meat-snacks',20),('KRI-WINE-SM-SAP-075','nuts',30),
  -- white wine → cheese → fish → nuts
  ('KRI-WINE-KC-WHITE-075','cheese',10),('KRI-WINE-KC-WHITE-075','fish',20),('KRI-WINE-KC-WHITE-075','nuts',30),
  ('KRI-WINE-SM-RK-075','cheese',10),('KRI-WINE-SM-RK-075','fish',20),('KRI-WINE-SM-RK-075','nuts',30),
  -- rosé → cheese → light snacks
  ('KRI-WINE-SAPERAVI-ROSE-075','cheese',10),('KRI-WINE-SAPERAVI-ROSE-075','snacks',20),
  -- cola → whisky
  ('KRI-SOFT-COLA-050','whisky',10),('KRI-SOFT-PEPSI-050','whisky',10),
  -- juice → vodka / strong
  ('KRI-JUICE-CAPPY-ASST','vodka',10),('KRI-JUICE-CAPPY-ASST','strong',20),
  ('KRI-SOFT-ARARAT-075','vodka',10),('KRI-SOFT-ARARAT-075','strong',20),
  ('KRI-SOFT-ARARAT-PREM-097','vodka',10),('KRI-SOFT-ARARAT-PREM-097','strong',20),
  ('KRI-SOFT-ARARAT-COMP-100','vodka',10),('KRI-SOFT-ARARAT-COMP-100','strong',20),
  -- mineral water → strong / wine
  ('KRI-WATER-LIKANI-060','vodka',10),('KRI-WATER-LIKANI-060','wine',20),
  ('KRI-WATER-LIKANI-100','vodka',10),('KRI-WATER-LIKANI-100','wine',20),
  ('KRI-WATER-NABEGLAVI-050','vodka',10),('KRI-WATER-NABEGLAVI-050','wine',20),
  ('KRI-WATER-NABEGLAVI-100','vodka',10),('KRI-WATER-NABEGLAVI-100','wine',20)
)
insert into public.upsell_rules(source_product_id, target_category_id, priority, active)
select p.id, t.id, r.prio, true from prod_rules r join public.products p on p.sku = r.sku join c t on t.slug = r.tgt;

-- 4. Product photo uploads from the admin: public-read bucket, only staff may write.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists "staff upload product images" on storage.objects;
create policy "staff upload product images" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and (select private.is_staff()));
drop policy if exists "staff update product images" on storage.objects;
create policy "staff update product images" on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and (select private.is_staff()));
drop policy if exists "staff delete product images" on storage.objects;
create policy "staff delete product images" on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and (select private.is_staff()));

-- 5. Fix: products.name_i18n (added 2026-09-28) was not readable by anon, so the public catalog and gift tiers
--    queries failed with "permission denied". Only customer-facing columns are granted; purchase_price stays hidden.
grant select (name_i18n) on public.products to anon, authenticated;

-- 6. Fix: city_catalog ran as the caller and read columns anon cannot see (top_pick, home_rank, stock_quantity),
--    so it always failed for visitors and the storefront silently fell back to the global catalog.
--    It returns only customer-facing fields, so it runs as definer now.
alter function public.city_catalog(uuid) security definer;
revoke all on function public.city_catalog(uuid) from public;
grant execute on function public.city_catalog(uuid) to anon, authenticated;
