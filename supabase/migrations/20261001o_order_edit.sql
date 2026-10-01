-- Stage 5: changing an order after it was placed.
-- Who: the customer (only before the courier's «Принят»), the courier who took the order and the owner/admin
-- (until «Собран»). One page, one database function; the three entry points differ only in who is checked.
-- A «рывок» is kept or removed whole. Prices of lines already in the order stay as they were; new lines get today's
-- price. Gift and delivery are recalculated. After «Принят» only the suppliers whose lines changed get a new message.
-- Draft beer (sold per liter) is poured as soon as the supplier gets the order: if it is reduced or the order is
-- cancelled after «Принят», the supplier is still paid and the purchase cost is written off — on the courier who
-- accepted the order (the owner can move it onto himself in admin).

-- 1. Write-offs of poured beer.
create table if not exists public.order_writeoffs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  supplier_id uuid references public.suppliers(id),
  product_id uuid references public.products(id),
  name text not null,
  unit text,
  quantity numeric not null check (quantity > 0),
  unit_cost numeric not null default 0,
  amount numeric generated always as (round(quantity * unit_cost, 2)) stored,
  reason text not null check (reason in ('EDIT', 'CANCEL')),
  charged_to text not null check (charged_to in ('DRIVER', 'OWNER')),
  driver_id uuid references public.drivers(id),
  settled_at timestamptz,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists order_writeoffs_order_idx on public.order_writeoffs(order_id);
create index if not exists order_writeoffs_open_idx on public.order_writeoffs(driver_id) where settled_at is null;
alter table public.order_writeoffs enable row level security;
drop policy if exists "staff order writeoffs" on public.order_writeoffs;
create policy "staff order writeoffs" on public.order_writeoffs for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));

-- 2. History of changes (who, before, after).
create table if not exists public.order_edits (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  actor text not null,               -- CUSTOMER / DRIVER / ADMIN
  actor_name text,
  before jsonb,
  after jsonb,
  total_before numeric,
  total_after numeric,
  created_at timestamptz not null default now()
);
create index if not exists order_edits_order_idx on public.order_edits(order_id);
alter table public.order_edits enable row level security;
drop policy if exists "staff order edits" on public.order_edits;
create policy "staff order edits" on public.order_edits for select to authenticated using ((select private.is_staff()));

-- 3. Lines per supplier, used to see whose part of the order changed.
create or replace function private.order_lines_snapshot(p_order uuid)
returns jsonb language sql stable security definer set search_path to ''
as $$
  select coalesce(jsonb_object_agg(sid, lines), '{}'::jsonb) from (
    select coalesce(supplier_id::text, 'none') sid,
           jsonb_agg(jsonb_build_array(product_id, trim_scale(quantity), is_gift) order by product_id, is_gift, quantity) lines
      from public.order_items where order_id = p_order group by 1) s
$$;
revoke all on function private.order_lines_snapshot(uuid) from public, anon, authenticated;

