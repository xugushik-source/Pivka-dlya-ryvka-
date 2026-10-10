-- Owner, 2026-10-10: «МАДО» — ATENK distributor in Akhalkalaki. Created now so it can connect the bot (Admin → Telegram).
-- ATENK goods (Сосиски «Атенк», колбаса «Гюмри») still come from Кристалл; they move to МАДО when the owner says so:
--   update public.supplier_products sp set supplier_id = (select id from public.suppliers where name = 'МАДО')
--     from public.products p where p.id = sp.product_id and p.sku in ('KRI-MEAT-SAUS-ATENK', 'KRI-MEAT-GYUMRI-600');
insert into public.suppliers(name, note, active)
select 'МАДО', 'Дистрибьютор ATENK: сосиски «Атенк», колбаса «Гюмри». Не показывать клиентам.', true
 where not exists (select 1 from public.suppliers where name = 'МАДО');
