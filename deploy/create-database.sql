:setvar SGR_APP_LOGIN "CHANGE_ME_APP_LOGIN"
:setvar SGR_APP_SECRET "CHANGE_ME_APP_SECRET"
:setvar SGR_MIGRATOR_LOGIN "CHANGE_ME_MIGRATOR_LOGIN"
:setvar SGR_MIGRATOR_SECRET "CHANGE_ME_MIGRATOR_SECRET"

IF DB_ID(N'SGR') IS NULL
BEGIN
    CREATE DATABASE SGR;
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'$(SGR_APP_LOGIN)')
BEGIN
    DECLARE @createLogin NVARCHAR(MAX) =
        N'CREATE LOGIN ' + QUOTENAME('$(SGR_APP_LOGIN)')
        + N' WITH PASSWORD = ' + QUOTENAME('$(SGR_APP_SECRET)', '''')
        + N', CHECK_POLICY = ON, CHECK_EXPIRATION = ON;';
    EXEC sp_executesql @createLogin;
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'$(SGR_MIGRATOR_LOGIN)')
BEGIN
    DECLARE @createMigratorLogin NVARCHAR(MAX) =
        N'CREATE LOGIN ' + QUOTENAME('$(SGR_MIGRATOR_LOGIN)')
        + N' WITH PASSWORD = ' + QUOTENAME('$(SGR_MIGRATOR_SECRET)', '''')
        + N', CHECK_POLICY = ON, CHECK_EXPIRATION = ON;';
    EXEC sp_executesql @createMigratorLogin;
END;
GO

USE SGR;
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$(SGR_APP_LOGIN)')
BEGIN
    DECLARE @createAppUser NVARCHAR(MAX) =
        N'CREATE USER ' + QUOTENAME('$(SGR_APP_LOGIN)')
        + N' FOR LOGIN ' + QUOTENAME('$(SGR_APP_LOGIN)') + N';';
    EXEC sp_executesql @createAppUser;
END;
GO

EXEC sp_addrolemember N'db_datareader', N'$(SGR_APP_LOGIN)';
EXEC sp_addrolemember N'db_datawriter', N'$(SGR_APP_LOGIN)';
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$(SGR_MIGRATOR_LOGIN)')
BEGIN
    DECLARE @createMigratorUser NVARCHAR(MAX) =
        N'CREATE USER ' + QUOTENAME('$(SGR_MIGRATOR_LOGIN)')
        + N' FOR LOGIN ' + QUOTENAME('$(SGR_MIGRATOR_LOGIN)') + N';';
    EXEC sp_executesql @createMigratorUser;
END;
GO

EXEC sp_addrolemember N'db_datareader', N'$(SGR_MIGRATOR_LOGIN)';
EXEC sp_addrolemember N'db_datawriter', N'$(SGR_MIGRATOR_LOGIN)';
EXEC sp_addrolemember N'db_ddladmin', N'$(SGR_MIGRATOR_LOGIN)';
GO