-- 4. What the edit page shows. Purchase prices and supplier names only for the courier and staff.
create or replace function private.order_edit_view(p_order uuid, p_role text)
returns jsonb language sql stable security definer set search_path to ''
as $$
  select jsonb_build_object(
    'order_id', o.id, 'order_number', o.order_number, 'status', o.status, 'fulfillment', o.fulfillment_type,
    'city_id', o.city_id, 'role', p_role,
    'editable', case when p_role = 'CUSTOMER' then o.status = 'NEW' else o.status in ('NEW', 'CONFIRMED', 'PREPARING') end,
    'poured', o.status <> 'NEW',
    'driver', (select d.name from public.delivery_assignments a join public.drivers d on d.id = a.driver_id where a.order_id = o.id),
    'discount', o.discount_total, 'delivery_fee', o.delivery_fee, 'total', o.total,
    'bundle', (select jsonb_build_object('total', sum(oi.line_total),
                 'items', jsonb_agg(jsonb_build_object('name', oi.name_snapshot, 'qty', trim_scale(oi.quantity), 'unit', oi.unit_snapshot,
                   'supplier', case when p_role <> 'CUSTOMER' then s.name end,
                   'cost', case when p_role <> 'CUSTOMER' then oi.supplier_cost_snapshot end) order by oi.name_snapshot))
                 from public.order_items oi left join public.suppliers s on s.id = oi.supplier_id
                where oi.order_id = o.id and oi.item_type = 'BUNDLE' having count(*) > 0),
    'items', coalesce((select jsonb_agg(jsonb_build_object('product_id', oi.product_id, 'name', oi.name_snapshot, 'unit', oi.unit_snapshot,
                 'qty', trim_scale(oi.quantity), 'price', oi.unit_price_snapshot, 'image', p.image_url,
                 'min', coalesce(cp.minimum_quantity, p.minimum_quantity, 1), 'step', coalesce(cp.quantity_step, p.quantity_step, 1),
                 'supplier_id', case when p_role <> 'CUSTOMER' then oi.supplier_id end,
                 'supplier', case when p_role <> 'CUSTOMER' then s.name end,
                 'cost', case when p_role <> 'CUSTOMER' then oi.supplier_cost_snapshot end)
                 order by s.name nulls last, oi.name_snapshot)
                 from public.order_items oi join public.products p on p.id = oi.product_id
                 left join public.city_products cp on cp.product_id = p.id and cp.city_id = o.city_id
                 left join public.suppliers s on s.id = oi.supplier_id
                where oi.order_id = o.id and oi.item_type = 'PRODUCT' and not oi.is_gift), '[]'::jsonb),
    'gifts', coalesce((select jsonb_agg(jsonb_build_object('name', oi.name_snapshot, 'qty', trim_scale(oi.quantity), 'unit', oi.unit_snapshot))
                 from public.order_items oi where oi.order_id = o.id and oi.is_gift), '[]'::jsonb))
  from public.orders o where o.id = p_order
$$;
revoke all on function private.order_edit_view(uuid, text) from public, anon, authenticated;

