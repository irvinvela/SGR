CREATE TABLE organizations (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID(),
    name NVARCHAR(160) NOT NULL,
    slug NVARCHAR(80) NOT NULL,
    timezone NVARCHAR(64) NOT NULL DEFAULT 'Europe/Madrid',
    currency CHAR(3) NOT NULL DEFAULT 'EUR',
    active BIT NOT NULL DEFAULT 1,
    created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_organizations PRIMARY KEY (id),
    CONSTRAINT uq_organizations_slug UNIQUE (slug)
);

CREATE TABLE locations (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID(),
    organization_id UNIQUEIDENTIFIER NOT NULL,
    name NVARCHAR(160) NOT NULL,
    code NVARCHAR(40) NOT NULL,
    timezone NVARCHAR(64) NOT NULL DEFAULT 'Europe/Madrid',
    active BIT NOT NULL DEFAULT 1,
    created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_locations PRIMARY KEY (id),
    CONSTRAINT fk_locations_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT uq_locations_organization_code UNIQUE (organization_id, code)
);

CREATE TABLE app_users (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID(),
    email NVARCHAR(254) NOT NULL,
    normalized_email NVARCHAR(254) NOT NULL,
    password_hash NVARCHAR(100) NOT NULL,
    display_name NVARCHAR(160) NOT NULL,
    active BIT NOT NULL DEFAULT 1,
    failed_login_attempts INT NOT NULL DEFAULT 0,
    locked_until DATETIME2(3) NULL,
    last_login_at DATETIME2(3) NULL,
    created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_app_users PRIMARY KEY (id),
    CONSTRAINT uq_app_users_normalized_email UNIQUE (normalized_email)
);

CREATE TABLE user_organizations (
    user_id UNIQUEIDENTIFIER NOT NULL,
    organization_id UNIQUEIDENTIFIER NOT NULL,
    role NVARCHAR(32) NOT NULL,
    active BIT NOT NULL DEFAULT 1,
    created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_user_organizations PRIMARY KEY (user_id, organization_id),
    CONSTRAINT fk_user_organizations_user FOREIGN KEY (user_id) REFERENCES app_users(id),
    CONSTRAINT fk_user_organizations_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT ck_user_organizations_role CHECK (role IN ('PLATFORM_ADMIN', 'OWNER', 'MANAGER', 'CASHIER', 'SERVER', 'KITCHEN'))
);

CREATE TABLE audit_events (
    id BIGINT IDENTITY(1,1) NOT NULL,
    organization_id UNIQUEIDENTIFIER NULL,
    actor_user_id UNIQUEIDENTIFIER NULL,
    event_type NVARCHAR(100) NOT NULL,
    entity_type NVARCHAR(100) NULL,
    entity_id NVARCHAR(100) NULL,
    ip_address NVARCHAR(64) NULL,
    user_agent NVARCHAR(512) NULL,
    details_json NVARCHAR(MAX) NULL,
    occurred_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_audit_events PRIMARY KEY (id),
    CONSTRAINT fk_audit_events_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    CONSTRAINT fk_audit_events_user FOREIGN KEY (actor_user_id) REFERENCES app_users(id),
    CONSTRAINT ck_audit_events_details_json CHECK (details_json IS NULL OR ISJSON(details_json) = 1)
);

CREATE INDEX ix_locations_organization ON locations(organization_id);
CREATE INDEX ix_user_organizations_organization ON user_organizations(organization_id);
CREATE INDEX ix_audit_events_organization_time ON audit_events(organization_id, occurred_at DESC);
