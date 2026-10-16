-- In the couriers' group the order goes to whoever pressed «🙋 Беру» (Telegram user → driver_tg → driver), not to the
-- courier the group was linked for. The owner pressing a courier's buttons acts for the assigned courier.
-- public.tg_courier keeps its body: it now takes the driver from pivka.tg_driver when tg_courier_by set it.
do $$ declare d text := pg_get_functiondef('public.tg_courier(bigint,uuid,text,text)'::regprocedure);
  old text := $q$  select dr.id, dr.name into d from public.telegram_links l join public.drivers dr on dr.id = l.ref_id
   where l.kind = 'DRIVER' and l.active and l.chat_id = p_chat and dr.active limit 1;$q$;
begin
  if position('pivka.tg_driver' in d) > 0 then return; end if;
  if position(old in d) = 0 then raise exception 'tg_courier: lookup not found'; end if;
  execute replace(d, old, $q$  select dr.id, dr.name into d from public.drivers dr
   where dr.id = nullif(current_setting('pivka.tg_driver', true), '')::uuid and dr.active;
  if d.id is null then
    select dr.id, dr.name into d from public.telegram_links l join public.drivers dr on dr.id = l.ref_id
     where l.kind = 'DRIVER' and l.active and l.chat_id = p_chat and dr.active limit 1;
  end if;$q$);
end $$;

create or replace function public.tg_courier_by(p_chat bigint, p_user bigint, p_order uuid, p_action text, p_arg text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v uuid;
begin
  select t.driver_id into v from public.driver_tg t join public.drivers dr on dr.id = t.driver_id where t.user_id = p_user and dr.active;
  if v is null and exists (select 1 from public.telegram_links where kind = 'OWNER' and active and chat_id = p_user) then
    select driver_id into v from public.delivery_assignments where order_id = p_order;   -- owner acts for the courier
  elsif v is null and p_chat < 0 then
    return jsonb_build_object('error', 'who');                                         -- unknown person in a group
  end if;
  perform set_config('pivka.tg_driver', coalesce(v::text, ''), true);
  return public.tg_courier(p_chat, p_order, p_action, p_arg);
end $$;
revoke all on function public.tg_courier_by(bigint, bigint, uuid, text, text) from public, anon, authenticated;

-- the order edit page (opened from a courier's private chat) also knows couriers linked through the group
do $$ declare d text := pg_get_functiondef('public.tg_order_edit(bigint,uuid,jsonb,boolean,text)'::regprocedure);
  old text := $q$    if v_id is null then raise exception 'Вы не подключены к боту как курьер'; end if;$q$;
begin
  if position('public.driver_tg' in d) > 0 then return; end if;
  if position(old in d) = 0 then raise exception 'tg_order_edit: check not found'; end if;
  execute replace(d, old, $q$    if v_id is null then
      select dr.id, dr.name into v_id, v_name from public.driver_tg t join public.drivers dr on dr.id = t.driver_id
       where t.user_id = p_chat and dr.active;
    end if;
$q$ || old);
end $$;