-- 5. The change itself. p_items = the full new list of extra products [{product_id, quantity}] (bundle lines and gifts
--    are not in it). p_keep_bundle = false removes the «рывок». p_charge (DRIVER/OWNER) = who pays for poured beer.
create or replace function private.order_edit_apply(p_order uuid, p_items jsonb, p_keep_bundle boolean, p_role text,
                                                    p_actor text, p_charge text default 'DRIVER')
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare o public.orders; v_driver uuid; v_before jsonb; v_after jsonb; v_old jsonb; v_new jsonb; v_keep boolean;
  r record; p record; e record; v_price numeric; v_sid uuid; v_cost numeric; v_newq numeric;
  v_old_extras numeric; v_extras numeric := 0; v_bundle numeric; v_gift numeric; v_goods numeric; v_cogs numeric;
  v_phone text; v_quote jsonb; v_fee numeric; v_charge text; v_writeoff numeric := 0; v_changed jsonb; v_removed jsonb;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Заказ не найден'; end if;
  if p_role = 'CUSTOMER' and o.status <> 'NEW' then
    raise exception 'Заказ уже принят курьером — изменить его можно, только позвонив курьеру';
  end if;
  if o.status not in ('NEW', 'CONFIRMED', 'PREPARING') then raise exception 'Заказ уже собран — менять поздно'; end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then raise exception 'Неверный список товаров'; end if;

  select driver_id into v_driver from public.delivery_assignments where order_id = p_order;
  v_charge := case when v_driver is null then 'OWNER' when p_role = 'ADMIN' and p_charge = 'OWNER' then 'OWNER' else 'DRIVER' end;
  v_before := private.order_lines_snapshot(p_order);
  v_keep := coalesce(p_keep_bundle, true);
  select coalesce(sum(line_total), 0) into v_old_extras from public.order_items
   where order_id = p_order and item_type = 'PRODUCT' and not is_gift;
  -- Lines already in the order keep their price, supplier and purchase cost.
  select coalesce(jsonb_object_agg(product_id::text, jsonb_build_object('qty', qty, 'price', price, 'sid', sid, 'cost', cost)), '{}'::jsonb)
    into v_old
    from (select product_id, sum(quantity) qty, max(unit_price_snapshot) price, (array_agg(supplier_id))[1] sid, max(supplier_cost_snapshot) cost
            from public.order_items where order_id = p_order and item_type = 'PRODUCT' and not is_gift group by product_id) x;
  select coalesce(jsonb_object_agg(pid::text, q), '{}'::jsonb) into v_new
    from (select (x->>'product_id')::uuid pid, sum((x->>'quantity')::numeric) q
            from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x group by 1 having sum((x->>'quantity')::numeric) > 0) y;

  -- Poured beer that is reduced or removed after «Принят» → write-off.
  if o.status <> 'NEW' then
    for r in select oi.product_id, oi.supplier_id, oi.name_snapshot, oi.unit_snapshot, oi.supplier_cost_snapshot, oi.item_type, oi.quantity
               from public.order_items oi where oi.order_id = p_order and not oi.is_gift and oi.unit_snapshot = 'liter' loop
      v_newq := case when r.item_type = 'BUNDLE' then case when v_keep then r.quantity else 0 end
                     else coalesce((v_new->>r.product_id::text)::numeric, 0) end;
      if v_newq < r.quantity then
        insert into public.order_writeoffs(order_id, supplier_id, product_id, name, unit, quantity, unit_cost, reason, charged_to, driver_id, created_by)
        values (p_order, r.supplier_id, r.product_id, r.name_snapshot, r.unit_snapshot, r.quantity - v_newq,
                coalesce(r.supplier_cost_snapshot, 0), 'EDIT', v_charge, v_driver, p_actor);
        v_writeoff := v_writeoff + round((r.quantity - v_newq) * coalesce(r.supplier_cost_snapshot, 0), 2);
      end if;
    end loop;
  end if;

  update public.stock_reservations set released_at = now() where order_id = p_order and released_at is null and consumed_at is null;
  delete from public.order_items where order_id = p_order
     and (is_gift or item_type = 'PRODUCT' or (item_type = 'BUNDLE' and not v_keep));

  for e in select key::uuid pid, value::text::numeric q from jsonb_each(v_new) loop
    select pr.id, pr.name, pr.sku, pr.unit, pr.purchase_price, pr.supply_mode, pr.active and coalesce(cp.active, true) active,
           coalesce(cp.sale_price, pr.sale_price, 0) sale_price,
           coalesce(cp.minimum_quantity, pr.minimum_quantity, 1) minimum_quantity, coalesce(cp.quantity_step, pr.quantity_step, 1) quantity_step
      into p from public.products pr left join public.city_products cp on cp.product_id = pr.id and cp.city_id = o.city_id
     where pr.id = e.pid;
    if p.id is null or (not p.active and not (v_old ? e.pid::text)) then raise exception 'Товар недоступен'; end if;
    if e.q < p.minimum_quantity or mod(e.q - p.minimum_quantity, p.quantity_step) <> 0 then
      raise exception 'Неверное количество: %', p.name;
    end if;
    if v_old ? e.pid::text then
      v_price := (v_old->e.pid::text->>'price')::numeric;
      v_sid := (v_old->e.pid::text->>'sid')::uuid;
      v_cost := coalesce((v_old->e.pid::text->>'cost')::numeric, p.purchase_price, 0);
    else
      v_price := p.sale_price; v_sid := null; v_cost := null;
      select rs.supplier_id, rs.cost into v_sid, v_cost from private.resolve_supplier(p.id) rs;
      v_cost := coalesce(v_cost, p.purchase_price, 0);
    end if;
    if p.supply_mode = 'OWN_STOCK' then
      if public.available_stock(p.id) < e.q then raise exception 'Не хватает на складе: %', p.name; end if;
      insert into public.stock_reservations(product_id, order_id, quantity, expires_at) values (p.id, p_order, e.q, now() + interval '20 minutes');
    end if;
    insert into public.order_items(order_id, product_id, item_type, name_snapshot, sku_snapshot, unit_snapshot, quantity,
      unit_price_snapshot, unit_cost_snapshot, line_total, line_cogs, is_gift, supplier_id, supplier_cost_snapshot)
    values (p_order, p.id, 'PRODUCT', p.name, p.sku, p.unit, e.q, v_price, v_cost, v_price * e.q, v_cost * e.q, false, v_sid, v_cost);
    v_extras := v_extras + v_price * e.q;
  end loop;
  -- Bundle lines that stay keep their stock reservation.
  insert into public.stock_reservations(product_id, order_id, quantity, expires_at)
  select oi.product_id, p_order, oi.quantity, now() + interval '20 minutes'
    from public.order_items oi join public.products pr on pr.id = oi.product_id
   where oi.order_id = p_order and oi.item_type = 'BUNDLE' and pr.supply_mode = 'OWN_STOCK';

  if not exists (select 1 from public.order_items where order_id = p_order and not is_gift) then
    raise exception 'В заказе ничего не осталось — если клиент отказался, отмените заказ';
  end if;

  -- The «рывок» itself never counts towards the gift, only the products on top (same rule as at checkout).
  v_gift := private.apply_order_gift(p_order, v_extras);
  select coalesce(sum(line_total), 0) into v_bundle from public.order_items where order_id = p_order and item_type = 'BUNDLE';
  select coalesce(sum(line_cogs), 0) into v_cogs from public.order_items where order_id = p_order;
  v_goods := v_bundle + v_extras;
  select c.phone into v_phone from public.customers c where c.id = o.customer_id;
  v_quote := private.delivery_quote(o.delivery_zone_id, v_phone, o.fulfillment_type, v_goods);
  v_fee := case when o.fulfillment_type = 'delivery' then coalesce((v_quote->>'fee')::numeric, 0) else 0 end;
  update public.orders
     set subtotal = case when v_bundle > 0 then o.subtotal - v_old_extras + v_extras else v_extras end,
         discount_total = case when v_bundle > 0 then o.discount_total else 0 end,
         delivery_fee = v_fee, total = v_goods + v_fee, cogs_total = v_cogs, gross_profit = v_goods - v_cogs, gift_cost_total = v_gift
   where id = p_order;

  -- Supplier parts: totals from the lines; a supplier with nothing left is cancelled (or dropped before «Принят»).
  insert into public.supplier_order_groups(order_id, supplier_id, supplier_total)
  select p_order, supplier_id, sum(supplier_cost_snapshot * quantity) from public.order_items
   where order_id = p_order and supplier_id is not null group by supplier_id
  on conflict (order_id, supplier_id) do update set supplier_total = excluded.supplier_total;
  if o.status = 'NEW' then
    delete from public.supplier_order_groups g where g.order_id = p_order
       and not exists (select 1 from public.order_items oi where oi.order_id = p_order and oi.supplier_id = g.supplier_id);
  else
    update public.supplier_order_groups g set status = 'CANCELLED', supplier_total = 0 where g.order_id = p_order
       and not exists (select 1 from public.order_items oi where oi.order_id = p_order and oi.supplier_id = g.supplier_id);
  end if;

  v_after := private.order_lines_snapshot(p_order);
  select coalesce(jsonb_agg(k), '[]'::jsonb) into v_changed from jsonb_object_keys(v_after) k
   where k <> 'none' and v_after->k is distinct from v_before->k;
  select coalesce(jsonb_agg(k), '[]'::jsonb) into v_removed from jsonb_object_keys(v_before) k
   where k <> 'none' and not v_after ? k;
  -- A supplier whose list changed after «Принят» prepares it again.
  if o.status <> 'NEW' then
    update public.supplier_order_groups set status = 'NEW', ready_at = null, missing_note = null
     where order_id = p_order and supplier_id::text in (select jsonb_array_elements_text(v_changed));
  end if;

  if v_after is distinct from v_before or v_writeoff > 0 then
    insert into public.order_edits(order_id, actor, actor_name, before, after, total_before, total_after)
    values (p_order, p_role, p_actor, v_before, v_after, o.total, v_goods + v_fee);
    perform private.tg_post(jsonb_build_object('action', 'order_edited', 'order_id', p_order, 'by', p_role, 'actor', p_actor,
      'changed', v_changed, 'removed', v_removed, 'total_before', o.total, 'writeoff', v_writeoff, 'charged_to', v_charge));
  end if;
  return jsonb_build_object('saved', true, 'writeoff', v_writeoff, 'charged_to', v_charge, 'changed', jsonb_array_length(v_changed) + jsonb_array_length(v_removed));
