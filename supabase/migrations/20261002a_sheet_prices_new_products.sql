-- Owner's sheet "Пивка для рывка — цены (закуп / продажа)", 2026-10-02: the sheet is the price list ("сайт = таблица").
-- 1) purchase and sale prices of every product in the sheet; 2) 19 new products (Кристалл): NOY 3/5/10 (5 ₾ under ARARAT
-- of the same volume, purchase likewise), sausages, smoked chicken, nuts, pickles, seafood, frozen pelmeni/khinkali,
-- napkins and cups; 3) two new sections (Полуфабрикаты, Расходники); pickles go to the existing «Соленья и закуски»,
-- seafood to the existing «Морепродукты»; 4) upsell rules for them; 5) bundle prices recomputed.

with v(sku, buy, sell) as (values
('DAV-BEER-003',5,7),
('DAV-BEER-005',5,7),
('DAV-BEER-001',6,8),
('DAV-BEER-002',5,7),
('DAV-BEER-004',5,7),
('KRI-MEAT-GYUMRI-600',15,19),
('KRI-MEAT-JERKY-CHK-030',2.5,3.5),
('KRI-MEAT-JERKY-MIX-060',4.5,7),
('KRI-MEAT-JERKY-PORK-030',2.5,3.5),
('KRI-MEAT-SUD-190',12.5,16),
('KRI-MEAT-SUD-230',14,18),
('KRI-ENERGY-BUM-FIRE-033',1.7,2.5),
('KRI-ENERGY-BURN-025',2.3,3.5),
('KRI-ENERGY-REDBULL-025',4.3,5.5),
('KRI-LIQ-JAG-050',35,40),
('KRI-VOD-ABS-050',25,30),
('KRI-VOD-FOR-PREM-050',18,22),
('KRI-VOD-FOR-MOON-050',25,29),
('KRI-VOD-TCH-050',25,30),
('KRI-VOD-UGL-050',17,20),
('KRI-VOD-UGL-070',21,25),
('KRI-VOD-TSAR-GOLD-050',25,30),
('KRI-VOD-TSAR-ORIG-050',18,23),
('KRI-VOD-CHIST-ROSY-050',60,70),
('KRI-WHI-JD-050',60,70),
('KRI-COG-ARA-003-050',35,40),
('KRI-COG-ARA-005-050',50,60),
('KRI-COG-ARA-AKH-050',95,110),
('KRI-WINE-KC-WHITE-075',20,25),
('KRI-VER-MAR-BIA-050',25,29),
('KRI-WINE-SM-SAP-075',13,16),
('KRI-WINE-SM-RK-075',12,15),
('KRI-WINE-MUKUZANI-075',23,28),
('KRI-WINE-SAPERAVI-ROSE-075',13.5,18),
('KRI-WINE-SAPERAVI-075',15,19),
('DAV-FISH-GEN-375',13,16),
('DAV-FISH-GEN-525',18,22),
('DAV-FISH-SIG-001',7,9),
('DAV-FISH-STR-500',15,19),
('DAV-FISH-STR-030',5,7),
('DAV-FISH-TUNA-030',5,7),
('DAV-FISH-SHAM-001',5,7),
('DAV-CHEESE-MIX-450',10,14),
('KRI-CHEESE-STICK-100',3,4),
('KRI-NUTS-POLA-PEANUT-125',2.95,4),
('KRI-CHIPS-LAYS-BURGER-100',4.95,6),
('KRI-CHIPS-LAYS-PIZZA-100',4.95,6),
('KRI-CHIPS-LAYS-CLASSIC-117',5.45,7),
('KRI-CHIPS-LAYS-PAPRIKA-155',5.45,7),
('KRI-CHIPS-LAYS-STEAK-140',5.45,7),
('KRI-CHIPS-LAYS-CHEESE-140',5.45,7),
('KRI-SNACK-MARTIN-SMALL',1.5,2),
('KRI-SNACK-MARTIN-080',2,2.5),
('KRI-SNACK-MARTIN-150',4,5),
('KRI-SNACK-MARTIN-250',6,8),
('KRI-SOFT-ARARAT-075',5.5,8),
('KRI-SOFT-ARARAT-PREM-097',5,7.5),
('KRI-SOFT-ARARAT-COMP-100',6,7.5),
('KRI-SOFT-BOOM-100',1.2,2),
('KRI-JUICE-CAPPY-ASST',2.5,3.5),
('KRI-SOFT-COLA-050',1.7,2.5),
('KRI-SOFT-FANTA-050',1.7,2.5),
('KRI-SOFT-LAIMON-050',2.5,3),
('KRI-WATER-LIKANI-060',1.3,2),
('KRI-WATER-LIKANI-100',1.8,2.5),
('KRI-SOFT-MIRINDA-050',1.5,2),
('KRI-SOFT-MIRINDA-OR-050',1.5,2),
('KRI-SOFT-MOONWALKER-024',3.5,5),
('KRI-WATER-NABEGLAVI-050',1.5,2),
('KRI-WATER-NABEGLAVI-100',2,3),
('KRI-SOFT-PEPSI-050',1.5,2),
('KRI-SOFT-SNO-050',0.8,1.5),
('KRI-SOFT-SNO-100',1.2,1.5),
('KRI-SOFT-SPRITE-050',1.7,2.5))
update public.products p set purchase_price = v.buy, sale_price = v.sell, updated_at = now()
  from v where p.sku = v.sku and (p.purchase_price, p.sale_price) is distinct from (v.buy, v.sell);

