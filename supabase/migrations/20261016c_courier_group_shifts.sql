-- Courier shifts in the couriers' group: one morning poll per group, every courier marks himself
-- (the Telegram user who pressed → driver_tg → driver). The answer is final for the day; the only way out is the
-- emergency «🚨 ухожу со смены» — once a day, with a warning, the owner is told at once.
create table if not exists public.driver_tg (
  user_id bigint primary key,
  driver_id uuid not null unique references public.drivers(id) on delete cascade,
  linked_at timestamptz not null default now()
);
alter table public.driver_tg enable row level security;

-- couriers already known by their private chat with the bot
insert into public.driver_tg(user_id, driver_id)
select distinct on (l.ref_id) coalesce(l.member_id, l.chat_id), l.ref_id
  from public.telegram_links l
 where l.kind = 'DRIVER' and l.active and l.ref_id is not null and coalesce(l.member_id, l.chat_id) > 0
on conflict do nothing;

alter table public.driver_shifts add column if not exists left_at timestamptz;

create table if not exists public.courier_polls (
  day date not null,
  chat_id bigint not null,
  message_id bigint not null,
  primary key (day, chat_id)
);
alter table public.courier_polls enable row level security;
