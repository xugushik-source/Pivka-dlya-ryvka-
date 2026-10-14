-- Pre-order: a customer can order goods that are closed right now (night / morning) for a chosen time.
-- The whole order is evaluated "as of" that time: selling hours, night prices, night delivery fee and
-- the from-stock flag. The moment is passed through the transaction-local setting pivka.at.

alter table public.orders add column if not exists scheduled_for timestamptz;

create or replace function private.order_at()
returns timestamptz language sql stable set search_path to '' as $$
  select coalesce(nullif(current_setting('pivka.at', true), '')::timestamptz, now())
$$;

create or replace function private.product_open(p_from time, p_until time, p_at timestamptz default private.order_at())
returns boolean language sql stable set search_path to '' as
$$ select p_from is null or p_until is null or private.in_window((p_at at time zone 'Asia/Tbilisi')::time, p_from, p_until) $$;

create or replace function private.night_percent(p_at timestamptz default private.order_at())
returns numeric language sql stable security definer set search_path to '' as $$
  select case when private.in_window((p_at at time zone 'Asia/Tbilisi')::time,
                                     coalesce(s.value->>'from', '00:00')::time, coalesce(s.value->>'to', '08:00')::time)
              then coalesce((s.value->>'percent')::numeric, 0) else 0 end
    from public.store_settings s where s.key = 'night_pricing'
$$;

create or replace function private.night_price(p_price numeric, p_at timestamptz default private.order_at())
returns numeric language sql stable security definer set search_path to '' as $$
  select case when coalesce(p_price, 0) <= 0 or private.night_percent(p_at) = 0 then p_price
              else ceil(round(p_price * (1 + private.night_percent(p_at) / 100) / st, 6)) * st end
    from (select coalesce((value->>'step')::numeric, 0.5) st from public.store_settings where key = 'night_pricing') x
$$;

create or replace function private.night_now()
returns boolean language sql stable set search_path to '' as
$$ select not private.in_window((private.order_at() at time zone 'Asia/Tbilisi')::time, '10:00'::time, '23:00'::time) $$;

-- night / day delivery fee is decided by the delivery time, not by the moment of ordering
do $$
declare d text := pg_get_functiondef('private.delivery_quote(uuid,text,text,numeric)'::regprocedure);
begin
  if position('v_local := (now() at time zone' in d) > 0 then
    execute replace(d, 'v_local := (now() at time zone', 'v_local := (private.order_at() at time zone');
  end if;
end $$;

-- first moment (15-minute grid, up to 2 days ahead) when everything in the cart is on sale
create or replace function private.next_open_at(p_items jsonb, p_bundle uuid default null)
returns timestamptz language sql stable security definer set search_path to '' as $$
  select min(t) from (
    select now() t
    union all
    select g from generate_series(date_bin('15 minutes', now(), timestamptz '2000-01-01') + interval '15 minutes',
                                  now() + interval '2 days', interval '15 minutes') g
  ) c
  where not exists (
    select 1 from public.products p
     where (p.id in (select (e->>'product_id')::uuid from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e where e ? 'product_id')
            or p.id in (select bi.product_id from public.bundle_items bi where bi.bundle_id = p_bundle))
       and not private.product_open(p.sell_from, p.sell_until, c.t))
$$;

create or replace function private.preorder_begin(p_at timestamptz)
returns void language plpgsql set search_path to '' as $$
begin
  if p_at is null or p_at < now() + interval '10 minutes' or p_at > now() + interval '3 days' then
    raise exception 'Время предзаказа — не раньше чем через 10 минут и не позже чем через 3 дня';
  end if;
  perform set_config('pivka.at', p_at::text, true);
end $$;

create or replace function private.preorder_finish(p_result jsonb, p_at timestamptz)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_order uuid := (p_result->>'order_id')::uuid;
begin
  perform set_config('pivka.at', '', true);
  update public.orders
     set scheduled_for = p_at, promised_at = p_at,
         comment = '🕐 Предзаказ на ' || to_char(p_at at time zone 'Asia/Tbilisi', 'DD.MM HH24:MI')
                   || coalesce(' | ' || nullif(trim(comment), ''), '')
   where id = v_order;
  return p_result || jsonb_build_object('scheduled_for', p_at);
