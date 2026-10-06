-- Owner, 2026-10-06: Мндо's kitchen times. Pizza and khachapuri 15 min; lahmajo 10 min per 5 pieces (6–10 → 20 min…).
-- One oven: different kinds go one after another, so the times add up (pizza + 6 lahmajo = 15 + 20 = 35 min).
-- The whole order is picked up together at that time: drinks are prepared for it and kept cold (Telegram bot).
-- Replaces suppliers.prep_minutes (a flat 30 min) added earlier the same day.
alter table public.products add column if not exists prep_minutes int check (prep_minutes is null or prep_minutes between 1 and 240);
alter table public.products add column if not exists prep_batch int check (prep_batch is null or prep_batch between 1 and 100);
comment on column public.products.prep_minutes is 'Kitchen minutes for this kind of hot food (null = ready at once).';
comment on column public.products.prep_batch is 'Pieces per oven batch: prep_minutes per started batch (null = any quantity in one batch).';

update public.products p set prep_minutes = 15, prep_batch = null
  from public.categories c where c.id = p.category_id and c.slug = 'pizza' and p.sku not like 'KRI-FOOD-LAHMAJO-%';
update public.products set prep_minutes = 10, prep_batch = 5 where sku like 'KRI-FOOD-LAHMAJO-%';

alter table public.suppliers drop column if exists prep_minutes;

-- The pizzeria's own photo of lahmajo with cheese (the «С СЫРОМ» badge was only a stand-in for it).
update public.products
   set image_url = 'https://xugushik-source.github.io/Pivka-dlya-ryvka-/assets/products/standard/lahmajo-cheese-200.jpg?v=20261007i',
       badge_text = null, updated_at = now()
 where sku = 'KRI-FOOD-LAHMAJO-CHEESE-200';
