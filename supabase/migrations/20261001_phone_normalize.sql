-- One phone format everywhere, so "591 244 0 75", "591244075", "+995 591 24 40 75" and "00995591244075"
-- all find the same customer (repeat order, order history, PASS). Georgian mobiles are stored as +995XXXXXXXXX.

create or replace function private.norm_phone(p text)
returns text language plpgsql immutable set search_path to ''
as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g'); intl boolean := trim(coalesce(p, '')) like '+%';
begin
  if d = '' then return trim(coalesce(p, '')); end if;
  if d like '00%' then d := substr(d, 3); intl := true; end if;
  if length(d) = 9 and d like '5%' then return '+995' || d; end if;      -- local Georgian mobile
  if length(d) = 12 and d like '9955%' then return '+' || d; end if;    -- 995… without plus
  if intl then return '+' || d; end if;
  return d;                                                             -- anything else: digits only, not guessed
end $$;

-- Every write to customers goes through the same format (also before ON CONFLICT (phone) is checked).
create or replace function private.customers_norm_phone()
returns trigger language plpgsql set search_path to ''
as $$ begin new.phone := private.norm_phone(new.phone); return new; end $$;
drop trigger if exists customers_norm_phone on public.customers;
create trigger customers_norm_phone before insert or update of phone on public.customers
  for each row execute function private.customers_norm_phone();

update public.customers set phone = private.norm_phone(phone) where phone is distinct from private.norm_phone(phone);

-- Lookups by phone use the same format.
do $$
declare f record; src text; fixed text;
begin
  for f in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where (n.nspname, p.proname) in (('public','get_repeat_order'),('public','customer_order_history'),
                                             ('public','customer_summary'),('private','delivery_quote'))
  loop
    src := pg_get_functiondef(f.oid);
    fixed := replace(replace(src, 'phone=trim(p_phone)', 'phone=private.norm_phone(p_phone)'),
                     'c.phone = trim(coalesce(p_phone, ''''))', 'c.phone = private.norm_phone(p_phone)');
    if fixed = src and src not like '%private.norm_phone(p_phone)%' then
      raise exception 'phone lookup not found in %', f.proname;
    end if;
    execute fixed;
  end loop;
end $$;

-- Fix: repeat order and order history read order_items.product_name / created_at, which do not exist
-- (the columns are name_snapshot etc.), so "Повторить прошлый заказ" always failed.
create or replace function public.get_repeat_order(p_phone text)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare c uuid; o uuid; num bigint; tot numeric; items jsonb;
begin
  select id into c from public.customers where phone = private.norm_phone(p_phone);
  if not found then return jsonb_build_object('found', false); end if;
  select id, order_number, total into o, num, tot from public.orders
   where customer_id = c and status not in ('CANCELLED','REFUNDED') order by created_at desc limit 1;
  if o is null then return jsonb_build_object('found', false); end if;
  select coalesce(jsonb_agg(jsonb_build_object('product_id', x.product_id, 'name', x.name, 'quantity', x.qty,
           'current_price', x.sale_price, 'active', x.active, 'available', public.available_stock(x.product_id)) order by x.name), '[]'::jsonb)
    into items
    from (select oi.product_id, coalesce(p.name, max(oi.name_snapshot)) name, sum(oi.quantity) qty, p.sale_price, p.active
            from public.order_items oi join public.products p on p.id = oi.product_id
           where oi.order_id = o and not oi.is_gift
           group by oi.product_id, p.name, p.sale_price, p.active) x;
  return jsonb_build_object('found', true, 'order_number', num, 'previous_total', tot, 'items', items);
end $$;

create or replace function public.customer_order_history(p_phone text)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare c uuid; result jsonb;
begin
  select id into c from public.customers where phone = private.norm_phone(p_phone);
  if not found then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(x.obj order by x.created_at desc), '[]'::jsonb) into result from (
    select o.created_at, jsonb_build_object('order_number', o.order_number, 'total', o.total, 'status', o.status, 'created_at', o.created_at,
      'items', coalesce((select jsonb_agg(jsonb_build_object('name', oi.name_snapshot, 'quantity', oi.quantity, 'is_gift', oi.is_gift))
                           from public.order_items oi where oi.order_id = o.id), '[]'::jsonb)) obj
      from public.orders o where o.customer_id = c order by o.created_at desc limit 10) x;
  return result;
end $$;

-- Fix: visitors (anon) could not call get_repeat_order at all, so the storefront button never worked.
-- It returns only product lines, order number and total — no name, address or phone.
-- customer_order_history / customer_summary stay staff-only.
grant execute on function public.get_repeat_order(text) to anon;
