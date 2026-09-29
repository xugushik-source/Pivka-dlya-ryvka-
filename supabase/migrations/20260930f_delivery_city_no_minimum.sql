-- Applied 2026-09-30 (migration "delivery_city_no_minimum").
-- No minimum order in the city: below 40 ₾ delivery costs 5 ₾, from 40 ₾ it is free.
update public.delivery_zones set minimum_order = 0 where active;
