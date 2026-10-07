-- Owner, 2026-10-07.
-- 1) Мндо's oven: ONE oven, a load = 2 pizzas/khachapuri OR 5 lahmajo (meat and cheese together), ~15 min a load;
--    loads go one after another (2 pizzas + 2 lahmajo = 15 + 15 = 30 min; 6 lahmajo = 30 min; 3 pizzas = 30 min).
--    The whole order is picked up at that time — every supplier of the order is told the same, longest time.
-- 2) A «рывок» line that is out of stock can be REPLACED in «Изменить заказ» (site, admin, Telegram), not only removed:
--    dearer → the customer pays the difference, cheaper → less; the рывок's discount percent stays the same.
--    Sent inside p_items as {"swap_from", "product_id", "quantity"} → no change for the Telegram bot.
update public.products p set prep_minutes = 15, prep_batch = 2
  from public.categories c where c.id = p.category_id and c.slug = 'pizza' and p.sku not like 'KRI-FOOD-LAHMAJO-%';
update public.products set prep_minutes = 15, prep_batch = 5 where sku like 'KRI-FOOD-LAHMAJO-%';

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
                 'items', jsonb_agg(jsonb_build_object('product_id', oi.product_id, 'name', oi.name_snapshot, 'qty', trim_scale(oi.quantity), 'unit', oi.unit_snapshot,
                   'line_total', oi.line_total, 'category_id', bp.category_id,
                   'supplier', case when p_role <> 'CUSTOMER' then s.name end,
                   'cost', case when p_role <> 'CUSTOMER' then oi.supplier_cost_snapshot end) order by oi.name_snapshot))
                 from public.order_items oi left join public.suppliers s on s.id = oi.supplier_id
                 left join public.products bp on bp.id = oi.product_id
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

create or replace function private.order_edit_apply(p_order uuid, p_items jsonb, p_keep_bundle boolean, p_role text,
                                                    p_actor text, p_charge text default 'DRIVER')
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare o public.orders; v_driver uuid; v_before jsonb; v_after jsonb; v_old jsonb; v_new jsonb; v_keep boolean;
  r record; p record; e record; v_price numeric; v_sid uuid; v_cost numeric; v_newq numeric;
  v_old_extras numeric; v_extras numeric := 0; v_bundle numeric; v_gift numeric; v_goods numeric; v_cogs numeric;
  v_phone text; v_quote jsonb; v_fee numeric; v_charge text; v_writeoff numeric := 0; v_changed jsonb; v_removed jsonb;
  v_swaps jsonb; sw record; bl public.order_items; v_from_sale numeric; v_factor numeric; v_line numeric; v_q numeric;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Заказ не найден'; end if;
  if p_role = 'CUSTOMER' and o.status <> 'NEW' then
    raise exception 'Заказ уже принят курьером — изменить его можно, только позвонив курьеру';
  end if;
  if o.status not in ('NEW', 'CONFIRMED', 'PREPARING') then raise exception 'Заказ уже собран — менять поздно'; end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then raise exception 'Неверный список товаров'; end if;
  -- A «рывок» line that is out of stock is replaced: {"swap_from": <product in the рывок>, "product_id": <new>, "quantity": n}.
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_swaps from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x where x ? 'swap_from';
  select coalesce(jsonb_agg(x), '[]'::jsonb) into p_items from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x where not x ? 'swap_from';

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

  -- Swaps inside the «рывок». The line keeps the рывок's discount percent: new price = new product × the same factor
  -- the old line had against its product's own price (dearer → the customer pays the difference, cheaper → less).
  if v_keep then
    for sw in select (x->>'swap_from')::uuid sfrom, (x->>'product_id')::uuid sto, nullif(x->>'quantity', '')::numeric sq
                from jsonb_array_elements(v_swaps) x loop
      select * into bl from public.order_items where order_id = p_order and item_type = 'BUNDLE' and product_id = sw.sfrom limit 1;
      if bl.id is null then raise exception 'В рывке нет такого товара'; end if;
      if sw.sto = sw.sfrom then continue; end if;
      select pr.id, pr.name, pr.sku, pr.unit, pr.purchase_price, pr.supply_mode, pr.active and coalesce(cp.active, true) active,
             coalesce(cp.sale_price, pr.sale_price, 0) sale_price,
             coalesce(cp.minimum_quantity, pr.minimum_quantity, 1) minimum_quantity, coalesce(cp.quantity_step, pr.quantity_step, 1) quantity_step
        into p from public.products pr left join public.city_products cp on cp.product_id = pr.id and cp.city_id = o.city_id
       where pr.id = sw.sto;
      if p.id is null or not p.active then raise exception 'Товар для замены недоступен'; end if;
      v_q := coalesce(sw.sq, case when p.unit = bl.unit_snapshot then bl.quantity else p.minimum_quantity end);
      if v_q < p.minimum_quantity or mod(v_q - p.minimum_quantity, p.quantity_step) <> 0 then
        raise exception 'Неверное количество: %', p.name;
      end if;
      select coalesce(cp.sale_price, pr.sale_price, 0) into v_from_sale
        from public.products pr left join public.city_products cp on cp.product_id = pr.id and cp.city_id = o.city_id where pr.id = bl.product_id;
      v_factor := case when coalesce(v_from_sale, 0) * bl.quantity > 0 then bl.line_total / (v_from_sale * bl.quantity) else 1 end;
      v_line := round(p.sale_price * v_q * v_factor, 2);
      v_sid := null; v_cost := null;
      select rs.supplier_id, rs.cost into v_sid, v_cost from private.resolve_supplier(p.id) rs;
      v_cost := coalesce(v_cost, p.purchase_price, 0);
      update public.order_items
         set product_id = p.id, name_snapshot = p.name, sku_snapshot = p.sku, unit_snapshot = p.unit, quantity = v_q,
             unit_price_snapshot = round(v_line / v_q, 4), line_total = v_line, unit_cost_snapshot = v_cost, line_cogs = v_cost * v_q,
             supplier_id = v_sid, supplier_cost_snapshot = v_cost
       where id = bl.id;
      -- The order's own figures move with it: the regular price by the price list, the discount keeps its share.
      o.subtotal := o.subtotal + (p.sale_price * v_q - coalesce(v_from_sale, 0) * bl.quantity);
      o.discount_total := o.discount_total + ((p.sale_price * v_q - coalesce(v_from_sale, 0) * bl.quantity) - (v_line - bl.line_total));
    end loop;
  end if;

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
      v_price := private.night_price(p.sale_price); v_sid := null; v_cost := null;
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
