-- «Пригласи друга» is a campaign: until 30.10 23:59 Tbilisi new links/bindings/rewards; points live 60 days.
update public.store_settings set value = value || '{"until": "2026-10-30T23:59:59+04:00", "points_days": 60}'::jsonb where key = 'referral';

create or replace function private.ref_active()
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce((select (value->>'enabled')::boolean and (value->>'until' is null or now() <= (value->>'until')::timestamptz)
                     from public.store_settings where key = 'referral'), false)
$$;

create or replace function public.referral_status()
returns jsonb language sql stable security definer set search_path to '' as $$
  select jsonb_build_object('active', private.ref_active(), 'until', (select value->>'until' from public.store_settings where key = 'referral'),
                            'points_days', private.ref_setting('points_days', 60))
$$;
grant execute on function public.referral_status() to anon, authenticated;
-- referral_bind / referral_attach / my_ref_link / referral_info: same as before plus «if not private.ref_active()»
-- (applied in the database; my_ref_link raises «Акция «Пригласи друга» закончилась», referral_info returns code = null).
