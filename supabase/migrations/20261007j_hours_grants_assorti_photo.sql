-- Applied by the owner in the SQL editor, 2026-10-06 (together with 20261007h and 20261007i).
-- The storefront reads products as anon with column grants: open the new columns to it.
grant select (sell_from, sell_until, prep_minutes, prep_batch) on public.products to anon, authenticated;
-- Assorti: the pizzeria's own photo.
update public.products set image_url = 'https://xugushik-source.github.io/Pivka-dlya-ryvka-/assets/products/standard/pizza-assorti-700.jpg?v=20261007k'
 where sku = 'KRI-FOOD-PIZZA-ASSORTI-700';
