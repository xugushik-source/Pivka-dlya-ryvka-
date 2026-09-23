-- Placeholder seed data. Replace from admin when real assortment/economics arrive.
insert into public.categories (slug,name,emoji,sort_order) values
('draft','Разливное пиво','🍺',10),
('strong','Крепкий алкоголь','🥃',20),
('fish','Рыба','🐟',30),
('seafood','Морепродукты','🦐',40),
('cheese','Сыр','🧀',50),
('nuts','Орехи','🥜',60),
('snacks','Снеки','🥨',70),
('soft-drinks','Безалкогольные напитки','🥤',80)
on conflict (slug) do nothing;

insert into public.products (sku,category_id,name,description,unit,sale_price,purchase_price,stock_quantity,minimum_quantity,quantity_step,featured,sort_order)
select 'DRAFT-LAGER-PLACEHOLDER', id, 'Лагер — placeholder', 'Цена и себестоимость временные', 'liter', 9.50, 0, 0, 2, 1, true, 10
from public.categories where slug='draft'
on conflict (sku) do nothing;
