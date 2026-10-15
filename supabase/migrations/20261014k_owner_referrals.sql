-- Owner's bot «🤝 Рефералы»: points on the customers' hands (our debt) and who brought how many friends.
do $$ declare d text := pg_get_functiondef('public.tg_owner(bigint,text,jsonb)'::regprocedure);
begin
  if position('''referrals''' in d) > 0 then return; end if;
  d := replace(d, $q$  return jsonb_build_object('error', 'action');$q$, $q$  if p_action = 'referrals' then   -- points on hands and who brought how many friends
    return jsonb_build_object(
      'points', coalesce((select sum(b) from (select sum(amount) b from public.bonus_ledger group by customer_id having sum(amount) > 0) x), 0),
      'holders', (select count(*) from (select 1 from public.bonus_ledger group by customer_id having sum(amount) > 0) x),
      'links', (select count(*) from public.customers where ref_code is not null),
      'friends', (select count(*) from public.customers where referred_by is not null),
      'rewarded', coalesce((select sum(amount) from public.bonus_ledger where kind in ('REF_REWARD', 'REF_REVERSAL')), 0),
      'spent', coalesce((select -sum(amount) from public.bonus_ledger where kind in ('SPEND', 'SPEND_REFUND')), 0),
      'top', coalesce((select jsonb_agg(t order by t.friends desc, t.earned desc) from (
          select c.full_name name, c.phone,
                 (select count(*) from public.customers f where f.referred_by = c.id) friends,
                 (select count(*) from public.bonus_ledger l where l.customer_id = c.id and l.kind = 'REF_REWARD') bought,
                 coalesce((select sum(amount) from public.bonus_ledger l where l.customer_id = c.id and l.kind in ('REF_REWARD', 'REF_REVERSAL')), 0) earned,
                 coalesce((select sum(amount) from public.bonus_ledger l where l.customer_id = c.id), 0) balance
            from public.customers c
           where exists (select 1 from public.customers f where f.referred_by = c.id) or exists (select 1 from public.bonus_ledger l where l.customer_id = c.id)
           order by 3 desc, 5 desc limit 20) t), '[]'::jsonb));
  end if;
  return jsonb_build_object('error', 'action');$q$);
  if position('''referrals''' in d) = 0 then raise exception 'no patch'; end if;
  execute d;
end $$;
