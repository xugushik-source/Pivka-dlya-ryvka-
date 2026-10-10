-- Owner's bot menu: «📥 Приход», «💸 Оплата», «📦 Склад», «📊 Долги»; morning report at 11:00 Tbilisi.
-- Only the edge function (service role) calls tg_owner; every action checks that the chat is the owner's.

create table if not exists public.tg_owner_state (
  chat_id bigint primary key,
  step text not null,
  data jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
alter table public.tg_owner_state enable row level security;

create or replace function public.tg_owner(p_chat bigint, p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare v jsonb;
begin
  -- p_chat null = the edge function itself (morning report, balance for the daily totals); only service_role can call this.
  if p_chat is not null and not exists (select 1 from public.telegram_links where kind = 'OWNER' and active and chat_id = p_chat) then
    return jsonb_build_object('error', 'forbidden');
  end if;

  if p_action = 'stock' then          -- night assortment: on stock, left for sale, whose goods
    return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'unit', p.unit, 'stock', trim_scale(p.stock_quantity),
                       'left', trim_scale(private.stock_left(p.id)), 'cost', coalesce(r.cost, p.purchase_price), 'supplier', s.name) order by s.name, p.name)
                       from public.products p left join lateral private.resolve_supplier(p.id) r on true left join public.suppliers s on s.id = r.supplier_id
                      where p.active and p.sell_from is null and p.supply_mode::text <> 'OWN_STOCK'), '[]'::jsonb);
  elsif p_action = 'stock_in' then
    return private.stock_in((p_args->>'product')::uuid, (p_args->>'qty')::numeric, 'бот владельца');
  elsif p_action = 'suppliers' then   -- everyone with a debt, an advance, goods on hold or sales today
    select coalesce(jsonb_agg(b || jsonb_build_object('id', s.id) order by s.name), '[]'::jsonb) into v
      from public.suppliers s cross join lateral private.supplier_balance(s.id) b
     where s.active and ((b->>'debt')::numeric <> 0 or (b->>'today')::numeric > 0 or jsonb_array_length(b->'stock') > 0
                         or exists (select 1 from public.supplier_settlements x where x.supplier_id = s.id));
    return v;
  elsif p_action = 'balance' then
    return private.supplier_balance((p_args->>'supplier')::uuid);
  elsif p_action = 'pay' then
    return private.supplier_pay_amount((p_args->>'supplier')::uuid, (p_args->>'amount')::numeric, p_args->>'method', 'бот владельца');
  elsif p_action = 'morning' then     -- last 12 hours = the night that just ended
    return jsonb_build_object(
      'orders', (select count(*) from public.orders where from_stock and status = 'DELIVERED' and delivered_at > now() - interval '12 hours'),
      'revenue', coalesce((select sum(total) from public.orders where from_stock and status = 'DELIVERED' and delivered_at > now() - interval '12 hours'), 0),
      'sold', coalesce((select jsonb_agg(jsonb_build_object('name', x.name, 'unit', x.unit, 'qty', trim_scale(x.q), 'cost', x.c) order by x.name)
                          from (select p.name, p.unit, -sum(m.qty) q, round(sum(-m.qty * coalesce(m.unit_cost, 0)), 2) c from public.stock_moves m
                                  join public.products p on p.id = m.product_id
                                 where m.kind in ('SALE', 'RETURN') and m.created_at > now() - interval '12 hours'
                                 group by p.name, p.unit having sum(m.qty) <> 0) x), '[]'::jsonb),
      'stock', coalesce((select jsonb_agg(jsonb_build_object('name', p.name, 'unit', p.unit, 'stock', trim_scale(p.stock_quantity)) order by p.name)
                           from public.products p where p.active and p.sell_from is null and p.supply_mode::text <> 'OWN_STOCK'), '[]'::jsonb),
      'paid', coalesce((select jsonb_object_agg(method, s) from (select method, sum(amount) s from public.supplier_payments
                          where paid_at > now() - interval '24 hours' group by method) y), '{}'::jsonb));
  end if;
  return jsonb_build_object('error', 'action');
end $$;
revoke all on function public.tg_owner(bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.tg_owner(bigint, text, jsonb) to service_role;

-- 11:00 Tbilisi = 07:00 UTC: night report to the owner.
do $$ begin
  perform cron.unschedule('stock-morning') where exists (select 1 from cron.job where jobname = 'stock-morning');
  perform cron.schedule('stock-morning', '0 7 * * *', $c$select private.tg_post(jsonb_build_object('action', 'stock_morning'))$c$);
end $$;
