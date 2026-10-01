-- Telegram bot, stage 2: couriers work orders from Telegram.
-- New delivery order → every connected courier of that city gets it with [🙋 Беру]. The first one takes it, calls
-- the customer, then: Принят → Собран (status «едет») → Доставлен + how the customer paid; or Отменён with a reason.
-- One shared transition function is used by the admin (set_order_status) and by the bot.

-- 1. One place for status changes. Fix: products supplied by a partner (supply_mode SUPPLIER, stock 0) are no longer
--    taken off stock on delivery — before this, every «Доставлен» failed with «Not enough stock».
create or replace function private.order_transition(p_order uuid, p_status public.order_status, p_reason text default null)
returns void language plpgsql security definer set search_path to ''
as $$
declare v_old public.order_status; r record;
begin
  select status into v_old from public.orders where id = p_order for update;
  if not found then raise exception 'Order not found'; end if;
  if v_old = p_status then return; end if;
  if not (
    (v_old = 'NEW' and p_status in ('CONFIRMED', 'CANCELLED')) or
    (v_old = 'CONFIRMED' and p_status in ('PREPARING', 'OUT_FOR_DELIVERY', 'CANCELLED')) or
    (v_old = 'PREPARING' and p_status in ('OUT_FOR_DELIVERY', 'CANCELLED')) or
    (v_old = 'OUT_FOR_DELIVERY' and p_status in ('DELIVERED', 'CANCELLED')) or
    (v_old = 'DELIVERED' and p_status = 'REFUNDED')
  ) then raise exception 'Invalid status transition: % -> %', v_old, p_status; end if;

  if p_status = 'DELIVERED' then
    for r in select oi.product_id, oi.quantity, oi.is_gift, p.stock_quantity, p.name, p.supply_mode
               from public.order_items oi join public.products p on p.id = oi.product_id
              where oi.order_id = p_order and p.supply_mode = 'OWN_STOCK' loop
      if r.stock_quantity < r.quantity then raise exception 'Not enough stock: %', r.name; end if;
      update public.products set stock_quantity = stock_quantity - r.quantity where id = r.product_id;
      insert into public.inventory_movements(product_id, order_id, movement_type, quantity, notes)
      values (r.product_id, p_order, case when r.is_gift then 'GIFT'::public.inventory_movement_type else 'SALE'::public.inventory_movement_type end, -r.quantity, 'Order delivered');
    end loop;
    update public.stock_reservations set released_at = now() where order_id = p_order and released_at is null;
  elsif p_status = 'CANCELLED' then
    update public.stock_reservations set released_at = now() where order_id = p_order and released_at is null;
  elsif p_status = 'REFUNDED' then
    for r in select oi.product_id, oi.quantity from public.order_items oi join public.products p on p.id = oi.product_id
              where oi.order_id = p_order and p.supply_mode = 'OWN_STOCK' loop
      update public.products set stock_quantity = stock_quantity + r.quantity where id = r.product_id;
      insert into public.inventory_movements(product_id, order_id, movement_type, quantity, notes)
      values (r.product_id, p_order, 'RETURN', r.quantity, 'Delivered order refunded');
    end loop;
  end if;

  update public.orders set status = p_status,
         confirmed_at = case when p_status = 'CONFIRMED' then coalesce(confirmed_at, now()) else confirmed_at end,
         ready_at     = case when p_status = 'OUT_FOR_DELIVERY' then coalesce(ready_at, now()) else ready_at end,
         delivered_at = case when p_status = 'DELIVERED' then now() else delivered_at end,
         cancelled_at = case when p_status = 'CANCELLED' then now() else cancelled_at end,
         cancellation_reason = case when p_status = 'CANCELLED' then coalesce(p_reason, cancellation_reason) else cancellation_reason end
   where id = p_order;
  insert into public.order_status_history(order_id, from_status, to_status, changed_by) values (p_order, v_old, p_status, auth.uid());
end $$;
revoke all on function private.order_transition(uuid, public.order_status, text) from public, anon, authenticated;

