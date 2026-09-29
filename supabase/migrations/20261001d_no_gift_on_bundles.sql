-- Owner's decision: a bundle (Рывок) already has its own discount, so it does not count toward the gift.
-- The gift threshold is checked only against extra products added to the bundle order.
do $$
declare src text; fixed text;
begin
  src := pg_get_functiondef('private.create_bundle_order_core(text,text,text,text,text,text,uuid,uuid,jsonb)'::regprocedure);
  fixed := replace(src, 'v_gift := private.apply_order_gift(v_order, v_total);', 'v_gift := private.apply_order_gift(v_order, v_extra);');
  if fixed = src then raise exception 'gift call not found in create_bundle_order_core'; end if;
  execute fixed;
end $$;
