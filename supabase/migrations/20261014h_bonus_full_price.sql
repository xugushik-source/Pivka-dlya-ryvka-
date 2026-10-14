-- A points order has no discounts and no gift: a Рывок in it goes at the full price of its products,
-- points cover up to spend_percent of the whole order (Рывок included).
create or replace function private.apply_bonus(p_result jsonb, p_phone text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare o public.orders; v_bal numeric; v_base numeric; v_full numeric; v_x numeric; v_goods numeric; q jsonb; v_fee numeric;
begin
  select * into o from public.orders where id = (p_result->>'order_id')::uuid;
  perform 1 from public.customers where id = o.customer_id for update;
  v_bal := private.bonus_balance(o.customer_id);
  if o.scheduled_for is not null then perform set_config('pivka.at', o.scheduled_for::text, true); end if;
  -- full (undiscounted) price of the Рывок lines, with the night markup of the order time
  select coalesce(sum(case when i.item_type = 'BUNDLE'
                           then private.night_price(coalesce(cp.sale_price, p.sale_price, 0)) * i.quantity
                           else i.line_total end), 0)
    into v_base
    from public.order_items i join public.products p on p.id = i.product_id
    left join public.city_products cp on cp.product_id = i.product_id and cp.city_id = o.city_id
   where i.order_id = o.id and not i.is_gift;
  v_x := round(least(v_bal, floor(v_base * private.ref_setting('spend_percent', 10) / 100 * 2) / 2), 2);
  if v_x <= 0 then perform set_config('pivka.at', '', true); return p_result; end if;
  -- a points order has no discounts: the Рывок goes at the full price of its products
  update public.order_items i
     set unit_price_snapshot = private.night_price(coalesce(cp.sale_price, p.sale_price, 0)),
         line_total = private.night_price(coalesce(cp.sale_price, p.sale_price, 0)) * i.quantity
    from public.products p left join public.city_products cp on cp.product_id = p.id and cp.city_id = o.city_id
   where i.order_id = o.id and i.item_type = 'BUNDLE' and p.id = i.product_id;
  select coalesce(sum(line_total), 0) into v_goods from public.order_items where order_id = o.id and not is_gift;
  q := private.delivery_quote(o.delivery_zone_id, p_phone, o.fulfillment_type, v_goods - v_x);
  perform set_config('pivka.at', '', true);
  v_fee := case when o.fulfillment_type = 'delivery' then coalesce((q->>'fee')::numeric, 0) else 0 end;
  update public.orders set bonus_used = v_x, discount_total = 0, subtotal = v_goods, delivery_fee = v_fee, total = v_goods - v_x + v_fee,
         gross_profit = v_goods - v_x - coalesce(cogs_total, 0),
         comment = coalesce(nullif(trim(comment), '') || ' | ', '') || '💎 Баллами: −' || trim_scale(v_x) || ' ₾ (без скидок и подарков)'
   where id = o.id;
  insert into public.bonus_ledger(customer_id, amount, kind, order_id) values (o.customer_id, -v_x, 'SPEND', o.id);
  return p_result || jsonb_build_object('bonus_used', v_x, 'delivery_fee', v_fee, 'delivery_reason', q->>'reason', 'total', v_goods - v_x + v_fee, 'savings', 0);
end $$;

-- points also with a Рывок (then without its discount)
do $$ declare d text := pg_get_functiondef('public.checkout_order(jsonb)'::regprocedure);
begin
  if position($q$or nullif(p->>'bundle', '') is not null) then$q$ in d) = 0 then
    d := replace(d, $q$if coalesce((p->>'use_bonus')::boolean, false) and jsonb_array_length(v_items) > 0 then$q$,
      $q$if coalesce((p->>'use_bonus')::boolean, false) and (jsonb_array_length(v_items) > 0 or nullif(p->>'bundle', '') is not null) then$q$);
    execute d;
  end if;
end $$;
