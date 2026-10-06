-- Owner, 2026-10-06: Мндо's purchase prices (sale − 5 ₾ for pizza/khachapuri, − 2 ₾ for lahmajo).
-- «Тост за Кавказ» fell to 9.5% margin (< 10% minimum) → discount 7.50 → 5.00 (97.50 ₾, 11.8%).
update public.products p set purchase_price = v.buy, updated_at = now()
  from (values ('KRI-FOOD-PIZZA-PEPPERONI-650',25),('KRI-FOOD-PIZZA-ASSORTI-700',25),('KRI-FOOD-PIZZA-MARGHERITA-600',20),
               ('KRI-FOOD-KHACH-ROYAL-900',25),('KRI-FOOD-KHACH-IMERULI-820',20),('KRI-FOOD-LAHMAJO-MEAT-200',5),('KRI-FOOD-LAHMAJO-CHEESE-200',6)) v(sku, buy)
 where p.sku = v.sku;
update public.supplier_products sp set last_cost = p.purchase_price
  from public.products p where p.id = sp.product_id and p.sku like 'KRI-FOOD-%';

update public.bundles set discount_value = 5.00, updated_at = now() where name = 'Тост за Кавказ';
update public.bundles b set price = x.bundle_price, compare_at_price = x.regular_total
  from private.bundle_calc(null) x where x.bundle_id = b.id and b.name = 'Тост за Кавказ';
