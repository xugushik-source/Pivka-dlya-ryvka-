-- Couriers, simple: "Курьер 1/2/3" per city (rename later in admin), pay per trip:
-- first order of a trip = pay_first, every next order in the same trip = pay_extra (4 + 2 + 2 …).
-- Rates are per city (Ниноцминда can differ). Pay is recorded when the order becomes DELIVERED.

alter table public.city_courier_settings add column if not exists pay_first numeric(10,2) not null default 4;
alter table public.city_courier_settings add column if not exists pay_extra numeric(10,2) not null default 2;
insert into public.city_courier_settings(city_id) select id from public.service_cities on conflict (city_id) do nothing;

alter table public.delivery_assignments add column if not exists trip_id uuid;
create index if not exists delivery_assignments_trip_idx on public.delivery_assignments(trip_id);

-- Starter couriers (only if a city has none yet).
insert into public.drivers(city_id, name, availability)
select c.id, v.name, 'AVAILABLE'
  from public.service_cities c
  join (values ('Ахалкалаки','Курьер 1'),('Ахалкалаки','Курьер 2'),('Ахалкалаки','Курьер 3'),('Ниноцминда','Курьер 1')) v(city, name) on v.city = c.name
 where not exists (select 1 from public.drivers d where d.city_id = c.id);

-- Pay for one order: first delivered order of its trip gets pay_first, the rest pay_extra.
create or replace function private.courier_pay_for_order(p_order uuid)
returns void language plpgsql security definer set search_path to ''
as $$
declare a record; o record; v_first numeric; v_extra numeric; is_first boolean;
begin
  select * into o from public.orders where id = p_order;
  select * into a from public.delivery_assignments where order_id = p_order;
  if o.status is distinct from 'DELIVERED' or a.driver_id is null then
    delete from public.driver_earnings where order_id = p_order and kind = 'DELIVERY';
    return;
  end if;
  -- courier changed after delivery: pay the new one
  delete from public.driver_earnings where order_id = p_order and kind = 'DELIVERY' and driver_id <> a.driver_id;
  if exists (select 1 from public.driver_earnings where order_id = p_order and kind = 'DELIVERY') then return; end if;
  update public.delivery_assignments set delivered_at = coalesce(delivered_at, now()) where id = a.id;
  select coalesce(s.pay_first, 4), coalesce(s.pay_extra, 2) into v_first, v_extra
    from public.drivers d left join public.city_courier_settings s on s.city_id = coalesce(o.city_id, d.city_id)
   where d.id = a.driver_id;
  is_first := not exists (select 1 from public.driver_earnings e join public.delivery_assignments b on b.order_id = e.order_id
                           where b.trip_id = a.trip_id and e.kind = 'DELIVERY' and e.order_id <> p_order);
  insert into public.driver_earnings(driver_id, order_id, amount, reason, kind)
  values (a.driver_id, p_order, case when is_first then coalesce(v_first, 4) else coalesce(v_extra, 2) end,
          case when is_first then 'Поездка: 1-й заказ' else 'Поездка: ещё заказ' end, 'DELIVERY');
end $$;

create or replace function private.orders_courier_pay()
returns trigger language plpgsql security definer set search_path to ''
as $$ begin
  if new.status is distinct from old.status and (new.status = 'DELIVERED' or old.status = 'DELIVERED') then
    perform private.courier_pay_for_order(new.id);
  end if;
  return new;
end $$;
drop trigger if exists orders_courier_pay on public.orders;
create trigger orders_courier_pay after update of status on public.orders
  for each row execute function private.orders_courier_pay();

-- Assign: if the courier already carries undelivered orders, the new one joins that trip (+pay_extra).
-- p_new_trip = true forces a separate trip.
drop function if exists public.assign_driver(uuid, uuid);
create function public.assign_driver(p_order uuid, p_driver uuid, p_new_trip boolean default false)
returns uuid language plpgsql security definer set search_path to ''
as $$
declare aid uuid; v_trip uuid;
begin
  if not private.is_staff() then raise exception 'Forbidden'; end if;
  if not exists (select 1 from public.drivers where id = p_driver and active) then raise exception 'Driver unavailable'; end if;
  select trip_id into v_trip from public.delivery_assignments where order_id = p_order and driver_id = p_driver;
  if v_trip is null and not p_new_trip then
    select a.trip_id into v_trip from public.delivery_assignments a join public.orders o on o.id = a.order_id
     where a.driver_id = p_driver and a.order_id <> p_order and a.trip_id is not null
       and a.delivered_at is null and a.failed_at is null and o.status not in ('DELIVERED','CANCELLED','REFUNDED')
     order by a.assigned_at desc limit 1;
  end if;
  v_trip := coalesce(v_trip, gen_random_uuid());
  insert into public.delivery_assignments(order_id, driver_id, assigned_at, trip_id) values (p_order, p_driver, now(), v_trip)
  on conflict (order_id) do update set driver_id = excluded.driver_id, assigned_at = now(), trip_id = excluded.trip_id
  returning id into aid;
  insert into public.dispatch_history(order_id, driver_id, action, actor_id) values (p_order, p_driver, 'ASSIGNED', auth.uid());
  perform private.courier_pay_for_order(p_order);
  return aid;
