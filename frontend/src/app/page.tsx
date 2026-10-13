"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { currentUser, login } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    currentUser()
      .then((user) => {
        if (user) router.replace("/app");
      })
      .catch(() => undefined);
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await login(email, password, remember);
      router.replace("/app");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo iniciar sesión");
    } finally {
      setLoading(false);
    }
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
              Operación conectada
            </p>
            <h1>Tu restaurante.</h1>
            <p>
              Coordina sala, cocina y caja desde una plataforma creada para
              que cada servicio fluya con claridad.
            </p>
          </div>

          <div className="operations-preview" aria-label="Módulos conectados de SGR">
            <div className="preview-heading">
              <div>
                <span>SGR</span>
                <strong>Todo en un mismo lugar</strong>
              </div>
              <span className="preview-status">
                <i aria-hidden="true" />
                Conectado
              </span>
            </div>
            <div className="preview-modules">
              <div>
                <span className="module-icon" aria-hidden="true">01</span>
                <p><strong>Mesas y pedidos</strong><small>Servicio coordinado</small></p>
              </div>
              <div>
                <span className="module-icon" aria-hidden="true">02</span>
                <p><strong>Cocina</strong><small>Comandas visibles</small></p>
              </div>
              <div>
                <span className="module-icon" aria-hidden="true">03</span>
                <p><strong>Caja</strong><small>Cierres controlados</small></p>
              </div>
            </div>
          </div>
        </div>

        <footer className="brand-footer">
          <span>Simple. Preciso. Conectado.</span>
        </footer>
      </section>

      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-card">
          <div className="login-badge" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M12 3 5.5 5.8v5.4c0 4.1 2.7 7.8 6.5 9 3.8-1.2 6.5-4.9 6.5-9V5.8L12 3Z" />
              <path d="m9.3 11.8 1.8 1.8 3.8-4" />
            </svg>
          </div>
          <p className="eyebrow">Acceso al sistema</p>
          <h2 id="login-title">Bienvenido</h2>
          <p>
            Ingresa con las credenciales asignadas a tu restaurante.
          </p>

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
              <label htmlFor="password">Contraseña</label>
              <div className="login-input-shell">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="5" y="10" width="14" height="10" rx="2" />
                  <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10M12 14v2" />
                </svg>
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Introduce tu contraseña"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={10}
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
              <span>{loading ? "Comprobando…" : "Entrar al sistema"}</span>
              {!loading && <span aria-hidden="true">→</span>}
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
