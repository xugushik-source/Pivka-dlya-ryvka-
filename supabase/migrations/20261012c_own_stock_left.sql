-- Own stock (МАДО etc.): what is left = on the shelf − everything in open orders. A reservation used to expire after
-- 20 minutes while the order was still on its way, so the same bottle could be sold twice.
create or replace function public.available_stock(p_product_id uuid)
returns numeric language sql stable security definer set search_path to '' as $function$
  select greatest(coalesce(p.stock_quantity, 0) - coalesce((
    select sum(oi.quantity) from public.order_items oi join public.orders o on o.id = oi.order_id
     where oi.product_id = p.id and o.status in ('NEW', 'CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY')), 0), 0)
  from public.products p where p.id = p_product_id
$function$;

-- What the storefront shows as «Осталось: N»: the night assortment (sold from the owner's night stock) and,
-- day and night, everything kept on our own shelf. own = true → the count applies around the clock.
drop function if exists public.night_stock();
create function public.night_stock()
returns table(product_id uuid, left_qty numeric, own boolean)
language sql stable security definer set search_path to '' as $function$
  select p.id,
         trim_scale(case when p.supply_mode::text = 'OWN_STOCK' then public.available_stock(p.id) else private.stock_left(p.id) end),
         p.supply_mode::text = 'OWN_STOCK'
    from public.products p
   where p.active and (p.supply_mode::text = 'OWN_STOCK' or p.sell_from is null)
$function$;
grant execute on function public.night_stock() to anon, authenticated;
