-- Ready "Рывки": price follows current retail prices of the components.
--   regular_total = Σ sale_price × quantity         (city price override respected)
--   bundle_price  = regular_total − discount_value   (FIXED)
--                 = regular_total × (1 − value/100)  (PERCENT)
--   bundle_cost   = Σ purchase_price × quantity      (never affects the customer price)
--   bundle_profit = bundle_price − bundle_cost
-- bundles.price / compare_at_price are legacy static numbers and are no longer read.

alter table public.bundles
  add column if not exists discount_type text not null default 'FIXED',
  add column if not exists discount_value numeric(12,2) not null default 0,
  add column if not exists min_margin_percent numeric(6,2) not null default 10,
  add column if not exists block_below_cost boolean not null default false;
alter table public.bundles drop constraint if exists bundles_discount_type_check;
alter table public.bundles add constraint bundles_discount_type_check check (discount_type in ('FIXED','PERCENT'));
alter table public.bundles drop constraint if exists bundles_discount_value_check;
alter table public.bundles add constraint bundles_discount_value_check check (discount_value >= 0 and (discount_type <> 'PERCENT' or discount_value <= 100));
alter table public.bundles alter column price drop not null;
comment on column public.bundles.price is 'LEGACY, not used: bundle price is computed by private.bundle_calc from current component sale prices';
comment on column public.bundles.compare_at_price is 'LEGACY, not used: regular total is computed by private.bundle_calc';
comment on column public.bundles.block_below_cost is 'If true, the bundle is not sold while its computed price is below component cost';

-- Localized product names: {"ka": "...", "hy": "..."}; products.name stays the RU/base name.
alter table public.products add column if not exists name_i18n jsonb not null default '{}'::jsonb;

create or replace function private.bundle_calc(p_city uuid default null)
returns table(
  bundle_id uuid, regular_total numeric, bundle_price numeric, savings numeric, savings_percent numeric,
  bundle_cost numeric, bundle_profit numeric, margin_percent numeric, margin_status text,
  available boolean, unavailable_reason text, items jsonb)
language sql stable security definer set search_path = ''
as $$
with lines as (
  select bi.bundle_id, bi.quantity, p.id product_id, p.sku, p.name, p.name_i18n, p.unit, p.image_url,
         coalesce(cp.sale_price, p.sale_price, 0) sale_price,
         coalesce(cp.purchase_price, p.purchase_price, 0) purchase_price,
         case
           when p.id is null then 'PRODUCT_MISSING'
           when not p.active then 'PRODUCT_INACTIVE'
           when c.id is not null and not c.active then 'CATEGORY_INACTIVE'
           when cp.active is false then 'NOT_IN_CITY'
           when p.supply_mode = 'OWN_STOCK' and public.available_stock(p.id) < bi.quantity then 'OUT_OF_STOCK'
         end problem
  from public.bundle_items bi
  left join public.products p on p.id = bi.product_id
  left join public.categories c on c.id = p.category_id
  left join public.city_products cp on cp.product_id = p.id and cp.city_id = p_city
),
agg as (
  select b.id, b.discount_type, b.discount_value, b.min_margin_percent, b.block_below_cost,
         coalesce(sum(l.sale_price * l.quantity), 0) regular_total,
         coalesce(sum(l.purchase_price * l.quantity), 0) bundle_cost,
         count(l.bundle_id) n_items,
         (array_agg(l.problem order by l.name) filter (where l.problem is not null))[1] problem,
         exists(select 1 from public.city_bundles cb where cb.bundle_id = b.id and cb.city_id = p_city and not cb.active) city_off,
         coalesce(jsonb_agg(jsonb_build_object(
           'product_id', l.product_id, 'sku', l.sku, 'name', l.name, 'name_i18n', l.name_i18n, 'unit', l.unit,
           'image_url', l.image_url, 'quantity', l.quantity, 'sale_price', l.sale_price,
           'available', l.problem is null, 'problem', l.problem) order by l.sale_price * l.quantity desc)
           filter (where l.bundle_id is not null), '[]'::jsonb) items
  from public.bundles b left join lines l on l.bundle_id = b.id
  group by b.id
),
priced as (
  select a.*,
         case when a.discount_type = 'PERCENT'
              then round(a.regular_total * (1 - least(a.discount_value, 100) / 100), 2)
              else greatest(round(a.regular_total - a.discount_value, 2), 0) end bundle_price
  from agg a
),
econ as (
  select p.*, p.bundle_price - p.bundle_cost bundle_profit,
         case when p.bundle_price > 0 then round((p.bundle_price - p.bundle_cost) / p.bundle_price * 100, 1) end margin_percent,
         case when p.bundle_price - p.bundle_cost < 0 then 'BELOW_COST'
              when p.bundle_price = 0 or (p.bundle_price - p.bundle_cost) / p.bundle_price * 100 < p.min_margin_percent then 'LOW_MARGIN'
              else 'OK' end margin_status
  from priced p
)
select e.id, e.regular_total, e.bundle_price, e.regular_total - e.bundle_price,
       case when e.regular_total > 0 then round((e.regular_total - e.bundle_price) / e.regular_total * 100) else 0 end,
       e.bundle_cost, e.bundle_profit, e.margin_percent, e.margin_status,
       e.n_items > 0 and e.problem is null and not e.city_off and not (e.block_below_cost and e.margin_status = 'BELOW_COST'),
       case when e.n_items = 0 then 'EMPTY'
            when e.problem is not null then e.problem
            when e.city_off then 'NOT_IN_CITY'
            when e.block_below_cost and e.margin_status = 'BELOW_COST' then 'BELOW_COST_BLOCKED' end,
       e.items
