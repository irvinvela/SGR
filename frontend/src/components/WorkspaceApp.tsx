"use client";

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { CurrentUser, Location, listLocations } from "@/lib/api";
import { AppShell, NavIcon, NavIconName, NavigationContext, canAccessNav } from "@/components/AppShell";
import PosView from "@/components/views/PosView";
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
  pos: "Punto de Venta",
  tables: "Salones y Mesas",
  catalog: "Productos",
  orders: "Pedidos",
  kitchen: "Cocina y Barra",
  bar: "Cocina y Barra",
  checkout: "Caja",
  cash: "Turnos de caja",
  sales: "Ventas",
  staff: "Personal",
  reports: "Reportes",
  account: "Perfil",
};

const modules: Array<{
  title: string;
  description: string;
  icon: NavIconName;
  roles?: string[];
}> = [
  { title: "Punto de Venta", icon: "pos", description: "Abre mesas, añade carta y cobra en el mismo flujo de sala.", roles: ["OWNER", "MANAGER", "CASHIER", "SERVER"] },
  { title: "Salones y Mesas", icon: "tables", description: "Configura el plano operativo y controla el estado de cada mesa." },
  { title: "Productos", icon: "catalog", description: "Administra categorías, productos, precios e impuestos." },
  { title: "Pedidos", icon: "orders", description: "Abre mesas, añade productos y envía rondas nuevas a cocina." },
  { title: "Cocina y Barra", icon: "bar", description: "Gestiona las rondas de cocina y barra pendientes, en preparación y listas.", roles: ["OWNER", "MANAGER", "KITCHEN", "SERVER"] },
  { title: "Caja", icon: "checkout", description: "Registra pagos parciales o completos y cierra las mesas.", roles: ["OWNER", "MANAGER", "CASHIER", "SERVER"] },
  { title: "Turnos de caja", icon: "cash", description: "Controla fondos, movimientos, arqueos y diferencias.", roles: ["OWNER", "MANAGER", "CASHIER"] },
  { title: "Personal", icon: "staff", description: "Administra usuarios, roles, accesos y contraseñas.", roles: ["OWNER", "MANAGER"] },
  { title: "Ventas", icon: "sales", description: "Consulta operaciones diarias y comprobantes de pago.", roles: ["OWNER", "MANAGER", "CASHIER"] },
  { title: "Reportes", icon: "reports", description: "Analiza ventas, catálogo y métodos de cobro con gráficos.", roles: ["OWNER", "MANAGER"] },
];

