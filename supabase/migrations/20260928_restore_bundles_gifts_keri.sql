-- Data: rename DAV-BEER-001, restore the three historical Рывки and the two gift tiers on real SKUs.
-- Discounts (5 / 6 / 8 ₾) and gift thresholds (60 / 100 ₾) are the values that were configured before;
-- only the DEMO components are replaced with active real products.

-- 1. DAV-BEER-001 "Fresh & Modern" -> "Кери" (SKU, price, photo, category, minimum and step unchanged).
update public.products
   set name = 'Кери', name_i18n = '{"ru":"Кери","ka":"ქერი","hy":"Քեռի"}'::jsonb, updated_at = now()
 where sku = 'DAV-BEER-001';

-- 2. All five draft beer photos replaced with the owner's round labels (four previous files were truncated); version the URL so no cached copy is reused.
update public.products
   set image_url = split_part(image_url, '?', 1) || '?v=20260928b', updated_at = now()
 where sku in ('DAV-BEER-001','DAV-BEER-002','DAV-BEER-003','DAV-BEER-004','DAV-BEER-005')
   and image_url like '%/assets/products/%-draft.jpg%';

-- 3. Рывки: live price = Σ sale_price × qty − fixed discount.
delete from public.bundle_items bi using public.bundles b
 where b.id = bi.bundle_id and b.name in ('Рывок на двоих','Рыбный рывок','Большой рывок');
with spec(bundle, sku, qty) as (values
  ('Рывок на двоих', 'DAV-BEER-001', 4), ('Рывок на двоих', 'DAV-FISH-STR-500', 1),
  ('Рывок на двоих', 'DAV-CHEESE-MIX-450', 1), ('Рывок на двоих', 'DAV-FISH-SHAM-001', 1),
  ('Рыбный рывок', 'DAV-BEER-005', 4), ('Рыбный рывок', 'DAV-FISH-GEN-525', 1),
  ('Рыбный рывок', 'DAV-FISH-STR-500', 1), ('Рыбный рывок', 'DAV-FISH-TUNA-030', 1),
  ('Большой рывок', 'DAV-BEER-004', 6), ('Большой рывок', 'DAV-FISH-GEN-525', 1),
  ('Большой рывок', 'DAV-FISH-STR-500', 1), ('Большой рывок', 'KRI-MEAT-SUD-230', 1),
  ('Большой рывок', 'DAV-CHEESE-MIX-450', 1)
)
insert into public.bundle_items(bundle_id, product_id, quantity)
select b.id, p.id, s.qty from spec s
join public.bundles b on b.name = s.bundle
join public.products p on p.sku = s.sku and p.active;

update public.bundles b
   set discount_type = 'FIXED', discount_value = v.discount, sort_order = v.ord,
       description = null, active = true, updated_at = now()
  from (values ('Рывок на двоих', 5, 10), ('Рыбный рывок', 6, 20), ('Большой рывок', 8, 30)) v(name, discount, ord)
 where b.name = v.name;
-- Transitional mirror for the storefront build still live on main (it reads bundles.price).
-- The new storefront/admin/checkout never read these columns; they can be nulled after deploy.
update public.bundles b set price = x.bundle_price, compare_at_price = x.regular_total
  from private.bundle_calc(null) x where x.bundle_id = b.id and b.name in ('Рывок на двоих','Рыбный рывок','Большой рывок');

-- 4. Gift tiers: same thresholds, real products of the same kind/price as the old DEMO gifts.
update public.gift_tiers g set product_id = p.id, quantity = 1, active = true
  from public.products p
 where p.sku = 'DAV-FISH-STR-030' and g.threshold = 60;   -- was DEMO-CHIPS (5 ₾)
update public.gift_tiers g set product_id = p.id, quantity = 1, active = true
  from public.products p
 where p.sku = 'DAV-FISH-SIG-001' and g.threshold = 100;  -- was DEMO-FISH-1 (7 ₾)
