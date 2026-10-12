CREATE TABLE order_payments (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID(),
    organization_id UNIQUEIDENTIFIER NOT NULL,
    location_id UNIQUEIDENTIFIER NOT NULL,
    order_id UNIQUEIDENTIFIER NOT NULL,
    method NVARCHAR(24) NOT NULL,
    amount DECIMAL(19,4) NOT NULL,
    tendered_amount DECIMAL(19,4) NULL,
    change_amount DECIMAL(19,4) NOT NULL DEFAULT 0,
    external_reference NVARCHAR(120) NULL,
    idempotency_key UNIQUEIDENTIFIER NOT NULL,
    status NVARCHAR(24) NOT NULL DEFAULT 'COMPLETED',
    paid_by_user_id UNIQUEIDENTIFIER NOT NULL,
    paid_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    voided_at DATETIME2(3) NULL,
    voided_by_user_id UNIQUEIDENTIFIER NULL,
    CONSTRAINT pk_order_payments PRIMARY KEY (id),
    CONSTRAINT fk_order_payments_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_order_payments_location FOREIGN KEY (location_id) REFERENCES locations(id),
    CONSTRAINT fk_order_payments_order FOREIGN KEY (order_id) REFERENCES restaurant_orders(id),
    CONSTRAINT fk_order_payments_paid_by FOREIGN KEY (paid_by_user_id) REFERENCES app_users(id),
    CONSTRAINT fk_order_payments_voided_by FOREIGN KEY (voided_by_user_id) REFERENCES app_users(id),
    CONSTRAINT uq_order_payments_idempotency UNIQUE (organization_id, idempotency_key),
    CONSTRAINT ck_order_payments_method CHECK (method IN ('CASH', 'CARD')),
    CONSTRAINT ck_order_payments_amount CHECK (amount > 0),
    CONSTRAINT ck_order_payments_tendered CHECK (
        tendered_amount IS NULL OR tendered_amount >= amount
    ),
    CONSTRAINT ck_order_payments_change CHECK (change_amount >= 0),
    CONSTRAINT ck_order_payments_status CHECK (status IN ('COMPLETED', 'VOIDED'))
);

CREATE INDEX ix_order_payments_order_status
    ON order_payments(organization_id, order_id, status, paid_at);
CREATE INDEX ix_order_payments_location_date
    ON order_payments(organization_id, location_id, paid_at, method);
