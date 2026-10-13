ALTER TABLE order_items ADD void_reason NVARCHAR(500) NULL;
ALTER TABLE order_items ADD voided_by_user_id UNIQUEIDENTIFIER NULL;
ALTER TABLE order_items
    ADD CONSTRAINT fk_order_items_voided_by
    FOREIGN KEY (voided_by_user_id) REFERENCES app_users(id);

CREATE INDEX ix_order_items_voided
    ON order_items(organization_id, order_id, voided_at);
