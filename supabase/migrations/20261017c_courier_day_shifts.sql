-- The shift poll's own table: public.driver_shifts already existed (an older planner: starts_at/ends_at/status),
-- so 20261016b never created the day-mark table and every mark failed. One row per courier per Tbilisi day.
create table if not exists public.courier_day_shifts (
  driver_id uuid not null references public.drivers(id) on delete cascade,
  day date not null,
  mode text not null check (mode in ('DAY', 'HOURS', 'OFF')),
  from_h int,
  to_h int,
  left_at timestamptz,
  answered_at timestamptz not null default now(),
  primary key (driver_id, day)
);
alter table public.courier_day_shifts enable row level security;
