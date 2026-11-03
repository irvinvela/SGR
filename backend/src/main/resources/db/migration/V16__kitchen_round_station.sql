ALTER TABLE kitchen_rounds ADD station NVARCHAR(16) NOT NULL
    CONSTRAINT df_kitchen_rounds_station DEFAULT 'KITCHEN';
GO
ALTER TABLE kitchen_rounds ADD CONSTRAINT ck_kitchen_rounds_station
    CHECK (station IN ('KITCHEN', 'BAR'));