from econ e
$$;
revoke all on function private.bundle_calc(uuid) from public, anon, authenticated;

-- Storefront: active bundles with live prices. No cost data is exposed.
create or replace function public.list_bundle_offers(p_city uuid default null)
returns table(id uuid, name text, description text, badge_text text, image_url text, sort_order integer, featured boolean,
              discount_type text, discount_value numeric, regular_total numeric, price numeric, savings numeric,
              savings_percent numeric, available boolean, unavailable_reason text, items jsonb)
language sql stable security definer set search_path = ''
as $$
  select b.id, b.name, b.description, b.badge_text, b.image_url, b.sort_order, b.featured,
         b.discount_type, b.discount_value, x.regular_total, x.bundle_price, x.savings, x.savings_percent,
         x.available, x.unavailable_reason, x.items
  from public.bundles b join private.bundle_calc(p_city) x on x.bundle_id = b.id
  where b.active
  order by b.sort_order, b.name
$$;
grant execute on function public.list_bundle_offers(uuid) to anon, authenticated;

-- Admin: economics of every bundle, including disabled ones.
create or replace function public.bundle_economics(p_city uuid default null)
returns table(id uuid, name text, active boolean, discount_type text, discount_value numeric, min_margin_percent numeric,
              block_below_cost boolean, regular_total numeric, price numeric, savings numeric, cost numeric, profit numeric,
              margin_percent numeric, margin_status text, available boolean, unavailable_reason text, items jsonb)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_staff() then raise exception 'Staff only'; end if;
  return query
  select b.id, b.name, b.active, b.discount_type, b.discount_value, b.min_margin_percent, b.block_below_cost,
         x.regular_total, x.bundle_price, x.savings, x.bundle_cost, x.bundle_profit, x.margin_percent, x.margin_status,
         x.available, x.unavailable_reason, x.items
  from public.bundles b join private.bundle_calc(p_city) x on x.bundle_id = b.id
  order by b.sort_order, b.name;
end $$;
revoke all on function public.bundle_economics(uuid) from public, anon;
grant execute on function public.bundle_economics(uuid) to authenticated;

-- Gifts: only the highest reached tier is granted (first one that can actually be supplied).
-- Supplier-supplied SKUs no longer need warehouse stock; gift lines are routed to the supplier.
create or replace function private.apply_order_gift(p_order uuid, p_subtotal numeric)
returns numeric language plpgsql security definer set search_path = ''
as $$
declare g record; v_sid uuid; v_cost numeric;
begin
  for g in
    select gt.product_id, gt.quantity, p.name, p.sku, p.unit, p.purchase_price, p.supply_mode
    from public.gift_tiers gt join public.products p on p.id = gt.product_id
    where gt.active and p.active and gt.threshold <= p_subtotal
    order by gt.threshold desc
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
    return v_cost * g.quantity;
  end loop;
  return 0;
