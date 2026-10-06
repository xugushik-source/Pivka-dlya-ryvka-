-- Owner, 2026-10-06: pizza, khachapuri and lahmajo come from a separate supplier — «Мндо».
-- Its own supplier group in every order → its own Telegram message once Мндо connects the bot (Admin → Telegram).
-- last_cost stays empty until the purchase prices are known.
insert into public.suppliers(name, note, active)
select 'Мндо', 'Пицца, хачапури, ламаджо. Не показывать клиентам.', true
 where not exists (select 1 from public.suppliers where name = 'Мндо');

insert into public.supplier_products(supplier_id, product_id, supplier_sku, last_cost, lead_days, preferred)
select s.id, p.id, p.sku, null, 0, true
  from public.suppliers s join public.products p on p.sku like 'KRI-FOOD-%'
 where s.name = 'Мндо'
   and not exists (select 1 from public.supplier_products x where x.supplier_id = s.id and x.product_id = p.id);
