"use client";

import { ReactNode, createContext, useContext, useEffect, useRef, useState } from "react";
import { CurrentUser, Location, logout } from "@/lib/api";
import { SystemSelect } from "@/components/SystemSelect";

export type NavIconName =
  | "home"
  | "pos"
  | "tables"
  | "catalog"
  | "orders"
  | "kitchen"
  | "bar"
  | "checkout"
  | "cash"
  | "sales"
  | "staff"
  | "reports"
  | "account";

type NavigationContextValue = {
  user: CurrentUser;
  activeSection: NavIconName;
  selectedOrderId?: string;
  selectedTableId?: string;
  locations: Location[];
  locationId: string;
  setLocationId: (locationId: string) => void;
  rememberSelection: (options: { orderId?: string; tableId?: string }) => void;
  navigate: (section: NavIconName, options?: { orderId?: string; tableId?: string }) => void;
};

const IDLE_ACTIVITY_KEY = "sgr.lastActivity";
const IDLE_REASON_KEY = "sgr.logoutReason";
const SIDEBAR_COLLAPSED_KEY = "sgr.sidebarCollapsed";
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const IDLE_WARN_MS = 60 * 1000;

export const NavigationContext = createContext<NavigationContextValue | null>(null);

export function useAppNavigation() {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error("useAppNavigation debe usarse dentro de WorkspaceApp");
  }
  return context;
}

type AppShellProps = {
  user: CurrentUser;
  title: string;
  activeSection: NavIconName;
  locations: Location[];
  locationId: string;
  onLocationChange: (locationId: string) => void;
  onNavigate: (section: NavIconName, options?: { orderId?: string; tableId?: string }) => void;
  children: ReactNode;
};

export function NavIcon({ name }: { name: NavIconName }) {
  switch (name) {
    case "home":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="nav-icon">
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5.5 9.5V20h13V9.5" />
          <path d="M9.5 20v-5.5h5V20" />
        </svg>
      );
    case "pos":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="nav-icon">
          <rect x="3.5" y="4" width="17" height="11.5" rx="1.6" />
          <path d="M7 8.2h4.5M7 11h3" />
          <rect x="14.2" y="7.2" width="4.2" height="5.2" rx="0.7" />
          <path d="M8 21h8M12 15.5V21" />
        </svg>
      );
    case "tables":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="nav-icon">
          <ellipse cx="12" cy="11.2" rx="7.2" ry="3.1" />
          <path d="M5 11.2v3.2c0 1.7 3.1 3.1 7 3.1s7-1.4 7-3.1v-3.2" />
          <path d="M9.2 17.4V20M14.8 17.4V20" />
        </svg>
      );
    case "catalog":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="nav-icon">
          <path d="M5 7.2h11.5a2 2 0 0 1 2 2V19H7a2 2 0 0 1-2-2V7.2Z" />
          <path d="M5 7.2A2.2 2.2 0 0 1 7.3 5H17" />
          <path d="M9 11.5h6M9 15h4.5" />
        </svg>
      );
    case "orders":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="nav-icon">
          <path d="M8.2 5h7.6v2.3H8.2z" />
          <rect x="5.5" y="6.2" width="13" height="14.3" rx="1.6" />
          <path d="M9 11.2h6M9 14.4h6M9 17.6h4" />
        </svg>
      );
    case "kitchen":
    case "bar":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="nav-icon">
          <path d="M4.2 10.2c0-1.6.9-3 2.3-3.6A3.6 3.6 0 0 1 12 7.2c1.1 0 2.1.4 2.8 1.2" />
          <path d="M5.4 10.2h7.4v6.3H5.4z" />
          <path d="M6.6 16.5h5" />
          <path d="M15.2 4.8h5.4l-1.7 5.2a2.5 2.5 0 0 1-2.4 1.7h0A2.5 2.5 0 0 1 14.2 10l1-5.2Z" />
          <path d="M16.4 11.7V19M15 19h3.2" />
        </svg>
      );
    case "checkout":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="nav-icon">
          <rect x="4" y="3.8" width="16" height="9.2" rx="1.5" />
          <path d="M7 7h4M16.2 6.6v2.8" />
          <path d="M3.8 13h16.4l1.1 6.4H4.6Z" />
          <path d="M8 16.4h3" />
        </svg>
      );
    case "cash":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="nav-icon">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 7.8v4.3l2.8 1.6" />
        </svg>
      );
    case "sales":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="nav-icon">
          <path d="M4.5 19.2h15" />
          <path d="M7 19.2V12.5h3.2V19" />
          <path d="M11.4 19.2V8.5h3.2v10.7" />
          <path d="M15.8 19.2V5.8H19v13.4" />
        </svg>
      );
    case "staff":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="nav-icon">
          <circle cx="9" cy="8.5" r="3.2" />
          <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
          <circle cx="16.8" cy="9.5" r="2.4" />
          <path d="M15.5 19c.4-2.1 2-3.6 4.2-3.8" />
        </svg>
      );
    case "reports":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="nav-icon">
          <rect x="4" y="4.2" width="16" height="15.6" rx="1.6" />
          <path d="M7.5 15.2 10.4 12l2.4 2 3.7-4.6" />
        </svg>
      );
    case "account":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="nav-icon">
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="10" r="2.5" />
          <path d="M7.4 17.4a5.2 5.2 0 0 1 9.2 0" />
        </svg>
      );
  }
}

