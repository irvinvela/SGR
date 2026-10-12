CREATE TABLE cash_shifts (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID(),
    organization_id UNIQUEIDENTIFIER NOT NULL,
    location_id UNIQUEIDENTIFIER NOT NULL,
    status NVARCHAR(16) NOT NULL DEFAULT 'OPEN',
    opening_amount DECIMAL(19,4) NOT NULL,
    opened_by_user_id UNIQUEIDENTIFIER NOT NULL,
    opened_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    closing_counted_cash DECIMAL(19,4) NULL,
    expected_cash DECIMAL(19,4) NULL,
    cash_difference DECIMAL(19,4) NULL,
    cash_sales_total DECIMAL(19,4) NULL,
    card_sales_total DECIMAL(19,4) NULL,
    paid_in_total DECIMAL(19,4) NULL,
    paid_out_total DECIMAL(19,4) NULL,
    closed_by_user_id UNIQUEIDENTIFIER NULL,
    closed_at DATETIME2(3) NULL,
    closing_note NVARCHAR(500) NULL,
    idempotency_key UNIQUEIDENTIFIER NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT pk_cash_shifts PRIMARY KEY (id),
    CONSTRAINT fk_cash_shifts_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_cash_shifts_location FOREIGN KEY (location_id) REFERENCES locations(id),
    CONSTRAINT fk_cash_shifts_opened_by FOREIGN KEY (opened_by_user_id) REFERENCES app_users(id),
    CONSTRAINT fk_cash_shifts_closed_by FOREIGN KEY (closed_by_user_id) REFERENCES app_users(id),
    CONSTRAINT uq_cash_shifts_idempotency UNIQUE (organization_id, idempotency_key),
    CONSTRAINT ck_cash_shifts_status CHECK (status IN ('OPEN', 'CLOSED')),
    CONSTRAINT ck_cash_shifts_opening CHECK (opening_amount >= 0),
    CONSTRAINT ck_cash_shifts_closing_count CHECK (closing_counted_cash IS NULL OR closing_counted_cash >= 0)
);

CREATE UNIQUE INDEX uq_cash_shifts_open_location
    ON cash_shifts(organization_id, location_id)
    WHERE status = 'OPEN';
CREATE INDEX ix_cash_shifts_location_opened
    ON cash_shifts(organization_id, location_id, opened_at DESC);

CREATE TABLE cash_movements (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID(),
    organization_id UNIQUEIDENTIFIER NOT NULL,
    location_id UNIQUEIDENTIFIER NOT NULL,
    cash_shift_id UNIQUEIDENTIFIER NOT NULL,
    type NVARCHAR(16) NOT NULL,
    amount DECIMAL(19,4) NOT NULL,
    reason NVARCHAR(240) NOT NULL,
    idempotency_key UNIQUEIDENTIFIER NOT NULL,
    created_by_user_id UNIQUEIDENTIFIER NOT NULL,
    created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_cash_movements PRIMARY KEY (id),
    CONSTRAINT fk_cash_movements_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_cash_movements_location FOREIGN KEY (location_id) REFERENCES locations(id),
    CONSTRAINT fk_cash_movements_shift FOREIGN KEY (cash_shift_id) REFERENCES cash_shifts(id),
    CONSTRAINT fk_cash_movements_created_by FOREIGN KEY (created_by_user_id) REFERENCES app_users(id),
    CONSTRAINT uq_cash_movements_idempotency UNIQUE (organization_id, idempotency_key),
    CONSTRAINT ck_cash_movements_type CHECK (type IN ('PAID_IN', 'PAID_OUT')),
    CONSTRAINT ck_cash_movements_amount CHECK (amount > 0)
);

CREATE INDEX ix_cash_movements_shift_created
    ON cash_movements(organization_id, cash_shift_id, created_at);

ALTER TABLE order_payments ADD cash_shift_id UNIQUEIDENTIFIER NULL;
ALTER TABLE order_payments
    ADD CONSTRAINT fk_order_payments_cash_shift
    FOREIGN KEY (cash_shift_id) REFERENCES cash_shifts(id);
CREATE INDEX ix_order_payments_cash_shift
    ON order_payments(organization_id, cash_shift_id, status, method);
