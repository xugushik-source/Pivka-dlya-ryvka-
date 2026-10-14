-- Russian-card payment can also be a payment link (business account / ИП): store_settings ru_card.pay_url.
create or replace function public.ru_card_info()
returns jsonb language sql stable security definer set search_path to '' as $$
  select case when coalesce((value->>'enabled')::boolean, false)
              then jsonb_build_object('markup', coalesce((value->>'markup')::numeric, 15), 'bank', value->>'bank',
                                      'card', value->>'card', 'holder', value->>'holder', 'sbp_phone', value->>'sbp_phone',
                                      'pay_url', value->>'pay_url')
         end
    from public.store_settings where key = 'ru_card'
$$;
