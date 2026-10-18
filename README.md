# SGR Online

Plataforma web de gestión de restaurantes de Semaia Labs publicada en `https://semaialabs.com`.

## Funcionalidades actuales

- Login y operación completa en la ruta única `/` (navegación SPA sin variación de URL).
- Sesión mediante JWT en cookie `HttpOnly`, `Secure` y `SameSite=Strict`.
- Cierre automático de sesión por inactividad tras 15 minutos (con aviso previo a los 14 minutos).
- Protección CSRF para operaciones autenticadas.
- Modelo multi-restaurante: organizaciones, locales, usuarios y roles (`OWNER`, `MANAGER`, `CASHIER`, `SERVER`, `KITCHEN`).
- Auditoría de eventos operativos y de seguridad.
- Gestión de salones y mesas con estados operativos y control de concurrencia.
- Catálogo por local con categorías, productos, precio, IVA y disponibilidad.
- Pedidos abiertos por mesa con precios e impuestos preservados como snapshots.
- Edición de partidas pendientes y anulaciones auditadas visibles en cocina.
- Rondas de cocina idempotentes: cada envío incluye únicamente ítems nuevos.
- KDS con estados nueva, en preparación, lista y completada.
- Solicitud de cuenta y cobros parciales o completos en efectivo y tarjeta.
- Pagos idempotentes, cambio calculado en el backend y cierre atómico de mesa.
- Turnos de caja por local con fondo inicial, entradas, salidas y arqueo.
- Conciliación de efectivo, ventas con tarjeta y registro auditable de diferencias.
- Historial diario por zona horaria del local y comprobantes operativos imprimibles.
- Desglose informativo de IVA incluido calculado por el backend.
- Anulaciones de pedidos y reembolsos parciales o completos con autorización,
  idempotencia, turno de caja y auditoría.
- Administración de personal, roles, estado de acceso y contraseñas (ocultando cuentas `OWNER` a roles no administradores).
- Invalidación inmediata de sesiones al cambiar permisos, desactivar cuentas o
  restablecer credenciales.
- Migraciones SQL Server administradas con Flyway.
- Proxy HTTPS con Nginx.

Los precios del catálogo se interpretan como precios finales con IVA incluido.
Los comprobantes actuales son documentos operativos no fiscales y no sustituyen
una factura ni acreditan cumplimiento tributario.

Los reembolsos con tarjeta registran la corrección dentro de SGR, pero no
ejecutan por sí mismos una devolución en el terminal o proveedor de pagos.

## Estructura

```text
online/
├── backend/                 Spring Boot 3 / Java 21
├── frontend/                Next.js 16 / React 19
├── deploy/
│   ├── nginx-semaialabs.conf configuración para Nginx
│   └── create-database.sql  base SGR y usuarios con privilegios separados
├── compose.production.yml
└── .env.production.example
```

## Desarrollo

Requisitos: Java 21, Maven 3.9, Node.js 22 o superior y acceso a SQL Server.

1. Cree la base `SGR` con `deploy/create-database.sql`.
2. Configure las variables descritas en `.env.production.example`.
3. Inicie la API:

```powershell
cd online/backend
mvn spring-boot:run
```

4. En otra terminal, inicie la web:

```powershell
cd online/frontend
npm ci
npm run dev
```

En desarrollo, Next.js reenvía `/api/*` a `http://localhost:8080`.

## Despliegue en VPS

SGR utiliza:

- una base independiente llamada `SGR`;
- logins SQL con privilegios separados (operación y migración);
- cadenas de conexión y credenciales protegidas mediante `ENC(...)` (AES-256-GCM) y transporte de credenciales ofuscado (`OBF1:`);
- contenedores y red propios;
- credenciales y backups independientes.

```sh
cd /opt/sgr/app
docker compose -p sgr -f compose.production.yml up -d --build
```

Los contenedores publican la web en `127.0.0.1:3300` y la API en
`127.0.0.1:38080` detrás del proxy Nginx del VPS.
