-- Catalog photos (white 800×1000 template) for products that had none. Wines still use the drawn placeholder
-- until their exact brand is confirmed.
update public.products p set image_url = 'https://xugushik-source.github.io/Pivka-dlya-ryvka-/assets/products/standard/' || v.file || '.jpg?v=20261001', updated_at = now()
  from (values
    ('DAV-FISH-SIG-001', 'sig-dried'),
    ('DAV-FISH-STR-030', 'stavrida-dried-030'),
    ('KRI-MEAT-SUD-190', 'sudzhuk-190'),
    ('KRI-MEAT-SUD-230', 'sudzhuk-vostochny-230'),
    ('KRI-MEAT-JERKY-MIX-060', 'atenk-jerky-mix-060'),
    ('KRI-SNACK-MARTIN-SMALL', 'ot-martina-small'),
    ('KRI-SNACK-MARTIN-080', 'ot-martina-080'),
    ('KRI-SNACK-MARTIN-250', 'ot-martina-250')
  ) v(sku, file)
 where p.sku = v.sku;