export function isDemoTestUser(user: CurrentUser) {
  const email = user.email.trim().toLowerCase();
  const name = user.displayName.trim().toLocaleLowerCase("es-ES");
  return email === "test@semaialabs.com" || name === "usuario de pruebas";
}

export function canAccessNav(user: CurrentUser, icon: NavIconName, roles?: string[]) {
  if (icon === "kitchen") return false;
  return !roles || roles.includes(user.role);
}

const navigation: Array<{ label: string; icon: NavIconName; roles?: string[] }> = [
  { label: "Inicio", icon: "home" },
  { label: "Punto de Venta", icon: "pos", roles: ["OWNER", "MANAGER", "CASHIER", "SERVER"] },
  { label: "Salones y Mesas", icon: "tables" },
  { label: "Productos", icon: "catalog" },
  { label: "Pedidos", icon: "orders" },
  { label: "Cocina y Barra", icon: "bar", roles: ["OWNER", "MANAGER", "KITCHEN", "SERVER"] },
  { label: "Caja", icon: "checkout", roles: ["OWNER", "MANAGER", "CASHIER", "SERVER"] },
  { label: "Turnos", icon: "cash", roles: ["OWNER", "MANAGER", "CASHIER"] },
  { label: "Personal", icon: "staff", roles: ["OWNER", "MANAGER"] },
  { label: "Ventas", icon: "sales", roles: ["OWNER", "MANAGER", "CASHIER"] },
  { label: "Reportes", icon: "reports", roles: ["OWNER", "MANAGER"] },
];

