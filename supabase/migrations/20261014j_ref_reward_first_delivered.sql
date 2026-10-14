-- The friend's phone is tied to the first inviter for good (a second link never attaches: the phone already has an
-- order or an inviter). The reward comes for the friend's FIRST DELIVERED order, so a cancelled first order doesn't
-- lose it; once per friend; on what the friend paid for goods.
create or replace function private.trg_order_bonus()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_amt numeric; v_ref uuid;
begin
  if new.status::text = 'DELIVERED' and old.status::text <> 'DELIVERED' then
    v_ref := coalesce(new.referrer_id, (select referred_by from public.customers where id = new.customer_id));
    if v_ref is not null and v_ref <> new.customer_id
       and not exists (select 1 from public.bonus_ledger where kind = 'REF_REWARD' and friend_id = new.customer_id)
       and not exists (select 1 from public.orders x where x.customer_id = new.customer_id and x.id <> new.id and x.status::text = 'DELIVERED') then
      v_amt := round((new.total - new.delivery_fee) * private.ref_setting('reward_percent', 50) / 100, 2);
      if v_amt > 0 then
        insert into public.bonus_ledger(customer_id, amount, kind, order_id, friend_id) values (v_ref, v_amt, 'REF_REWARD', new.id, new.customer_id);
      end if;
    end if;
  end if;
  if new.status::text in ('CANCELLED', 'REFUNDED') and old.status::text not in ('CANCELLED', 'REFUNDED') then
    insert into public.bonus_ledger(customer_id, amount, kind, order_id, friend_id)
    select l.customer_id, -l.amount, 'REF_REVERSAL', l.order_id, l.friend_id from public.bonus_ledger l
     where l.order_id = new.id and l.kind = 'REF_REWARD'
       and not exists (select 1 from public.bonus_ledger x where x.order_id = new.id and x.kind = 'REF_REVERSAL');
    insert into public.bonus_ledger(customer_id, amount, kind, order_id)
    select l.customer_id, -l.amount, 'SPEND_REFUND', l.order_id from public.bonus_ledger l
     where l.order_id = new.id and l.kind = 'SPEND'
       and not exists (select 1 from public.bonus_ledger x where x.order_id = new.id and x.kind = 'SPEND_REFUND');
  end if;
  return null;
end $$;
