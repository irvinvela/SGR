"use client";

import Link from "next/link";
import { AppShell } from "@/components/AppShell";

const modules = [
  ["/app/tables", "Mesas y salones", "Configura el plano operativo y controla el estado de cada mesa.", "Disponible"],
  ["/app/catalog", "Catálogo", "Administra categorías, productos, precios e impuestos.", "Disponible"],
  ["#", "Pedidos y cocina", "Crea comandas y envíalas a preparación en tiempo real.", "Próxima fase"],
];

export default function DashboardPage() {
  return (
    <AppShell title="Centro de operaciones">
      {(user) => (
        <>
          <p className="page-intro">Hola, {user.displayName}. Selecciona un área para continuar.</p>
          <section className="dashboard-grid" aria-label="Módulos">
            {modules.map(([href, title, description, status]) => (
              <Link className="module-card" href={href} key={title}>
                <h2>{title}</h2>
                <p>{description}</p>
                <span className="status">{status}</span>
              </Link>
            ))}
          </section>
        </>
      )}
    </AppShell>
  );
}