end $$;
revoke all on function private.order_edit_apply(uuid, jsonb, boolean, text, text, text) from public, anon, authenticated;

-- 6. Entry points. Without p_items they only return the order for the page.
-- Customer: by the order id the browser saved at checkout (a random uuid), only before «Принят».
create or replace function public.order_edit(p_order uuid, p_items jsonb default null, p_keep_bundle boolean default true)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare r jsonb;
begin
  if p_items is not null then r := private.order_edit_apply(p_order, p_items, p_keep_bundle, 'CUSTOMER', 'Клиент'); end if;
  return private.order_edit_view(p_order, 'CUSTOMER') || coalesce(r, '{}'::jsonb);
end $$;
revoke all on function public.order_edit(uuid, jsonb, boolean) from public;
grant execute on function public.order_edit(uuid, jsonb, boolean) to anon, authenticated;

-- Admin panel.
create or replace function public.order_edit_staff(p_order uuid, p_items jsonb default null, p_keep_bundle boolean default true,
                                                   p_charge text default 'DRIVER')
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare r jsonb; v_name text;
begin
  if not private.is_staff() then raise exception 'Forbidden'; end if;
  select coalesce(nullif(full_name, ''), 'Админ') into v_name from public.profiles where id = auth.uid();
  if p_items is not null then r := private.order_edit_apply(p_order, p_items, p_keep_bundle, 'ADMIN', coalesce(v_name, 'Админ'), p_charge); end if;
  return private.order_edit_view(p_order, 'ADMIN') || coalesce(r, '{}'::jsonb);