end $$;

-- Bundle checkout: live price, supplier-aware components, optional extra products in the SAME order
-- (one delivery, one gift evaluated on the whole basket). Old 7-argument calls keep working via defaults.
drop function if exists public.create_bundle_order(text, text, text, text, text, text, uuid);
create or replace function public.create_bundle_order(
  p_name text, p_phone text, p_fulfillment text, p_address text, p_payment text, p_comment text, p_bundle uuid,
  p_city uuid default null, p_items jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare b public.bundles%rowtype; x record; l record; i jsonb; p record;
  v_customer uuid; v_order uuid; v_num bigint; v_sid uuid; v_cost numeric; v_share numeric; v_left numeric; v_n int; v_k int := 0;
  v_qty numeric; v_extra numeric := 0; v_cogs numeric := 0; v_gift numeric := 0; v_total numeric;
begin
  select * into b from public.bundles where id = p_bundle and active;
  if not found then raise exception 'Bundle unavailable'; end if;
  select * into x from private.bundle_calc(p_city) c where c.bundle_id = b.id;
  if not x.available then raise exception 'Bundle unavailable: %', x.unavailable_reason; end if;
  if coalesce(trim(p_phone), '') = '' then raise exception 'Phone required'; end if;
  if p_fulfillment not in ('pickup', 'delivery') then raise exception 'Invalid fulfillment'; end if;
  if p_fulfillment = 'delivery' and coalesce(trim(p_address), '') = '' then raise exception 'Address required'; end if;

  insert into public.customers(phone, full_name, last_order_at) values (trim(p_phone), nullif(trim(p_name), ''), now())
  on conflict (phone) do update set full_name = coalesce(excluded.full_name, public.customers.full_name), last_order_at = now()
  returning id into v_customer;
  insert into public.orders(customer_id, fulfillment_type, address_snapshot, payment_method, comment, age_confirmed, city_id)
  values (v_customer, p_fulfillment, p_address, p_payment, p_comment, true, p_city) returning id, order_number into v_order, v_num;

  -- Bundle components: bundle price is allocated across lines proportionally to their retail value.
  select count(*) into v_n from public.bundle_items where bundle_id = b.id;
  v_left := x.bundle_price;
  for l in
    select bi.quantity, pr.id, pr.name, pr.sku, pr.unit, pr.purchase_price, pr.supply_mode,
           coalesce(cp.sale_price, pr.sale_price, 0) sale_price
    from public.bundle_items bi join public.products pr on pr.id = bi.product_id
    left join public.city_products cp on cp.product_id = pr.id and cp.city_id = p_city
    where bi.bundle_id = b.id order by coalesce(cp.sale_price, pr.sale_price, 0) * bi.quantity, pr.sku
  loop
    v_k := v_k + 1;
    v_share := case when v_k = v_n then v_left
                    when x.regular_total > 0 then round(x.bundle_price * l.sale_price * l.quantity / x.regular_total, 2)
                    else 0 end;
    v_left := v_left - v_share;
    v_sid := null; v_cost := coalesce(l.purchase_price, 0);
    select r.supplier_id, r.cost into v_sid, v_cost from private.resolve_supplier(l.id) r;
    v_cost := coalesce(v_cost, l.purchase_price, 0);
    insert into public.order_items(order_id, product_id, item_type, name_snapshot, sku_snapshot, unit_snapshot, quantity,
      unit_price_snapshot, unit_cost_snapshot, line_total, line_cogs, is_gift, supplier_id, supplier_cost_snapshot)
    values (v_order, l.id, 'BUNDLE', l.name, l.sku, l.unit, l.quantity, round(v_share / l.quantity, 4), v_cost, v_share,
            v_cost * l.quantity, false, v_sid, v_cost);
    if l.supply_mode = 'OWN_STOCK' then
      insert into public.stock_reservations(product_id, order_id, quantity, expires_at)
      values (l.id, v_order, l.quantity, now() + interval '20 minutes');
    end if;
    if v_sid is not null then
      insert into public.supplier_order_groups(order_id, supplier_id, supplier_total) values (v_order, v_sid, v_cost * l.quantity)
      on conflict (order_id, supplier_id) do update set supplier_total = public.supplier_order_groups.supplier_total + excluded.supplier_total;
    end if;
    v_cogs := v_cogs + v_cost * l.quantity;
  end loop;

  -- Extra products added after choosing the bundle.
  for i in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    select pr.id, pr.name, pr.sku, pr.unit, pr.purchase_price, pr.supply_mode,
           coalesce(cp.sale_price, pr.sale_price) sale_price,
           coalesce(cp.minimum_quantity, pr.minimum_quantity) minimum_quantity,
           coalesce(cp.quantity_step, pr.quantity_step) quantity_step
    into p
    from public.products pr left join public.city_products cp on cp.product_id = pr.id and cp.city_id = p_city
    where pr.id = (i->>'product_id')::uuid and pr.active and coalesce(cp.active, true);
    if not found then raise exception 'Product unavailable'; end if;
    v_qty := (i->>'quantity')::numeric;
    if v_qty < p.minimum_quantity or mod(v_qty - p.minimum_quantity, p.quantity_step) <> 0 then
      raise exception 'Invalid quantity: %', p.name;
    end if;
    v_sid := null; v_cost := coalesce(p.purchase_price, 0);
    select r.supplier_id, r.cost into v_sid, v_cost from private.resolve_supplier(p.id) r;
    v_cost := coalesce(v_cost, p.purchase_price, 0);
    if p.supply_mode = 'OWN_STOCK' then
      if public.available_stock(p.id) < v_qty then raise exception 'Not enough stock: %', p.name; end if;
      insert into public.stock_reservations(product_id, order_id, quantity, expires_at)
      values (p.id, v_order, v_qty, now() + interval '20 minutes');
    end if;
    insert into public.order_items(order_id, product_id, item_type, name_snapshot, sku_snapshot, unit_snapshot, quantity,
      unit_price_snapshot, unit_cost_snapshot, line_total, line_cogs, is_gift, supplier_id, supplier_cost_snapshot)
    values (v_order, p.id, 'PRODUCT', p.name, p.sku, p.unit, v_qty, p.sale_price, v_cost, p.sale_price * v_qty, v_cost * v_qty, false, v_sid, v_cost);
    if v_sid is not null then
      insert into public.supplier_order_groups(order_id, supplier_id, supplier_total) values (v_order, v_sid, v_cost * v_qty)
      on conflict (order_id, supplier_id) do update set supplier_total = public.supplier_order_groups.supplier_total + excluded.supplier_total;
    end if;
    v_extra := v_extra + p.sale_price * v_qty;
    v_cogs := v_cogs + v_cost * v_qty;
  end loop;

  v_total := x.bundle_price + v_extra;
  v_gift := private.apply_order_gift(v_order, v_total);
  v_cogs := v_cogs + v_gift;
  update public.orders
     set subtotal = x.regular_total + v_extra, discount_total = x.savings, total = v_total,
         cogs_total = v_cogs, gross_profit = v_total - v_cogs, gift_cost_total = v_gift
   where id = v_order;
  return jsonb_build_object('order_id', v_order, 'order_number', v_num, 'total', v_total, 'gift_cost', v_gift,
    'bundle_price', x.bundle_price, 'regular_total', x.regular_total, 'savings', x.savings, 'extras_total', v_extra);
end $$;
grant execute on function public.create_bundle_order(text, text, text, text, text, text, uuid, uuid, jsonb) to anon, authenticated;

-- Social links showed the legacy static price; show the live one.
create or replace function public.get_social_order(p_token uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare s record;
begin
  select so.*, b.name bundle_name, (select c.bundle_price from private.bundle_calc(null) c where c.bundle_id = b.id) bundle_price,
         p.name product_name, p.sale_price product_price into s
  from public.social_orders so left join public.bundles b on b.id = so.bundle_id left join public.products p on p.id = so.product_id
  where so.token = p_token;
  if not found then raise exception 'Link not found'; end if;
  return to_jsonb(s) - 'sender_phone' - 'recipient_phone' - 'recipient_address';
end $$;
