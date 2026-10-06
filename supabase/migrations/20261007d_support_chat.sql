-- Chat on the site instead of WhatsApp. The owner's phone number is no longer shown anywhere.
--
-- Customer side: «💬 Написать нам» on the site. A conversation = support_threads row; its id is a random uuid that
-- only this browser knows (localStorage), the same «key = random id» model as the order page.
-- Owner side (Telegram), kept apart from the order messages:
--   • a separate Telegram group with Topics (telegram_links kind SUPPORT): every customer gets an own topic named
--     «№51 · Гоча»; the first message is a card — name, phone, order number, status, sum. The owner just writes in the
--     topic and the text goes back to the customer's chat on the site;
--   • until that group is connected, messages come to the owner's bot chat marked «💬 ЧАТ», answer with «Ответить».
-- Swearing: the message is not delivered, the customer is warned and blocked — 5 min, again within 7 days → 30 min.
-- Tables: RLS on, no policies; the browser goes only through the functions below, the bot uses the service role.

alter table public.telegram_links drop constraint if exists telegram_links_kind_check;
alter table public.telegram_links add constraint telegram_links_kind_check check (kind in ('OWNER', 'SUPPLIER', 'DRIVER', 'SUPPORT'));

create table if not exists public.support_threads (
  id uuid primary key,                       -- generated in the browser, kept in localStorage
  order_id uuid references public.orders(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  name text,
  phone text,
  lang text,
  tg_chat bigint,                            -- support group
  tg_topic bigint,                           -- message_thread_id of the customer's topic
  tg_order_shown uuid,                       -- order last shown in the topic card
  blocked_until timestamptz,
  strikes int not null default 0,
  last_strike_at timestamptz,
  created_at timestamptz not null default now(),
  last_in_at timestamptz,
  last_out_at timestamptz
);
create index if not exists support_threads_topic_idx on public.support_threads (tg_chat, tg_topic);

create table if not exists public.support_messages (
  id bigint generated always as identity primary key,
  thread_id uuid not null references public.support_threads(id) on delete cascade,
  dir text not null check (dir in ('IN', 'OUT', 'SYS')),   -- IN customer → us, OUT us → customer, SYS notices
  body text,
  image_path text,                                          -- storage bucket support-chat
  author text,
  created_at timestamptz not null default now()
);
create index if not exists support_messages_thread_idx on public.support_messages (thread_id, id);

-- Telegram copies of customer messages (owner's bot chat fallback: a reply to one of them answers that customer).
create table if not exists public.support_tg (
  chat_id bigint not null,
  message_id bigint not null,
  thread_id uuid not null references public.support_threads(id) on delete cascade,
  primary key (chat_id, message_id)
);

alter table public.support_threads enable row level security;
alter table public.support_messages enable row level security;
alter table public.support_tg enable row level security;
revoke all on public.support_threads, public.support_messages, public.support_tg from anon, authenticated;
drop policy if exists "staff support threads" on public.support_threads;
drop policy if exists "staff support messages" on public.support_messages;
create policy "staff support threads" on public.support_threads for select to authenticated using (public.is_staff());
create policy "staff support messages" on public.support_messages for select to authenticated using (public.is_staff());
grant select on public.support_threads, public.support_messages to authenticated;

-- Photos (e.g. a transfer screenshot): private bucket, only images up to 5 MB; anyone may upload into a folder named
-- after a uuid (their thread), nobody may read through the API — the bot reads them with the service role.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support-chat', 'support-chat', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "support chat upload" on storage.objects;
create policy "support chat upload" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'support-chat' and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

-- Swearing (Russian incl. Latin spelling, Georgian, Armenian). Word starts only, so «хлеб», «небо», «команда» pass.
create or replace function private.support_is_rude(p text)
returns boolean language sql immutable set search_path to ''
as $$
  select lower(coalesce(p, '')) ~* (
    '(^|[^[:alpha:]])(' ||
      'х[уy]+[йяеёию]|п[иі]+зд|(за|на|по|вы|от|до|раз|у|въ|съ|при)?[её]б(а|у|и|л|н|ё|ы|ок|ищ|ну|[^[:alpha:]]|$)|бл[яa]+(д|т|$|[^[:alpha:]])|бля$|' ||
      'сук(а|и|у|ой|ин)|мудак|мудил|гандон|г[ао]ндон|пид[оа]р|шлюх|долбо[её]б|залуп|манд(а|у|ой|ы)([^[:alpha:]]|$)|ебл[ао]|уеб|' ||
      'hu[iy]|pizd|eba[tln]|blya|blyat|suk[ai]|nahu[iy]|pidor|mudak|' ||
      'მოგიტყ|მოვტყ|ტყნ|ყლე|მუტელ|ბოზ|' ||
      'քունեմ|քունած|քունի|բոզ|qunem|qunac|' ||
      'идиот|дебил|ублюд' ||
    ')')
$$;

-- Customer sends a message (text and/or photo). Creates the thread on the first message.
create or replace function public.support_send(p_thread uuid, p_body text, p_image text default null, p_order uuid default null,
                                               p_name text default null, p_lang text default null)
returns jsonb language plpgsql volatile security definer set search_path to ''
as $$
declare t public.support_threads; v_body text; v_recent int; v_order public.orders; v_msg bigint; v_block interval;
begin
  if p_thread is null then return jsonb_build_object('error', 'thread'); end if;
  v_body := nullif(btrim(left(coalesce(p_body, ''), 1000)), '');
  if v_body is null and p_image is null then return jsonb_build_object('error', 'empty'); end if;
  if p_image is not null and p_image !~ ('^' || p_thread::text || '/[A-Za-z0-9._-]{1,80}$') then return jsonb_build_object('error', 'image'); end if;

  select * into t from public.support_threads where id = p_thread for update;
  if t.id is null then
    insert into public.support_threads (id, lang) values (p_thread, left(p_lang, 5)) returning * into t;
  end if;
  if t.blocked_until is not null and t.blocked_until > now() then
    return jsonb_build_object('error', 'blocked', 'until', t.blocked_until);
  end if;

  -- attach the order (and through it the customer: name, phone) the browser knows about
  if p_order is not null then
    select * into v_order from public.orders where id = p_order;
    if v_order.id is not null then
      update public.support_threads set order_id = v_order.id, customer_id = v_order.customer_id,
             phone = coalesce((select c.phone from public.customers c where c.id = v_order.customer_id), phone),
             name = coalesce(nullif(btrim((select c.full_name from public.customers c where c.id = v_order.customer_id)), ''), name)
       where id = t.id returning * into t;
    end if;
  end if;
  if t.name is null and nullif(btrim(p_name), '') is not null then
    update public.support_threads set name = left(btrim(p_name), 40) where id = t.id returning * into t;
  end if;

  select count(*) into v_recent from public.support_messages where thread_id = t.id and dir = 'IN' and created_at > now() - interval '10 minutes';
  if v_recent >= 15 then return jsonb_build_object('error', 'rate'); end if;

  if private.support_is_rude(v_body) then
    v_block := case when t.last_strike_at > now() - interval '7 days' then interval '30 minutes' else interval '5 minutes' end;
    update public.support_threads set strikes = strikes + 1, last_strike_at = now(), blocked_until = now() + v_block
     where id = t.id returning * into t;
    insert into public.support_messages (thread_id, dir, body, author) values (t.id, 'SYS', 'rude', 'system');
    perform private.tg_post(jsonb_build_object('action', 'support_blocked', 'thread_id', t.id, 'until', t.blocked_until));
    return jsonb_build_object('error', 'rude', 'until', t.blocked_until);
  end if;

  insert into public.support_messages (thread_id, dir, body, image_path) values (t.id, 'IN', v_body, p_image) returning id into v_msg;
  update public.support_threads set last_in_at = now() where id = t.id;
  perform private.tg_post(jsonb_build_object('action', 'support_in', 'message_id', v_msg));
  return jsonb_build_object('ok', true, 'id', v_msg);
end $$;
revoke all on function public.support_send(uuid, text, text, uuid, text, text) from public;
grant execute on function public.support_send(uuid, text, text, uuid, text, text) to anon, authenticated;

-- Customer reads the conversation (only by the thread id this browser holds).
create or replace function public.support_fetch(p_thread uuid, p_after bigint default 0)
returns jsonb language sql stable security definer set search_path to ''
as $$
  select jsonb_build_object(
    'blocked_until', (select case when t.blocked_until > now() then t.blocked_until end from public.support_threads t where t.id = p_thread),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'dir', m.dir, 'body', m.body, 'image', m.image_path is not null, 'at', m.created_at) order by m.id)
                 from (select * from public.support_messages where thread_id = p_thread and id > coalesce(p_after, 0) order by id limit 200) m), '[]'::jsonb))
$$;
revoke all on function public.support_fetch(uuid, bigint) from public;
grant execute on function public.support_fetch(uuid, bigint) to anon, authenticated;
