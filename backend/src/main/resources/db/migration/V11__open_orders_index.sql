IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'ix_restaurant_orders_open_location'
      AND object_id = OBJECT_ID('restaurant_orders')
)
    CREATE INDEX ix_restaurant_orders_open_location
        ON restaurant_orders(organization_id, location_id, opened_at)
        INCLUDE (id, order_number, table_id, status, guest_count, notes, version)
        WHERE closed_at IS NULL;
