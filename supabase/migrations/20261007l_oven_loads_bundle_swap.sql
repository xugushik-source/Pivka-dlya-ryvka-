-- Owner, 2026-10-07.
-- 1) Мндо's oven: ONE oven, a load = 2 pizzas/khachapuri OR 5 lahmajo (meat and cheese together), ~15 min a load;
--    loads go one after another (2 pizzas + 2 lahmajo = 15 + 15 = 30 min; 6 lahmajo = 30 min; 3 pizzas = 30 min).
--    The whole order is picked up at that time — every supplier of the order is told the same, longest time.
-- 2) A «рывок» line that is out of stock can be REPLACED in «Изменить заказ» (site, admin, Telegram), not only removed:
--    dearer → the customer pays the difference, cheaper → less; the рывок's discount percent stays the same.
--    Sent inside p_items as {"swap_from", "product_id", "quantity"} → no change for the Telegram bot.
-- Applied by the owner in the SQL editor as this compact patch of the live functions (tested on a local Postgres).
update products p set prep_minutes=15, prep_batch=2 from categories c where c.id=p.category_id and c.slug='pizza' and p.sku not like 'KRI-FOOD-LAHMAJO-%';
update products set prep_minutes=15, prep_batch=5 where sku like 'KRI-FOOD-LAHMAJO-%';
do $p$ declare d text;
begin
d := pg_get_functiondef('private.order_edit_view(uuid,text)'::regprocedure);
if position('category_id' in d) = 0 then
d := replace(d, $$jsonb_build_object('name', oi.name_snapshot, 'qty'$$, $$jsonb_build_object('product_id', oi.product_id, 'line_total', oi.line_total, 'category_id', (select bp.category_id from public.products bp where bp.id = oi.product_id), 'name', oi.name_snapshot, 'qty'$$);
execute d; end if;
d := pg_get_functiondef('private.order_edit_apply(uuid,jsonb,boolean,text,text,text)'::regprocedure);
if position('swap_from' in d) > 0 then return; end if;
d := replace(d, $$v_changed jsonb; v_removed jsonb;$$, $$v_changed jsonb; v_removed jsonb; v_swaps jsonb; sw record; bl public.order_items; v_fs numeric; v_k numeric; v_l numeric; v_q numeric;$$);
d := replace(d, $$  select driver_id into v_driver$$, $$  select coalesce(jsonb_agg(x), '[]') into v_swaps from jsonb_array_elements(coalesce(p_items, '[]')) x where x ? 'swap_from';
  select coalesce(jsonb_agg(x), '[]') into p_items from jsonb_array_elements(coalesce(p_items, '[]')) x where not x ? 'swap_from';
  select driver_id into v_driver$$);
d := replace(d, $$  for e in select key::uuid pid$$, $$  for sw in select (x->>'swap_from')::uuid f, (x->>'product_id')::uuid t, (x->>'quantity')::numeric q from jsonb_array_elements(v_swaps) x where v_keep loop
    select * into bl from public.order_items where order_id = p_order and item_type = 'BUNDLE' and product_id = sw.f limit 1;
    if bl.id is null then raise exception 'В рывке нет такого товара'; end if;
    select pr.id, pr.name, pr.sku, pr.unit, pr.purchase_price, pr.active and coalesce(cp.active, true) active, coalesce(cp.sale_price, pr.sale_price, 0) sale_price
      into p from public.products pr left join public.city_products cp on cp.product_id = pr.id and cp.city_id = o.city_id where pr.id = sw.t;
    if p.id is null or not p.active then raise exception 'Товар для замены недоступен'; end if;
    v_q := coalesce(sw.q, bl.quantity);
    select coalesce(cp.sale_price, pr.sale_price, 0) into v_fs from public.products pr left join public.city_products cp on cp.product_id = pr.id and cp.city_id = o.city_id where pr.id = bl.product_id;
    v_k := case when v_fs * bl.quantity > 0 then bl.line_total / (v_fs * bl.quantity) else 1 end;
    v_l := round(p.sale_price * v_q * v_k, 2);
    v_sid := null; v_cost := null;
    select rs.supplier_id, rs.cost into v_sid, v_cost from private.resolve_supplier(p.id) rs;
    v_cost := coalesce(v_cost, p.purchase_price, 0);
    update public.order_items set product_id = p.id, name_snapshot = p.name, sku_snapshot = p.sku, unit_snapshot = p.unit, quantity = v_q,
      unit_price_snapshot = round(v_l / v_q, 4), line_total = v_l, unit_cost_snapshot = v_cost, line_cogs = v_cost * v_q, supplier_id = v_sid, supplier_cost_snapshot = v_cost
     where id = bl.id;
    o.subtotal := o.subtotal + p.sale_price * v_q - v_fs * bl.quantity;
    o.discount_total := o.discount_total + (p.sale_price * v_q - v_fs * bl.quantity) - (v_l - bl.line_total);
  end loop;
  for e in select key::uuid pid$$);
if position('swap_from' in d) = 0 or position('v_swaps) x where v_keep' in d) = 0 then raise exception 'patch did not apply'; end if;
execute d;
end $p$;
