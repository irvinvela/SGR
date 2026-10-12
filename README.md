# SGR Online

Nueva plataforma web de gestión de restaurantes de Semaia Labs. Esta aplicación
es independiente del runtime Electron/SQLite de FloCafe y se publica
directamente en `https://semaialabs.com`.

## Primera entrega

- Login en la ruta `/`.
- Sesión mediante JWT en cookie `HttpOnly`, `Secure` y `SameSite=Strict`.
- Protección CSRF para operaciones autenticadas.
- Modelo inicial multi-restaurante: organizaciones, locales, usuarios y roles.
- Auditoría del inicio de sesión.
- Gestión de salones y mesas con estados operativos y control de concurrencia.
- Catálogo por local con categorías, productos, precio, IVA y disponibilidad.
- Pedidos abiertos por mesa con precios e impuestos preservados como snapshots.
- Rondas de cocina idempotentes: cada envío incluye únicamente ítems nuevos.
- KDS con estados nueva, en preparación, lista y completada.
- Solicitud de cuenta y cobros parciales o completos en efectivo y tarjeta.
- Pagos idempotentes, cambio calculado en el backend y cierre atómico de mesa.
- Turnos de caja por local con fondo inicial, entradas, salidas y arqueo.
- Conciliación de efectivo, ventas con tarjeta y registro auditable de diferencias.
- Migraciones SQL Server administradas con Flyway.
- Panel inicial en `/app`.
- Proxy HTTPS con Caddy.

El módulo de impresión todavía no contiene lógica operativa.

## Estructura

```text
online/
├── backend/                 Spring Boot 3 / Java 21
├── frontend/                Next.js 16 / React 19
├── deploy/
│   ├── Caddyfile            configuración opcional para Caddy existente
│   ├── nginx-semaialabs.conf configuración opcional para Nginx existente
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

## Primer propietario

Las variables `SGR_BOOTSTRAP_*` crean de forma idempotente el primer
restaurante, local y propietario. Deben retirarse del entorno del VPS después
del primer arranque correcto. No se deben guardar contraseñas reales en Git.

Genere el secreto JWT con al menos 32 bytes aleatorios codificados en Base64:

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
```

## Despliegue junto a SGI

SGR puede compartir VPS e instancia SQL Server con SGI, pero utiliza:

- una base independiente llamada `SGR`;
- logins SQL independientes (`sgr_app` y `sgr_migrator`);
- contenedores y red propios;
- credenciales y backups independientes.

La base de datos no debe publicar el puerto 1433 en Internet. Antes de ejecutar
`docker compose`, copie `.env.production.example` como `.env.production` fuera
del control de versiones y configure las credenciales reales.

```sh
cd online
docker compose -f compose.production.yml up -d --build
```

Los contenedores solo publican la web en `127.0.0.1:3300` y la API en
`127.0.0.1:38080`; no ocupan directamente los puertos públicos del VPS. Integre
uno de los archivos de `deploy/` en el proxy que ya utiliza SGI. No levante un
segundo proxy en los puertos 80/443.

El DNS de `semaialabs.com` y `www.semaialabs.com` debe apuntar al VPS y el proxy
existente debe mantener un certificado TLS válido.

## Próximas fases

1. Productos con grupos de modificadores.
2. Actualización KDS mediante WebSocket.
3. Pagos y cierre de mesa.
4. Agente local Windows para impresora USB y cola offline.
