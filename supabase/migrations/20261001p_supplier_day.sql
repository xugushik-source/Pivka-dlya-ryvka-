-- Stage 6: end-of-day total for every supplier at 00:00 Tbilisi.
-- Counted: orders DELIVERED that day (gifts included) at the purchase price fixed in the order, plus poured beer that
-- was written off that day (the supplier is paid for it anyway). Cancelled goods go back to the supplier — not counted.
-- The supplier answers «Сходится» / «Не сходится» in Telegram; the owner presses «Оплачено» in the morning.
-- Whatever is not paid carries over and is shown in the next day's total.
-- Builds on the existing supplier_settlements table and the admin «Расчёты» tab (their old report counted every
-- non-cancelled order by creation date in UTC, including undelivered ones).

alter table public.supplier_settlements
  add column if not exists orders_count int not null default 0,
  add column if not exists details jsonb,
  add column if not exists sent_at timestamptz,
  add column if not exists supplier_status text,
  add column if not exists supplier_note text,
  add column if not exists replied_at timestamptz,
  add column if not exists tg jsonb not null default '{}'::jsonb;   -- message ids: {"supplier":[chat,msg],"owner":[[chat,msg],…]}
alter table public.supplier_settlements drop constraint if exists supplier_settlements_supplier_status_check;
alter table public.supplier_settlements add constraint supplier_settlements_supplier_status_check
  check (supplier_status is null or supplier_status in ('SENT', 'AGREED', 'DISPUTED'));

-- Business day in Tbilisi.
create or replace function private.tbilisi_day(p_at timestamptz)
returns date language sql stable set search_path to ''
as $$ select (p_at at time zone 'Asia/Tbilisi')::date $$;

-- What a supplier is owed for one day.
create or replace function private.supplier_day_calc(p_supplier uuid, p_day date)
returns jsonb language sql stable security definer set search_path to ''
as $$
  with li as (
    select oi.order_id, oi.name_snapshot name, oi.unit_snapshot unit, oi.is_gift, oi.quantity, coalesce(oi.supplier_cost_snapshot, 0) cost
      from public.order_items oi join public.orders o on o.id = oi.order_id
     where oi.supplier_id = p_supplier and o.status in ('DELIVERED', 'REFUNDED') and private.tbilisi_day(o.delivered_at) = p_day
  ), wo as (
    select w.name, w.unit, w.quantity, w.unit_cost cost, w.amount from public.order_writeoffs w
     where w.supplier_id = p_supplier and private.tbilisi_day(w.created_at) = p_day
  )
  select jsonb_build_object(
    'orders', (select count(distinct order_id) from li),
    'goods', coalesce((select sum(quantity * cost) from li), 0),
    'poured', coalesce((select sum(amount) from wo), 0),
    'amount', round(coalesce((select sum(quantity * cost) from li), 0) + coalesce((select sum(amount) from wo), 0), 2),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'unit', unit, 'gift', is_gift, 'qty', trim_scale(q), 'cost', cost, 'sum', round(q * cost, 2))
                        order by is_gift, name)
                         from (select name, unit, is_gift, cost, sum(quantity) q from li group by name, unit, is_gift, cost) x), '[]'::jsonb),
    'poured_lines', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'unit', unit, 'qty', trim_scale(q), 'cost', cost, 'sum', s) order by name)
                         from (select name, unit, cost, sum(quantity) q, sum(amount) s from wo group by name, unit, cost) y), '[]'::jsonb))
$$;
revoke all on function private.supplier_day_calc(uuid, date) from public, anon, authenticated;

-- Close a day: one settlement per supplier with something to pay, then the bot sends the totals.
-- Already paid days are not touched. Running it again (admin «Отправить итог») recounts and resends.
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
    if v_id is not null then v_ids := v_ids || v_id; end if;
    v_id := null;
  end loop;
  if array_length(v_ids, 1) > 0 then
    perform private.tg_post(jsonb_build_object('action', 'supplier_day', 'day', p_day, 'ids', to_jsonb(v_ids)));
  end if;
  return coalesce(array_length(v_ids, 1), 0);
end $$;
revoke all on function private.supplier_day_close(date) from public, anon, authenticated;

-- Every night at 00:05 Tbilisi (20:05 UTC): the day that just ended.
do $$ begin
  perform cron.unschedule('supplier-day-total') where exists (select 1 from cron.job where jobname = 'supplier-day-total');
  perform cron.schedule('supplier-day-total', '5 20 * * *', $c$select private.supplier_day_close(private.tbilisi_day(now()) - 1)$c$);
