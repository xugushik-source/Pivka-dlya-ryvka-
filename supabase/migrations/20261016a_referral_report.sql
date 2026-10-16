-- Owner's «🤝 Рефералы»: the whole funnel (window opened → link taken → shared → friends clicked → friend bound →
-- friend bought) for 7 days and in total, and who invited whom.
-- Site events: ref_open, ref_link {code}, ref_share {code}, ref_visit {code} (a visit by someone's ?ref= link).
create or replace function private.referral_report()
returns jsonb language sql stable security definer set search_path to '' as $$
  with ev as (
    select event_name, session_id, created_at, upper(coalesce(metadata->>'code', '')) code from public.store_events
     where event_name in ('ref_open', 'ref_link', 'ref_share', 'ref_visit')
  ), f(p) as (values ('7d'), ('all'))
  select jsonb_build_object(
    'points', coalesce((select sum(b) from (select sum(amount) b from public.bonus_ledger group by customer_id having sum(amount) > 0) x), 0),
    'holders', (select count(*) from (select 1 from public.bonus_ledger group by customer_id having sum(amount) > 0) x),
    'rewarded', coalesce((select sum(amount) from public.bonus_ledger where kind in ('REF_REWARD', 'REF_REVERSAL')), 0),
    'spent', coalesce((select -sum(amount) from public.bonus_ledger where kind in ('SPEND', 'SPEND_REFUND')), 0),
    'funnel', (select jsonb_object_agg(f.p, jsonb_build_object(
        'opened', (select count(distinct session_id) from ev where event_name = 'ref_open' and (f.p = 'all' or created_at > now() - interval '7 days')),
        'links', (select count(*) from public.customers c where c.ref_code is not null
                   and (f.p = 'all' or exists (select 1 from ev where event_name = 'ref_link' and code = c.ref_code and created_at > now() - interval '7 days'))),
        'shared', (select count(distinct session_id) from ev where event_name = 'ref_share' and (f.p = 'all' or created_at > now() - interval '7 days')),
        'visits', (select count(distinct session_id) from ev where event_name = 'ref_visit' and (f.p = 'all' or created_at > now() - interval '7 days')),
        'friends', (select count(*) from public.customers where referred_by is not null and (f.p = 'all' or created_at > now() - interval '7 days')),
        'bought', (select count(*) from public.bonus_ledger where kind = 'REF_REWARD' and (f.p = 'all' or created_at > now() - interval '7 days'))))
      from f),
    'top', coalesce((select jsonb_agg(t order by t.friends desc, t.visits desc, t.earned desc) from (
        select c.full_name name, c.phone, c.ref_code code,
               (select count(distinct session_id) from ev where event_name = 'ref_share' and code = c.ref_code) shares,
               (select count(distinct session_id) from ev where event_name = 'ref_visit' and code = c.ref_code) visits,
               (select count(*) from public.customers x where x.referred_by = c.id) friends,
               coalesce((select sum(amount) from public.bonus_ledger l where l.customer_id = c.id and l.kind in ('REF_REWARD', 'REF_REVERSAL')), 0) earned,
               coalesce((select sum(amount) from public.bonus_ledger l where l.customer_id = c.id), 0) balance,
               coalesce((select jsonb_agg(jsonb_build_object('name', x.full_name, 'phone', x.phone,
                          'bought', exists (select 1 from public.bonus_ledger l where l.kind = 'REF_REWARD' and l.friend_id = x.id))
                          order by x.created_at)
                  from public.customers x where x.referred_by = c.id), '[]'::jsonb) list
          from public.customers c
         where c.ref_code is not null
         order by 6 desc, 5 desc limit 15) t), '[]'::jsonb))
$$;

do $$ declare d text := pg_get_functiondef('public.tg_owner(bigint,text,jsonb)'::regprocedure);
begin
  if position('private.referral_report()' in d) > 0 then return; end if;
  d := replace(d, $q$  if p_action = 'referrals' then$q$, $q$  if p_action = 'referrals' then return private.referral_report(); end if;
  if p_action = 'referrals' then$q$);
  if position('private.referral_report()' in d) = 0 then raise exception 'no patch'; end if;
  execute d;
end $$;