end $$;
revoke all on function public.order_edit_staff(uuid, jsonb, boolean, text) from public, anon;
grant execute on function public.order_edit_staff(uuid, jsonb, boolean, text) to authenticated;

-- Telegram (edge function only): the courier who took the order, or the owner. Identified by the verified chat id.
create or replace function public.tg_order_edit(p_chat bigint, p_order uuid, p_items jsonb default null, p_keep_bundle boolean default true,
                                                p_charge text default 'DRIVER')
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare v_id uuid; v_name text := 'Владелец'; v_role text; r jsonb; v_driver uuid;
begin
  if exists (select 1 from public.telegram_links where kind = 'OWNER' and active and chat_id = p_chat) then
    v_role := 'ADMIN';
  else
    select dr.id, dr.name into v_id, v_name from public.telegram_links l join public.drivers dr on dr.id = l.ref_id
     where l.kind = 'DRIVER' and l.active and l.chat_id = p_chat and dr.active limit 1;
    if v_id is null then raise exception 'Вы не подключены к боту как курьер'; end if;
    select driver_id into v_driver from public.delivery_assignments where order_id = p_order;
    if v_driver is distinct from v_id then raise exception 'Этот заказ не ваш — менять его может курьер, который его взял'; end if;
    v_role := 'DRIVER';
  end if;
  if p_items is not null then
    r := private.order_edit_apply(p_order, p_items, p_keep_bundle, v_role, v_name, case when v_role = 'ADMIN' then p_charge else 'DRIVER' end);
  end if;
  return private.order_edit_view(p_order, v_role) || coalesce(r, '{}'::jsonb);
end $$;
revoke all on function public.tg_order_edit(bigint, uuid, jsonb, boolean, text) from public, anon, authenticated;
grant execute on function public.tg_order_edit(bigint, uuid, jsonb, boolean, text) to service_role;

-- 7. Cancelled after «Принят»: the poured beer is written off (on the courier who had the order, else on the owner).
create or replace function private.orders_writeoff_cancel()
returns trigger language plpgsql security definer set search_path to ''
as $$
declare v_driver uuid;
begin
  if new.status = 'CANCELLED' and old.status in ('CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY') then
    select driver_id into v_driver from public.delivery_assignments where order_id = new.id;
    insert into public.order_writeoffs(order_id, supplier_id, product_id, name, unit, quantity, unit_cost, reason, charged_to, driver_id, created_by)
    select new.id, oi.supplier_id, oi.product_id, oi.name_snapshot, oi.unit_snapshot, oi.quantity, coalesce(oi.supplier_cost_snapshot, 0),
           'CANCEL', case when v_driver is null then 'OWNER' else 'DRIVER' end, v_driver, 'Отмена заказа'
      from public.order_items oi where oi.order_id = new.id and not oi.is_gift and oi.unit_snapshot = 'liter';
  end if;
  return new;
end $$;
drop trigger if exists orders_writeoff_cancel on public.orders;
create trigger orders_writeoff_cancel after update of status on public.orders
  for each row execute function private.orders_writeoff_cancel();
