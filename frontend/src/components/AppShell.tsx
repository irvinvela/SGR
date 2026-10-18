"use client";

import { ReactNode, createContext, useContext, useEffect, useState } from "react";
import { CurrentUser, logout } from "@/lib/api";

export type NavIconName =
  | "home"
  | "tables"
  | "catalog"
  | "orders"
  | "kitchen"
  | "checkout"
  | "cash"
  | "sales"
  | "staff"
  | "account";

type NavigationContextValue = {
  user: CurrentUser;
  activeSection: NavIconName;
  selectedOrderId?: string;
  navigate: (section: NavIconName, options?: { orderId?: string }) => void;
};

const IDLE_ACTIVITY_KEY = "sgr.lastActivity";
const IDLE_REASON_KEY = "sgr.logoutReason";
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
  onNavigate: (section: NavIconName, options?: { orderId?: string }) => void;
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
    case "tables":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="nav-icon">
          <rect x="4" y="4" width="7" height="7" rx="1.5" />
          <rect x="13" y="4" width="7" height="7" rx="1.5" />
          <rect x="4" y="13" width="7" height="7" rx="1.5" />
          <rect x="13" y="13" width="7" height="7" rx="1.5" />
        </svg>
      );
    case "catalog":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="nav-icon">
          <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z" />
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M8.5 8h7M8.5 11.5h5" />
        </svg>
      );
    case "orders":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="nav-icon">
          <rect x="5" y="4" width="14" height="17" rx="2" />
          <path d="M9 4.5h6M8.5 10h7M8.5 14h7M8.5 18h4.5" />
        </svg>
      );
    case "kitchen":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="nav-icon">
          <path d="M6 10a4 4 0 0 1 2.2-3.6A4.5 4.5 0 0 1 15.8 6.4 4 4 0 0 1 18 10c0 1.8-1 3.2-2 3.7V18H8v-4.3c-1-.5-2-1.9-2-3.7Z" />
          <path d="M8 21h8" />
        </svg>
      );
    case "checkout":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="nav-icon">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 10h18M7 15h4" />
        </svg>
      );
    case "cash":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="nav-icon">
          <rect x="4" y="6" width="16" height="13" rx="2" />
          <path d="M8 6V4h8v2M12 10v5M9.5 12.5h5" />
        </svg>
      );
    case "sales":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="nav-icon">
          <path d="M4 19.5h16" />
          <path d="M7.5 16v-4.5M12 16V8.5M16.5 16v-7" />
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
    case "account":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="nav-icon">
          <circle cx="12" cy="8.5" r="3.5" />
          <path d="M5 19.5a7 7 0 0 1 14 0" />
        </svg>
      );
  }
}

const navigation: Array<{ label: string; icon: NavIconName; roles?: string[] }> = [
  { label: "Inicio", icon: "home" },
  { label: "Mesas", icon: "tables" },
  { label: "Catálogo", icon: "catalog" },
  { label: "Pedidos", icon: "orders" },
  { label: "Cocina", icon: "kitchen", roles: ["OWNER", "MANAGER", "KITCHEN", "SERVER"] },
  { label: "Caja", icon: "checkout", roles: ["OWNER", "MANAGER", "CASHIER", "SERVER"] },
  { label: "Turnos", icon: "cash", roles: ["OWNER", "MANAGER", "CASHIER"] },
  { label: "Ventas", icon: "sales", roles: ["OWNER", "MANAGER", "CASHIER"] },
  { label: "Personal", icon: "staff", roles: ["OWNER", "MANAGER"] },
  { label: "Mi cuenta", icon: "account" },
];

export function AppShell({ user, title, activeSection, onNavigate, children }: AppShellProps) {
  const [idleWarning, setIdleWarning] = useState(false);
  const [idleSecondsLeft, setIdleSecondsLeft] = useState(60);

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
    <div className="app-frame">
      <aside className="app-sidebar">
        <div>
          <div className="brand">Semaia Labs</div>
          <p className="sidebar-organization">{user.organizationName}</p>
        </div>
        <nav className="app-nav" aria-label="Navegación principal">
          {navigation.filter((item) => !item.roles || item.roles.includes(user.role)).map((item) => (
            <button
              key={item.icon}
              type="button"
              onClick={() => onNavigate(item.icon)}
              className={activeSection === item.icon ? "active" : undefined}
            >
              <NavIcon name={item.icon} />
              <span>{item.label}</span>
            </button>
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
