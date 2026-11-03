CREATE TABLE addon_groups (
    id UNIQUEIDENTIFIER NOT NULL,
    organization_id UNIQUEIDENTIFIER NOT NULL,
    location_id UNIQUEIDENTIFIER NOT NULL,
    name NVARCHAR(100) NOT NULL,
    required BIT NOT NULL DEFAULT 0,
    min_select INT NOT NULL DEFAULT 0,
    max_select INT NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0,
    active BIT NOT NULL DEFAULT 1,
    version BIGINT NOT NULL DEFAULT 0,
    created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_addon_groups PRIMARY KEY (id),
    CONSTRAINT fk_addon_groups_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_addon_groups_location FOREIGN KEY (location_id) REFERENCES locations(id),
    CONSTRAINT uq_addon_groups_location_name UNIQUE (location_id, name),
    CONSTRAINT ck_addon_groups_select CHECK (
        min_select >= 0
        AND max_select >= min_select
        AND max_select BETWEEN 1 AND 99
    )
);

CREATE TABLE addon_options (
    id UNIQUEIDENTIFIER NOT NULL,
    organization_id UNIQUEIDENTIFIER NOT NULL,
    group_id UNIQUEIDENTIFIER NOT NULL,
    name NVARCHAR(160) NOT NULL,
    price DECIMAL(19,4) NOT NULL DEFAULT 0,
    available BIT NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0,
    active BIT NOT NULL DEFAULT 1,
    CONSTRAINT pk_addon_options PRIMARY KEY (id),
    CONSTRAINT fk_addon_options_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_addon_options_group FOREIGN KEY (group_id) REFERENCES addon_groups(id),
    CONSTRAINT uq_addon_options_group_name UNIQUE (group_id, name),
    CONSTRAINT ck_addon_options_price CHECK (price >= 0)
);

CREATE TABLE product_addon_groups (
    product_id UNIQUEIDENTIFIER NOT NULL,
    group_id UNIQUEIDENTIFIER NOT NULL,
    CONSTRAINT pk_product_addon_groups PRIMARY KEY (product_id, group_id),
    CONSTRAINT fk_product_addon_groups_product FOREIGN KEY (product_id) REFERENCES products(id),
    CONSTRAINT fk_product_addon_groups_group FOREIGN KEY (group_id) REFERENCES addon_groups(id)
);

CREATE INDEX ix_addon_groups_location
    ON addon_groups(organization_id, location_id, active, sort_order);
CREATE INDEX ix_addon_options_group
    ON addon_options(group_id, active, sort_order);
