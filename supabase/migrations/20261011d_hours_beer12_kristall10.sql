-- Owner, 2026-10-11: everything from «Пивная компания Давида» (draft beer, fish, cheese) is sold from 12:00,
-- everything from «Кристалл» from 10:00. Night (owner's stock, suppliers get nothing) is now 23:00–10:00,
-- the morning stock report comes at 10:00 Tbilisi.

update public.products set sell_from = '12:00'
 where sell_from is not null and id in (select p.id from public.products p cross join lateral private.resolve_supplier(p.id) r
                                         join public.suppliers s on s.id = r.supplier_id where s.name = 'Пивная компания Давида');

update public.products set sell_from = '10:00'
 where sell_from is not null and id in (select p.id from public.products p cross join lateral private.resolve_supplier(p.id) r
                                         join public.suppliers s on s.id = r.supplier_id where s.name = 'Кристалл');

create or replace function private.night_now() returns boolean language sql stable set search_path to ''
as $$ select not private.in_window((now() at time zone 'Asia/Tbilisi')::time, '10:00'::time, '23:00'::time) $$;

do $$
declare d text := pg_get_functiondef('private.assert_open'::regproc);
begin
  d := replace(d, 'Ночью (23:00–11:00) — только крепкое и закуска; пиво — с 11:00, пицца, хачапури и ламаджо — с 12:00.',
                  'Ночью (23:00–10:00) — только крепкое и закуска; магазин — с 10:00, пиво, пицца, хачапури и ламаджо — с 12:00.');
  execute d;
end $$;

do $$ begin
  perform cron.unschedule('stock-morning') where exists (select 1 from cron.job where jobname = 'stock-morning');
  perform cron.schedule('stock-morning', '0 6 * * *', $c$select private.tg_post(jsonb_build_object('action', 'stock_morning'))$c$);
end $$;
