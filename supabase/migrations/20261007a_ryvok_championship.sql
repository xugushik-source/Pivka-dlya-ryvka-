-- «РЫВОК» championship. Generic for any future game: every row carries game_id, a season points to its game.
--
-- Rules
--   • 1 order = 3 attempts (game_seasons.attempts_per_order). An attempt is used the moment a run starts,
--     so restarting / closing the tab does not give a fresh try.
--   • A player = a customer (the phone behind the order). Their best score in the season counts.
--   • Only orders that are (or become) CONFIRMED…DELIVERED count on the public board; a cancelled order's runs
--     drop out by themselves. Customers can play while the order is still NEW — that is the waiting time.
--   • The score is never taken from the browser: the edge function `game-run` replays seed + jump ticks with the
--     same simulation file (js/game/ryvok-sim.js) and writes the result through game_finish_run().
--   • The board returns name, place and score only. No phone, order id or customer id leaves the database.
--
-- Tables have RLS on and no policies: the browser reaches them only through the functions below.

create table if not exists public.game_seasons (
  id text primary key,                         -- seasonId, e.g. ryvok-2026-10
  game_id text not null,                       -- gameId, e.g. ryvok-runner-01
  name jsonb not null default '{}'::jsonb,     -- seasonName {ru,ka,hy}
  prize_title jsonb not null default '{}'::jsonb,
  prize_description jsonb not null default '{}'::jsonb,
  prize_image text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'finished')),
  attempts_per_order int not null default 3 check (attempts_per_order between 1 and 10),
  winner_customer_id uuid references public.customers(id),
  winner_name text,
  created_at timestamptz not null default now(),
  check (end_at > start_at)
);
create index if not exists game_seasons_game_idx on public.game_seasons (game_id, status, start_at);

create table if not exists public.game_players (
  customer_id uuid primary key references public.customers(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 2 and 16),
  updated_at timestamptz not null default now()
);

