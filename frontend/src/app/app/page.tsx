"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CurrentUser, currentUser, logout } from "@/lib/api";

const modules = [
  ["Mesas y pedidos", "Abre mesas, registra comandas y controla el estado del servicio."],
  ["Cocina", "Recibe partidas en tiempo real y coordina su preparación."],
  ["Caja", "Registra pagos en efectivo o tarjeta y cierra las mesas."],
];

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    currentUser()
      .then((result) => {
        if (!result) {
          router.replace("/");
          return;
        }
        setUser(result);
      })
      .catch(() => setError("No se pudo cargar la sesión."));
  }, [router]);

  async function endSession() {
    await logout();
    router.replace("/");
  }

  if (error) {
    return <main className="dashboard"><p className="error">{error}</p></main>;
  }
  if (!user) {
    return <main className="dashboard"><p>Cargando sesión…</p></main>;
  }

  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">{user.organizationName}</p>
          <h1>Hola, {user.displayName}</h1>
        </div>
        <button className="secondary-button" onClick={endSession}>Cerrar sesión</button>
      </header>

      <section className="dashboard-grid" aria-label="Módulos">
        {modules.map(([title, description]) => (
          <article className="module-card" key={title}>
            <h2>{title}</h2>
            <p>{description}</p>
            <span className="status">Próxima fase</span>
          </article>
        ))}
      </section>
    </main>
  );
}
