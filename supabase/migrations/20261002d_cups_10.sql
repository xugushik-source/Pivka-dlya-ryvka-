-- Owner, 2026-10-02: paper cups are sold by 10 too: 2 ₾ for 10, purchase = the pack-of-50 price / 5 (2.50 → 0.50 ₾).
update public.products
   set name = 'Стаканы бумажные, 10 шт',
       name_i18n = jsonb_build_object('ru', 'Стаканы бумажные, 10 шт', 'ka', 'ქაღალდის ჭიქები, 10 ც', 'hy', 'Թղթե բաժակներ, 10 հատ'),
       sale_price = 2, purchase_price = 0.5, updated_at = now()
 where sku = 'KRI-SUPPLY-CUPS-PAPER-050';
update public.supplier_products sp set last_cost = p.purchase_price
  from public.products p where p.id = sp.product_id and p.sku = 'KRI-SUPPLY-CUPS-PAPER-050';
