-- Owner: beer order in the catalog — Helles, Valhalla, Sanapiro, Alpenbräu, Keri (products.home_rank; editable in admin).
update public.products p set home_rank = v.r, updated_at = now()
  from (values ('DAV-BEER-005',1),('DAV-BEER-004',2),('DAV-BEER-002',3),('DAV-BEER-003',4),('DAV-BEER-001',5)) v(sku, r)
 where p.sku = v.sku;
