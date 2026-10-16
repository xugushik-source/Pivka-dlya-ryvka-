-- Daily closing (owner, 16.10: «закрываемся в 11, пока не скажу по-другому»): store_settings.pause.daily = {from, to}
-- (Tbilisi time) refuses orders for that part of every day, like the one-off window {from, until}.
-- public.store_pause() returns the current or the next window (shown from 2 hours before it starts) for the site.
update public.store_settings set value = jsonb_build_object(
  'daily', jsonb_build_object('from', '23:00', 'to', '10:00'),
  'message', 'Работаем до 23:00. Ночью (23:00–10:00) заказы не принимаем — можно оформить предзаказ на 10:00 или позже.')
 where key = 'pause';

create or replace function private.store_paused(p_at timestamptz default private.order_at())
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce((select (value ? 'from' and p_at >= (value->>'from')::timestamptz and p_at < (value->>'until')::timestamptz)
                       or (value ? 'daily' and private.in_window((p_at at time zone 'Asia/Tbilisi')::time,
                                                                 (value->'daily'->>'from')::time, (value->'daily'->>'to')::time))
                     from public.store_settings where key = 'pause'), false)
$$;

create or replace function public.store_pause()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v jsonb; f time; t time; d date; s timestamptz; e timestamptz;
begin
  select value into v from public.store_settings where key = 'pause';
  if v is null then return null; end if;
  if v ? 'from' and (v->>'until')::timestamptz > now() then return v; end if;
  if not v ? 'daily' then return null; end if;
  f := (v->'daily'->>'from')::time; t := (v->'daily'->>'to')::time;
  d := (now() at time zone 'Asia/Tbilisi')::date;
  -- windows starting yesterday and today; the first one that has not ended yet
  for i in -1..1 loop
    s := ((d + i) + f) at time zone 'Asia/Tbilisi';
    e := ((d + i + case when t <= f then 1 else 0 end) + t) at time zone 'Asia/Tbilisi';
    if e > now() then
      if s - interval '2 hours' > now() then return null; end if;
      return jsonb_build_object('from', s, 'until', e, 'message', v->>'message');
    end if;
  end loop;
  return null;
end $$;
grant execute on function public.store_pause() to anon, authenticated;
