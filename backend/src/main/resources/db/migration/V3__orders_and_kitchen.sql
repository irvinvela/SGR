CREATE TABLE restaurant_orders (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID(),
    order_number BIGINT IDENTITY(1,1) NOT NULL,
    organization_id UNIQUEIDENTIFIER NOT NULL,
    location_id UNIQUEIDENTIFIER NOT NULL,
    table_id UNIQUEIDENTIFIER NOT NULL,
    status NVARCHAR(24) NOT NULL DEFAULT 'OPEN',
    guest_count INT NOT NULL DEFAULT 1,
    notes NVARCHAR(500) NULL,
    opened_by_user_id UNIQUEIDENTIFIER NOT NULL,
    opened_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    closed_at DATETIME2(3) NULL,
    version BIGINT NOT NULL DEFAULT 0,
    updated_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_restaurant_orders PRIMARY KEY (id),
    CONSTRAINT uq_restaurant_orders_number UNIQUE (order_number),
    CONSTRAINT fk_restaurant_orders_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_restaurant_orders_location FOREIGN KEY (location_id) REFERENCES locations(id),
    CONSTRAINT fk_restaurant_orders_table FOREIGN KEY (table_id) REFERENCES dining_tables(id),
    CONSTRAINT fk_restaurant_orders_opened_by FOREIGN KEY (opened_by_user_id) REFERENCES app_users(id),
    CONSTRAINT ck_restaurant_orders_status CHECK (
        status IN ('OPEN', 'WAITING_PAYMENT', 'PAID', 'CANCELLED')
    ),
    CONSTRAINT ck_restaurant_orders_guests CHECK (guest_count BETWEEN 1 AND 999)
);

CREATE UNIQUE INDEX uq_restaurant_orders_open_table
    ON restaurant_orders(table_id)
    WHERE closed_at IS NULL;

CREATE TABLE order_items (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID(),
    organization_id UNIQUEIDENTIFIER NOT NULL,
    order_id UNIQUEIDENTIFIER NOT NULL,
    product_id UNIQUEIDENTIFIER NOT NULL,
    product_name NVARCHAR(160) NOT NULL,
    sku NVARCHAR(64) NOT NULL,
    quantity DECIMAL(10,3) NOT NULL,
    unit_price DECIMAL(19,4) NOT NULL,
    tax_rate DECIMAL(7,4) NOT NULL,
    kitchen_note NVARCHAR(500) NULL,
    sent_to_kitchen_at DATETIME2(3) NULL,
    voided_at DATETIME2(3) NULL,
    created_by_user_id UNIQUEIDENTIFIER NOT NULL,
    created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT pk_order_items PRIMARY KEY (id),
    CONSTRAINT fk_order_items_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES restaurant_orders(id),
    CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products(id),
    CONSTRAINT fk_order_items_created_by FOREIGN KEY (created_by_user_id) REFERENCES app_users(id),
    CONSTRAINT ck_order_items_quantity CHECK (quantity > 0),
    CONSTRAINT ck_order_items_unit_price CHECK (unit_price >= 0),
    CONSTRAINT ck_order_items_tax_rate CHECK (tax_rate BETWEEN 0 AND 100)
);

CREATE TABLE kitchen_rounds (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID(),
    organization_id UNIQUEIDENTIFIER NOT NULL,
    location_id UNIQUEIDENTIFIER NOT NULL,
    order_id UNIQUEIDENTIFIER NOT NULL,
    round_number INT NOT NULL,
    idempotency_key UNIQUEIDENTIFIER NOT NULL,
    status NVARCHAR(24) NOT NULL DEFAULT 'QUEUED',
    sent_by_user_id UNIQUEIDENTIFIER NOT NULL,
    sent_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    preparing_at DATETIME2(3) NULL,
    ready_at DATETIME2(3) NULL,
    completed_at DATETIME2(3) NULL,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT pk_kitchen_rounds PRIMARY KEY (id),
    CONSTRAINT fk_kitchen_rounds_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_kitchen_rounds_location FOREIGN KEY (location_id) REFERENCES locations(id),
    CONSTRAINT fk_kitchen_rounds_order FOREIGN KEY (order_id) REFERENCES restaurant_orders(id),
    CONSTRAINT fk_kitchen_rounds_sent_by FOREIGN KEY (sent_by_user_id) REFERENCES app_users(id),
    CONSTRAINT uq_kitchen_rounds_idempotency UNIQUE (organization_id, idempotency_key),
    CONSTRAINT uq_kitchen_rounds_order_number UNIQUE (order_id, round_number),
    CONSTRAINT ck_kitchen_rounds_number CHECK (round_number > 0),
    CONSTRAINT ck_kitchen_rounds_status CHECK (
        status IN ('QUEUED', 'PREPARING', 'READY', 'COMPLETED')
    )
);

CREATE TABLE kitchen_round_items (
    round_id UNIQUEIDENTIFIER NOT NULL,
    order_item_id UNIQUEIDENTIFIER NOT NULL,
    CONSTRAINT pk_kitchen_round_items PRIMARY KEY (round_id, order_item_id),
    CONSTRAINT fk_kitchen_round_items_round FOREIGN KEY (round_id) REFERENCES kitchen_rounds(id),
    CONSTRAINT fk_kitchen_round_items_item FOREIGN KEY (order_item_id) REFERENCES order_items(id),
    CONSTRAINT uq_kitchen_round_items_item UNIQUE (order_item_id)
);

CREATE INDEX ix_restaurant_orders_organization_location_status
    ON restaurant_orders(organization_id, location_id, status, opened_at DESC);
CREATE INDEX ix_order_items_order_active
    ON order_items(order_id, voided_at, sent_to_kitchen_at);
CREATE INDEX ix_kitchen_rounds_location_status
    ON kitchen_rounds(organization_id, location_id, status, sent_at);
