-- Owner, 2026-10-06 (applied by the owner in the SQL editor): the section is «Пицца и хачапури»;
-- Assorti gets the pizzeria's second photo (same file, new version).
update public.categories set name = 'Пицца и хачапури' where slug = 'pizza';
update public.products set image_url = 'https://xugushik-source.github.io/Pivka-dlya-ryvka-/assets/products/standard/pizza-assorti-700.jpg?v=20261007l'
 where sku = 'KRI-FOOD-PIZZA-ASSORTI-700';