function readSession(key: string) {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function KeptSection({
  show,
  eager,
  children,
}: {
  show: boolean;
  eager?: boolean;
  children: ReactNode;
}) {
  const [seen, setSeen] = useState(Boolean(eager || show));
  if (show && !seen) setSeen(true);
  if (!seen) return null;
  return (
    <div className="workspace-keep" hidden={!show} aria-hidden={!show}>
      {children}
    </div>
  );
}

export function WorkspaceApp({ user }: { user: CurrentUser }) {
  const [activeSection, setActiveSection] = useState<NavIconName>(() => {
    const saved = readSession("sgr.activeSection") as NavIconName;
    if (saved && saved in sectionTitles) {
      if (saved === "kitchen") {
        try { window.sessionStorage.setItem("sgr.stationTab", "KITCHEN"); } catch { /* ignore */ }
        return canAccessNav(user, "bar", ["OWNER", "MANAGER", "KITCHEN", "SERVER"]) ? "bar" : "home";
      }
      if (saved === "bar" && !canAccessNav(user, "bar", ["OWNER", "MANAGER", "KITCHEN", "SERVER"])) {
        return "home";
      }
      return saved;
    }
    return "home";
  });
  const [selectedOrderId, setSelectedOrderId] = useState<string | undefined>(() => readSession("sgr.selectedOrderId") || undefined);
  const [selectedTableId, setSelectedTableId] = useState<string | undefined>(() => readSession("sgr.selectedTableId") || undefined);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState(() => readSession("sgr.locationId"));
  const selectionRef = useRef({ orderId: selectedOrderId, tableId: selectedTableId });
  selectionRef.current = { orderId: selectedOrderId, tableId: selectedTableId };

  useEffect(() => {
    listLocations()
      .then((result) => {
        setLocations(result);
        const saved = typeof window !== "undefined"
          ? window.sessionStorage.getItem("sgr.locationId")
          : null;
        const next = result.find((location) => location.id === saved)?.id ?? result[0]?.id ?? "";
        setLocationId((current) => current === next ? current : next);
        if (next && typeof window !== "undefined") {
          window.sessionStorage.setItem("sgr.locationId", next);
        }
      })
      .catch(() => undefined);
  }, []);

  const persistSelection = useCallback((orderId?: string, tableId?: string) => {
    const order = orderId && !orderId.startsWith("local:") ? orderId : undefined;
    const table = tableId || undefined;
    const current = selectionRef.current;
    if (current.orderId === order && current.tableId === table) return;
    selectionRef.current = { orderId: order, tableId: table };
    setSelectedOrderId(order);
    setSelectedTableId(table);
    if (typeof window === "undefined") return;
    if (order) window.sessionStorage.setItem("sgr.selectedOrderId", order);
    else window.sessionStorage.removeItem("sgr.selectedOrderId");
    if (table) window.sessionStorage.setItem("sgr.selectedTableId", table);
    else window.sessionStorage.removeItem("sgr.selectedTableId");
  }, []);

  const rememberSelection = useCallback((options: { orderId?: string; tableId?: string }) => {
    persistSelection(options.orderId, options.tableId);
  }, [persistSelection]);

  function changeLocation(nextId: string) {
    setLocationId(nextId);
    persistSelection(undefined, undefined);
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("sgr.locationId", nextId);
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.pathname !== "/" || window.location.search) {
      window.history.replaceState(null, "", "/");
    }
  }, []);

  const navigate = useCallback((section: NavIconName, options?: { orderId?: string; tableId?: string }) => {
    if (section === "kitchen") {
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem("sgr.stationTab", "KITCHEN");
      }
      section = "bar";
    }
    if (section === "bar" && !canAccessNav(user, "bar", ["OWNER", "MANAGER", "KITCHEN", "SERVER"])) {
      setActiveSection("home");
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem("sgr.activeSection", "home");
      }
      return;
    }
    if (section === "bar" && typeof window !== "undefined" && !window.sessionStorage.getItem("sgr.stationTab")) {
      window.sessionStorage.setItem("sgr.stationTab", "BAR");
    }
    setActiveSection(section);
    if (options) {
      persistSelection(
        "orderId" in options ? options.orderId : selectionRef.current.orderId,
        "tableId" in options ? options.tableId : selectionRef.current.tableId,
      );
    }
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("sgr.activeSection", section);
      if (window.location.pathname !== "/" || window.location.search) {
        window.history.replaceState(null, "", "/");
      }
    }
  }, [persistSelection, user]);

  return (
    <AppShell
      user={user}
      title={sectionTitles[activeSection]}
      activeSection={activeSection}
      locations={locations}
      locationId={locationId}
      onLocationChange={changeLocation}
      onNavigate={navigate}
    >
      <NavigationContext.Provider value={{
        user,
        activeSection,
        selectedOrderId,
        selectedTableId,
        locations,
        locationId,
        setLocationId: changeLocation,
        rememberSelection,
        navigate,
      }}>
        {activeSection === "home" && (
          <section className="dashboard-grid" aria-label="Módulos">
            {modules.filter((module) => canAccessNav(user, module.icon, module.roles)).map((module) => (
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
              </button>
            ))}
          </section>
        )}
        <KeptSection show={activeSection === "pos"} eager>
          <PosView />
        </KeptSection>
        <KeptSection show={activeSection === "tables"}>
          <TablesView />
        </KeptSection>
        {activeSection === "catalog" && <CatalogView />}
        <KeptSection show={activeSection === "orders"}>
          <OrdersView />
        </KeptSection>
        {canAccessNav(user, "bar", ["OWNER", "MANAGER", "KITCHEN", "SERVER"]) && (
          <KeptSection show={activeSection === "bar" || activeSection === "kitchen"}>
            <KitchenView />
          </KeptSection>
        )}
        <KeptSection show={activeSection === "checkout"}>
          <CheckoutView />
        </KeptSection>
        <KeptSection show={activeSection === "cash"}>
          <CashView />
        </KeptSection>
        {activeSection === "sales" && <SalesView />}
        {activeSection === "staff" && <StaffView />}
        {activeSection === "reports" && <ReportsView />}
        {activeSection === "account" && <AccountView />}
      </NavigationContext.Provider>
    </AppShell>
  );
}