end $$;

-- Paying a supplier closes every unpaid day up to and including p_day (carried-over debt is paid with it).
create or replace function private.supplier_pay(p_supplier uuid, p_day date)
returns numeric language plpgsql security definer set search_path to ''
as $$
declare v_sum numeric; v_days date[];
begin
  select coalesce(sum(amount), 0), array_agg(settlement_date) into v_sum, v_days from public.supplier_settlements
   where supplier_id = p_supplier and status = 'OPEN' and settlement_date <= p_day;
  update public.supplier_settlements set status = 'PAID', paid_at = now()
   where supplier_id = p_supplier and status = 'OPEN' and settlement_date <= p_day;
  update public.order_items oi set supplier_settlement_status = 'PAID' from public.orders o
   where oi.order_id = o.id and oi.supplier_id = p_supplier and o.status in ('DELIVERED', 'REFUNDED')
     and private.tbilisi_day(o.delivered_at) = any(coalesce(v_days, '{}'));
  return v_sum;
end $$;
revoke all on function private.supplier_pay(uuid, date) from public, anon, authenticated;

-- Admin «Расчёты»: replaces the old report (same name; it now also returns the supplier's answer and the debt).
drop function if exists public.staff_supplier_daily_report(date);
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
         coalesce(ss.status, 'OPEN'), ss.supplier_status, ss.supplier_note,
         (select coalesce(sum(p.amount), 0) from public.supplier_settlements p where p.supplier_id = s.id and p.status = 'OPEN' and p.settlement_date < v_day),
         ss.sent_at, coalesce(ss.details, c)
    from public.suppliers s
    cross join lateral private.supplier_day_calc(s.id, v_day) c
    left join public.supplier_settlements ss on ss.supplier_id = s.id and ss.settlement_date = v_day
   where s.active and ((c->>'amount')::numeric > 0 or ss.id is not null
         or exists (select 1 from public.supplier_settlements p where p.supplier_id = s.id and p.status = 'OPEN'))
   order by s.name;
end $$;
revoke all on function public.staff_supplier_daily_report(date) from public, anon;
grant execute on function public.staff_supplier_daily_report(date) to authenticated;

create or replace function public.staff_mark_supplier_paid(p_supplier uuid, p_date date default null)
returns void language plpgsql security definer set search_path to ''
as $$
declare v_day date := coalesce(p_date, private.tbilisi_day(now())); v_sum numeric;
begin
  if not private.is_staff() then raise exception 'Forbidden'; end if;
  v_sum := private.supplier_pay(p_supplier, v_day);
  if v_sum > 0 then
    perform private.tg_post(jsonb_build_object('action', 'supplier_paid', 'supplier_id', p_supplier, 'day', v_day, 'amount', v_sum));
  end if;
end $$;

-- Admin button «Отправить итог»: close a day now (e.g. today before midnight, or resend yesterday).
create or replace function public.staff_send_supplier_day(p_date date default null)
returns int language plpgsql security definer set search_path to ''
as $$ begin
  if not private.is_staff() then raise exception 'Forbidden'; end if;
  return private.supplier_day_close(coalesce(p_date, private.tbilisi_day(now())));
end $$;
revoke all on function public.staff_send_supplier_day(date) from public, anon;
grant execute on function public.staff_send_supplier_day(date) to authenticated;

-- Telegram buttons (edge function only). Supplier: ok / bad / note. Owner: paid.
create or replace function public.tg_supplier_day(p_chat bigint, p_settlement uuid, p_action text, p_note text default null)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare st public.supplier_settlements; v_sum numeric; v_owner boolean;
begin
  if p_action = 'note' then   -- free text after «Не сходится»: the latest disputed day of this supplier without a note
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
  if p_action = 'paid' then
    v_owner := exists (select 1 from public.telegram_links where kind = 'OWNER' and active and chat_id = p_chat);
    if not v_owner then return jsonb_build_object('error', 'forbidden'); end if;
    if st.status = 'PAID' then return jsonb_build_object('error', 'already'); end if;
    v_sum := private.supplier_pay(st.supplier_id, st.settlement_date);
    return jsonb_build_object('ok', true, 'amount', v_sum);
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
revoke all on function public.tg_supplier_day(bigint, uuid, text, text) from public, anon, authenticated;
grant execute on function public.tg_supplier_day(bigint, uuid, text, text) to service_role;