create or replace function public.set_order_status(p_order uuid, p_status public.order_status)
returns void language plpgsql security definer set search_path to ''
as $$ begin
  if not private.is_staff() then raise exception 'Forbidden'; end if;
  perform private.order_transition(p_order, p_status);
end $$;

-- 2. Assigning a courier (trip grouping from 20261001b) shared by admin and bot.
create or replace function private.assign_trip(p_order uuid, p_driver uuid, p_new_trip boolean default false)
returns uuid language plpgsql security definer set search_path to ''
as $$
declare aid uuid; v_trip uuid;
begin
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
revoke all on function private.assign_trip(uuid, uuid, boolean) from public, anon, authenticated;

create or replace function public.assign_driver(p_order uuid, p_driver uuid, p_new_trip boolean default false)
returns uuid language plpgsql security definer set search_path to ''
as $$ begin
  if not private.is_staff() then raise exception 'Forbidden'; end if;
  return private.assign_trip(p_order, p_driver, p_new_trip);
end $$;

-- 3. Telegram messages per order, so the bot can update them (offer → «взял Курьер 1», owner's status line).
create table if not exists public.telegram_messages (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  chat_id bigint not null,
  message_id bigint,
  kind text not null,                -- OWNER_NEW / DRIVER_OFFER / REMIND
  created_at timestamptz not null default now()
);
create index if not exists telegram_messages_order_idx on public.telegram_messages(order_id, kind);
alter table public.telegram_messages enable row level security;
drop policy if exists "staff telegram messages" on public.telegram_messages;
create policy "staff telegram messages" on public.telegram_messages for select to authenticated using ((select private.is_staff()));

-- 4. Everything a courier can do from Telegram. Called by the edge function only (service role).
--    The courier is identified by his Telegram chat (telegram_links DRIVER), never by data from the message.
create or replace function public.tg_courier(p_chat bigint, p_order uuid, p_action text, p_arg text default null)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare d record; o public.orders; a public.delivery_assignments; other text; v_method text; v_reason text;
begin
  select dr.id, dr.name into d from public.telegram_links l join public.drivers dr on dr.id = l.ref_id
   where l.kind = 'DRIVER' and l.active and l.chat_id = p_chat and dr.active limit 1;
  if d.id is null then return jsonb_build_object('error', 'not_driver'); end if;
  select * into o from public.orders where id = p_order for update;
  if not found then return jsonb_build_object('error', 'no_order'); end if;
  select * into a from public.delivery_assignments where order_id = p_order;

  if p_action = 'take' then
    if a.driver_id is not null and a.driver_id <> d.id then
      select name into other from public.drivers where id = a.driver_id;
      return jsonb_build_object('error', 'taken', 'by', other);
    end if;
    if o.status <> 'NEW' or o.fulfillment_type <> 'delivery' then return jsonb_build_object('error', 'state', 'status', o.status); end if;
    if a.driver_id is null then
      perform private.assign_trip(p_order, d.id, false);
      update public.delivery_assignments set accepted_at = now() where order_id = p_order;
    end if;
    return jsonb_build_object('ok', true, 'driver', d.name);
  end if;

  if a.driver_id is distinct from d.id then return jsonb_build_object('error', 'not_yours'); end if;

  if p_action = 'accept' then
    if o.status <> 'NEW' then return jsonb_build_object('error', 'state', 'status', o.status); end if;
    perform private.order_transition(p_order, 'CONFIRMED');
  elsif p_action = 'ready' then
    if o.status not in ('CONFIRMED', 'PREPARING') then return jsonb_build_object('error', 'state', 'status', o.status); end if;
    perform private.order_transition(p_order, 'OUT_FOR_DELIVERY');
    update public.delivery_assignments set picked_up_at = coalesce(picked_up_at, now()), on_route_at = coalesce(on_route_at, now()) where order_id = p_order;
  elsif p_action = 'deliver' then
    if o.status <> 'OUT_FOR_DELIVERY' then return jsonb_build_object('error', 'state', 'status', o.status); end if;
    v_method := case p_arg when 'cash' then 'CASH' when 'card' then 'CARD' when 'transfer' then 'TRANSFER' end;
    if v_method is null then return jsonb_build_object('error', 'method'); end if;
    perform private.order_transition(p_order, 'DELIVERED');
    update public.delivery_assignments set delivered_at = coalesce(delivered_at, now()) where order_id = p_order;
    if o.total - o.amount_paid > 0 then
      insert into public.order_collections(order_id, driver_id, amount, method, note)
      values (p_order, d.id, o.total - o.amount_paid, v_method, 'Telegram');
    end if;
    update public.orders set amount_paid = total, collection_status = 'PAID', payment_status = 'PAID', paid_at = now(), debt_amount = 0
     where id = p_order;
  elsif p_action = 'cancel' then
    if o.status in ('DELIVERED', 'CANCELLED', 'REFUNDED') then return jsonb_build_object('error', 'state', 'status', o.status); end if;
    v_reason := case p_arg when 'mind' then 'Клиент передумал' when 'money' then 'Нет денег' when 'stock' then 'Нет товара'
                           when 'noanswer' then 'Не дозвонились' else 'Другое' end;
    perform private.order_transition(p_order, 'CANCELLED', v_reason || ' (курьер ' || d.name || ')');
    update public.delivery_assignments set failed_at = now(), failure_reason = v_reason where order_id = p_order;
  else
    return jsonb_build_object('error', 'action');
  end if;
  return jsonb_build_object('ok', true, 'driver', d.name);
end $$;
revoke all on function public.tg_courier(bigint, uuid, text, text) from public, anon, authenticated;
grant execute on function public.tg_courier(bigint, uuid, text, text) to service_role;

-- 5. Reminder: a delivery order still not accepted 5 minutes after it came in → message to the owner (once).
create or replace function private.tg_reminders()
returns void language plpgsql security definer set search_path to ''
as $$
declare r record;
begin
  for r in select o.id from public.orders o
            where o.status = 'NEW' and o.fulfillment_type = 'delivery'
              and o.created_at < now() - interval '5 minutes' and o.created_at > now() - interval '3 hours'
              and not exists (select 1 from public.telegram_messages m where m.order_id = o.id and m.kind = 'REMIND')
  loop
    insert into public.telegram_messages(order_id, chat_id, kind) values (r.id, 0, 'REMIND');
    perform private.tg_post(jsonb_build_object('action', 'remind', 'order_id', r.id));
  end loop;
end $$;
revoke all on function private.tg_reminders() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'tg-reminders';
select cron.schedule('tg-reminders', '* * * * *', 'select private.tg_reminders()');

-- 6. Fix: orders from the storefront had no city_id, so the bot could not tell which couriers to offer them to.
--    The city now comes from the delivery zone (zones belong to a city); existing orders are backfilled.
create or replace function private.apply_order_delivery(p_result jsonb, p_zone uuid, p_phone text, p_fulfillment text)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare q jsonb; v_fee numeric; v_order uuid := (p_result->>'order_id')::uuid; v_total numeric; v_sub numeric;
begin
  select total into v_sub from public.orders where id = v_order;
  q := private.delivery_quote(p_zone, p_phone, p_fulfillment, v_sub);
  v_fee := coalesce((q->>'fee')::numeric, 0);
  update public.orders set delivery_fee = v_fee, delivery_zone_id = case when p_fulfillment = 'delivery' then p_zone end, total = total + v_fee,
         city_id = coalesce(city_id, (select z.city_id from public.delivery_zones z where z.id = p_zone))
   where id = v_order returning total into v_total;
  return p_result || jsonb_build_object('delivery_fee', v_fee, 'delivery_reason', q->>'reason', 'total', v_total);
end $$;

update public.orders o set city_id = z.city_id from public.delivery_zones z
 where o.city_id is null and o.delivery_zone_id = z.id;
