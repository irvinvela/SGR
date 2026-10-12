"use client";

import Link from "next/link";
import { AppShell } from "@/components/AppShell";

const modules: Array<{
  href: string;
  title: string;
  description: string;
  roles?: string[];
}> = [
  { href: "/app/tables", title: "Mesas y salones", description: "Configura el plano operativo y controla el estado de cada mesa." },
  { href: "/app/catalog", title: "Catálogo", description: "Administra categorías, productos, precios e impuestos." },
  { href: "/app/orders", title: "Pedidos", description: "Abre mesas, añade productos y envía rondas nuevas a cocina." },
  { href: "/app/kitchen", title: "Cocina", description: "Gestiona las rondas pendientes, en preparación y listas.", roles: ["OWNER", "MANAGER", "KITCHEN", "SERVER"] },
  { href: "/app/checkout", title: "Caja", description: "Registra pagos parciales o completos y cierra las mesas.", roles: ["OWNER", "MANAGER", "CASHIER", "SERVER"] },
  { href: "/app/cash", title: "Turnos de caja", description: "Controla fondos, movimientos, arqueos y diferencias.", roles: ["OWNER", "MANAGER", "CASHIER"] },
  { href: "/app/sales", title: "Ventas", description: "Consulta operaciones diarias y comprobantes de pago.", roles: ["OWNER", "MANAGER", "CASHIER"] },
];

export default function DashboardPage() {
  return (
    <AppShell title="Centro de operaciones">
      {(user) => (
        <>
          <p className="page-intro">Hola, {user.displayName}. Selecciona un área para continuar.</p>
          <section className="dashboard-grid" aria-label="Módulos">
            {modules.filter((module) => !module.roles || module.roles.includes(user.role)).map((module) => (
              <Link className="module-card" href={module.href} key={module.title}>
                <h2>{module.title}</h2>
                <p>{module.description}</p>
                <span className="status">Disponible</span>
              </Link>
            ))}
          </section>
        </>
      )}
    </AppShell>
  );
}
