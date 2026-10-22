-- Минимальные цены от закупки (решение владельца 22.10.2026).
-- Цена = закупка + наценка группы, вверх до 0,5 ₾ (еда — до целого лари). Цены только снижаются.
-- Скидки наборов урезаются так, чтобы маржа набора была не ниже 15%.

create table if not exists private._price_backup_20261022 as
  select id, sale_price from public.products;
create table if not exists private._bundle_disc_backup_20261022 as
  select id, discount_value, active from public.bundles;

with sup as (
  select p.id, c.slug,
    (select s.name from public.supplier_products sp join public.suppliers s on s.id = sp.supplier_id
      where sp.product_id = p.id order by sp.preferred desc limit 1) as s
  from public.products p join public.categories c on c.id = p.category_id
), rule as (
  select p.id, p.sale_price, p.purchase_price,
    case
      when sup.s in ('Мангал (ресторан)', 'Мндо') then ceil(p.purchase_price * 1.20)
      when sup.slug in ('draft', 'beer') then ceil(p.purchase_price * 1.30 * 2) / 2
      when sup.s = 'МАДО' then ceil(p.purchase_price * 1.35 * 2) / 2
      when sup.slug in ('brandy', 'vodka', 'whisky', 'wine', 'strong', 'rum', 'gin', 'tequila') then ceil(p.purchase_price * 1.15 * 2) / 2
      when sup.s = 'Пивная компания Давида' then ceil(p.purchase_price * 1.25 * 2) / 2
      when sup.slug = 'supplies' then null
      else ceil(p.purchase_price * 1.20 * 2) / 2
    end as newp
  from public.products p join sup on sup.id = p.id
  where p.active and p.purchase_price > 0
)
update public.products p set sale_price = rule.newp
from rule where rule.id = p.id and rule.newp is not null and rule.newp < p.sale_price;

-- Оставляем 7 самых выгодных наборов, остальные выключаем.
update public.bundles set active = false
where active and name not in ('Рывок на двоих','Футбольный рывок','Ереванский дворик','Рыбный рывок',
  'Собрались вчетвером','Вечер у телика','Трое у мангала');

with b as (
  select b.id, sum(p.sale_price * bi.quantity) reg, sum(p.purchase_price * bi.quantity) cost
  from public.bundles b
  join public.bundle_items bi on bi.bundle_id = b.id
  join public.products p on p.id = bi.product_id
  where b.discount_type = 'FIXED'
  group by b.id
)
update public.bundles x set discount_value = greatest(0, least(x.discount_value, floor((b.reg - b.cost / 0.85) * 10) / 10))
from b where b.id = x.id;

update public.bundles b set price = x.bundle_price, compare_at_price = x.regular_total
from private.bundle_calc(null) x where x.bundle_id = b.id;

-- Курьер получает 4 ₾ за каждый заказ, в том числе за второй в поездке.
update public.city_courier_settings set pay_extra = 4 where pay_extra <> 4;
