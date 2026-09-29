-- Applied 2026-09-30 (migration "delivery_pass_min_20").
-- PASS (12:00–22:00): order from 20 ₾ → 0 ₾, below 20 ₾ → 3 ₾. Without PASS: from 40 ₾ → 0 ₾, below → 5 ₾.
-- private.delivery_quote was replaced accordingly (settings keys pass_free_from = 20, pass_fee = 3).
update public.store_settings set value = value || '{"pass_free_from":20,"pass_fee":3}'::jsonb where key = 'delivery_policy';
