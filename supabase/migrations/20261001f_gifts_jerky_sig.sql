-- Owner, 2026-10-01: gifts on regular products (bundles don't count):
--   from 50 ₾ — Jerky chicken 30 g + Jerky pork 30 g (one of each), from 100 ₾ — сиг сушёный 1 шт.
-- A threshold can now hold several products; the order gets every product of the highest reached threshold
-- (not the lower level too). If none of them is in stock, the next lower threshold is tried.

create or replace function private.apply_order_gift(p_order uuid, p_subtotal numeric)
returns numeric language plpgsql security definer set search_path to ''
as $$
declare lvl numeric; g record; v_sid uuid; v_cost numeric; v_total numeric;
begin
  for lvl in
    select distinct gt.threshold from public.gift_tiers gt join public.products p on p.id = gt.product_id
     where gt.active and p.active and gt.threshold <= p_subtotal order by gt.threshold desc
  loop
    v_total := 0;
    for g in
      select gt.product_id, gt.quantity, p.name, p.sku, p.unit, p.purchase_price, p.supply_mode
        from public.gift_tiers gt join public.products p on p.id = gt.product_id
       where gt.active and p.active and gt.threshold = lvl order by gt.sort_order, p.name
    loop
      if g.supply_mode = 'OWN_STOCK' and public.available_stock(g.product_id) < g.quantity then continue; end if;
      v_sid := null; v_cost := coalesce(g.purchase_price, 0);
      select r.supplier_id, r.cost into v_sid, v_cost from private.resolve_supplier(g.product_id) r;
      v_cost := coalesce(v_cost, g.purchase_price, 0);
      insert into public.order_items(order_id, product_id, item_type, name_snapshot, sku_snapshot, unit_snapshot, quantity,
        unit_price_snapshot, unit_cost_snapshot, line_total, line_cogs, is_gift, supplier_id, supplier_cost_snapshot)
      values (p_order, g.product_id, 'PRODUCT', g.name, g.sku, g.unit, g.quantity, 0, v_cost, 0, v_cost * g.quantity, true, v_sid, v_cost);
      if g.supply_mode = 'OWN_STOCK' then
        insert into public.stock_reservations(product_id, order_id, quantity, expires_at)
        values (g.product_id, p_order, g.quantity, now() + interval '20 minutes');
      end if;
      if v_sid is not null then
        insert into public.supplier_order_groups(order_id, supplier_id, supplier_total) values (p_order, v_sid, v_cost * g.quantity)
        on conflict (order_id, supplier_id) do update set supplier_total = public.supplier_order_groups.supplier_total + excluded.supplier_total;
      end if;
      v_total := v_total + v_cost * g.quantity;
    end loop;
    if v_total > 0 then return v_total; end if;
  end loop;
  return 0;
end $$;

-- One threshold may hold several products now (was: one row per threshold).
alter table public.gift_tiers drop constraint if exists gift_tiers_threshold_key;
alter table public.gift_tiers add constraint gift_tiers_threshold_product_key unique (threshold, product_id);

-- Tiers: 60 ₾ ставрида → 50 ₾ Jerky chicken; + 50 ₾ Jerky pork; 100 ₾ сиг stays.
update public.gift_tiers gt set threshold = 50, product_id = p.id, quantity = 1, sort_order = 10, active = true
  from public.products p
 where p.sku = 'KRI-MEAT-JERKY-CHK-030' and gt.threshold = 60
   and gt.product_id = (select id from public.products where sku = 'DAV-FISH-STR-030');
insert into public.gift_tiers(threshold, product_id, quantity, active, sort_order)
select 50, p.id, 1, true, 11 from public.products p
 where p.sku = 'KRI-MEAT-JERKY-PORK-030'
   and not exists (select 1 from public.gift_tiers gt where gt.threshold = 50 and gt.product_id = p.id);
update public.gift_tiers gt set quantity = 1, active = true, sort_order = 20
 where gt.threshold = 100 and gt.product_id = (select id from public.products where sku = 'DAV-FISH-SIG-001');
