IF EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = 'ck_dining_tables_status' AND parent_object_id = OBJECT_ID('dining_tables')
)
    ALTER TABLE dining_tables DROP CONSTRAINT ck_dining_tables_status;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = 'ck_dining_tables_status' AND parent_object_id = OBJECT_ID('dining_tables')
)
    ALTER TABLE dining_tables ADD CONSTRAINT ck_dining_tables_status CHECK (
        status IN ('FREE', 'OCCUPIED', 'WAITING_PAYMENT', 'OUT_OF_SERVICE', 'RESERVED')
    );
GO

IF COL_LENGTH('dining_tables', 'pos_x') IS NULL
    ALTER TABLE dining_tables ADD pos_x DECIMAL(6, 2) NOT NULL CONSTRAINT df_dining_tables_pos_x DEFAULT 12;
GO

IF COL_LENGTH('dining_tables', 'pos_y') IS NULL
    ALTER TABLE dining_tables ADD pos_y DECIMAL(6, 2) NOT NULL CONSTRAINT df_dining_tables_pos_y DEFAULT 14;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = 'ck_dining_tables_pos' AND parent_object_id = OBJECT_ID('dining_tables')
)
    ALTER TABLE dining_tables ADD CONSTRAINT ck_dining_tables_pos CHECK (
        pos_x BETWEEN 0 AND 100 AND pos_y BETWEEN 0 AND 100
    );
GO

WITH numbered AS (
    SELECT
        t.id,
        ROW_NUMBER() OVER (PARTITION BY t.area_id ORDER BY t.code, t.name) - 1 AS n
    FROM dining_tables t
)
UPDATE t
SET
    pos_x = 12 + (numbered.n % 4) * 24,
    pos_y = 14 + (numbered.n / 4) * 28
FROM dining_tables t
INNER JOIN numbered ON numbered.id = t.id;
GO
