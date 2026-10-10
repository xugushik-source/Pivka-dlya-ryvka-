-- Owner, 2026-10-10: partial payments to suppliers, cash or transfer.
-- Debt = all daily totals − all payments. Payments close the oldest days first (status PAID); a payment larger than the
-- debt is an advance. Before this, «Оплачено» paid the whole debt at once: those days become one payment each (cash).

create table if not exists public.supplier_payments (
  id bigserial primary key,
  supplier_id uuid not null references public.suppliers(id),
  amount numeric(12,2) not null check (amount > 0),
  method text not null check (method in ('CASH', 'TRANSFER')),
  paid_at timestamptz not null default now(),
  note text
);
create index if not exists supplier_payments_idx on public.supplier_payments(supplier_id, paid_at desc);
alter table public.supplier_payments enable row level security;
drop policy if exists supplier_payments_staff on public.supplier_payments;
create policy supplier_payments_staff on public.supplier_payments for select to authenticated using (public.is_staff());

insert into public.supplier_payments(supplier_id, amount, method, paid_at, note)
select supplier_id, amount, 'CASH', coalesce(paid_at, now()), 'итог за ' || to_char(settlement_date, 'DD.MM')
  from public.supplier_settlements
 where status = 'PAID' and amount > 0 and not exists (select 1 from public.supplier_payments);

-- Oldest days first: a day is PAID when the payments cover it.
create or replace function private.supplier_settle(p_supplier uuid) returns void language plpgsql security definer set search_path to ''
as $$
declare v_paid numeric; v_cum numeric := 0; s record;
begin
  select coalesce(sum(amount), 0) into v_paid from public.supplier_payments where supplier_id = p_supplier;
  for s in select id, amount, status::text st, settlement_date from public.supplier_settlements where supplier_id = p_supplier order by settlement_date loop
    v_cum := v_cum + s.amount;
    if v_cum <= v_paid + 0.004 then
      if s.st <> 'PAID' then
        update public.supplier_settlements set status = 'PAID', paid_at = now() where id = s.id;
        update public.order_items oi set supplier_settlement_status = 'PAID' from public.orders o
         where oi.order_id = o.id and oi.supplier_id = p_supplier and o.status in ('DELIVERED', 'REFUNDED')
           and private.tbilisi_day(o.delivered_at) = s.settlement_date;
      end if;
    elsif s.st = 'PAID' then
      update public.supplier_settlements set status = 'OPEN', paid_at = null where id = s.id;
    end if;
  end loop;
end $$;

-- Debt, payments, today so far, and the supplier's goods on our night stock.
create or replace function private.supplier_balance(p_supplier uuid) returns jsonb language sql stable security definer set search_path to ''
as $$
  with b as (select coalesce((select sum(amount) from public.supplier_settlements where supplier_id = p_supplier), 0) billed,
                    coalesce((select sum(amount) from public.supplier_payments where supplier_id = p_supplier), 0) paid)
  select jsonb_build_object(
    'supplier', (select name from public.suppliers where id = p_supplier),
    'billed', b.billed, 'paid', b.paid, 'debt', round(b.billed - b.paid, 2),
    'today', case when exists (select 1 from public.supplier_settlements where supplier_id = p_supplier and settlement_date = private.tbilisi_day(now()))
                 then 0 else coalesce((private.supplier_day_calc(p_supplier, private.tbilisi_day(now()))->>'amount')::numeric, 0) end,   -- not in a total yet
    'stock', coalesce((select jsonb_agg(jsonb_build_object('name', p.name, 'unit', p.unit, 'qty', trim_scale(p.stock_quantity), 'cost', r.cost) order by p.name)
                         from public.products p cross join lateral private.resolve_supplier(p.id) r
                        where r.supplier_id = p_supplier and p.sell_from is null and p.supply_mode::text <> 'OWN_STOCK' and p.stock_quantity > 0), '[]'::jsonb),
    'last', coalesce((select jsonb_agg(jsonb_build_object('amount', x.amount, 'method', x.method, 'at', x.paid_at) order by x.paid_at desc)
                        from (select * from public.supplier_payments where supplier_id = p_supplier order by paid_at desc limit 5) x), '[]'::jsonb))
  from b
$$;

create or replace function private.supplier_pay_amount(p_supplier uuid, p_amount numeric, p_method text, p_note text default null)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare v_before numeric;
begin
  if coalesce(p_amount, 0) <= 0 or p_method not in ('CASH', 'TRANSFER') then return jsonb_build_object('error', 'amount'); end if;
  v_before := (private.supplier_balance(p_supplier)->>'debt')::numeric;
  insert into public.supplier_payments(supplier_id, amount, method, note) values (p_supplier, round(p_amount, 2), p_method, p_note);
  perform private.supplier_settle(p_supplier);
  return jsonb_build_object('ok', true, 'amount', round(p_amount, 2), 'method', p_method, 'debt_before', v_before, 'debt_after', v_before - round(p_amount, 2));
end $$;