end $$;
revoke all on function public.assign_driver(uuid, uuid, boolean) from public, anon;
grant execute on function public.assign_driver(uuid, uuid, boolean) to authenticated;

create or replace function public.unassign_driver(p_order uuid)
returns void language plpgsql security definer set search_path to ''
as $$ begin
  if not private.is_staff() then raise exception 'Forbidden'; end if;
  delete from public.driver_earnings where order_id = p_order and kind = 'DELIVERY';
  delete from public.delivery_assignments where order_id = p_order;
end $$;

-- Admin: couriers with today's work and what is owed.
create or replace function public.courier_pay_summary()
returns table(driver_id uuid, name text, city_id uuid, city_name text, phone text, active boolean,
              today_orders bigint, today_trips bigint, today_earned numeric, earned_total numeric, paid_total numeric, owed numeric, open_orders bigint)
language plpgsql stable security definer set search_path to ''
as $$ begin
  if not private.is_staff() then raise exception 'Forbidden'; end if;
  return query
  select d.id, d.name, d.city_id, c.name, d.phone, d.active,
         (select count(*) from public.driver_earnings e where e.driver_id = d.id and e.kind = 'DELIVERY'
             and (e.created_at at time zone 'Asia/Tbilisi')::date = (now() at time zone 'Asia/Tbilisi')::date),
         (select count(distinct b.trip_id) from public.driver_earnings e join public.delivery_assignments b on b.order_id = e.order_id
           where e.driver_id = d.id and e.kind = 'DELIVERY' and (e.created_at at time zone 'Asia/Tbilisi')::date = (now() at time zone 'Asia/Tbilisi')::date),
         (select coalesce(sum(e.amount), 0) from public.driver_earnings e where e.driver_id = d.id
             and (e.created_at at time zone 'Asia/Tbilisi')::date = (now() at time zone 'Asia/Tbilisi')::date),
         x.earned, y.paid, x.earned - y.paid,
         (select count(*) from public.delivery_assignments a join public.orders o on o.id = a.order_id
           where a.driver_id = d.id and a.delivered_at is null and a.failed_at is null and o.status not in ('DELIVERED','CANCELLED','REFUNDED'))
    from public.drivers d
    left join public.service_cities c on c.id = d.city_id
    cross join lateral (select coalesce(sum(ee.amount), 0) earned from public.driver_earnings ee where ee.driver_id = d.id) x
    cross join lateral (select coalesce(sum(pp.amount), 0) paid from public.driver_payouts pp where pp.driver_id = d.id and pp.status = 'PAID') y
   order by c.name, d.name;
end $$;
revoke all on function public.courier_pay_summary() from public, anon;
grant execute on function public.courier_pay_summary() to authenticated;

-- Admin: pay the courier everything owed right now.
create or replace function public.courier_payout(p_driver uuid)
returns numeric language plpgsql security definer set search_path to ''
as $$
declare v_owed numeric; v_from date;
begin
  if not private.is_staff() then raise exception 'Forbidden'; end if;
  select coalesce(sum(amount), 0) into v_owed from public.driver_earnings where driver_id = p_driver;
  v_owed := v_owed - (select coalesce(sum(amount), 0) from public.driver_payouts where driver_id = p_driver and status = 'PAID');
  if v_owed <= 0 then return 0; end if;
  select coalesce((max(period_to) + 1), (select min(created_at)::date from public.driver_earnings where driver_id = p_driver), current_date)
    into v_from from public.driver_payouts where driver_id = p_driver and status = 'PAID';
  insert into public.driver_payouts(driver_id, period_from, period_to, amount, status, paid_at)
  values (p_driver, least(v_from, current_date), current_date, v_owed, 'PAID', now());
  return v_owed;
end $$;
revoke all on function public.courier_payout(uuid) from public, anon;
grant execute on function public.courier_payout(uuid) to authenticated;

-- Dispatcher also sees new orders (the shop often ships straight from NEW).
create or replace function public.dispatch_board()
returns table(order_id uuid, order_number bigint, city_name text, status public.order_status, address text, total numeric, collection_status text,
              driver_id uuid, driver_name text, driver_availability text, assigned_at timestamptz)
language plpgsql security definer set search_path to ''
as $$ begin
  if not private.is_staff() then raise exception 'Forbidden'; end if;
  return query select o.id, o.order_number, c.name, o.status, o.address_snapshot, o.total, o.collection_status, d.id, d.name, d.availability, a.assigned_at
    from public.orders o left join public.service_cities c on c.id = o.city_id
    left join public.delivery_assignments a on a.order_id = o.id left join public.drivers d on d.id = a.driver_id
   where o.fulfillment_type = 'delivery' and o.status in ('NEW','CONFIRMED','PREPARING','OUT_FOR_DELIVERY')
   order by case when a.driver_id is null then 0 else 1 end, o.created_at;
end $$;
