-- Owner, 2026-10-11: ready-made Рывки must not disappear because one product ran out.
-- bundle_items.base_product_id = what the owner put into the Рывок; bundle_items.product_id = what is sold now.
-- When the base product can't be sold (switched off, its section switched off, own stock empty), the line gets an
-- available product of the SAME section and unit (beer → beer, vodka → vodka), closest in price; different Рывки
-- get different substitutes where possible (Helles in one, Valhalla in another). When the base product is back,
-- the line returns to it. The Рывок price is recomputed from the current products by bundle_calc, so the discount stays.
-- Runs after products / sections / Рывок lines change, and every 10 minutes.

alter table public.bundle_items add column if not exists base_product_id uuid references public.products(id);
update public.bundle_items set base_product_id = product_id where base_product_id is null;

create or replace function private.product_sellable(p_product uuid) returns boolean
language sql stable security definer set search_path to ''
as $$
  select exists (select 1 from public.products p left join public.categories c on c.id = p.category_id
                  where p.id = p_product and p.active and coalesce(c.active, true)
                    and (p.supply_mode::text <> 'OWN_STOCK' or public.available_stock(p.id) > 0))
$$;

create or replace function private.bundle_autoswap() returns int
language plpgsql security definer set search_path to ''
as $$
declare r record; v_pick uuid; v_used jsonb := '{}'::jsonb; v_changed int := 0;
begin
  perform set_config('pivka.autoswap', '1', true);   -- our own updates must not re-trigger us
  -- How often each product already stands in the Рывки (to spread the substitutes).
  select coalesce(jsonb_object_agg(product_id::text, n), '{}'::jsonb) into v_used
    from (select product_id, count(*) n from public.bundle_items group by product_id) x;

  for r in
    select bi.id, bi.bundle_id, bi.product_id, bi.base_product_id, bp.category_id, bp.unit, coalesce(bp.sale_price, 0) base_price
      from public.bundle_items bi join public.products bp on bp.id = bi.base_product_id
     order by bi.bundle_id, bi.id
  loop
    if private.product_sellable(r.base_product_id) then
      if r.product_id <> r.base_product_id then           -- the owner's product is back
        update public.bundle_items set product_id = r.base_product_id where id = r.id;
        v_changed := v_changed + 1;
      end if;
      continue;
    end if;
    -- A working substitute of the same section stays as it is (no churn every 10 minutes).
    if r.product_id <> r.base_product_id and private.product_sellable(r.product_id)
       and exists (select 1 from public.products p where p.id = r.product_id and p.category_id = r.category_id and p.unit = r.unit) then
      continue;
    end if;
    -- New substitute: same section and unit, sellable; preferably not already in this Рывок; least used, then closest price.
    select p.id into v_pick
      from public.products p
     where p.category_id = r.category_id and p.unit = r.unit and p.id <> r.base_product_id
       and private.product_sellable(p.id)
     order by exists (select 1 from public.bundle_items o where o.bundle_id = r.bundle_id and o.id <> r.id and o.product_id = p.id),
                                                                                             -- not already in this Рывок first
              abs(coalesce(p.sale_price, 0) - r.base_price) > greatest(r.base_price * 0.35, 1),   -- price within ±35 % first
              coalesce((v_used->>p.id::text)::int, 0),
              abs(coalesce(p.sale_price, 0) - r.base_price), p.name
     limit 1;
    if v_pick is not null and v_pick <> r.product_id then
      update public.bundle_items set product_id = v_pick where id = r.id;
      v_used := jsonb_set(v_used, array[v_pick::text], to_jsonb(coalesce((v_used->>v_pick::text)::int, 0) + 1));
      v_changed := v_changed + 1;
    end if;
  end loop;
  perform set_config('pivka.autoswap', '', true);
  return v_changed;
end $$;
revoke all on function private.bundle_autoswap() from public, anon, authenticated;
revoke all on function private.product_sellable(uuid) from public, anon, authenticated;

-- The owner edits a Рывок line (admin) → that product becomes the base.
create or replace function private.trg_bundle_item_base() returns trigger language plpgsql set search_path to ''
as $$ begin
  if coalesce(current_setting('pivka.autoswap', true), '') <> '1' then new.base_product_id := new.product_id; end if;
  return new;
end $$;
drop trigger if exists bundle_items_base on public.bundle_items;
create trigger bundle_items_base before insert or update of product_id on public.bundle_items
  for each row execute function private.trg_bundle_item_base();

-- Re-check after any change that can make a product (un)sellable.
create or replace function private.trg_bundle_autoswap() returns trigger language plpgsql security definer set search_path to ''
as $$ begin
  if coalesce(current_setting('pivka.autoswap', true), '') <> '1' then perform private.bundle_autoswap(); end if;
  return null;
end $$;
drop trigger if exists products_bundle_autoswap on public.products;
create trigger products_bundle_autoswap after update of active, category_id, unit, sale_price on public.products
  for each statement execute function private.trg_bundle_autoswap();
drop trigger if exists categories_bundle_autoswap on public.categories;
create trigger categories_bundle_autoswap after update of active on public.categories
  for each statement execute function private.trg_bundle_autoswap();
drop trigger if exists bundle_items_autoswap on public.bundle_items;
create trigger bundle_items_autoswap after insert or update of product_id on public.bundle_items
  for each statement execute function private.trg_bundle_autoswap();

do $$ begin
  perform cron.unschedule('bundle-autoswap') where exists (select 1 from cron.job where jobname = 'bundle-autoswap');
  perform cron.schedule('bundle-autoswap', '*/10 * * * *', $c$select private.bundle_autoswap()$c$);
end $$;

select private.bundle_autoswap();
