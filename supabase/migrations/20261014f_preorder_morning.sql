-- 08:00 Tbilisi (04:00 UTC): pre-orders made during the night are sent to the suppliers.
select cron.schedule('preorder-morning', '0 4 * * *', $$select private.tg_post(jsonb_build_object('action', 'preorder_morning'))$$);