create table if not exists public.game_runs (
  id uuid primary key default gen_random_uuid(),   -- the run token the browser holds
  game_id text not null,
  season_id text not null references public.game_seasons(id),
  order_id uuid not null references public.orders(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  game_version int not null,
  seed bigint not null,
  status text not null default 'started' check (status in ('started', 'finished', 'rejected')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  score int,
  client_score int,
  ticks int,
  jumps int,
  pauses int,
  reject_reason text,
  ip_hash text
);
create index if not exists game_runs_order_idx on public.game_runs (order_id);
create index if not exists game_runs_board_idx on public.game_runs (season_id, status, score desc);
create index if not exists game_runs_ip_idx on public.game_runs (ip_hash, started_at);

alter table public.game_seasons enable row level security;
alter table public.game_players enable row level security;
alter table public.game_runs enable row level security;
revoke all on public.game_seasons, public.game_players, public.game_runs from anon, authenticated;

-- Staff can read everything in the admin (same pattern as the rest of the shop).
drop policy if exists "staff game seasons" on public.game_seasons;
drop policy if exists "staff game players" on public.game_players;
drop policy if exists "staff game runs" on public.game_runs;
create policy "staff game seasons" on public.game_seasons for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "staff game players" on public.game_players for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "staff game runs" on public.game_runs for select to authenticated using (public.is_staff());
grant select, insert, update on public.game_seasons, public.game_players to authenticated;
grant select on public.game_runs to authenticated;

-- October 2026: the first season.
insert into public.game_seasons (id, game_id, name, prize_title, prize_description, start_at, end_at, status, attempts_per_order)
values ('ryvok-2026-10', 'ryvok-runner-01',
  '{"ru":"Чемпионат «Рывок» — октябрь","ka":"ჩემპიონატი — ოქტომბერი","hy":"Առաջնություն — հոկտեմբեր"}',
  '{"ru":"4 порции шашлыка","ka":"4 პორცია მწვადი","hy":"4 բաժին խորոված"}',
  '{"ru":"Лучший результат месяца забирает приз. Приз выдаётся после проверки результата.","ka":"თვის საუკეთესო შედეგი იგებს პრიზს. პრიზი გაიცემა შედეგის შემოწმების შემდეგ.","hy":"Ամսվա լավագույն արդյունքը շահում է մրցանակը։ Մրցանակը տրվում է արդյունքի ստուգումից հետո։"}',
  '2026-10-01 00:00+04', '2026-11-01 00:00+04', 'active', 3)
on conflict (id) do nothing;

-- Orders that count on the board.
create or replace function private.game_order_counts(p_status public.order_status)
returns boolean language sql immutable set search_path to ''
as $$ select p_status in ('CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED') $$;

create or replace function private.game_active_season(p_game text)
returns public.game_seasons language sql stable set search_path to ''
as $$
  select s.* from public.game_seasons s
  where s.game_id = p_game and s.status = 'active' and now() >= s.start_at and now() < s.end_at
  order by s.start_at desc limit 1
$$;

-- Public board: top N + the caller's own place (by their order id). Name, place, score only.
create or replace function public.game_leaderboard(p_game text, p_order uuid default null, p_limit int default 10)
returns jsonb language plpgsql stable security definer set search_path to ''
as $$
declare
  s public.game_seasons;
  v_customer uuid;
  v_top jsonb;
  v_me jsonb;
begin
  s := private.game_active_season(p_game);
  if s.id is null then
    select * into s from public.game_seasons where game_id = p_game order by end_at desc limit 1;
  end if;
  if s.id is null then return jsonb_build_object('season', null, 'top', '[]'::jsonb); end if;
  if p_order is not null then select o.customer_id into v_customer from public.orders o where o.id = p_order; end if;

  with best as (
    -- each player's best score; equal scores: whoever reached it first ranks higher
    select distinct on (r.customer_id) r.customer_id, r.score, r.finished_at
    from public.game_runs r join public.orders o on o.id = r.order_id
    where r.season_id = s.id and r.status = 'finished' and r.customer_id is not null and private.game_order_counts(o.status)
    order by r.customer_id, r.score desc, r.finished_at
  ), ranked as (
    select b.customer_id, b.score, row_number() over (order by b.score desc, b.finished_at) as place from best b
  )
  select coalesce(jsonb_agg(jsonb_build_object('place', k.place, 'name', p.nickname, 'score', k.score, 'me', coalesce(k.customer_id = v_customer, false)) order by k.place)
                  filter (where k.place <= greatest(1, least(p_limit, 50))), '[]'::jsonb),
         (array_agg(jsonb_build_object('place', k.place, 'name', p.nickname, 'score', k.score)) filter (where k.customer_id = v_customer))[1]
    into v_top, v_me
  from ranked k left join public.game_players p on p.customer_id = k.customer_id;

  return jsonb_build_object(
    'season', jsonb_build_object('id', s.id, 'gameId', s.game_id, 'name', s.name, 'prizeTitle', s.prize_title,
                                 'prizeDescription', s.prize_description, 'prizeImage', s.prize_image,
                                 'startDate', s.start_at, 'endDate', s.end_at, 'status', s.status, 'winner', s.winner_name),
    'top', v_top, 'me', v_me);
end $$;
revoke all on function public.game_leaderboard(text, uuid, int) from public;
grant execute on function public.game_leaderboard(text, uuid, int) to anon, authenticated;

-- Attempts and the player's own state for an order (the browser holds the order id from checkout).
create or replace function public.game_order_state(p_game text, p_order uuid)
returns jsonb language plpgsql stable security definer set search_path to ''
as $$
declare
  s public.game_seasons; o record; v_used int; v_best int; v_nick text;
begin
  select id, customer_id, status, created_at into o from public.orders where id = p_order;
  if o.id is null then return jsonb_build_object('error', 'order'); end if;
  s := private.game_active_season(p_game);
  if s.id is null then return jsonb_build_object('error', 'season'); end if;
  select count(*) into v_used from public.game_runs where order_id = p_order and season_id = s.id;
  select max(score) into v_best from public.game_runs where customer_id = o.customer_id and season_id = s.id and status = 'finished';
  select nickname into v_nick from public.game_players where customer_id = o.customer_id;
  return jsonb_build_object(
    'attempts', s.attempts_per_order, 'used', v_used, 'left', greatest(0, s.attempts_per_order - v_used),
    'best', coalesce(v_best, 0), 'nickname', v_nick,
    'orderStatus', o.status, 'counts', private.game_order_counts(o.status),
    'blocked', o.status in ('CANCELLED', 'REFUNDED'));
end $$;
revoke all on function public.game_order_state(text, uuid) from public;
grant execute on function public.game_order_state(text, uuid) to anon, authenticated;

-- Start a run (called only by the edge function, which also checks origin and rate limits).
create or replace function public.game_start_run(p_game text, p_version int, p_order uuid, p_nickname text, p_ip_hash text)
returns jsonb language plpgsql volatile security definer set search_path to ''
as $$
declare
  s public.game_seasons; o record; v_used int; v_run uuid; v_seed bigint; v_nick text; v_recent int;
begin
  select id, customer_id, status, created_at into o from public.orders where id = p_order for update;
  if o.id is null then return jsonb_build_object('error', 'order'); end if;
  if o.status in ('CANCELLED', 'REFUNDED') then return jsonb_build_object('error', 'cancelled'); end if;
  if o.created_at < now() - interval '14 days' then return jsonb_build_object('error', 'old_order'); end if;
  s := private.game_active_season(p_game);
  if s.id is null then return jsonb_build_object('error', 'season'); end if;
  select count(*) into v_used from public.game_runs where order_id = p_order and season_id = s.id;
  if v_used >= s.attempts_per_order then return jsonb_build_object('error', 'no_attempts', 'left', 0); end if;
  -- one device / network cannot start runs non-stop with many orders
  select count(*) into v_recent from public.game_runs where ip_hash = p_ip_hash and started_at > now() - interval '1 hour';
  if p_ip_hash is not null and v_recent >= 30 then return jsonb_build_object('error', 'rate'); end if;

  v_nick := nullif(btrim(regexp_replace(coalesce(p_nickname, ''), '[^[:alnum:] _.\-]', '', 'g')), '');
  if v_nick is not null and o.customer_id is not null then
    insert into public.game_players (customer_id, nickname) values (o.customer_id, left(v_nick, 16))
    on conflict (customer_id) do update set nickname = excluded.nickname, updated_at = now()
    where char_length(left(v_nick, 16)) >= 2;
  end if;

  v_seed := floor(random() * 4294967295)::bigint + 1;
  insert into public.game_runs (game_id, season_id, order_id, customer_id, game_version, seed, ip_hash)
  values (p_game, s.id, p_order, o.customer_id, p_version, v_seed, p_ip_hash) returning id into v_run;
  return jsonb_build_object('run', v_run, 'seed', v_seed, 'season', s.id, 'left', s.attempts_per_order - v_used - 1);
end $$;
revoke all on function public.game_start_run(text, int, uuid, text, text) from public, anon, authenticated;
grant execute on function public.game_start_run(text, int, uuid, text, text) to service_role;

-- The run as the edge function needs it to replay.
create or replace function public.game_get_run(p_run uuid)
returns jsonb language sql stable security definer set search_path to ''
as $$
  select jsonb_build_object('id', r.id, 'game_id', r.game_id, 'version', r.game_version, 'seed', r.seed, 'status', r.status,
                            'order_id', r.order_id, 'started_at', r.started_at, 'now', now())
  from public.game_runs r where r.id = p_run
$$;
revoke all on function public.game_get_run(uuid) from public, anon, authenticated;
grant execute on function public.game_get_run(uuid) to service_role;

-- Store the verified result (once per run).
create or replace function public.game_finish_run(p_run uuid, p_ok boolean, p_score int, p_client_score int, p_ticks int,
                                                  p_jumps int, p_pauses int, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path to ''
as $$
declare r public.game_runs;
begin
  update public.game_runs set status = case when p_ok then 'finished' else 'rejected' end, finished_at = now(),
         score = case when p_ok then p_score end, client_score = p_client_score, ticks = p_ticks, jumps = p_jumps,
         pauses = p_pauses, reject_reason = p_reason
   where id = p_run and status = 'started' returning * into r;
  if r.id is null then return jsonb_build_object('error', 'state'); end if;
  return jsonb_build_object('ok', p_ok, 'score', r.score, 'order_id', r.order_id);
end $$;
revoke all on function public.game_finish_run(uuid, boolean, int, int, int, int, int, text) from public, anon, authenticated;
grant execute on function public.game_finish_run(uuid, boolean, int, int, int, int, int, text) to service_role;
