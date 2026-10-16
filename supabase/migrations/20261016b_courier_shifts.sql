-- Courier shifts: every day at 09:00 Tbilisi the bot asks each courier «Сегодня работаешь?»
-- (весь день / с … до … / не работаю); the owner sees who works when. 10:00 — a reminder to the silent ones
-- and the day's roster to the owner. to_h: hour of the end (24+ = after midnight), null = «до ночи».
create table if not exists public.driver_shifts (
  driver_id uuid not null references public.drivers(id) on delete cascade,
  day date not null,
  mode text not null check (mode in ('DAY', 'HOURS', 'OFF')),
  from_h int,
  to_h int,
  answered_at timestamptz not null default now(),
  primary key (driver_id, day)
);
alter table public.driver_shifts enable row level security;

select cron.schedule('courier-morning', '0 5 * * *', $$select private.tg_post(jsonb_build_object('action', 'courier_morning'))$$);
select cron.schedule('courier-remind', '0 6 * * *', $$select private.tg_post(jsonb_build_object('action', 'courier_remind'))$$);
