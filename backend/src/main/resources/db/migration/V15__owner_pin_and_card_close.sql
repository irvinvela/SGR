ALTER TABLE organizations ADD owner_pin_hash NVARCHAR(100) NULL;
GO
ALTER TABLE organizations ADD owner_pin_failed_attempts INT NOT NULL CONSTRAINT df_organizations_owner_pin_failed DEFAULT 0;
GO
ALTER TABLE organizations ADD owner_pin_locked_until DATETIME2(3) NULL;
GO
ALTER TABLE cash_shifts ADD closing_counted_card DECIMAL(19,4) NULL;
GO
ALTER TABLE cash_shifts ADD expected_card DECIMAL(19,4) NULL;
GO
ALTER TABLE cash_shifts ADD card_difference DECIMAL(19,4) NULL;
GO
