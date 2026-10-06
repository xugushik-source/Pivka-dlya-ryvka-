-- Cancelling an order from every side.
-- Before: only the courier who took the order could cancel it in the bot; the owner's message had no «Отменить»;
-- the customer could not cancel; and a cancel while the order was still «Новый» (admin panel, courier) told nobody —
-- the owner's message, the courier's card and the other couriers' offers kept showing the old status.
-- Now:
--   • owner: «❌ Отменить заказ» → reason, on his order message in the bot (tg_owner_cancel);
--   • customer: «Отменить заказ» on the order page while it is «Новый» (nobody confirmed it yet) (order_cancel_by_customer);
--   • courier: as before (his own order);
--   • supplier: does not cancel the order — «⚠️ Чего-то нет» warns the courier and the owner;
--   • any cancel (bot, admin, site, any status) reaches the bot, which updates every message and tells the owner/courier.

-- 1. Every cancel → bot. (Before: only after «Принят».)
create or replace function private.orders_tg_status()
returns trigger language plpgsql security definer set search_path to ''
as $$ begin
  if new.status = 'CONFIRMED' and old.status = 'NEW' then
    perform private.tg_post(jsonb_build_object('action', 'order_confirmed', 'order_id', new.id));
  elsif new.status = 'CANCELLED' and old.status in ('NEW', 'CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY') then
    update public.supplier_order_groups set status = 'CANCELLED' where order_id = new.id;
    perform private.tg_post(jsonb_build_object('action', 'order_cancelled', 'order_id', new.id, 'from', old.status));
  end if;
  return new;
end $$;

-- 2. Owner cancels from the bot. The owner is identified by his Telegram chat (telegram_links OWNER).
create or replace function public.tg_owner_cancel(p_chat bigint, p_order uuid, p_arg text default null)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare o public.orders; v_reason text;
begin
  if not exists (select 1 from public.telegram_links where kind = 'OWNER' and active and chat_id = p_chat) then
    return jsonb_build_object('error', 'not_owner');
  end if;
  select * into o from public.orders where id = p_order for update;
  if not found then return jsonb_build_object('error', 'no_order'); end if;
  if o.status in ('DELIVERED', 'CANCELLED', 'REFUNDED') then return jsonb_build_object('error', 'state', 'status', o.status); end if;
  v_reason := case p_arg when 'mind' then 'Клиент передумал' when 'money' then 'Нет денег' when 'stock' then 'Нет товара'
                         when 'noanswer' then 'Не дозвонились' when 'test' then 'Тестовый заказ' else 'Другое' end;
  perform private.order_transition(p_order, 'CANCELLED', v_reason || ' (владелец)');
  update public.delivery_assignments set failed_at = coalesce(failed_at, now()), failure_reason = coalesce(failure_reason, v_reason)
   where order_id = p_order;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.tg_owner_cancel(bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.tg_owner_cancel(bigint, uuid, text) to service_role;

-- 3. Customer cancels on the order page — only while nobody has confirmed the order (status NEW).
--    Access = the random order id, the same key the order page already uses.
create or replace function public.order_cancel_by_customer(p_order uuid)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare v_status public.order_status;
begin
  select status into v_status from public.orders where id = p_order for update;
  if not found then return jsonb_build_object('error', 'no_order'); end if;
  if v_status = 'CANCELLED' then return jsonb_build_object('ok', true); end if;
  if v_status <> 'NEW' then return jsonb_build_object('error', 'state', 'status', v_status); end if;
  perform private.order_transition(p_order, 'CANCELLED', 'Клиент отменил на сайте');
  update public.delivery_assignments set failed_at = coalesce(failed_at, now()), failure_reason = coalesce(failure_reason, 'Клиент отменил на сайте')
   where order_id = p_order;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.order_cancel_by_customer(uuid) from public;
grant execute on function public.order_cancel_by_customer(uuid) to anon, authenticated;
