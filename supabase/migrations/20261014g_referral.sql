-- Referral: every customer (= phone number) has a personal link ?ref=CODE. A new customer who comes by it and gets
-- the first order delivered brings the inviter 50 % of that order's goods as bonus points (once per friend).
-- Points pay up to 10 % of the products in an order (not Рывки — they are discounted already); an order paid partly
-- with points gets no gift, and free delivery counts the goods after the points. Only a customer with no orders yet
-- can be invited, so two friends can't invite each other.

insert into public.store_settings(key, value) values ('referral', '{"enabled": true, "reward_percent": 50, "spend_percent": 10}')
on conflict (key) do nothing;

alter table public.customers add column if not exists ref_code text unique;
alter table public.customers add column if not exists referred_by uuid references public.customers(id);
alter table public.orders add column if not exists referrer_id uuid references public.customers(id);
alter table public.orders add column if not exists bonus_used numeric not null default 0;

create table if not exists public.bonus_ledger (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  amount numeric not null,
  kind text not null check (kind in ('REF_REWARD', 'REF_REVERSAL', 'SPEND', 'SPEND_REFUND', 'ADJUST')),
  order_id uuid references public.orders(id),
  friend_id uuid references public.customers(id),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists bonus_ledger_customer on public.bonus_ledger(customer_id);
create index if not exists bonus_ledger_order on public.bonus_ledger(order_id);
alter table public.bonus_ledger enable row level security;   -- no policies: only security definer functions touch it

create or replace function private.ref_setting(p_key text, p_default numeric)
returns numeric language sql stable security definer set search_path to '' as
$$ select coalesce((select (value->>p_key)::numeric from public.store_settings where key = 'referral'), p_default) $$;

create or replace function private.bonus_balance(p_customer uuid)
returns numeric language sql stable security definer set search_path to '' as
$$ select coalesce(sum(amount), 0) from public.bonus_ledger where customer_id = p_customer $$;

-- personal code: 6 letters/digits without look-alikes, made once per customer
create or replace function private.ref_code(p_customer uuid)
returns text language plpgsql security definer set search_path to '' as $$
declare v text; a text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  select ref_code into v from public.customers where id = p_customer;
  if v is not null then return v; end if;
  loop
    v := '';
    for i in 1..6 loop v := v || substr(a, 1 + floor(random() * length(a))::int, 1); end loop;
    begin
      update public.customers set ref_code = v where id = p_customer and ref_code is null;
      return (select ref_code from public.customers where id = p_customer);
    exception when unique_violation then null;
    end;
  end loop;
end $$;

-- the gift tiers skip an order paid partly with points
do $$
declare d text := pg_get_functiondef('private.apply_order_gift(uuid,numeric)'::regprocedure);
begin
  if position('pivka.nogift' in d) = 0 then
    d := replace(d, E'begin\n  for lvl in', E'begin\n  if coalesce(current_setting(''pivka.nogift'', true), '''') = ''1'' then return 0; end if;\n  for lvl in');
    if position('pivka.nogift' in d) = 0 then raise exception 'apply_order_gift: patch point not found'; end if;
    execute d;
  end if;
end $$;

-- order edits keep the points: total, profit and the free-delivery check count them, no gift comes back
do $$
declare d text := pg_get_functiondef('private.order_edit_apply(uuid,jsonb,boolean,text,text,text)'::regprocedure);
begin
  if position('bonus_used' in d) = 0 then
    d := replace(d, 'v_quote := private.delivery_quote(o.delivery_zone_id, v_phone, o.fulfillment_type, v_goods);',
                    'v_quote := private.delivery_quote(o.delivery_zone_id, v_phone, o.fulfillment_type, v_goods - coalesce(o.bonus_used, 0));');
    d := replace(d, 'total = v_goods + v_fee, cogs_total = v_cogs, gross_profit = v_goods - v_cogs,',
                    'total = v_goods + v_fee - coalesce(o.bonus_used, 0), cogs_total = v_cogs, gross_profit = v_goods - v_cogs - coalesce(o.bonus_used, 0),');
    d := replace(d, 'v_gift := private.apply_order_gift(p_order, v_extras);',
                    E'if coalesce(o.bonus_used, 0) > 0 then perform set_config(''pivka.nogift'', ''1'', true); end if;\n  v_gift := private.apply_order_gift(p_order, v_extras);\n  perform set_config(''pivka.nogift'', '''', true);');
    if (length(d) - length(replace(d, 'bonus_used', ''))) / length('bonus_used') < 4 then
      raise exception 'order_edit_apply: patch points not found';
    end if;
    execute d;
  end if;
end $$;

-- the friend's first order: remember who invited (only a brand-new customer, never the inviter himself)
create or replace function private.referral_attach(p_order uuid, p_code text)
returns boolean language plpgsql security definer set search_path to '' as $$
declare o public.orders; v_ref uuid; v_cust public.customers;
begin
  if coalesce((select (value->>'enabled')::boolean from public.store_settings where key = 'referral'), false) is false then return false; end if;
  select * into o from public.orders where id = p_order;
  select id into v_ref from public.customers where ref_code = upper(trim(p_code));
  if o.id is null or v_ref is null or v_ref = o.customer_id then return false; end if;
  select * into v_cust from public.customers where id = o.customer_id for update;
  if v_cust.referred_by is not null then return false; end if;
  if exists (select 1 from public.orders x where x.customer_id = o.customer_id and x.id <> o.id) then return false; end if;
  if exists (select 1 from public.customers r where r.id = v_ref and r.referred_by = o.customer_id) then return false; end if;
  update public.customers set referred_by = v_ref where id = o.customer_id;
  update public.orders set referrer_id = v_ref where id = o.id;
  return true;
end $$;

-- points into the order: up to spend_percent of the products (Рывок lines and gifts excluded), never above the balance
create or replace function private.apply_bonus(p_result jsonb, p_phone text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare o public.orders; v_bal numeric; v_base numeric; v_x numeric; v_goods numeric; q jsonb; v_fee numeric;
begin
  select * into o from public.orders where id = (p_result->>'order_id')::uuid;
  perform 1 from public.customers where id = o.customer_id for update;
  v_bal := private.bonus_balance(o.customer_id);
  select coalesce(sum(line_total), 0) into v_base from public.order_items
   where order_id = o.id and item_type = 'PRODUCT' and not is_gift;
  v_x := round(least(v_bal, floor(v_base * private.ref_setting('spend_percent', 10) / 100 * 2) / 2), 2);
  if v_x <= 0 then return p_result; end if;
  v_goods := o.total - o.delivery_fee;
  if o.scheduled_for is not null then perform set_config('pivka.at', o.scheduled_for::text, true); end if;
  q := private.delivery_quote(o.delivery_zone_id, p_phone, o.fulfillment_type, v_goods - v_x);
  perform set_config('pivka.at', '', true);
  v_fee := case when o.fulfillment_type = 'delivery' then coalesce((q->>'fee')::numeric, 0) else 0 end;
  update public.orders set bonus_used = v_x, delivery_fee = v_fee, total = v_goods - v_x + v_fee,
         gross_profit = coalesce(gross_profit, 0) - v_x,
         comment = coalesce(nullif(trim(comment), '') || ' | ', '') || '💎 Баллами: −' || trim_scale(v_x) || ' ₾'
   where id = o.id;
  insert into public.bonus_ledger(customer_id, amount, kind, order_id) values (o.customer_id, -v_x, 'SPEND', o.id);
  return p_result || jsonb_build_object('bonus_used', v_x, 'delivery_fee', v_fee, 'delivery_reason', q->>'reason', 'total', v_goods - v_x + v_fee);
end $$;

-- One entry point for the storefront checkout: regular order / Рывок, pre-order time, referral code, points.
create or replace function public.checkout_order(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare r jsonb; v_at timestamptz := nullif(p->>'at', '')::timestamptz; v_cust uuid; v_use boolean := false;
        v_items jsonb := coalesce(p->'items', '[]'::jsonb);
begin
  if coalesce((p->>'use_bonus')::boolean, false) and jsonb_array_length(v_items) > 0 then
    select id into v_cust from public.customers where phone = private.norm_phone(p->>'phone');
    v_use := v_cust is not null and private.bonus_balance(v_cust) > 0;
  end if;
  if v_use then perform set_config('pivka.nogift', '1', true); end if;
  if v_at is not null then perform private.preorder_begin(v_at); end if;
  if nullif(p->>'bundle', '') is not null then
    r := public.create_bundle_order(p->>'name', p->>'phone', p->>'fulfillment', coalesce(p->>'address', ''), coalesce(p->>'payment', 'cash'),
           coalesce(p->>'comment', ''), (p->>'bundle')::uuid, nullif(p->>'city', '')::uuid, v_items, nullif(p->>'zone', '')::uuid);
  else
    r := public.create_store_order(p->>'name', p->>'phone', p->>'fulfillment', coalesce(p->>'address', ''), coalesce(p->>'payment', 'cash'),
           coalesce(p->>'comment', ''), v_items, nullif(p->>'zone', '')::uuid);
  end if;
  if v_at is not null then r := private.preorder_finish(r, v_at); end if;
  perform set_config('pivka.nogift', '', true);
  if nullif(trim(p->>'ref'), '') is not null then
    r := r || jsonb_build_object('referred', private.referral_attach((r->>'order_id')::uuid, p->>'ref'));
  end if;
  if v_use then r := private.apply_bonus(r, p->>'phone'); end if;
  return r;
end $$;
grant execute on function public.checkout_order(jsonb) to anon, authenticated;

-- checkout: points of the phone typed in the form (amount only)
create or replace function public.bonus_info(p_phone text)
returns jsonb language sql stable security definer set search_path to '' as $$
  select jsonb_build_object('balance', coalesce((select private.bonus_balance(c.id) from public.customers c where c.phone = private.norm_phone(p_phone)), 0),
                            'spend_percent', private.ref_setting('spend_percent', 10))
$$;
grant execute on function public.bonus_info(text) to anon, authenticated;

-- order page: the customer's personal link, points and friends (access = the random order id, like order_track)
create or replace function public.referral_info(p_order uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order;
  if o.id is null or coalesce((select (value->>'enabled')::boolean from public.store_settings where key = 'referral'), false) is false then return null; end if;
  return jsonb_build_object(
    'code', private.ref_code(o.customer_id),
    'balance', private.bonus_balance(o.customer_id),
    'bonus_used', o.bonus_used,
    'reward_percent', private.ref_setting('reward_percent', 50),
    'spend_percent', private.ref_setting('spend_percent', 10),
    'friends', (select count(*) from public.customers where referred_by = o.customer_id),
    'earned', coalesce((select sum(amount) from public.bonus_ledger where customer_id = o.customer_id and kind in ('REF_REWARD', 'REF_REVERSAL')), 0));
end $$;
grant execute on function public.referral_info(uuid) to anon, authenticated;

-- rewards and refunds follow the order status
create or replace function private.trg_order_bonus()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_amt numeric;
begin
  -- friend's first delivered order → inviter gets reward_percent of the goods (once per friend)
  if new.status::text = 'DELIVERED' and old.status::text <> 'DELIVERED' and new.referrer_id is not null
     and not exists (select 1 from public.bonus_ledger where kind = 'REF_REWARD' and friend_id = new.customer_id) then
    v_amt := round((new.total - new.delivery_fee) * private.ref_setting('reward_percent', 50) / 100, 2);
    if v_amt > 0 then
      insert into public.bonus_ledger(customer_id, amount, kind, order_id, friend_id) values (new.referrer_id, v_amt, 'REF_REWARD', new.id, new.customer_id);
    end if;
  end if;
  if new.status::text in ('CANCELLED', 'REFUNDED') and old.status::text not in ('CANCELLED', 'REFUNDED') then
    -- reward taken back if the friend's order is cancelled / refunded after delivery
    insert into public.bonus_ledger(customer_id, amount, kind, order_id, friend_id)
    select l.customer_id, -l.amount, 'REF_REVERSAL', l.order_id, l.friend_id from public.bonus_ledger l
     where l.order_id = new.id and l.kind = 'REF_REWARD'
       and not exists (select 1 from public.bonus_ledger x where x.order_id = new.id and x.kind = 'REF_REVERSAL');
    -- points spent on a cancelled order come back
    insert into public.bonus_ledger(customer_id, amount, kind, order_id)
    select l.customer_id, -l.amount, 'SPEND_REFUND', l.order_id from public.bonus_ledger l
     where l.order_id = new.id and l.kind = 'SPEND'
       and not exists (select 1 from public.bonus_ledger x where x.order_id = new.id and x.kind = 'SPEND_REFUND');
  end if;
  return null;
end $$;
drop trigger if exists orders_bonus on public.orders;
create trigger orders_bonus after update of status on public.orders for each row execute function private.trg_order_bonus();
