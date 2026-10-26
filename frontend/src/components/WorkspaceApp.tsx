"use client";

import { useEffect, useState } from "react";
import { CurrentUser } from "@/lib/api";
import { AppShell, NavIcon, NavIconName, NavigationContext } from "@/components/AppShell";
import TablesView from "@/components/views/TablesView";
import CatalogView from "@/components/views/CatalogView";
import OrdersView from "@/components/views/OrdersView";
import KitchenView from "@/components/views/KitchenView";
import CheckoutView from "@/components/views/CheckoutView";
import CashView from "@/components/views/CashView";
import SalesView from "@/components/views/SalesView";
import StaffView from "@/components/views/StaffView";
import ReportsView from "@/components/views/ReportsView";
import AccountView from "@/components/views/AccountView";

const sectionTitles: Record<NavIconName, string> = {
  home: "Centro de operaciones",
  tables: "Salones y mesas",
  catalog: "Catálogo",
  orders: "Pedidos",
  kitchen: "Cocina",
  checkout: "Caja",
  cash: "Turnos de caja",
  sales: "Ventas",
  staff: "Personal",
  reports: "Reportes",
  account: "Mi cuenta",
};

const modules: Array<{
  title: string;
  description: string;
  icon: NavIconName;
  roles?: string[];
}> = [
  { title: "Mesas y salones", icon: "tables", description: "Configura el plano operativo y controla el estado de cada mesa." },
  { title: "Catálogo", icon: "catalog", description: "Administra categorías, productos, precios e impuestos." },
  { title: "Pedidos", icon: "orders", description: "Abre mesas, añade productos y envía rondas nuevas a cocina." },
  { title: "Cocina", icon: "kitchen", description: "Gestiona las rondas pendientes, en preparación y listas.", roles: ["OWNER", "MANAGER", "KITCHEN", "SERVER"] },
  { title: "Caja", icon: "checkout", description: "Registra pagos parciales o completos y cierra las mesas.", roles: ["OWNER", "MANAGER", "CASHIER", "SERVER"] },
  { title: "Turnos de caja", icon: "cash", description: "Controla fondos, movimientos, arqueos y diferencias.", roles: ["OWNER", "MANAGER", "CASHIER"] },
  { title: "Ventas", icon: "sales", description: "Consulta operaciones diarias y comprobantes de pago.", roles: ["OWNER", "MANAGER", "CASHIER"] },
  { title: "Personal", icon: "staff", description: "Administra usuarios, roles, accesos y contraseñas.", roles: ["OWNER", "MANAGER"] },
  { title: "Reportes", icon: "reports", description: "Analiza ventas, catálogo y métodos de cobro con gráficos.", roles: ["OWNER", "MANAGER"] },
];

export function WorkspaceApp({ user }: { user: CurrentUser }) {
  const [activeSection, setActiveSection] = useState<NavIconName>("home");
  const [selectedOrderId, setSelectedOrderId] = useState<string | undefined>(undefined);
  const [selectedTableId, setSelectedTableId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedSection = window.sessionStorage.getItem("sgr.activeSection") as NavIconName | null;
    const savedOrder = window.sessionStorage.getItem("sgr.selectedOrderId") ?? undefined;
    const savedTable = window.sessionStorage.getItem("sgr.selectedTableId") ?? undefined;
    if (savedSection && savedSection in sectionTitles) {
      setActiveSection(savedSection);
    }
    if (savedOrder) {
      setSelectedOrderId(savedOrder);
    }
    if (savedTable) {
      setSelectedTableId(savedTable);
    }
    if (window.location.pathname !== "/" || window.location.search) {
      window.history.replaceState(null, "", "/");
    }
  }, []);

  function navigate(section: NavIconName, options?: { orderId?: string; tableId?: string }) {
    setActiveSection(section);
    setSelectedOrderId(options?.orderId);
    setSelectedTableId(options?.tableId);
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("sgr.activeSection", section);
      if (options?.orderId) {
        window.sessionStorage.setItem("sgr.selectedOrderId", options.orderId);
      } else {
        window.sessionStorage.removeItem("sgr.selectedOrderId");
      }
      if (options?.tableId) {
        window.sessionStorage.setItem("sgr.selectedTableId", options.tableId);
      } else {
        window.sessionStorage.removeItem("sgr.selectedTableId");
      }
      if (window.location.pathname !== "/" || window.location.search) {
        window.history.replaceState(null, "", "/");
      }
    }
  }

  return (
    <AppShell
      user={user}
      title={sectionTitles[activeSection]}
      activeSection={activeSection}
      onNavigate={navigate}
    >
      <NavigationContext.Provider value={{ user, activeSection, selectedOrderId, selectedTableId, navigate }}>
        {activeSection === "home" && (
          <>
            <p className="page-intro">Hola, {user.displayName}. Selecciona un área para continuar.</p>
            <section className="dashboard-grid" aria-label="Módulos">
              {modules.filter((module) => !module.roles || module.roles.includes(user.role)).map((module) => (
                <button
                  type="button"
                  className="module-card"
                  key={module.title}
                  onClick={() => navigate(module.icon)}
                >
                  <div className="module-card-title">
                    <span className="module-card-icon">
                      <NavIcon name={module.icon} />
                    </span>
                    <h2>{module.title}</h2>
                  </div>
                  <p>{module.description}</p>
                  <span className="status">Disponible</span>
                </button>
              ))}
            </section>
          </>
        )}
        {activeSection === "tables" && <TablesView />}
        {activeSection === "catalog" && <CatalogView />}
        {activeSection === "orders" && <OrdersView />}
        {activeSection === "kitchen" && <KitchenView />}
        {activeSection === "checkout" && <CheckoutView />}
        {activeSection === "cash" && <CashView />}
        {activeSection === "sales" && <SalesView />}
        {activeSection === "staff" && <StaffView />}
        {activeSection === "reports" && <ReportsView />}
        {activeSection === "account" && <AccountView />}
      </NavigationContext.Provider>
    </AppShell>
  );
}