export function AppShell({
  user,
  title,
  activeSection,
  locations,
  locationId,
  onLocationChange,
  onNavigate,
  children,
}: AppShellProps) {
  const [idleWarning, setIdleWarning] = useState(false);
  const [idleSecondsLeft, setIdleSecondsLeft] = useState(60);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    try {
      setSidebarCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
    } catch {
      // ignore
    }
  }, []);

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }

  useEffect(() => {
    if (typeof window === "undefined") return;

    let lastActivity = Date.now();
    let lastWrite = 0;
    let lastMoveSample = 0;
    let warningOpen = false;
    let expiring = false;
    let countdownTimer: ReturnType<typeof setInterval> | null = null;

    function writeIdleActivity(ts: number) {
      lastActivity = ts;
      lastWrite = ts;
      try {
        window.localStorage.setItem(IDLE_ACTIVITY_KEY, String(ts));
      } catch {
        // ignore storage quota / private mode
      }
    }

    function readIdleActivity(): number {
      try {
        const raw = window.localStorage.getItem(IDLE_ACTIVITY_KEY);
        const parsed = raw ? Number(raw) : 0;
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
      } catch {
        return 0;
      }
    }

    function closeWarningModal() {
      warningOpen = false;
      setIdleWarning(false);
      if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
      }
    }

    async function expireIdleSession() {
      if (expiring) return;
      expiring = true;
      closeWarningModal();
      try {
        window.sessionStorage.setItem(IDLE_REASON_KEY, "Sesión cerrada por inactividad.");
        window.sessionStorage.removeItem("sgr.activeSection");
        window.sessionStorage.removeItem("sgr.selectedOrderId");
        window.sessionStorage.removeItem("sgr.selectedTableId");
        window.localStorage.removeItem(IDLE_ACTIVITY_KEY);
      } catch {
        // ignore
      }
      await logout().catch(() => undefined);
      window.location.replace("/");
    }

    function openWarningModal() {
      if (warningOpen) return;
      warningOpen = true;
      setIdleWarning(true);
      const initialLeft = Math.max(0, Math.ceil((IDLE_TIMEOUT_MS - (Date.now() - lastActivity)) / 1000));
      setIdleSecondsLeft(initialLeft || Math.ceil(IDLE_WARN_MS / 1000));
      if (countdownTimer) clearInterval(countdownTimer);
      countdownTimer = setInterval(() => {
        const stored = readIdleActivity();
        if (stored > lastActivity) {
          lastActivity = stored;
        }
        const elapsed = Date.now() - lastActivity;
        const leftMs = Math.max(0, IDLE_TIMEOUT_MS - elapsed);
        if (leftMs > IDLE_WARN_MS) {
          closeWarningModal();
          return;
        }
        setIdleSecondsLeft(Math.ceil(leftMs / 1000));
        if (leftMs <= 0) {
          void expireIdleSession();
        }
      }, 250);
    }

    function checkIdleTimeout() {
      const stored = readIdleActivity();
      if (stored > lastActivity) {
        lastActivity = stored;
      }
      const elapsed = Date.now() - lastActivity;
      if (elapsed >= IDLE_TIMEOUT_MS) {
        void expireIdleSession();
        return;
      }
      if (elapsed >= IDLE_TIMEOUT_MS - IDLE_WARN_MS) {
        openWarningModal();
        return;
      }
      if (warningOpen) {
        closeWarningModal();
      }
    }

    function onUserActivity(event: Event) {
      if (warningOpen || expiring) return;
      const now = Date.now();
      if (event.type === "mousemove") {
        if (now - lastMoveSample < 5000) return;
        lastMoveSample = now;
      }
      if (now - lastWrite < 1000) {
        lastActivity = now;
        return;
      }
      writeIdleActivity(now);
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        checkIdleTimeout();
      }
    }

    function onStorage(event: StorageEvent) {
      if (event.key !== IDLE_ACTIVITY_KEY || !event.newValue) return;
      const ts = Number(event.newValue);
      if (!Number.isFinite(ts) || ts <= lastActivity) return;
      lastActivity = ts;
      if (warningOpen && Date.now() - lastActivity < IDLE_TIMEOUT_MS - IDLE_WARN_MS) {
        closeWarningModal();
      }
    }

    function onContinueIdle() {
      writeIdleActivity(Date.now());
      closeWarningModal();
    }

    writeIdleActivity(Date.now());
    const events = ["mousedown", "mousemove", "keydown", "touchstart", "scroll", "wheel", "click"];
    events.forEach((type) => document.addEventListener(type, onUserActivity, { passive: true, capture: true }));
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("storage", onStorage);
    window.addEventListener("sgr:idle-continue", onContinueIdle);
    const checkTimer = setInterval(checkIdleTimeout, 10000);

    return () => {
      clearInterval(checkTimer);
      if (countdownTimer) clearInterval(countdownTimer);
      events.forEach((type) => document.removeEventListener(type, onUserActivity, { capture: true }));
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("sgr:idle-continue", onContinueIdle);
    };
  }, []);

  async function endSession() {
    await logout();
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem("sgr.activeSection");
      window.sessionStorage.removeItem("sgr.selectedOrderId");
      window.sessionStorage.removeItem("sgr.selectedTableId");
      window.localStorage.removeItem(IDLE_ACTIVITY_KEY);
      window.location.replace("/");
    }
  }

  function continueIdleSession() {
    setIdleWarning(false);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("sgr:idle-continue"));
    }
  }

  return (
    <div className={`app-frame${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-head">
            <span className="sidebar-mark" aria-hidden="true">S</span>
            <div className="brand">Semaia</div>
            <button
              type="button"
              className="sidebar-collapse"
              onClick={toggleSidebar}
              aria-pressed={sidebarCollapsed}
              aria-label={sidebarCollapsed ? "Expandir menú" : "Contraer menú"}
              title={sidebarCollapsed ? "Expandir menú" : "Contraer menú"}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {sidebarCollapsed ? (
                  <path d="M9 6.5 14.5 12 9 17.5" />
                ) : (
                  <path d="M15 6.5 9.5 12 15 17.5" />
                )}
              </svg>
            </button>
          </div>
        </div>
        <nav className="app-nav" aria-label="Navegación principal">
          {navigation.filter((item) => canAccessNav(user, item.icon, item.roles)).map((item) => (
            <button
              key={item.icon}
              type="button"
              onClick={() => onNavigate(item.icon)}
              className={activeSection === item.icon ? "active" : undefined}
              title={item.label}
              aria-label={item.label}
            >
              <NavIcon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>
      <main className="workspace">
        <header className="workspace-header">
          <div className="workspace-header-title">
            <NavIcon name={activeSection} />
            <h1>{title}</h1>
          </div>
          <div className="workspace-header-meta">
            {locations.length > 0 && (
              <label className="header-location">
                Local
                <SystemSelect
                  aria-label="Local"
                  value={locationId}
                  onChange={onLocationChange}
                  options={locations.map((location) => ({
                    value: location.id,
                    label: location.name,
                  }))}
                />
              </label>
            )}
            <UserMenu
              user={user}
              onProfile={() => onNavigate("account")}
              onLogout={endSession}
            />
            <div id="workspace-header-actions" className="workspace-header-actions" />
            <FullscreenButton />
          </div>
        </header>
        {children}
      </main>
      {idleWarning && (
        <div className="idle-modal-backdrop" role="presentation">
          <div
            className="idle-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="idle-modal-title"
          >
            <div className="idle-modal-head">
              <h2 id="idle-modal-title">CIERRE DE SESIÓN POR INACTIVIDAD</h2>
            </div>
            <div className="idle-modal-body">
              <p>
                Tu sesión va a expirar por inactividad en{" "}
                <strong>{idleSecondsLeft}</strong> segundos. ¿Quieres seguir
                usando el sistema?
              </p>
              <div className="idle-modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={endSession}
                >
                  Cerrar sesión
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={continueIdleSession}
                  autoFocus
                >
                  Sí, continuar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FullscreenButton() {
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement != null);
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      /* El navegador puede rechazar la pantalla completa fuera de un gesto. */
    }
  }

  return (
    <button
      type="button"
      className="header-fullscreen"
      aria-label={fullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
      aria-pressed={fullscreen}
      onClick={() => void toggleFullscreen()}
    >
      {fullscreen ? <CollapseIcon /> : <ExpandIcon />}
    </button>
  );
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 4H5a1 1 0 0 0-1 1v4" />
      <path d="M15 4h4a1 1 0 0 1 1 1v4" />
      <path d="M20 15v4a1 1 0 0 1-1 1h-4" />
      <path d="M4 15v4a1 1 0 0 0 1 1h4" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9h4a1 1 0 0 0 1-1V4" />
      <path d="M15 4v4a1 1 0 0 0 1 1h4" />
      <path d="M20 15h-4a1 1 0 0 0-1 1v4" />
      <path d="M9 20v-4a1 1 0 0 0-1-1H4" />
    </svg>
  );
}

function UserMenu({
  user,
  onProfile,
  onLogout,
}: {
  user: CurrentUser;
  onProfile: () => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`user-menu ${open ? "open" : ""}`}>
      <button
        type="button"
        className="user-menu-button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="user-avatar" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="8.5" r="3.5" />
            <path d="M5 19.5a7 7 0 0 1 14 0" />
          </svg>
        </span>
        <strong className="user-menu-name">{user.displayName}</strong>
        <svg className="user-caret" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 6 8 10.5 12.5 6" />
        </svg>
      </button>
      {open && (
        <div className="user-menu-panel" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onProfile();
            }}
          >
            Perfil
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}