insert into public.categories(slug, name, emoji, sort_order, active)
select * from (values ('frozen', 'Полуфабрикаты', '🥟', 45, true), ('supplies', 'Расходники', '🧻', 90, true)) x(slug, name, emoji, sort_order, active)
 where not exists (select 1 from public.categories c where c.slug = x.slug);
update public.categories set emoji = '🥒' where slug = 'salty' and emoji is null;

insert into public.products(sku, category_id, name, description, image_url, unit, sale_price, purchase_price, stock_quantity,
                            minimum_quantity, quantity_step, active, supply_mode, name_i18n)
select v.sku, c.id, v.name, v.descr, 'https://xugushik-source.github.io/Pivka-dlya-ryvka-/assets/products/standard/' || v.img || '.jpg?v=20261002', 'piece', v.sell, v.buy, 0, 1, 1, true, 'SUPPLIER',
       jsonb_build_object('ru', v.name, 'ka', v.ka, 'hy', v.hy)
  from (values
  ('KRI-COG-NOY-003-050','brandy','NOY 3 года 0,5 л','40%, выдержка 3 года','noy-3-050',30,35,'NOY 3 წლიანი 0,5 ლ','NOY 3 տարեկան 0,5 լ'),
  ('KRI-COG-NOY-005-050','brandy','NOY 5 лет 0,5 л','40%, выдержка 5 лет','noy-5-050',45,55,'NOY 5 წლიანი 0,5 ლ','NOY 5 տարեկան 0,5 լ'),
  ('KRI-COG-NOY-010-050','brandy','NOY 10 лет 0,5 л','40%, выдержка 10 лет','noy-10-050',90,105,'NOY 10 წლიანი 0,5 ლ','NOY 10 տարեկան 0,5 լ'),
  ('KRI-SUPPLY-NAPKIN-2525','supplies','Салфетки 25×25',null,'napkins-25',1,2,'ხელსახოცები 25×25','Անձեռոցիկներ 25×25'),
  ('KRI-SUPPLY-NAPKIN-3030','supplies','Салфетки 30×30',null,'napkins-30',2.5,3,'ხელსახოცები 30×30','Անձեռոցիկներ 30×30'),
  ('KRI-SUPPLY-CUPS-PAPER-050','supplies','Стаканы бумажные 50 шт',null,'cups-paper-050',2.5,3,'ქაღალდის ჭიქები 50 ც','Թղթե բաժակներ 50 հատ'),
  ('KRI-MEAT-SAUS-LIDER-500','meat-snacks','Сосиски «Лидер Фуд» 500 г','Leader Food, Грузия','sausages-leader-500',15,19,'სოსისები Leader Food 500 გ','Նրբերշիկներ Leader Food 500 գ'),
  ('KRI-MEAT-SAUS-ATENK','meat-snacks','Сосиски «Атенк»',null,'atenk-sausages',8.5,14,'სოსისები ATENK','Նրբերշիկներ ATENK'),
  ('KRI-MEAT-CHICKEN-SMOKED-1000','meat-snacks','Варёно-копчёная курица 1 кг','Biela, Армения','chicken-smoked-1000',17,22,'Biela მოხარშულ-შებოლილი ქათამი 1 კგ','Biela եփած-ապխտած հավ 1 կգ'),
  ('KRI-NUTS-MARTIN-ALMOND-100','nuts','Миндаль от Мартина 100 г',null,'ot-martina-almond-100',5,8,'Ot Martina ნუში 100 გ','Ot Martina նուշ 100 գ'),
  ('KRI-NUTS-MARTIN-PISTA-080','nuts','Фисташки от Мартина 80 г',null,'ot-martina-pistachio-080',5.5,8,'Ot Martina ფისტა 80 გ','Ot Martina պիստակ 80 գ'),
  ('KRI-FROZEN-PELMENI-800','frozen','Пельмени 800 г','Замороженные','pelmeni-800',8,10,'პელმენი 800 გ','Պելմենի 800 գ'),
  ('KRI-FROZEN-KHINKALI-800','frozen','Хинкали 800 г','Замороженные','khinkali-800',8,10,'ხინკალი 800 გ','Խինկալի 800 գ'),
  ('KRI-PICKLE-BUTEN-710','salty','Бутень маринованный 710 г',null,'buten-pickled-710',11,15,'მარინირებული ბუტენი 710 გ','Մարինացված շուշան 710 գ'),
  ('KRI-PICKLE-CORNICH-370','salty','Корнишоны 370 г',null,'cornichons-370',5,7,'კორნიშონები 370 გ','Կորնիշոններ 370 գ'),
  ('KRI-PICKLE-CORN-370','salty','Кукуруза маринованная 370 г',null,'corn-pickled-370',5,7,'მარინირებული სიმინდი 370 გ','Մարինացված եգիպտացորեն 370 գ'),
  ('KRI-SEAFOOD-SHRIMP-1620','seafood','Креветки 16/20','Замороженные','shrimp-16-20',40,50,'კრევეტები 16/20','Կրևետներ 16/20'),
  ('KRI-SEAFOOD-SHRIMP-7190','seafood','Креветки 71/90','Замороженные','shrimp-71-90',30,40,'კრევეტები 71/90','Կրևետներ 71/90'),
  ('KRI-SEAFOOD-MUSSELS-900','seafood','Мидии 200/300, 900 г','Замороженные','mussels-900',40,50,'მიდიები 200/300, 900 გ','Միդիաներ 200/300, 900 գ')
  ) v(sku, cat, name, descr, img, buy, sell, ka, hy)
  join public.categories c on c.slug = v.cat
 where not exists (select 1 from public.products p where p.sku = v.sku);

