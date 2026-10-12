CREATE TABLE dining_areas (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID(),
    organization_id UNIQUEIDENTIFIER NOT NULL,
    location_id UNIQUEIDENTIFIER NOT NULL,
    name NVARCHAR(100) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    active BIT NOT NULL DEFAULT 1,
    created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_dining_areas PRIMARY KEY (id),
    CONSTRAINT fk_dining_areas_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_dining_areas_location FOREIGN KEY (location_id) REFERENCES locations(id),
    CONSTRAINT uq_dining_areas_location_name UNIQUE (location_id, name),
    CONSTRAINT ck_dining_areas_sort_order CHECK (sort_order >= 0)
);

CREATE TABLE dining_tables (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID(),
    organization_id UNIQUEIDENTIFIER NOT NULL,
    location_id UNIQUEIDENTIFIER NOT NULL,
    area_id UNIQUEIDENTIFIER NOT NULL,
    code NVARCHAR(40) NOT NULL,
    name NVARCHAR(100) NOT NULL,
    capacity INT NOT NULL DEFAULT 2,
    status NVARCHAR(24) NOT NULL DEFAULT 'FREE',
    active BIT NOT NULL DEFAULT 1,
    version BIGINT NOT NULL DEFAULT 0,
    created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_dining_tables PRIMARY KEY (id),
    CONSTRAINT fk_dining_tables_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_dining_tables_location FOREIGN KEY (location_id) REFERENCES locations(id),
    CONSTRAINT fk_dining_tables_area FOREIGN KEY (area_id) REFERENCES dining_areas(id),
    CONSTRAINT uq_dining_tables_location_code UNIQUE (location_id, code),
    CONSTRAINT ck_dining_tables_capacity CHECK (capacity BETWEEN 1 AND 100),
    CONSTRAINT ck_dining_tables_status CHECK (
        status IN ('FREE', 'OCCUPIED', 'WAITING_PAYMENT', 'OUT_OF_SERVICE')
    )
);

CREATE TABLE menu_categories (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID(),
    organization_id UNIQUEIDENTIFIER NOT NULL,
    location_id UNIQUEIDENTIFIER NOT NULL,
    name NVARCHAR(100) NOT NULL,
    code NVARCHAR(40) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    active BIT NOT NULL DEFAULT 1,
    created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_menu_categories PRIMARY KEY (id),
    CONSTRAINT fk_menu_categories_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_menu_categories_location FOREIGN KEY (location_id) REFERENCES locations(id),
    CONSTRAINT uq_menu_categories_location_code UNIQUE (location_id, code),
    CONSTRAINT uq_menu_categories_location_name UNIQUE (location_id, name),
    CONSTRAINT ck_menu_categories_sort_order CHECK (sort_order >= 0)
);

CREATE TABLE products (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID(),
    organization_id UNIQUEIDENTIFIER NOT NULL,
    location_id UNIQUEIDENTIFIER NOT NULL,
    category_id UNIQUEIDENTIFIER NOT NULL,
    name NVARCHAR(160) NOT NULL,
    sku NVARCHAR(64) NOT NULL,
    description NVARCHAR(500) NULL,
    price DECIMAL(19,4) NOT NULL,
    tax_rate DECIMAL(7,4) NOT NULL DEFAULT 0,
    available BIT NOT NULL DEFAULT 1,
    active BIT NOT NULL DEFAULT 1,
    version BIGINT NOT NULL DEFAULT 0,
    created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_products PRIMARY KEY (id),
    CONSTRAINT fk_products_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_products_location FOREIGN KEY (location_id) REFERENCES locations(id),
    CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES menu_categories(id),
    CONSTRAINT uq_products_location_sku UNIQUE (location_id, sku),
    CONSTRAINT ck_products_price CHECK (price >= 0),
    CONSTRAINT ck_products_tax_rate CHECK (tax_rate BETWEEN 0 AND 100)
);

CREATE INDEX ix_dining_areas_organization_location
    ON dining_areas(organization_id, location_id, active, sort_order);
CREATE INDEX ix_dining_tables_organization_location_status
    ON dining_tables(organization_id, location_id, status, active);
CREATE INDEX ix_menu_categories_organization_location
    ON menu_categories(organization_id, location_id, active, sort_order);
CREATE INDEX ix_products_organization_location_category
    ON products(organization_id, location_id, category_id, active, available);
