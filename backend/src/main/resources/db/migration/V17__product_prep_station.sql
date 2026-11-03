ALTER TABLE products ADD prep_station NVARCHAR(16) NOT NULL
    CONSTRAINT df_products_prep_station DEFAULT 'KITCHEN';
GO
UPDATE p
SET p.prep_station = N'BAR'
FROM products p
INNER JOIN menu_categories c ON c.id = p.category_id
WHERE LOWER(c.name) LIKE N'%bebida%'
   OR LOWER(p.name) LIKE N'%bebida%';
GO
ALTER TABLE products ADD CONSTRAINT ck_products_prep_station
    CHECK (prep_station IN ('KITCHEN', 'BAR'));
