-- Courier: «📦 Собран» and «🛵 Еду» are two separate steps.
-- Before: «Собран» put the order straight into OUT_FOR_DELIVERY and the customer saw «Едет» 30 s later by a timer.
-- Now:   «Собран» → PREPARING (ready_at)  — the customer sees «Собран»;
--        «Еду»    → OUT_FOR_DELIVERY (departed_at) — the customer sees «Едет» (and gets the «Рывок» game).
-- Old orders without departed_at keep the old rule in the browser (ready_at + 30 s).

alter table public.orders add column if not exists departed_at timestamptz;

-- ready_at = collected (PREPARING or, if skipped, OUT_FOR_DELIVERY); departed_at = the courier left.
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
         ready_at     = case when p_status in ('PREPARING', 'OUT_FOR_DELIVERY') then coalesce(ready_at, now()) else ready_at end,
         departed_at  = case when p_status = 'OUT_FOR_DELIVERY' then coalesce(departed_at, now()) else departed_at end,
         delivered_at = case when p_status = 'DELIVERED' then now() else delivered_at end,
         cancelled_at = case when p_status = 'CANCELLED' then now() else cancelled_at end,
         cancellation_reason = case when p_status = 'CANCELLED' then coalesce(p_reason, cancellation_reason) else cancellation_reason end
   where id = p_order;
  insert into public.order_status_history(order_id, from_status, to_status, changed_by) values (p_order, v_old, p_status, auth.uid());
end $$;

-- The customer's status page / card gets departed_at too.
create or replace function public.order_track(p_order uuid)
returns jsonb language sql stable security definer set search_path to ''
as $$
  select jsonb_build_object(
    'order_number', o.order_number, 'status', o.status, 'fulfillment', o.fulfillment_type, 'total', o.total,
    'created_at', o.created_at, 'confirmed_at', o.confirmed_at, 'ready_at', o.ready_at, 'departed_at', o.departed_at,
    'delivered_at', o.delivered_at, 'cancelled_at', o.cancelled_at, 'now', now())
  from public.orders o where o.id = p_order
$$;
revoke all on function public.order_track(uuid) from public;
grant execute on function public.order_track(uuid) to anon, authenticated;

-- Bot: «ready» = Собран (PREPARING), new «go» = Еду (OUT_FOR_DELIVERY).
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
    if o.status <> 'CONFIRMED' then return jsonb_build_object('error', 'state', 'status', o.status); end if;
    perform private.order_transition(p_order, 'PREPARING');
    update public.delivery_assignments set picked_up_at = coalesce(picked_up_at, now()) where order_id = p_order;
  elsif p_action = 'go' then
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
