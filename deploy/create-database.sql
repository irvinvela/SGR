:setvar SGR_APP_PASSWORD "CHANGE_ME_APP"
:setvar SGR_MIGRATOR_PASSWORD "CHANGE_ME_MIGRATOR"

IF DB_ID(N'SGR') IS NULL
BEGIN
    CREATE DATABASE SGR;
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'sgr_app')
BEGIN
    DECLARE @createLogin NVARCHAR(MAX) =
        N'CREATE LOGIN sgr_app WITH PASSWORD = ' + QUOTENAME('$(SGR_APP_PASSWORD)', '''')
        + N', CHECK_POLICY = ON, CHECK_EXPIRATION = ON;';
    EXEC sp_executesql @createLogin;
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'sgr_migrator')
BEGIN
    DECLARE @createMigratorLogin NVARCHAR(MAX) =
        N'CREATE LOGIN sgr_migrator WITH PASSWORD = ' + QUOTENAME('$(SGR_MIGRATOR_PASSWORD)', '''')
        + N', CHECK_POLICY = ON, CHECK_EXPIRATION = ON;';
    EXEC sp_executesql @createMigratorLogin;
END;
GO

USE SGR;
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'sgr_app')
BEGIN
    CREATE USER sgr_app FOR LOGIN sgr_app;
END;
GO

ALTER ROLE db_datareader ADD MEMBER sgr_app;
ALTER ROLE db_datawriter ADD MEMBER sgr_app;
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'sgr_migrator')
BEGIN
    CREATE USER sgr_migrator FOR LOGIN sgr_migrator;
END;
GO

ALTER ROLE db_datareader ADD MEMBER sgr_migrator;
ALTER ROLE db_datawriter ADD MEMBER sgr_migrator;
ALTER ROLE db_ddladmin ADD MEMBER sgr_migrator;
GO