-- «Оплачено» (admin button / owner's bot button): pay everything owed up to that day.
drop function if exists private.supplier_pay(uuid, date);
create or replace function private.supplier_pay(p_supplier uuid, p_day date, p_method text default 'CASH')
returns numeric language plpgsql security definer set search_path to ''
as $$
declare v_due numeric;
begin
  select round(coalesce((select sum(amount) from public.supplier_settlements where supplier_id = p_supplier and settlement_date <= p_day), 0)
             - coalesce((select sum(amount) from public.supplier_payments where supplier_id = p_supplier), 0), 2) into v_due;
  if v_due <= 0 then perform private.supplier_settle(p_supplier); return 0; end if;
  perform private.supplier_pay_amount(p_supplier, v_due, p_method, 'Оплачено полностью');
  return v_due;
end $$;

-- The day close also settles: an advance covers the new day.
create or replace function private.supplier_day_close(p_day date)
returns int language plpgsql security definer set search_path to ''
as $$
declare s record; c jsonb; v_ids uuid[] := '{}'; v_id uuid;
begin
  for s in select id from public.suppliers where active loop
    c := private.supplier_day_calc(s.id, p_day);
    if (c->>'amount')::numeric <= 0 then continue; end if;
    insert into public.supplier_settlements(supplier_id, settlement_date, amount, orders_count, details, status, sent_at, supplier_status)
    values (s.id, p_day, (c->>'amount')::numeric, (c->>'orders')::int, c, 'OPEN', now(), 'SENT')
    on conflict (supplier_id, settlement_date) do update
      set amount = excluded.amount, orders_count = excluded.orders_count, details = excluded.details, sent_at = now(),
          supplier_status = 'SENT', supplier_note = null, replied_at = null
      where public.supplier_settlements.status <> 'PAID'
    returning id into v_id;
    perform private.supplier_settle(s.id);
    if v_id is not null then v_ids := v_ids || v_id; end if;
    v_id := null;
  end loop;
  if array_length(v_ids, 1) > 0 then
    perform private.tg_post(jsonb_build_object('action', 'supplier_day', 'day', p_day, 'ids', to_jsonb(v_ids)));
  end if;
  return coalesce(array_length(v_ids, 1), 0);
end $$;

-- Admin «Расчёты»: debt before the day now counts partial payments.
create or replace function public.staff_supplier_daily_report(p_date date default null)
returns table(supplier_id uuid, supplier_name text, orders bigint, amount numeric, status text, supplier_status text,
              supplier_note text, unpaid_before numeric, sent_at timestamptz, details jsonb)
language plpgsql stable security definer set search_path to ''
as $$
declare v_day date := coalesce(p_date, private.tbilisi_day(now()));
begin
  if not private.is_staff() then raise exception 'Forbidden'; end if;
  return query
  select s.id, s.name, coalesce(ss.orders_count, (c->>'orders')::int)::bigint, coalesce(ss.amount, (c->>'amount')::numeric),
         coalesce(ss.status::text, 'OPEN'), ss.supplier_status, ss.supplier_note,
         greatest(coalesce((select sum(p.amount) from public.supplier_settlements p where p.supplier_id = s.id and p.settlement_date < v_day), 0)
                - coalesce((select sum(x.amount) from public.supplier_payments x where x.supplier_id = s.id), 0), 0),
         ss.sent_at, coalesce(ss.details, c)
    from public.suppliers s
    cross join lateral private.supplier_day_calc(s.id, v_day) c
    left join public.supplier_settlements ss on ss.supplier_id = s.id and ss.settlement_date = v_day
   where s.active and ((c->>'amount')::numeric > 0 or ss.id is not null
         or exists (select 1 from public.supplier_settlements p where p.supplier_id = s.id and p.status = 'OPEN'))
   order by s.name;
end $$;

-- Telegram day buttons: owner pays in cash or by transfer.
create or replace function public.tg_supplier_day(p_chat bigint, p_settlement uuid, p_action text, p_note text default null)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare st public.supplier_settlements; v_sum numeric;
begin
  if p_action = 'note' then
    select ss.* into st from public.supplier_settlements ss join public.telegram_links l on l.ref_id = ss.supplier_id
     where l.kind = 'SUPPLIER' and l.active and l.chat_id = p_chat and ss.supplier_status = 'DISPUTED' and ss.supplier_note is null
       and ss.replied_at > now() - interval '1 day'
     order by ss.replied_at desc limit 1;
    if st.id is null then return jsonb_build_object('error', 'none'); end if;
    update public.supplier_settlements set supplier_note = left(trim(p_note), 500) where id = st.id;
    return jsonb_build_object('ok', true, 'id', st.id);
  end if;

  select * into st from public.supplier_settlements where id = p_settlement for update;
  if st.id is null then return jsonb_build_object('error', 'not_found'); end if;
  if p_action in ('paid', 'paid_cash', 'paid_transfer') then
    if not exists (select 1 from public.telegram_links where kind = 'OWNER' and active and chat_id = p_chat) then
      return jsonb_build_object('error', 'forbidden');
    end if;
    if st.status = 'PAID' then return jsonb_build_object('error', 'already'); end if;
    v_sum := private.supplier_pay(st.supplier_id, st.settlement_date, case when p_action = 'paid_transfer' then 'TRANSFER' else 'CASH' end);
    return jsonb_build_object('ok', true, 'amount', v_sum, 'method', case when p_action = 'paid_transfer' then 'TRANSFER' else 'CASH' end);
  end if;
  if not exists (select 1 from public.telegram_links where kind = 'SUPPLIER' and active and chat_id = p_chat and ref_id = st.supplier_id) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if p_action = 'ok' then
    update public.supplier_settlements set supplier_status = 'AGREED', supplier_note = null, replied_at = now() where id = st.id;
  elsif p_action = 'bad' then
    update public.supplier_settlements set supplier_status = 'DISPUTED', supplier_note = null, replied_at = now() where id = st.id;
  else
    return jsonb_build_object('error', 'action');
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function private.supplier_settle(uuid) from public, anon, authenticated;
revoke all on function private.supplier_balance(uuid) from public, anon, authenticated;
revoke all on function private.supplier_pay_amount(uuid, numeric, text, text) from public, anon, authenticated;
revoke all on function private.supplier_pay(uuid, date, text) from public, anon, authenticated;
