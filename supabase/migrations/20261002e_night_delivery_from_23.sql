-- Owner, 2026-10-02: the evening delivery rate (7 ₾, free from 80 ₾) starts at 23:00 instead of 22:00 (until 08:00).
update public.store_settings set value = value || '{"night_from":"23:00"}'::jsonb where key = 'delivery_policy';
