-- Owner, 2026-10-02: the section is «Одноразовая посуда и салфетки» (was «Расходники»); napkins are sold by 10:
-- 2 ₾ for 10 napkins, purchase = the pack-of-50 price / 5 (25×25: 1 → 0.20 ₾, 30×30: 2.50 → 0.50 ₾).
-- Real table-napkin photo (was a tissue box).
update public.categories set name = 'Одноразовая посуда и салфетки' where slug = 'supplies';

update public.products p
   set name = v.name, name_i18n = jsonb_build_object('ru', v.name, 'ka', v.ka, 'hy', v.hy),
       sale_price = 2, purchase_price = v.buy,
       image_url = 'https://xugushik-source.github.io/Pivka-dlya-ryvka-/assets/products/standard/' || v.img || '.jpg?v=20261002e',
       updated_at = now()
  from (values
    ('KRI-SUPPLY-NAPKIN-2525', 'Салфетки 25×25, 10 шт', 'ხელსახოცები 25×25, 10 ც', 'Անձեռոցիկներ 25×25, 10 հատ', 0.2, 'napkins-25'),
    ('KRI-SUPPLY-NAPKIN-3030', 'Салфетки 30×30, 10 шт', 'ხელსახოცები 30×30, 10 ც', 'Անձեռոցիկներ 30×30, 10 հատ', 0.5, 'napkins-30')
  ) v(sku, name, ka, hy, buy, img)
 where p.sku = v.sku;
update public.supplier_products sp set last_cost = p.purchase_price
  from public.products p where p.id = sp.product_id and p.sku in ('KRI-SUPPLY-NAPKIN-2525', 'KRI-SUPPLY-NAPKIN-3030');
