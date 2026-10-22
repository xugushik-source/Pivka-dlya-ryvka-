-- Минимальный заказ на доставку — 20 ₾ (решение владельца 22.10.2026): курьер стоит 4 ₾,
-- заказ меньше 20 ₾ не окупает доставку. Самовывоз — без минимума.
-- Сайт уже читает delivery_zones.minimum_order; сервер проверяет сумму товаров при создании заказа.

update public.delivery_zones set minimum_order = 20 where is_city;

create or replace function private.enforce_min_order() returns trigger
language plpgsql security definer set search_path = public as $$
declare o record; m numeric;
begin
  select * into o from public.orders where id = new.id;
  if not found or o.fulfillment_type is distinct from 'delivery' or o.status = 'CANCELLED' then return null; end if;
  select coalesce(z.minimum_order, 0) into m from public.delivery_zones z where z.id = o.delivery_zone_id;
  if coalesce(m, 0) > 0 and coalesce(o.total, 0) - coalesce(o.delivery_fee, 0) + coalesce(o.bonus_used, 0) < m then
    raise exception 'Минимальный заказ на доставку — % ₾', trim(to_char(m, 'FM999990.##'))
      using errcode = 'P0001';
  end if;
  return null;
end $$;

drop trigger if exists orders_min_order on public.orders;
create constraint trigger orders_min_order after insert on public.orders
  deferrable initially deferred for each row execute function private.enforce_min_order();
