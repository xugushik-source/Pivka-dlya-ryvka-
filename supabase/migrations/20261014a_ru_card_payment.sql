-- Payment from a Russian card: the owner's receiving details live in store_settings «ru_card»;
-- the storefront shows the option only when enabled. Amount = order total × CBR rate (RUB per GEL) × 1.15.
insert into public.store_settings(key, value)
values ('ru_card', '{"enabled": false, "markup": 15, "bank": "", "card": "", "holder": "", "sbp_phone": ""}'::jsonb)
on conflict (key) do nothing;

create or replace function public.ru_card_info()
returns jsonb language sql stable security definer set search_path to '' as $$
  select case when coalesce((value->>'enabled')::boolean, false)
              then jsonb_build_object('markup', coalesce((value->>'markup')::numeric, 15), 'bank', value->>'bank',
                                      'card', value->>'card', 'holder', value->>'holder', 'sbp_phone', value->>'sbp_phone')
         end
    from public.store_settings where key = 'ru_card'
$$;
revoke all on function public.ru_card_info() from public;
grant execute on function public.ru_card_info() to anon, authenticated;
