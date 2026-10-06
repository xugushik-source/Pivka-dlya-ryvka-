-- Owner, 2026-10-06: hot food — pizza 40 cm, round khachapuri 40 cm, lahmajo 200 g. New section «Пицца, хачапури,
-- ламаджо», shown first in «2 · Закуска» (right after beer / strong / wine). Pizza toppings from the pizzeria's menu.
-- Purchase prices and the supplier are not known yet → purchase_price 0 (margins in reports are overstated until set).
-- Photos: Unsplash License (free, commercial use) and Wikimedia-free stock until the pizzeria's own shots replace them;
-- «Ламаджо с сыром» temporarily uses the lahmajo photo with a «С СЫРОМ» badge.
insert into public.categories(slug, name, emoji, sort_order, active)
select 'pizza', 'Пицца, хачапури, ламаджо', '🍕', 28, true
 where not exists (select 1 from public.categories where slug = 'pizza');

insert into public.products(sku, category_id, name, description, image_url, unit, sale_price, purchase_price, stock_quantity,
                            minimum_quantity, quantity_step, active, supply_mode, name_i18n, badge_text, sort_order)
select v.sku, c.id, v.name, v.descr, 'https://xugushik-source.github.io/Pivka-dlya-ryvka-/assets/products/standard/' || v.img || '.jpg?v=20261007e',
       'piece', v.sell, 0, 0, 1, 1, true, 'SUPPLIER', jsonb_build_object('ru', v.name, 'ka', v.ka, 'hy', v.hy), v.badge, v.ord
  from (values
  ('KRI-FOOD-PIZZA-PEPPERONI-650','Пицца Пепперони 40 см, 650 г','Томатный соус, моцарелла, пепперони','pizza-pepperoni-650',30,'პიცა პეპერონი 40 სმ, 650 გ','Պիցցա Պեպպերոնի 40 սմ, 650 գ',null,10),
  ('KRI-FOOD-PIZZA-ASSORTI-700','Пицца Ассорти 40 см, 700 г','Томатный соус, моцарелла, ветчина, оливки','pizza-assorti-700',30,'პიცა ასორტი 40 სმ, 700 გ','Պիցցա Ասորտի 40 սմ, 700 գ',null,20),
  ('KRI-FOOD-PIZZA-MARGHERITA-600','Пицца Маргарита 40 см, 600 г','Томатный соус, моцарелла, базилик','pizza-margherita-600',25,'პიცა მარგარიტა 40 სმ, 600 გ','Պիցցա Մարգարիտա 40 սմ, 600 գ',null,30),
  ('KRI-FOOD-KHACH-ROYAL-900','Хачапури Королевский 40 см, 900 г','Круглый, 40 см','khachapuri-royal-900',30,'სამეფო ხაჭაპური 40 სმ, 900 გ','Թագավորական խաչապուրի 40 սմ, 900 գ',null,40),
  ('KRI-FOOD-KHACH-IMERULI-820','Хачапури Имеретинский 40 см, 820 г','Круглый, сыр внутри, 40 см','khachapuri-imeruli-820',25,'იმერული ხაჭაპური 40 სმ, 820 გ','Իմերական խաչապուրի 40 սմ, 820 գ',null,50),
  ('KRI-FOOD-LAHMAJO-MEAT-200','Ламаджо с мясом 200 г','Тонкая лепёшка с мясным фаршем','lahmajo-meat-200',7,'ლაჰმაჯო ხორცით 200 გ','Լահմաջո մսով 200 գ',null,60),
  ('KRI-FOOD-LAHMAJO-CHEESE-200','Ламаджо с сыром 200 г','Тонкая лепёшка с мясным фаршем и сыром','lahmajo-meat-200',8,'ლაჰმაჯო ყველით 200 გ','Լահմաջո պանրով 200 գ','С СЫРОМ',70)
  ) v(sku, name, descr, img, sell, ka, hy, badge, ord)
  join public.categories c on c.slug = 'pizza'
 where not exists (select 1 from public.products p where p.sku = v.sku);

-- Upsell: food is the FIRST thing offered after beer; after strong drinks right after meat/salty snacks.
-- After food: beer to wash it down, then drinks, then snacks for later («пиццу съели, пивом запили, ещё закусок взяли»).
insert into public.upsell_rules(source_category_id, target_category_id, priority, active)
select s.id, t.id, v.prio, true
  from (values ('draft','pizza',5),('vodka','pizza',12),('strong','pizza',12),('whisky','pizza',25),('brandy','pizza',35),('wine','pizza',40),
               ('pizza','draft',10),('pizza','soft-drinks',20),('pizza','chips',30),('pizza','nuts',40),('pizza','vodka',50)) v(src, tgt, prio)
  join public.categories s on s.slug = v.src
  join public.categories t on t.slug = v.tgt
 where not exists (select 1 from public.upsell_rules u where u.source_category_id = s.id and u.target_category_id = t.id and u.source_product_id is null);

