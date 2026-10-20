-- «Подарок от друга» (owner, 2026-10-20): a new customer who came by a friend's link gets, on the first order of at
-- least friend_min ₾ of goods, free delivery + a gift product. The inviter's reward (50 % of that order's goods) is
-- unchanged. Settings live in store_settings.referral: friend_gift_product (uuid or null), friend_min,
-- friend_free_delivery. The gift works only while the referral campaign is active (private.ref_active()).

update public.store_settings
   set value = value || '{"friend_gift_product": "7fc26fad-4b6f-44f0-8de0-47a015aaa912", "friend_min": 25, "friend_free_delivery": true}'::jsonb
 where key = 'referral' and not (value ? 'friend_gift_product');

-- The friend's gift for a link code and, when a phone is given, whether this phone can still get it
-- (a new customer: no orders yet, not tied to another inviter). Only the inviter's first name leaves the database.
create or replace function public.ref_gift_info(p_code text, p_phone text default null)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare s jsonb; inv public.customers; c public.customers; g public.products; v_ok boolean;
begin
  if not private.ref_active() or nullif(trim(p_code), '') is null then return null; end if;
  select value into s from public.store_settings where key = 'referral';
  select * into inv from public.customers where ref_code = upper(trim(p_code));
  if inv.id is null then return null; end if;
  select * into g from public.products where id = nullif(s->>'friend_gift_product', '')::uuid and active;
  if nullif(trim(p_phone), '') is not null then
    select * into c from public.customers where phone = private.norm_phone(p_phone);
    v_ok := c.id is null or (c.id <> inv.id
            and (c.referred_by is null or c.referred_by = inv.id)
            and not exists (select 1 from public.orders o where o.customer_id = c.id and o.status::text <> 'CANCELLED'));
  end if;
  return jsonb_build_object(
    'name', nullif(split_part(trim(coalesce(inv.full_name, '')), ' ', 1), ''),
    'gift', case when g.id is null then null else jsonb_build_object('ru', g.name) || coalesce(g.name_i18n, '{}'::jsonb) end,
    'min', coalesce((s->>'friend_min')::numeric, 25),
    'free_delivery', coalesce((s->>'friend_free_delivery')::boolean, true),
    'eligible', v_ok);
end $$;
grant execute on function public.ref_gift_info(text, text) to anon, authenticated;

-- Applied to a just-created order: only the customer's first (not cancelled) order, tied to an inviter.
create or replace function private.apply_friend_gift(p_result jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare s jsonb; o public.orders; c public.customers; g public.products; v_goods numeric; v_fee numeric;
        v_sid uuid; v_cost numeric; v_note text := '🎁 Подарок от друга:';
begin
  if not private.ref_active() then return p_result; end if;
  select value into s from public.store_settings where key = 'referral';
  select * into o from public.orders where id = (p_result->>'order_id')::uuid;
  select * into c from public.customers where id = o.customer_id;
  if o.id is null or coalesce(o.referrer_id, c.referred_by) is null or coalesce(o.referrer_id, c.referred_by) = o.customer_id then return p_result; end if;
  if exists (select 1 from public.orders x where x.customer_id = o.customer_id and x.id <> o.id and x.status::text <> 'CANCELLED') then return p_result; end if;
  v_goods := o.total - o.delivery_fee;
  if v_goods < coalesce((s->>'friend_min')::numeric, 25) then return p_result; end if;

  v_fee := o.delivery_fee;
  if coalesce((s->>'friend_free_delivery')::boolean, true) and v_fee > 0 then
    update public.orders set delivery_fee = 0, total = total - v_fee where id = o.id;
    v_note := v_note || ' бесплатная доставка (−' || trim_scale(v_fee) || ' ₾)';
  else
    v_fee := 0;
  end if;

  select * into g from public.products where id = nullif(s->>'friend_gift_product', '')::uuid and active;
  if g.id is not null and not (g.supply_mode = 'OWN_STOCK' and public.available_stock(g.id) < 1) then
    v_cost := coalesce(g.purchase_price, 0);
    select r.supplier_id, r.cost into v_sid, v_cost from private.resolve_supplier(g.id) r;
    v_cost := coalesce(v_cost, g.purchase_price, 0);
    insert into public.order_items(order_id, product_id, item_type, name_snapshot, sku_snapshot, unit_snapshot, quantity,
      unit_price_snapshot, unit_cost_snapshot, line_total, line_cogs, is_gift, supplier_id, supplier_cost_snapshot)
    values (o.id, g.id, 'PRODUCT', g.name, g.sku, g.unit, 1, 0, v_cost, 0, v_cost, true, v_sid, v_cost);
    if g.supply_mode = 'OWN_STOCK' then
      insert into public.stock_reservations(product_id, order_id, quantity, expires_at) values (g.id, o.id, 1, now() + interval '20 minutes');
    end if;
    if v_sid is not null then
      insert into public.supplier_order_groups(order_id, supplier_id, supplier_total) values (o.id, v_sid, v_cost)
      on conflict (order_id, supplier_id) do update set supplier_total = public.supplier_order_groups.supplier_total + excluded.supplier_total;
    end if;
    update public.orders set cogs_total = coalesce(cogs_total, 0) + v_cost, gift_cost_total = coalesce(gift_cost_total, 0) + v_cost,
           gross_profit = coalesce(gross_profit, 0) - v_cost where id = o.id;
    v_note := v_note || case when v_fee > 0 then ' + ' else ' ' end || g.name;
  end if;

  if v_note = '🎁 Подарок от друга:' then return p_result; end if;
  update public.orders set comment = coalesce(nullif(trim(comment), '') || ' | ', '') || v_note where id = o.id;
  return p_result || jsonb_build_object('friend_gift', true, 'friend_gift_name', g.name, 'friend_free_delivery', v_fee > 0,
                                        'delivery_fee', o.delivery_fee - v_fee, 'total', (select total from public.orders where id = o.id));
end $$;

-- Checkout: the gift goes last, after the points (they recount the delivery fee).
do $$ declare d text := pg_get_functiondef('public.checkout_order(jsonb)'::regprocedure);
begin
  if position('apply_friend_gift' in d) = 0 then
    d := replace(d, $q$  if v_use then r := private.apply_bonus(r, p->>'phone'); end if;
  return r;$q$, $q$  if v_use then r := private.apply_bonus(r, p->>'phone'); end if;
  r := private.apply_friend_gift(r);
  return r;$q$);
    if position('apply_friend_gift' in d) = 0 then raise exception 'checkout_order: patch point not found'; end if;
    execute d;
  end if;
end $$;
