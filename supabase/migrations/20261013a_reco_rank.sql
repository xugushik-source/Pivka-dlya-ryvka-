-- Voice seller: which product earns more inside its category (1 = most profit in GEL), without exposing costs.
create or replace function public.reco_rank()
returns table(product_id uuid, rank int)
language sql stable security definer set search_path = public as $$
  select p.id, dense_rank() over (partition by p.category_id order by (p.sale_price - coalesce(p.purchase_price, p.sale_price)) desc)::int
  from products p where p.active and p.sale_price > 0
$$;
revoke all on function public.reco_rank() from public;
grant execute on function public.reco_rank() to anon, authenticated;
