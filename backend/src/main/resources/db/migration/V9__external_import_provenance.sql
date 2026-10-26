CREATE TABLE external_import_batches (
    id UNIQUEIDENTIFIER NOT NULL,
    organization_id UNIQUEIDENTIFIER NOT NULL,
    source_system NVARCHAR(40) NOT NULL,
    source_fingerprint CHAR(64) NOT NULL,
    source_created_at DATETIME2(3) NULL,
    source_schema_version NVARCHAR(40) NULL,
    summary_json NVARCHAR(MAX) NOT NULL,
    imported_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_external_import_batches PRIMARY KEY (id),
    CONSTRAINT fk_external_import_batches_organization
        FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT uq_external_import_batches_fingerprint
        UNIQUE (source_system, source_fingerprint),
    CONSTRAINT ck_external_import_batches_summary_json
        CHECK (ISJSON(summary_json) = 1)
);

CREATE TABLE external_entity_mappings (
    import_id UNIQUEIDENTIFIER NOT NULL,
    entity_type NVARCHAR(60) NOT NULL,
    source_id NVARCHAR(160) NOT NULL,
    target_id UNIQUEIDENTIFIER NOT NULL,
    source_reference NVARCHAR(240) NULL,
    CONSTRAINT pk_external_entity_mappings
        PRIMARY KEY (import_id, entity_type, source_id),
    CONSTRAINT fk_external_entity_mappings_import
        FOREIGN KEY (import_id) REFERENCES external_import_batches(id)
);

CREATE INDEX ix_external_entity_mappings_target
    ON external_entity_mappings(entity_type, target_id);

ALTER TABLE restaurant_orders ADD order_type NVARCHAR(24) NOT NULL
    CONSTRAINT df_restaurant_orders_order_type DEFAULT 'DINE_IN';
ALTER TABLE restaurant_orders ADD external_reference NVARCHAR(120) NULL;
ALTER TABLE restaurant_orders ADD source_total DECIMAL(19,4) NULL;

GO

ALTER TABLE restaurant_orders ADD CONSTRAINT ck_restaurant_orders_order_type
    CHECK (order_type IN ('DINE_IN', 'TAKEAWAY'));

GO

CREATE UNIQUE INDEX uq_restaurant_orders_external_reference
    ON restaurant_orders(organization_id, external_reference)
    WHERE external_reference IS NOT NULL;
