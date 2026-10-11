-- Owner, 2026-10-11: a Рывок price is always a whole number of lari, rounded UP (93.05 → 94),
-- never above the price of the parts bought separately. Order creation reads the same bundle_calc.
do $$
declare d text := pg_get_functiondef('private.bundle_calc(uuid)'::regprocedure);
begin
  if position('ceil(a.regular_total' in d) > 0 then return; end if;
  d := replace(d, 'then round(a.regular_total * (1 - least(a.discount_value, 100) / 100), 2)',
                  'then least(ceil(a.regular_total * (1 - least(a.discount_value, 100) / 100)), a.regular_total)');
  d := replace(d, 'else greatest(round(a.regular_total - a.discount_value, 2), 0) end bundle_price',
                  'else least(greatest(ceil(a.regular_total - a.discount_value), 0), a.regular_total) end bundle_price');
  if position('ceil(a.regular_total * (1' in d) = 0 or position('ceil(a.regular_total - a.discount_value)' in d) = 0 then
    raise exception 'bundle_calc: price formula not found, nothing changed';
  end if;
  execute d;
end $$;