end $$;

create or replace function public.create_store_preorder(p_name text, p_phone text, p_fulfillment text, p_address text, p_payment text,
  p_comment text, p_items jsonb, p_zone uuid default null, p_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform private.preorder_begin(p_at);
  return private.preorder_finish(public.create_store_order(p_name, p_phone, p_fulfillment, p_address, p_payment, p_comment, p_items, p_zone), p_at);
end $$;

create or replace function public.create_bundle_preorder(p_name text, p_phone text, p_fulfillment text, p_address text, p_payment text,
  p_comment text, p_bundle uuid, p_city uuid default null, p_items jsonb default '[]'::jsonb, p_zone uuid default null, p_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform private.preorder_begin(p_at);
  return private.preorder_finish(public.create_bundle_order(p_name, p_phone, p_fulfillment, p_address, p_payment, p_comment, p_bundle, p_city, p_items, p_zone), p_at);
end $$;

grant execute on function public.create_store_preorder(text,text,text,text,text,text,jsonb,uuid,timestamptz) to anon, authenticated;
grant execute on function public.create_bundle_preorder(text,text,text,text,text,text,uuid,uuid,jsonb,uuid,timestamptz) to anon, authenticated;

-- public slot hint for the storefront: earliest time the cart can be delivered
create or replace function public.preorder_earliest(p_items jsonb, p_bundle uuid default null)
returns timestamptz language sql stable security definer set search_path to '' as
$$ select private.next_open_at(p_items, p_bundle) $$;
grant execute on function public.preorder_earliest(jsonb, uuid) to anon, authenticated;

-- "treat a friend" works around the clock: if the gift is closed now, it becomes a pre-order for the opening time
create or replace function public.finalize_treat(p_token uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare s public.social_orders%rowtype; r jsonb; v_items jsonb; v_at timestamptz;
begin
 select * into s from public.social_orders where token=p_token for update;
 if not found then raise exception 'Link not found';end if;
 if s.type<>'TREAT' then raise exception 'Wrong type';end if;
 if s.final_order_id is not null then return jsonb_build_object('order_id',s.final_order_id,'already_created',true);end if;
 if coalesce(trim(s.recipient_phone),'')='' or coalesce(trim(s.recipient_address),'')='' then raise exception 'Recipient address required';end if;
 v_items := case when s.bundle_id is null then jsonb_build_array(jsonb_build_object('product_id',s.product_id,'quantity',s.quantity)) else '[]'::jsonb end;
 v_at := private.next_open_at(v_items, s.bundle_id);
 if v_at is null then raise exception 'Подарок сейчас недоступен';end if;
 if v_at > now() + interval '1 minute' then
  v_at := greatest(v_at, now() + interval '10 minutes');
  if s.bundle_id is not null then
   r:=public.create_bundle_preorder(s.recipient_name,s.recipient_phone,'delivery',s.recipient_address,'pending_online',s.message,s.bundle_id,null,'[]'::jsonb,null,v_at);
  else
   r:=public.create_store_preorder(s.recipient_name,s.recipient_phone,'delivery',s.recipient_address,'pending_online',s.message,v_items,null,v_at);
  end if;
 elsif s.bundle_id is not null then
  r:=public.create_bundle_order(s.recipient_name,s.recipient_phone,'delivery',s.recipient_address,'pending_online',s.message,s.bundle_id);
 else
  r:=public.create_store_order(s.recipient_name,s.recipient_phone,'delivery',s.recipient_address,'pending_online',s.message,v_items);
 end if;
 update public.social_orders set final_order_id=(r->>'order_id')::uuid,status='AWAITING_PAYMENT',updated_at=now() where id=s.id;
 return r||jsonb_build_object('payment_required',true);
end $$;
