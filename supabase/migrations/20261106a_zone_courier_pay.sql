-- Владелец, 06.11.2026: курьер за Городок первый берёт 6 ₾ (город — 4 ₾ по настройкам города).
alter table public.delivery_zones add column if not exists courier_pay numeric(10,2);
comment on column public.delivery_zones.courier_pay is 'Оплата курьеру за заказ в эту зону; null = по настройкам города';
update public.delivery_zones set courier_pay = 6 where name = 'Ахалкалаки — Городок первый';

create or replace function private.courier_pay_for_order(p_order uuid)
returns void language plpgsql security definer set search_path to '' as $function$
declare a record; o record; v_first numeric; v_extra numeric; v_zone numeric; is_first boolean;
begin
  select * into o from public.orders where id = p_order;
  select * into a from public.delivery_assignments where order_id = p_order;
  if o.status is distinct from 'DELIVERED' or a.driver_id is null then
    delete from public.driver_earnings where order_id = p_order and kind = 'DELIVERY';
    return;
  end if;
  delete from public.driver_earnings where order_id = p_order and kind = 'DELIVERY' and driver_id <> a.driver_id;
  if exists (select 1 from public.driver_earnings where order_id = p_order and kind = 'DELIVERY') then return; end if;
  update public.delivery_assignments set delivered_at = coalesce(delivered_at, now()) where id = a.id;
  select coalesce(s.pay_first, 4), coalesce(s.pay_extra, 2) into v_first, v_extra
    from public.drivers d left join public.city_courier_settings s on s.city_id = coalesce(o.city_id, d.city_id)
   where d.id = a.driver_id;
  select z.courier_pay into v_zone from public.delivery_zones z where z.id = o.delivery_zone_id;
  is_first := not exists (select 1 from public.driver_earnings e join public.delivery_assignments b on b.order_id = e.order_id
                           where b.trip_id = a.trip_id and e.kind = 'DELIVERY' and e.order_id <> p_order);
  insert into public.driver_earnings(driver_id, order_id, amount, reason, kind)
  values (a.driver_id, p_order,
          coalesce(v_zone, case when is_first then coalesce(v_first, 4) else coalesce(v_extra, 2) end),
          case when v_zone is not null then 'Поездка: зона' when is_first then 'Поездка: 1-й заказ' else 'Поездка: ещё заказ' end, 'DELIVERY');
end $function$;
