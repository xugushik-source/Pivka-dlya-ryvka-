-- Owner, 2026-10-10: night stock (23:00–11:00).
-- By day everything goes to the suppliers as before. At night the shops are closed: the night assortment
-- (products with sell_from = null — strong drinks and snacks) is sold only from the owner's own stock, which the owner
-- takes from the same suppliers. The stock stays the supplier's goods on hold (consignment): the supplier is owed only
-- for what is sold, at the purchase price, in his usual daily total (order_items.supplier_id stays the supplier).
--   orders.from_stock   — set when an order is created at night; such an order gets no supplier parts and no supplier messages;
--                         the courier takes the goods from the stock.
--   products.stock_quantity — what is physically on the night stock (night products only).
--   left = stock_quantity − lines of open night orders (NEW … OUT_FOR_DELIVERY); delivered → stock goes down.
--   stock_moves         — receipts (owner's bot «📥 Приход»), sales, refunds.

alter table public.orders add column if not exists from_stock boolean not null default false;

create table if not exists public.stock_moves (
  id bigserial primary key,
  product_id uuid not null references public.products(id),
  supplier_id uuid references public.suppliers(id),
  qty numeric(12,3) not null,
  kind text not null check (kind in ('IN', 'BACK', 'SALE', 'RETURN')),
  unit_cost numeric(12,2),
  order_id uuid references public.orders(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists stock_moves_at_idx on public.stock_moves(created_at desc);
alter table public.stock_moves enable row level security;
drop policy if exists stock_moves_staff on public.stock_moves;
create policy stock_moves_staff on public.stock_moves for select to authenticated using (public.is_staff());

create or replace function private.night_now() returns boolean language sql stable set search_path to ''
as $$ select not private.in_window((now() at time zone 'Asia/Tbilisi')::time, '11:00'::time, '23:00'::time) $$;

create or replace function private.stock_item(p_product uuid) returns boolean language sql stable security definer set search_path to ''
as $$ select exists (select 1 from public.products p where p.id = p_product and p.sell_from is null and p.supply_mode::text <> 'OWN_STOCK') $$;

create or replace function private.stock_left(p_product uuid) returns numeric language sql stable security definer set search_path to ''
as $$
  select greatest(coalesce((select stock_quantity from public.products where id = p_product), 0)
    - coalesce((select sum(oi.quantity) from public.order_items oi join public.orders o on o.id = oi.order_id
                 where oi.product_id = p_product and o.from_stock and o.status in ('NEW', 'CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY')), 0), 0)
$$;

-- An order created at night is a stock order.
create or replace function private.trg_order_from_stock() returns trigger language plpgsql set search_path to ''
as $$ begin new.from_stock := coalesce(private.night_now(), false); return new; end $$;
drop trigger if exists orders_from_stock on public.orders;
create trigger orders_from_stock before insert on public.orders for each row execute function private.trg_order_from_stock();

-- A stock order cannot take more than is left.
create or replace function private.trg_item_stock() returns trigger language plpgsql security definer set search_path to ''
as $$
declare v_name text; v_left numeric;
begin
  if not coalesce((select from_stock from public.orders where id = new.order_id), false) or not private.stock_item(new.product_id) then
    return new;
  end if;
  select name into v_name from public.products where id = new.product_id for update;   -- one order at a time per product
  v_left := private.stock_left(new.product_id) + case when tg_op = 'UPDATE' and old.product_id = new.product_id then old.quantity else 0 end;
  if new.quantity > v_left then
    raise exception 'Ночью продаём со склада: «%» осталось %', v_name, trim_scale(v_left);
  end if;
  return new;
end $$;
drop trigger if exists order_items_stock on public.order_items;
create trigger order_items_stock before insert or update of product_id, quantity on public.order_items
  for each row execute function private.trg_item_stock();

-- No supplier parts for a stock order: the supplier is not asked to prepare anything.
create or replace function private.trg_group_skip_stock() returns trigger language plpgsql security definer set search_path to ''
as $$ begin
  if coalesce((select from_stock from public.orders where id = new.order_id), false) then return null; end if;
  return new;
end $$;
drop trigger if exists supplier_groups_skip_stock on public.supplier_order_groups;
create trigger supplier_groups_skip_stock before insert on public.supplier_order_groups
  for each row execute function private.trg_group_skip_stock();

-- Delivered → the goods left the stock; refunded → back.
create or replace function private.trg_order_stock_out() returns trigger language plpgsql security definer set search_path to ''
as $$
declare r record; v_sign int;
begin
  if not new.from_stock or new.status = old.status then return null; end if;
  if new.status = 'DELIVERED' then v_sign := -1;
  elsif new.status = 'REFUNDED' and old.status = 'DELIVERED' then v_sign := 1;
  else return null; end if;
  for r in select oi.product_id, oi.supplier_id, sum(oi.quantity) q, max(oi.supplier_cost_snapshot) cost
             from public.order_items oi where oi.order_id = new.id and private.stock_item(oi.product_id) group by 1, 2 loop
    update public.products set stock_quantity = stock_quantity + v_sign * r.q where id = r.product_id;
    insert into public.stock_moves(product_id, supplier_id, qty, kind, unit_cost, order_id)
    values (r.product_id, r.supplier_id, v_sign * r.q, case when v_sign < 0 then 'SALE' else 'RETURN' end, r.cost, new.id);
  end loop;
  return null;
end $$;
drop trigger if exists orders_stock_out on public.orders;
create trigger orders_stock_out after update of status on public.orders for each row execute function private.trg_order_stock_out();

-- Owner took goods to the stock (qty > 0) or gave them back / fixed a mistake (qty < 0).
create or replace function private.stock_in(p_product uuid, p_qty numeric, p_note text default null)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare p public.products; v_sid uuid; v_cost numeric;
begin
  select * into p from public.products where id = p_product for update;
  if p.id is null or not private.stock_item(p_product) then return jsonb_build_object('error', 'not_stock_item'); end if;
  if coalesce(p_qty, 0) = 0 then return jsonb_build_object('error', 'qty'); end if;
  if p.stock_quantity + p_qty < 0 then return jsonb_build_object('error', 'below_zero', 'stock', trim_scale(p.stock_quantity)); end if;
  select r.supplier_id, r.cost into v_sid, v_cost from private.resolve_supplier(p_product) r;
  v_cost := coalesce(v_cost, p.purchase_price, 0);
  update public.products set stock_quantity = stock_quantity + p_qty where id = p_product;
  insert into public.stock_moves(product_id, supplier_id, qty, kind, unit_cost, note)
  values (p_product, v_sid, p_qty, case when p_qty > 0 then 'IN' else 'BACK' end, v_cost, p_note);
  return jsonb_build_object('ok', true, 'name', p.name, 'unit', p.unit, 'qty', trim_scale(p_qty), 'stock', trim_scale(p.stock_quantity + p_qty),
    'left', trim_scale(private.stock_left(p_product)), 'cost', v_cost, 'supplier_id', v_sid,
    'supplier', (select name from public.suppliers where id = v_sid));
end $$;

-- Site: at night shows «осталось N» and hides what is gone.
create or replace function public.night_stock()
returns table (product_id uuid, left_qty numeric) language sql stable security definer set search_path to ''
as $$ select p.id, trim_scale(private.stock_left(p.id)) from public.products p
       where p.active and p.sell_from is null and p.supply_mode::text <> 'OWN_STOCK' $$;
grant execute on function public.night_stock() to anon, authenticated;

-- Start from zero (owner, 2026-10-10).
update public.products set stock_quantity = 0 where sell_from is null and supply_mode::text <> 'OWN_STOCK';

revoke all on function private.stock_in(uuid, numeric, text) from public, anon, authenticated;