-- Рывки with food, shown first (sort 1–7). Portions: 2 L beer per person (the norm of all existing Рывки);
-- a 40 cm pizza (~8 slices, 600–700 g) per 2 people as the evening's main food (3–4 slices each);
-- lahmajo 2 per person; khachapuri ~300–430 g per person; 0.5 L strong per 3–4 people (125–170 ml each).
with v(name, descr, badge, serves, discount, ord) as (values
  ('Итальянец на двоих',      'Пепперони 40 см и 4 л пива — полпиццы и 2 л на каждого', 'ИТАЛИЯ',   'НА 2 ЧЕЛОВЕКА', 3.00, 1),
  ('Ереванский дворик',              '4 ламаджо и 4 л пива — по 2 ламаджо и 2 л на каждого',   'АРМЕНИЯ',  'НА 2 ЧЕЛОВЕКА', 3.00, 2),
  ('Генацвале',   'Королевский хачапури и 6 л пива — по 300 г и 2 л на каждого','ГРУЗИЯ','НА 3 ЧЕЛОВЕКА', 5.00, 3),
  ('Сицилийская семья',     '2 пиццы, 8 л пива и закуски на после пиццы',             'КОМПАНИЯ', 'НА 4 ЧЕЛОВЕКА', 9.00, 4),
  ('Ереван не спит',   'Водка 0,5 л, 6 ламаджо, корнишоны и вода',              'КРЕПКО',   'НА 3 ЧЕЛОВЕКА', 6.00, 5),
  ('Тост за Кавказ',          'ARARAT, два хачапури и компот',                          'КРЕПКО',   'НА 4 ЧЕЛОВЕКА', 7.50, 6),
  ('Ёрш по-итальянски',               'Водка, 6 л пива и две пиццы на компанию',               'КРЕПКО',   'НА 4 ЧЕЛОВЕКА', 9.00, 7)
)
insert into public.bundles(name, description, badge_text, serves_label, discount_type, discount_value, sort_order, active, min_margin_percent)
select v.name, v.descr, v.badge, v.serves, 'FIXED', v.discount, v.ord, true, 10 from v
 where not exists (select 1 from public.bundles b where b.name = v.name);

with spec(bundle, sku, qty) as (values
  ('Итальянец на двоих','KRI-FOOD-PIZZA-PEPPERONI-650',1),('Итальянец на двоих','DAV-BEER-005',4),
  ('Ереванский дворик','KRI-FOOD-LAHMAJO-MEAT-200',2),('Ереванский дворик','KRI-FOOD-LAHMAJO-CHEESE-200',2),('Ереванский дворик','DAV-BEER-003',4),
  ('Генацвале','KRI-FOOD-KHACH-ROYAL-900',1),('Генацвале','DAV-BEER-004',6),
  ('Сицилийская семья','KRI-FOOD-PIZZA-PEPPERONI-650',1),('Сицилийская семья','KRI-FOOD-PIZZA-ASSORTI-700',1),('Сицилийская семья','DAV-BEER-001',8),
  ('Сицилийская семья','KRI-CHIPS-LAYS-CLASSIC-117',1),('Сицилийская семья','KRI-NUTS-POLA-PEANUT-125',1),
  ('Ереван не спит','KRI-VOD-TSAR-ORIG-050',1),('Ереван не спит','KRI-FOOD-LAHMAJO-MEAT-200',3),('Ереван не спит','KRI-FOOD-LAHMAJO-CHEESE-200',3),
  ('Ереван не спит','KRI-PICKLE-CORNICH-370',1),('Ереван не спит','KRI-WATER-NABEGLAVI-100',1),
  ('Тост за Кавказ','KRI-COG-ARA-003-050',1),('Тост за Кавказ','KRI-FOOD-KHACH-IMERULI-820',1),('Тост за Кавказ','KRI-FOOD-KHACH-ROYAL-900',1),('Тост за Кавказ','KRI-SOFT-ARARAT-COMP-100',1),
  ('Ёрш по-итальянски','KRI-VOD-UGL-050',1),('Ёрш по-итальянски','DAV-BEER-001',6),('Ёрш по-итальянски','KRI-FOOD-PIZZA-PEPPERONI-650',1),('Ёрш по-итальянски','KRI-FOOD-PIZZA-ASSORTI-700',1)
)
insert into public.bundle_items(bundle_id, product_id, quantity)
select b.id, p.id, s.qty from spec s
  join public.bundles b on b.name = s.bundle
  join public.products p on p.sku = s.sku and p.active
 where not exists (select 1 from public.bundle_items bi where bi.bundle_id = b.id and bi.product_id = p.id);

update public.bundles b set price = x.bundle_price, compare_at_price = x.regular_total
  from private.bundle_calc(null) x where x.bundle_id = b.id and b.sort_order between 1 and 7;
