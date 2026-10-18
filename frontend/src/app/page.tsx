"use client";

import { FormEvent, useEffect, useState } from "react";
import { CurrentUser, currentUser, login } from "@/lib/api";
import { WorkspaceApp } from "@/components/WorkspaceApp";

export default function LoginPage() {
  const [authenticatedUser, setAuthenticatedUser] = useState<CurrentUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const reason = window.sessionStorage.getItem("sgr.logoutReason");
        if (reason) {
          setError(reason);
          window.sessionStorage.removeItem("sgr.logoutReason");
        }
      } catch {
        // ignore
      }
    }
    currentUser()
      .then((user) => {
        if (user) setAuthenticatedUser(user);
      })
      .catch(() => undefined)
      .finally(() => setCheckingSession(false));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const user = await login(email, password, remember);
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem("sgr.activeSection", "home");
      }
      setAuthenticatedUser(user);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo iniciar sesión");
    } finally {
      setLoading(false);
    }
  }

  if (checkingSession) {
    return null;
  }

  if (authenticatedUser) {
    return <WorkspaceApp user={authenticatedUser} />;
  }

  return (
    <main className="login-page">
      <section className="brand-panel" aria-label="SGR de Semaia Labs">
        <div className="brand-glow brand-glow-top" aria-hidden="true" />
        <div className="brand-glow brand-glow-bottom" aria-hidden="true" />

        <header className="brand-header">
          <span className="brand-mark" aria-hidden="true">S</span>
          <span className="brand">Semaia Labs</span>
        </header>

        <div className="brand-content">
          <div className="brand-copy">
            <p className="brand-kicker">
              <span aria-hidden="true" />
              Gestiona
            </p>
            <h1>TU RESTAURANTE</h1>
            <p>
              Coordina sala, cocina y caja desde una plataforma creada para
              que cada servicio fluya con claridad.
            </p>
          </div>
        </div>

        <footer className="brand-footer">
          <span>Simple. Preciso. Conectado.</span>
        </footer>
      </section>

      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-card">
          <h2 id="login-title">Bienvenido</h2>

          <form onSubmit={submit}>
            <div className="form-field">
              <label htmlFor="email">Correo electrónico</label>
              <div className="login-input-shell">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 6.5h16v11H4z" />
                  <path d="m4.5 7 7.5 6 7.5-6" />
                </svg>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="nombre@restaurante.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
            </div>
            <div className="form-field">
              <label htmlFor="credential">Contraseña</label>
              <div className="login-input-shell">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="5" y="10" width="14" height="10" rx="2" />
                  <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10M12 14v2" />
                </svg>
                <input
                  id="credential"
                  name="k"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Introduce tu contraseña"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={8}
                  required
                />
                <button
                  className="password-toggle"
                  type="button"
                  aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? "Ocultar" : "Mostrar"}
                </button>
              </div>
            </div>
            <label className="remember">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
              />
              Mantener la sesión en este dispositivo
            </label>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="primary-button" type="submit" disabled={loading}>
              <span>{loading ? "Comprobando…" : "Iniciar sesión"}</span>
            </button>
          </form>

          <div className="secure-note">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="5" y="10" width="14" height="10" rx="2" />
              <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" />
            </svg>
            <span><strong>Conexión protegida</strong> · Tus datos viajan cifrados.</span>
          </div>
        </div>
      </section>
    </main>
  );
}
