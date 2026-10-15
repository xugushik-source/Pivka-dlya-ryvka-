-- Store pause (car broken, holiday…): store_settings 'pause' = {from, until, message}.
-- Orders whose delivery moment (now or the chosen pre-order time) falls inside the window are refused.
insert into public.store_settings(key, value) values ('pause', jsonb_build_object(
  'from', '2026-10-16T00:00:00+04:00', 'until', '2026-10-16T10:00:00+04:00',
  'message', 'Сегодня ночью доставки нет: с 00:00 до 10:00 не работаем. Можно оформить предзаказ на 10:00 или позже.'))
on conflict (key) do update set value = excluded.value;

create or replace function private.store_paused(p_at timestamptz default private.order_at())
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce((select p_at >= (value->>'from')::timestamptz and p_at < (value->>'until')::timestamptz
                     from public.store_settings where key = 'pause'), false)
$$;

create or replace function public.store_pause()
returns jsonb language sql stable security definer set search_path to '' as $$
  select value from public.store_settings where key = 'pause' and (value->>'until')::timestamptz > now()
$$;
grant execute on function public.store_pause() to anon, authenticated;

create or replace function private.assert_open(p_items jsonb, p_bundle uuid default null)
returns void language plpgsql stable security definer set search_path to '' as $$
declare v text;
begin
  if private.store_paused() then
    raise exception '%', coalesce((select value->>'message' from public.store_settings where key = 'pause'), 'Сейчас не работаем');
  end if;
  select string_agg(distinct p.name, ', ') into v
    from public.products p
   where (p.id in (select (e->>'product_id')::uuid from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e where e ? 'product_id')
          or p.id in (select bi.product_id from public.bundle_items bi where bi.bundle_id = p_bundle))
     and not private.product_open(p.sell_from, p.sell_until);
  if v is not null then
    if coalesce(current_setting('pivka.at', true), '') <> '' then
      raise exception 'На выбранное время не продаётся: %. Магазин — с 10:00 до 23:00, пиво, пицца, хачапури и ламаджо — с 12:00 до 23:00.', v;
    end if;
    raise exception 'Сейчас не продаётся: %. Ночью (23:00–10:00) — только крепкое и закуска; магазин — с 10:00, пиво, пицца, хачапури и ламаджо — с 12:00.', v;
  end if;
end $$;

-- the earliest pre-order slot skips the pause too
create or replace function private.next_open_at(p_items jsonb, p_bundle uuid default null)
returns timestamptz language sql stable security definer set search_path to '' as $$
  select min(t) from (
    select now() t
    union all
    select g from generate_series(date_bin('15 minutes', now(), timestamptz '2000-01-01') + interval '15 minutes',
                                  now() + interval '2 days', interval '15 minutes') g
  ) c
  where not private.store_paused(c.t)
    and not exists (
    select 1 from public.products p
     where (p.id in (select (e->>'product_id')::uuid from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e where e ? 'product_id')
            or p.id in (select bi.product_id from public.bundle_items bi where bi.bundle_id = p_bundle))
       and not private.product_open(p.sell_from, p.sell_until, c.t))
$$;
