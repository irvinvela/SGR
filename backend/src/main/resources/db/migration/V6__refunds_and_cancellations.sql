ALTER TABLE restaurant_orders DROP CONSTRAINT ck_restaurant_orders_status;
ALTER TABLE restaurant_orders ADD CONSTRAINT ck_restaurant_orders_status CHECK (
    status IN (
        'OPEN', 'WAITING_PAYMENT', 'PAID',
        'PARTIALLY_REFUNDED', 'REFUNDED', 'CANCELLED'
    )
);

ALTER TABLE kitchen_rounds DROP CONSTRAINT ck_kitchen_rounds_status;
ALTER TABLE kitchen_rounds ADD CONSTRAINT ck_kitchen_rounds_status CHECK (
    status IN ('QUEUED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED')
);

CREATE TABLE payment_refunds (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID(),
    organization_id UNIQUEIDENTIFIER NOT NULL,
    location_id UNIQUEIDENTIFIER NOT NULL,
    order_id UNIQUEIDENTIFIER NOT NULL,
    payment_id UNIQUEIDENTIFIER NOT NULL,
    cash_shift_id UNIQUEIDENTIFIER NOT NULL,
    method NVARCHAR(24) NOT NULL,
    amount DECIMAL(19,4) NOT NULL,
    reason NVARCHAR(500) NOT NULL,
    idempotency_key UNIQUEIDENTIFIER NOT NULL,
    refunded_by_user_id UNIQUEIDENTIFIER NOT NULL,
    refunded_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_payment_refunds PRIMARY KEY (id),
    CONSTRAINT fk_payment_refunds_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_payment_refunds_location FOREIGN KEY (location_id) REFERENCES locations(id),
    CONSTRAINT fk_payment_refunds_order FOREIGN KEY (order_id) REFERENCES restaurant_orders(id),
    CONSTRAINT fk_payment_refunds_payment FOREIGN KEY (payment_id) REFERENCES order_payments(id),
    CONSTRAINT fk_payment_refunds_cash_shift FOREIGN KEY (cash_shift_id) REFERENCES cash_shifts(id),
    CONSTRAINT fk_payment_refunds_user FOREIGN KEY (refunded_by_user_id) REFERENCES app_users(id),
    CONSTRAINT uq_payment_refunds_idempotency UNIQUE (organization_id, idempotency_key),
    CONSTRAINT ck_payment_refunds_method CHECK (method IN ('CASH', 'CARD')),
    CONSTRAINT ck_payment_refunds_amount CHECK (amount > 0)
);

CREATE INDEX ix_payment_refunds_payment
    ON payment_refunds(organization_id, payment_id, refunded_at);
CREATE INDEX ix_payment_refunds_order
    ON payment_refunds(organization_id, order_id, refunded_at);
CREATE INDEX ix_payment_refunds_cash_shift
    ON payment_refunds(organization_id, cash_shift_id, method, refunded_at);

ALTER TABLE cash_shifts ADD cash_refunds_total DECIMAL(19,4) NULL;
ALTER TABLE cash_shifts ADD card_refunds_total DECIMAL(19,4) NULL;
