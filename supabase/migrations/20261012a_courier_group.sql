-- Courier group «courier + owner + bot»: the DRIVER link's chat_id is the group (orders go there, both may press
-- the buttons); member_id keeps the courier's private chat, so the edit page opened from it still knows him.
alter table public.telegram_links add column if not exists member_id bigint;

create or replace function public.tg_order_edit(p_chat bigint, p_order uuid, p_items jsonb default null::jsonb, p_keep_bundle boolean default true, p_charge text default 'DRIVER'::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_id uuid; v_name text := 'Владелец'; v_role text; r jsonb; v_driver uuid;
begin
  if exists (select 1 from public.telegram_links where kind = 'OWNER' and active and chat_id = p_chat) then
    v_role := 'ADMIN';
  else
    select dr.id, dr.name into v_id, v_name from public.telegram_links l join public.drivers dr on dr.id = l.ref_id
     where l.kind = 'DRIVER' and l.active and (l.chat_id = p_chat or l.member_id = p_chat) and dr.active limit 1;
    if v_id is null then raise exception 'Вы не подключены к боту как курьер'; end if;
    select driver_id into v_driver from public.delivery_assignments where order_id = p_order;
    if v_driver is distinct from v_id then raise exception 'Этот заказ не ваш — менять его может курьер, который его взял'; end if;
    v_role := 'DRIVER';
  end if;
  if p_items is not null then
    r := private.order_edit_apply(p_order, p_items, p_keep_bundle, v_role, v_name, case when v_role = 'ADMIN' then p_charge else 'DRIVER' end);
  end if;
  return private.order_edit_view(p_order, v_role) || coalesce(r, '{}'::jsonb);
end $function$;
