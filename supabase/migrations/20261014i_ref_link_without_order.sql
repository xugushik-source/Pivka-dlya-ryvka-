-- Personal referral link by phone, without an order (virality first): the customer row is created if needed.
create or replace function public.my_ref_link(p_phone text, p_name text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_phone text := private.norm_phone(p_phone); c uuid;
begin
  if coalesce((select (value->>'enabled')::boolean from public.store_settings where key = 'referral'), false) is false then return null; end if;
  if length(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g')) < 9 then raise exception 'Укажи номер телефона'; end if;
  insert into public.customers(phone, full_name) values (v_phone, nullif(trim(p_name), '')) on conflict (phone) do nothing;
  select id into c from public.customers where phone = v_phone;
  return jsonb_build_object(
    'code', private.ref_code(c),
    'balance', private.bonus_balance(c),
    'reward_percent', private.ref_setting('reward_percent', 50),
    'spend_percent', private.ref_setting('spend_percent', 10),
    'friends', (select count(*) from public.customers where referred_by = c));
end $$;
grant execute on function public.my_ref_link(text, text) to anon, authenticated;
