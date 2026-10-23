-- Решение владельца 23.10.2026: чистыми не меньше 15% с заказа.
-- Курьер 4 ₾ съедает ~8% на заказе 50 ₾, поэтому маржа на каждом товаре — не ниже 25%.
-- 1) Возвращаем цены до снижения 22.10. 2) Поднимаем всё, что ниже 25% маржи
--    (вверх до 0,5 ₾, еда ресторана и пекарни — до целого лари). 3) Готовые рывки выключаем все.

create table if not exists private._price_backup_20261023 as
  select id, sale_price from public.products;

update public.products p set sale_price = b.sale_price
from private._price_backup_20261022 b where b.id = p.id and p.sale_price <> b.sale_price;

with sup as (
  select p.id,
    (select s.name from public.supplier_products sp join public.suppliers s on s.id = sp.supplier_id
      where sp.product_id = p.id order by sp.preferred desc limit 1) as s
  from public.products p
), fl as (
  select p.id,
    case when sup.s in ('Мангал (ресторан)', 'Мндо') then ceil(p.purchase_price / 0.75)
         else ceil(p.purchase_price / 0.75 * 2) / 2 end as floor_p
  from public.products p join sup on sup.id = p.id
  where p.active and p.purchase_price > 0
)
update public.products p set sale_price = fl.floor_p
from fl where fl.id = p.id and p.sale_price < fl.floor_p;

update public.bundles set active = false where active;
