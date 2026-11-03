ALTER TABLE restaurant_orders DROP CONSTRAINT ck_restaurant_orders_order_type;

ALTER TABLE restaurant_orders ADD CONSTRAINT ck_restaurant_orders_order_type
    CHECK (order_type IN ('DINE_IN', 'TAKEAWAY', 'DELIVERY'));
