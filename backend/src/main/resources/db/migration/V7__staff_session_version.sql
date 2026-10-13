ALTER TABLE app_users
    ADD token_version BIGINT NOT NULL
        CONSTRAINT df_app_users_token_version DEFAULT 0;

CREATE INDEX ix_user_organizations_organization_active_role
    ON user_organizations(organization_id, active, role, user_id);
