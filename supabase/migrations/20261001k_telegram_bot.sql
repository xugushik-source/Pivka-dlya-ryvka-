-- Telegram bot, stage 1: the owner pastes the bot token in admin (kept in Vault, never in the repo),
-- people connect with a one-time link t.me/<bot>?start=<code>, and every new order is sent to the owner.
-- The edge function `telegram` sends the messages; the database calls it through pg_net after commit.

create extension if not exists pg_net with schema extensions;

-- Who receives what. kind: OWNER (full orders), SUPPLIER (own items only), DRIVER (deliveries).
create table if not exists public.telegram_links (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('OWNER', 'SUPPLIER', 'DRIVER')),
  ref_id uuid,                       -- profiles.id / suppliers.id / drivers.id
  label text,
  code text not null unique default encode(extensions.gen_random_bytes(9), 'hex'),
  chat_id bigint,
  tg_username text,
  linked_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists telegram_links_kind_ref_key on public.telegram_links(kind, ref_id) where active;
alter table public.telegram_links enable row level security;
drop policy if exists "staff telegram links" on public.telegram_links;
create policy "staff telegram links" on public.telegram_links for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));

-- Secrets live in Vault. Internal secrets are created once here; the bot token is set from admin.
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'tg_internal_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'tg_internal_secret', 'DB → edge function telegram');
  end if;
  if not exists (select 1 from vault.secrets where name = 'tg_webhook_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'tg_webhook_secret', 'Telegram → edge function telegram');
  end if;
end $$;

create or replace function private.vault_get(p_name text)
returns text language sql stable security definer set search_path to ''
as $$ select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1 $$;
revoke all on function private.vault_get(text) from public, anon, authenticated;

-- Owner/admin pastes the token from @BotFather. Only OWNER/ADMIN; the token is never returned to the browser.
create or replace function public.tg_set_token(p_token text)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare sid uuid;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and p.role in ('OWNER', 'ADMIN')) then
    raise exception 'Forbidden';
  end if;
  if coalesce(trim(p_token), '') !~ '^[0-9]{5,}:[A-Za-z0-9_-]{30,}$' then
    raise exception 'Это не похоже на токен от @BotFather';
  end if;
  select id into sid from vault.secrets where name = 'tg_bot_token';
  if sid is null then perform vault.create_secret(trim(p_token), 'tg_bot_token', 'Telegram bot token');
  else perform vault.update_secret(sid, trim(p_token)); end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.tg_set_token(text) from public, anon;
grant execute on function public.tg_set_token(text) to authenticated;

-- Read by the edge function only (service role).
create or replace function public.tg_config()
returns jsonb language sql stable security definer set search_path to ''
as $$
  select jsonb_build_object('token', private.vault_get('tg_bot_token'),
                            'internal', private.vault_get('tg_internal_secret'),
                            'webhook', private.vault_get('tg_webhook_secret'))
$$;
revoke all on function public.tg_config() from public, anon, authenticated;
grant execute on function public.tg_config() to service_role;

-- Admin: get (or create) the invite link code for a person.
create or replace function public.tg_invite(p_kind text, p_ref uuid, p_label text default null)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare l public.telegram_links;
begin
  if not private.is_staff() then raise exception 'Forbidden'; end if;
  select * into l from public.telegram_links where kind = p_kind and ref_id is not distinct from p_ref and active;
  if l.id is null then
    insert into public.telegram_links(kind, ref_id, label) values (p_kind, p_ref, p_label) returning * into l;
  elsif p_label is not null and l.label is distinct from p_label then
    update public.telegram_links set label = p_label where id = l.id returning * into l;
  end if;
  return jsonb_build_object('id', l.id, 'code', l.code, 'linked', l.chat_id is not null, 'tg_username', l.tg_username);
end $$;
revoke all on function public.tg_invite(text, uuid, text) from public, anon;
grant execute on function public.tg_invite(text, uuid, text) to authenticated;

-- Admin: disconnect (the person stops receiving messages; a new link can be issued).
create or replace function public.tg_unlink(p_id uuid)
returns void language plpgsql security definer set search_path to ''
as $$ begin
  if not private.is_staff() then raise exception 'Forbidden'; end if;
  update public.telegram_links set active = false where id = p_id;
end $$;
revoke all on function public.tg_unlink(uuid) from public, anon;
grant execute on function public.tg_unlink(uuid) to authenticated;

-- DB → edge function. Never breaks the caller: without a token or on any error it silently does nothing.
create or replace function private.tg_post(p_body jsonb)
returns void language plpgsql security definer set search_path to ''
as $$
declare v_secret text;
begin
  if private.vault_get('tg_bot_token') is null then return; end if;
  v_secret := private.vault_get('tg_internal_secret');
  perform net.http_post(
    url := 'https://uphnuzgaildmjrttmbaq.supabase.co/functions/v1/telegram',
    body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_secret),
    timeout_milliseconds := 10000);
exception when others then
  raise warning 'tg_post failed: %', sqlerrm;
end $$;
revoke all on function private.tg_post(jsonb) from public, anon, authenticated;

-- New order → owner. pg_net sends after commit, so the function sees items, delivery and totals.
create or replace function private.orders_tg_new()
returns trigger language plpgsql security definer set search_path to ''
as $$ begin
  perform private.tg_post(jsonb_build_object('action', 'order_created', 'order_id', new.id));
  return new;
end $$;
drop trigger if exists orders_tg_new on public.orders;
create trigger orders_tg_new after insert on public.orders
  for each row execute function private.orders_tg_new();
