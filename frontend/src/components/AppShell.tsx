"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { CurrentUser, currentUser, logout } from "@/lib/api";

type AppShellProps = {
  title: string;
  children: (user: CurrentUser) => ReactNode;
};

const navigation = [
  ["/app", "Inicio"],
  ["/app/tables", "Mesas"],
  ["/app/catalog", "Catálogo"],
  ["/app/orders", "Pedidos"],
  ["/app/kitchen", "Cocina"],
  ["/app/checkout", "Caja"],
  ["/app/cash", "Turnos"],
];

export function AppShell({ title, children }: AppShellProps) {
  const pathname = usePathname();
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

  if (error) return <main className="dashboard"><p className="error">{error}</p></main>;
  if (!user) return <main className="dashboard"><p>Cargando sesión…</p></main>;

  return (
    <div className="app-frame">
      <aside className="app-sidebar">
        <div>
          <div className="brand">Semai Labs</div>
          <p className="sidebar-organization">{user.organizationName}</p>
        </div>
        <nav className="app-nav" aria-label="Navegación principal">
          {navigation.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className={pathname === href ? "active" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
        <button className="sidebar-session" onClick={endSession}>Cerrar sesión</button>
      </aside>
      <main className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">{user.role}</p>
            <h1>{title}</h1>
          </div>
          <span className="user-chip">{user.displayName}</span>
        </header>
        {children(user)}
      </main>
    </div>
  );
}
