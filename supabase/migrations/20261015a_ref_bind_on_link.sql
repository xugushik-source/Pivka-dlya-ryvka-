-- Who came by whose link is fixed at the first contact, even without a purchase: a phone that takes its own link
-- after opening a friend's link is tied to that friend for good, so it can never invite the friend back.
create or replace function private.referral_bind(p_customer uuid, p_code text)
returns boolean language plpgsql security definer set search_path to '' as $$
declare v_ref uuid; v_cust public.customers;
begin
  if p_customer is null or nullif(trim(p_code), '') is null then return false; end if;
  select id into v_ref from public.customers where ref_code = upper(trim(p_code));
  if v_ref is null or v_ref = p_customer then return false; end if;
  select * into v_cust from public.customers where id = p_customer for update;
  if v_cust.referred_by is not null then return false; end if;
  if exists (select 1 from public.orders x where x.customer_id = p_customer) then return false; end if;
  if exists (select 1 from public.customers r where r.id = v_ref and r.referred_by = p_customer) then return false; end if;
  update public.customers set referred_by = v_ref where id = p_customer;
  return true;
end $$;

create or replace function public.my_ref_link(p_phone text, p_name text, p_ref text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_phone text := private.norm_phone(p_phone); c uuid; v_bound boolean;
begin
  if coalesce((select (value->>'enabled')::boolean from public.store_settings where key = 'referral'), false) is false then return null; end if;
  if length(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g')) < 9 then raise exception 'Укажи номер телефона'; end if;
  insert into public.customers(phone, full_name) values (v_phone, nullif(trim(p_name), '')) on conflict (phone) do nothing;
  select id into c from public.customers where phone = v_phone;
  v_bound := private.referral_bind(c, p_ref);
  return jsonb_build_object(
    'code', private.ref_code(c),
    'balance', private.bonus_balance(c),
    'reward_percent', private.ref_setting('reward_percent', 50),
    'spend_percent', private.ref_setting('spend_percent', 10),
    'friends', (select count(*) from public.customers where referred_by = c),
    'invited', v_bound);
end $$;
grant execute on function public.my_ref_link(text, text, text) to anon, authenticated;
