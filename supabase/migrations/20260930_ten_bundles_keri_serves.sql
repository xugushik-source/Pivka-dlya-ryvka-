-- Approved 2026-09-30: ten Рывки from affordable to premium, "for how many people" label, Keri name, upsell order.

-- 1. Keri (owner's spelling). SKU, price, photo, category, minimum and step unchanged.
update public.products
   set name = 'Keri', name_i18n = '{"ru":"Keri","ka":"ქერი","hy":"Քեռի"}'::jsonb, updated_at = now()
 where sku = 'DAV-BEER-001';

-- 2. "НА 2 / НА 4 / НА МАТЧ" label on the card.
alter table public.bundles add column if not exists serves_label text;

drop function if exists public.list_bundle_offers(uuid);
create function public.list_bundle_offers(p_city uuid default null)
returns table(id uuid, name text, description text, badge_text text, serves_label text, image_url text, sort_order integer,
              featured boolean, discount_type text, discount_value numeric, regular_total numeric, price numeric,
              savings numeric, savings_percent numeric, available boolean, unavailable_reason text, items jsonb)
language sql stable security definer set search_path to ''
as $$
  select b.id, b.name, b.description, b.badge_text, b.serves_label, b.image_url, b.sort_order, b.featured,
         b.discount_type, b.discount_value, x.regular_total, x.bundle_price, x.savings, x.savings_percent,
         x.available, x.unavailable_reason, x.items
  from public.bundles b join private.bundle_calc(p_city) x on x.bundle_id = b.id
  where b.active
  order by b.sort_order, b.name
$$;
grant execute on function public.list_bundle_offers(uuid) to anon, authenticated;

-- 3. Ten Рывки. Existing rows keep their ids (social orders reference them); "ЁРШ" becomes "ЁРШ для скромников".
update public.bundles set name = 'ЁРШ для скромников' where name = 'ЁРШ';

with v(name, descr, badge, serves, discount, ord) as (values
  ('Рывок на двоих',      'Пиво, рыба и сыр — вечер на двоих',            'ВЫГОДНО',  'НА 2 ЧЕЛОВЕКА',      3.00,  10),
  ('Вечер у телика',      'Пиво, чипсы и орешки под сериал',              'УЮТНО',    'НА 2 ЧЕЛОВЕКА',      2.90,  20),
  ('ЁРШ для скромников',  'Водка без пива — деньги на ветер',             'КРЕПКО',   'НА 2 ЧЕЛОВЕКА',      3.50,  30),
  ('Рыбный рывок',        'Для тех, кто пьёт пиво с рыбой',               'КЛАССИКА', 'НА 3 ЧЕЛОВЕКА',      5.00,  40),
  ('Собрались вчетвером', 'Всего поровну на компанию из четырёх',         'КОМПАНИЯ', 'НА 4 ЧЕЛОВЕКА',      7.40,  50),
  ('Большой ЁРШ',         'Fortuna, 6 л пива и закуска на всех',          'КРЕПКО',   'НА 4 ЧЕЛОВЕКА',      7.95,  60),
  ('Футбольный рывок',    'Матч, 8 л пива и закуски на оба тайма',        'ФУТБОЛ',   'НА МАТЧ · 4–6 ЧЕЛОВЕК', 7.80, 70),
  ('Коньячный вечер',     'ARARAT 5 лет, колбаса и сыр',                  'ПРЕМИУМ',  'НА 4 ЧЕЛОВЕКА',      7.95,  80),
  ('Царская трапеза',     'Царская Золотая, пиво и богатый стол',         'ПРЕМИУМ',  'НА 4–6 ЧЕЛОВЕК',     11.40, 90),
  ('Большой рывок',       '12 л пива и закуски на большую компанию',      'КОМПАНИЯ', 'НА 8 ЧЕЛОВЕК',       12.90, 100)
)
insert into public.bundles(name, description, badge_text, serves_label, discount_type, discount_value, sort_order, active)
select v.name, v.descr, v.badge, v.serves, 'FIXED', v.discount, v.ord, true from v
 where not exists (select 1 from public.bundles b where b.name = v.name);

with v(name, descr, badge, serves, discount, ord) as (values
  ('Рывок на двоих',      'Пиво, рыба и сыр — вечер на двоих',            'ВЫГОДНО',  'НА 2 ЧЕЛОВЕКА',      3.00,  10),
  ('Вечер у телика',      'Пиво, чипсы и орешки под сериал',              'УЮТНО',    'НА 2 ЧЕЛОВЕКА',      2.90,  20),
  ('ЁРШ для скромников',  'Водка без пива — деньги на ветер',             'КРЕПКО',   'НА 2 ЧЕЛОВЕКА',      3.50,  30),
  ('Рыбный рывок',        'Для тех, кто пьёт пиво с рыбой',               'КЛАССИКА', 'НА 3 ЧЕЛОВЕКА',      5.00,  40),
  ('Собрались вчетвером', 'Всего поровну на компанию из четырёх',         'КОМПАНИЯ', 'НА 4 ЧЕЛОВЕКА',      7.40,  50),
  ('Большой ЁРШ',         'Fortuna, 6 л пива и закуска на всех',          'КРЕПКО',   'НА 4 ЧЕЛОВЕКА',      7.95,  60),
  ('Футбольный рывок',    'Матч, 8 л пива и закуски на оба тайма',        'ФУТБОЛ',   'НА МАТЧ · 4–6 ЧЕЛОВЕК', 7.80, 70),
  ('Коньячный вечер',     'ARARAT 5 лет, колбаса и сыр',                  'ПРЕМИУМ',  'НА 4 ЧЕЛОВЕКА',      7.95,  80),
  ('Царская трапеза',     'Царская Золотая, пиво и богатый стол',         'ПРЕМИУМ',  'НА 4–6 ЧЕЛОВЕК',     11.40, 90),
  ('Большой рывок',       '12 л пива и закуски на большую компанию',      'КОМПАНИЯ', 'НА 8 ЧЕЛОВЕК',       12.90, 100)
)
update public.bundles b set description = v.descr, badge_text = v.badge, serves_label = v.serves,
       discount_type = 'FIXED', discount_value = v.discount, sort_order = v.ord, active = true, updated_at = now()
  from v where b.name = v.name;

delete from public.bundle_items bi using public.bundles b
 where b.id = bi.bundle_id and b.name in ('Рывок на двоих','Вечер у телика','ЁРШ для скромников','Рыбный рывок','Собрались вчетвером',
                                           'Большой ЁРШ','Футбольный рывок','Коньячный вечер','Царская трапеза','Большой рывок');
with spec(bundle, sku, qty) as (values
  ('Рывок на двоих','DAV-BEER-005',4),('Рывок на двоих','DAV-FISH-SHAM-001',1),('Рывок на двоих','DAV-FISH-TUNA-030',1),('Рывок на двоих','KRI-CHEESE-STICK-100',1),
  ('Вечер у телика','DAV-BEER-003',4),('Вечер у телика','KRI-CHIPS-LAYS-PAPRIKA-155',1),('Вечер у телика','KRI-NUTS-POLA-PEANUT-125',1),('Вечер у телика','KRI-MEAT-JERKY-CHK-030',1),
  ('ЁРШ для скромников','KRI-VOD-UGL-050',1),('ЁРШ для скромников','DAV-BEER-001',2),('ЁРШ для скромников','KRI-MEAT-JERKY-PORK-030',1),('ЁРШ для скромников','KRI-MEAT-JERKY-CHK-030',1),('ЁРШ для скромников','KRI-WATER-NABEGLAVI-050',1),
  ('Рыбный рывок','DAV-BEER-004',6),('Рыбный рывок','DAV-FISH-GEN-375',1),('Рыбный рывок','DAV-FISH-SHAM-001',1),('Рыбный рывок','DAV-FISH-TUNA-030',1),
  ('Собрались вчетвером','DAV-BEER-002',8),('Собрались вчетвером','DAV-FISH-STR-500',1),('Собрались вчетвером','DAV-CHEESE-MIX-450',1),('Собрались вчетвером','KRI-CHIPS-LAYS-CLASSIC-117',1),('Собрались вчетвером','KRI-NUTS-POLA-PEANUT-125',1),
  ('Большой ЁРШ','KRI-VOD-FOR-PREM-050',1),('Большой ЁРШ','DAV-BEER-005',6),('Большой ЁРШ','DAV-FISH-GEN-375',1),('Большой ЁРШ','DAV-CHEESE-MIX-450',1),('Большой ЁРШ','KRI-NUTS-POLA-PEANUT-125',1),('Большой ЁРШ','KRI-WATER-NABEGLAVI-100',1),
  ('Футбольный рывок','DAV-BEER-001',8),('Футбольный рывок','KRI-CHIPS-LAYS-BURGER-100',1),('Футбольный рывок','KRI-CHIPS-LAYS-PIZZA-100',1),('Футбольный рывок','KRI-NUTS-POLA-PEANUT-125',2),('Футбольный рывок','KRI-MEAT-JERKY-PORK-030',2),('Футбольный рывок','KRI-MEAT-JERKY-CHK-030',2),('Футбольный рывок','KRI-SNACK-MARTIN-150',1),
  ('Коньячный вечер','KRI-COG-ARA-005-050',1),('Коньячный вечер','KRI-MEAT-GYUMRI-600',1),('Коньячный вечер','DAV-CHEESE-MIX-450',1),('Коньячный вечер','KRI-NUTS-POLA-PEANUT-125',1),('Коньячный вечер','KRI-SOFT-ARARAT-COMP-100',1),
  ('Царская трапеза','KRI-VOD-TSAR-GOLD-050',1),('Царская трапеза','DAV-BEER-001',6),('Царская трапеза','DAV-FISH-GEN-525',1),('Царская трапеза','KRI-MEAT-GYUMRI-600',1),('Царская трапеза','DAV-CHEESE-MIX-450',1),('Царская трапеза','KRI-NUTS-POLA-PEANUT-125',1),('Царская трапеза','KRI-CHIPS-LAYS-STEAK-140',1),
  ('Большой рывок','DAV-BEER-004',6),('Большой рывок','DAV-BEER-003',6),('Большой рывок','DAV-FISH-GEN-525',1),('Большой рывок','DAV-FISH-STR-500',1),('Большой рывок','KRI-MEAT-GYUMRI-600',1),('Большой рывок','DAV-CHEESE-MIX-450',1),('Большой рывок','KRI-CHIPS-LAYS-CHEESE-140',1),('Большой рывок','KRI-CHIPS-LAYS-STEAK-140',1)
)
insert into public.bundle_items(bundle_id, product_id, quantity)
select b.id, p.id, s.qty from spec s
join public.bundles b on b.name = s.bundle
join public.products p on p.sku = s.sku and p.active;

update public.bundles b set price = x.bundle_price, compare_at_price = x.regular_total
  from private.bundle_calc(null) x where x.bundle_id = b.id;

-- 4. After beer: fish → meat/Jerky → cheese → nuts → chips → seeds/snacks.
update public.upsell_rules u set priority = v.prio
  from (values ('fish',10),('meat-snacks',20),('cheese',30),('nuts',40),('chips',50),('snacks',60)) v(slug, prio),
       public.categories s, public.categories t
 where s.slug = 'draft' and u.source_category_id = s.id and t.slug = v.slug and u.target_category_id = t.id;
