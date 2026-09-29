-- Owner, 2026-10-01: sale prices for the three beers left empty in the sheet (purchase unchanged: 5 / 5 / 6).
update public.products p set sale_price = v.sell, updated_at = now()
  from (values ('DAV-BEER-003', 7.5), ('DAV-BEER-005', 7.5), ('DAV-BEER-001', 8.5)) v(sku, sell) where p.sku = v.sku;
update public.bundles b set price = x.bundle_price, compare_at_price = x.regular_total from private.bundle_calc(null) x where x.bundle_id = b.id;
