"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { CurrentUser, currentUser, logout } from "@/lib/api";

type AppShellProps = {
  title: string;
  children: (user: CurrentUser) => ReactNode;
};

const navigation: Array<{ href: string; label: string; roles?: string[] }> = [
  { href: "/app", label: "Inicio" },
  { href: "/app/tables", label: "Mesas" },
  { href: "/app/catalog", label: "Catálogo" },
  { href: "/app/orders", label: "Pedidos" },
  { href: "/app/kitchen", label: "Cocina", roles: ["OWNER", "MANAGER", "KITCHEN", "SERVER"] },
  { href: "/app/checkout", label: "Caja", roles: ["OWNER", "MANAGER", "CASHIER", "SERVER"] },
  { href: "/app/cash", label: "Turnos", roles: ["OWNER", "MANAGER", "CASHIER"] },
  { href: "/app/sales", label: "Ventas", roles: ["OWNER", "MANAGER", "CASHIER"] },
  { href: "/app/staff", label: "Personal", roles: ["OWNER", "MANAGER"] },
  { href: "/app/account", label: "Mi cuenta" },
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
          {navigation.filter((item) => !item.roles || item.roles.includes(user.role)).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={pathname === item.href ? "active" : undefined}
            >
              {item.label}
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
