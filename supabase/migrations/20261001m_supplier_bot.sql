-- Telegram bot, stage 3: suppliers.
-- When an order is accepted (courier pressed «Принят», or staff set «Подтверждён» in admin), every supplier gets only
-- their own lines at purchase price, with a prep deadline (delivery 5 min, pickup 10 min) and [Готово] [Чего-то нет].
-- If the order is cancelled after that, the supplier is told not to prepare it.

alter table public.supplier_order_groups add column if not exists missing_note text;

-- Status changes → bot (after commit, via pg_net). Works for both the bot and the admin panel.
create or replace function private.orders_tg_status()
returns trigger language plpgsql security definer set search_path to ''
as $$ begin
  if new.status = 'CONFIRMED' and old.status = 'NEW' then
    perform private.tg_post(jsonb_build_object('action', 'order_confirmed', 'order_id', new.id));
  elsif new.status = 'CANCELLED' and old.status in ('CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY') then
    update public.supplier_order_groups set status = 'CANCELLED' where order_id = new.id;
    perform private.tg_post(jsonb_build_object('action', 'order_cancelled', 'order_id', new.id));
  end if;
  return new;
end $$;
drop trigger if exists orders_tg_status on public.orders;
create trigger orders_tg_status after update of status on public.orders
  for each row execute function private.orders_tg_status();

-- Supplier buttons. The supplier is identified by the Telegram chat (telegram_links SUPPLIER); only their own group.
create or replace function public.tg_supplier(p_chat bigint, p_order uuid, p_action text, p_arg text default null)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare s record; g public.supplier_order_groups; v_status public.order_status;
begin
  select sp.id, sp.name into s from public.telegram_links l join public.suppliers sp on sp.id = l.ref_id
   where l.kind = 'SUPPLIER' and l.active and l.chat_id = p_chat and sp.active limit 1;
  if s.id is null then return jsonb_build_object('error', 'not_supplier'); end if;
  select * into g from public.supplier_order_groups where order_id = p_order and supplier_id = s.id for update;
  if g.id is null then return jsonb_build_object('error', 'not_yours'); end if;
  select status into v_status from public.orders where id = p_order;
  if v_status in ('CANCELLED', 'REFUNDED') or g.status = 'CANCELLED' then return jsonb_build_object('error', 'cancelled'); end if;

  if p_action = 'ready' then
    update public.supplier_order_groups set status = 'READY', ready_at = coalesce(ready_at, now()) where id = g.id;
  elsif p_action = 'missing' then
    if coalesce(trim(p_arg), '') = '' then return jsonb_build_object('error', 'arg'); end if;
    update public.supplier_order_groups
       set missing_note = concat_ws(', ', nullif(missing_note, ''), left(trim(p_arg), 120)),
           status = case when status in ('NEW', 'SEEN') then 'PREPARING' else status end
     where id = g.id;
  else
    return jsonb_build_object('error', 'action');
  end if;
  return jsonb_build_object('ok', true, 'supplier', s.name);
end $$;
revoke all on function public.tg_supplier(bigint, uuid, text, text) from public, anon, authenticated;
grant execute on function public.tg_supplier(bigint, uuid, text, text) to service_role;
