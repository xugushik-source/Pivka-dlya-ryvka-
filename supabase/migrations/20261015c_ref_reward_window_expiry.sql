-- Reward only for a friend's order created within the campaign; daily FIFO expiry of points older than points_days.
do $$ declare d text := pg_get_functiondef('private.trg_order_bonus()'::regprocedure);
begin
  if position('''until''' in d) = 0 then
    d := replace(d, $q$    if v_ref is not null and v_ref <> new.customer_id$q$,
      $q$    if v_ref is not null and v_ref <> new.customer_id
       and new.created_at <= coalesce((select (value->>'until')::timestamptz from public.store_settings where key = 'referral'), 'infinity')$q$);
    if position('''until''' in d) = 0 then raise exception 'no patch'; end if;
    execute d;
  end if;
end $$;

create or replace function private.bonus_expire()
returns int language plpgsql security definer set search_path to '' as $$
declare c record; e record; lots numeric[]; lot_at timestamptz[]; i int; need numeric; n int := 0;
        v_days int := private.ref_setting('points_days', 60)::int;
begin
  for c in select customer_id from public.bonus_ledger group by customer_id having sum(amount) > 0 loop
    lots := '{}'; lot_at := '{}';
    for e in select amount, created_at from public.bonus_ledger where customer_id = c.customer_id order by created_at, id loop
      if e.amount > 0 then
        lots := lots || e.amount; lot_at := lot_at || e.created_at;
      else
        need := -e.amount; i := 1;
        while need > 0 and i <= coalesce(array_length(lots, 1), 0) loop
          if lots[i] > 0 then
            if lots[i] >= need then lots[i] := lots[i] - need; need := 0; else need := need - lots[i]; lots[i] := 0; end if;
          end if;
          i := i + 1;
        end loop;
      end if;
    end loop;
    for i in 1..coalesce(array_length(lots, 1), 0) loop
      if lots[i] > 0 and lot_at[i] < now() - make_interval(days => v_days) then
        insert into public.bonus_ledger(customer_id, amount, kind, note) values (c.customer_id, -lots[i], 'ADJUST', 'EXPIRE');
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end $$;

select cron.schedule('bonus-expire', '10 20 * * *', $$select private.bonus_expire()$$);
