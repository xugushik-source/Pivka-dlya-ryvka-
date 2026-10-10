-- Owner, 2026-10-10: admin «Аналитика» — how many people came, from where, how many ordered.
-- One visitor = one browser (store_events session). Source of a visitor = his first page_view in the period:
--   metadata.src (qr / qr:<spot> / friend / link:<name> / google / instagram / … / direct), older visits: qr_landing → qr,
--   referrer host → its name, nothing → direct. Orders and revenue come from orders (not cancelled).
-- The store_events columns were created outside the migrations: the session/metadata column names are looked up here.
do $outer$
declare v_sess text; v_meta text;
begin
  select column_name into v_sess from information_schema.columns
   where table_schema = 'public' and table_name = 'store_events' and column_name in ('session_id', 'session', 'sid', 'session_key')
   order by array_position(array['session_id', 'session', 'sid', 'session_key'], column_name::text) limit 1;
  select column_name into v_meta from information_schema.columns
   where table_schema = 'public' and table_name = 'store_events' and column_name in ('metadata', 'meta', 'data', 'properties', 'payload')
   order by array_position(array['metadata', 'meta', 'data', 'properties', 'payload'], column_name::text) limit 1;
  if v_sess is null or v_meta is null then
    raise exception 'store_events: не нашёл колонки сессии/данных. Колонки: %',
      (select string_agg(column_name, ', ') from information_schema.columns where table_schema = 'public' and table_name = 'store_events');
  end if;

  execute format($f$
create or replace function public.staff_traffic(p_days int default 0)
returns jsonb language plpgsql stable security definer set search_path to ''
as $$
declare v_today date := (now() at time zone 'Asia/Tbilisi')::date; v_from timestamptz; v_to timestamptz; r jsonb;
begin
  if not private.is_staff() then raise exception 'Forbidden'; end if;
  -- 0 = today, 1 = yesterday, N > 1 = the last N days including today (Tbilisi days)
  v_from := (case when p_days = 1 then v_today - 1 when p_days > 1 then v_today - (p_days - 1) else v_today end)::timestamp at time zone 'Asia/Tbilisi';
  v_to   := (case when p_days = 1 then v_today else v_today + 1 end)::timestamp at time zone 'Asia/Tbilisi';
  with ev as (
    select e.%1$I::text sid, e.event_name, e.product_id, e.created_at, coalesce(e.%2$I::jsonb, '{}'::jsonb) m
      from public.store_events e where e.created_at >= v_from and e.created_at < v_to and e.%1$I is not null
  ), first_view as (
    select distinct on (sid) sid, m from ev where event_name = 'page_view' order by sid, created_at
  ), visit as (
    select v.sid, coalesce(nullif(v.m->>'src', ''),
             case when exists (select 1 from ev q where q.sid = v.sid and q.event_name = 'qr_landing') then 'qr'
                  when coalesce(v.m->>'ref', '') ~ 'google\.' then 'google'
                  when coalesce(v.m->>'ref', '') ~ 'instagram' then 'instagram'
                  when coalesce(v.m->>'ref', '') ~ 'facebook|fb\.' then 'facebook'
                  when coalesce(v.m->>'ref', '') ~ 't\.me|telegram' then 'telegram'
                  when coalesce(v.m->>'ref', '') ~ 'whatsapp|wa\.me' then 'whatsapp'
                  when coalesce(v.m->>'ref', '') not in ('', 'pivkadlaryvka.ge', 'xugushik-source.github.io') then v.m->>'ref'
                  else 'direct' end) src
      from first_view v
  ), flags as (
    select v.sid, v.src,
           bool_or(e.event_name in ('add_to_cart', 'bundle_add')) cart,
           bool_or(e.event_name = 'checkout_start') checkout,
           bool_or(e.event_name = 'order_complete') ordered
      from visit v join ev e on e.sid = v.sid group by v.sid, v.src
  ), ord as (
    select count(*) n, coalesce(sum(total), 0) revenue from public.orders
     where created_at >= v_from and created_at < v_to and status::text <> 'CANCELLED'
  )
  select jsonb_build_object(
    'from', v_from, 'to', v_to,
    'visitors', (select count(*) from flags),
    'cart', (select count(*) from flags where cart),
    'checkout', (select count(*) from flags where checkout),
    'ordered', (select count(*) from flags where ordered),
    'orders', (select n from ord), 'revenue', (select revenue from ord),
    'sources', coalesce((select jsonb_agg(x order by x.visitors desc) from (
        select src, count(*) visitors, count(*) filter (where cart) cart, count(*) filter (where ordered) ordered
          from flags group by src) x), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(y order by y.adds desc, y.views desc) from (
        select p.name, count(*) filter (where e.event_name = 'product_view') views, count(*) filter (where e.event_name = 'add_to_cart') adds
          from ev e join public.products p on p.id = e.product_id
         where e.event_name in ('product_view', 'add_to_cart') group by p.name order by 3 desc, 2 desc limit 10) y), '[]'::jsonb),
    'days', coalesce((select jsonb_agg(z order by z.day) from (
        select (e.created_at at time zone 'Asia/Tbilisi')::date as day, count(distinct e.sid) visitors,
               count(distinct e.sid) filter (where e.event_name = 'order_complete') ordered
          from ev e group by 1) z), '[]'::jsonb)
  ) into r;
  return r;
end $$;
$f$, v_sess, v_meta);
end $outer$;

revoke all on function public.staff_traffic(int) from public, anon;
grant execute on function public.staff_traffic(int) to authenticated;
