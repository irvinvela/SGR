CREATE TABLE order_item_addons (
    id UNIQUEIDENTIFIER NOT NULL,
    organization_id UNIQUEIDENTIFIER NOT NULL,
    order_item_id UNIQUEIDENTIFIER NOT NULL,
    group_id UNIQUEIDENTIFIER NOT NULL,
    option_id UNIQUEIDENTIFIER NOT NULL,
    group_name NVARCHAR(100) NOT NULL,
    option_name NVARCHAR(160) NOT NULL,
    price DECIMAL(19,4) NOT NULL DEFAULT 0,
    CONSTRAINT pk_order_item_addons PRIMARY KEY (id),
    CONSTRAINT fk_order_item_addons_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_order_item_addons_item FOREIGN KEY (order_item_id) REFERENCES order_items(id),
    CONSTRAINT fk_order_item_addons_group FOREIGN KEY (group_id) REFERENCES addon_groups(id),
    CONSTRAINT fk_order_item_addons_option FOREIGN KEY (option_id) REFERENCES addon_options(id),
    CONSTRAINT ck_order_item_addons_price CHECK (price >= 0)
);

CREATE INDEX ix_order_item_addons_item
    ON order_item_addons(order_item_id);