-- Every new product comes from Кристалл (SKU prefix KRI-).
insert into public.supplier_products(supplier_id, product_id, supplier_sku, last_cost, lead_days, preferred)
select s.id, p.id, p.sku, p.purchase_price, 0, true
  from public.products p cross join (select id from public.suppliers where name = 'Кристалл') s
 where p.sku in ('KRI-COG-NOY-003-050', 'KRI-COG-NOY-005-050', 'KRI-COG-NOY-010-050', 'KRI-SUPPLY-NAPKIN-2525', 'KRI-SUPPLY-NAPKIN-3030', 'KRI-SUPPLY-CUPS-PAPER-050', 'KRI-MEAT-SAUS-LIDER-500', 'KRI-MEAT-SAUS-ATENK', 'KRI-MEAT-CHICKEN-SMOKED-1000', 'KRI-NUTS-MARTIN-ALMOND-100', 'KRI-NUTS-MARTIN-PISTA-080', 'KRI-FROZEN-PELMENI-800', 'KRI-FROZEN-KHINKALI-800', 'KRI-PICKLE-BUTEN-710', 'KRI-PICKLE-CORNICH-370', 'KRI-PICKLE-CORN-370', 'KRI-SEAFOOD-SHRIMP-1620', 'KRI-SEAFOOD-SHRIMP-7190', 'KRI-SEAFOOD-MUSSELS-900')
   and not exists (select 1 from public.supplier_products sp where sp.product_id = p.id);
update public.supplier_products sp set last_cost = p.purchase_price
  from public.products p where p.id = sp.product_id and sp.last_cost is distinct from p.purchase_price;

-- «К этому обычно берут»: pickles to vodka/strong, seafood to beer, pelmeni/khinkali to vodka — and back.
insert into public.upsell_rules(source_category_id, target_category_id, priority, active)
select s.id, t.id, v.prio, true
  from (values ('vodka','salty',15), ('strong','salty',15), ('salty','vodka',10), ('salty','draft',20),
               ('draft','seafood',35), ('seafood','draft',10), ('seafood','wine',20),
               ('frozen','vodka',10), ('frozen','salty',20), ('vodka','frozen',30)) v(src, tgt, prio)
  join public.categories s on s.slug = v.src join public.categories t on t.slug = v.tgt
 where not exists (select 1 from public.upsell_rules r where r.source_category_id = s.id and r.target_category_id = t.id);

update public.bundles b set price = x.bundle_price, compare_at_price = x.regular_total from private.bundle_calc(null) x where x.bundle_id = b.id;
