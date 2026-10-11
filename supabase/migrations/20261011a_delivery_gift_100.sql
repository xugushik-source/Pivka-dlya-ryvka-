-- Owner, 2026-10-11: delivery day 3 ₾ (free from 50 ₾), after 23:00 7 ₾ (free from 80 ₾ — the night trip costs 7 ₾,
-- night prices are +10 %). Gifts: only from 100 ₾ (сиг сушёный); the 50 ₾ level (two Jerky) is switched off.
update public.store_settings
   set value = value || '{"day_fee":3,"day_free_from":50,"night_fee":7,"night_free_from":80}'::jsonb
 where key = 'delivery_policy';
update public.gift_tiers set active = false where threshold = 50;
