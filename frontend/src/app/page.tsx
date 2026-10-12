"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { currentUser, login } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
      <section className="brand-panel">
        <div className="brand">Semai Labs</div>
        <div className="brand-copy">
          <h1>El restaurante, bajo control.</h1>
          <p>
            Pedidos, cocina, mesas y caja conectados en una sola operación,
            desde cualquier dispositivo autorizado.
          </p>
        </div>
        <small>SGR · Gestión de restaurantes</small>
      </section>

      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-card">
          <p className="eyebrow">Acceso seguro</p>
          <h2 id="login-title">Iniciar sesión</h2>
          <p className="intro">
            Introduce tus credenciales para acceder a tu restaurante.
          </p>

          <form onSubmit={submit}>
            <div className="form-field">
              <label htmlFor="email">Correo electrónico</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <div className="form-field">
              <label htmlFor="password">Contraseña</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={10}
                required
              />
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
              {loading ? "Comprobando…" : "Entrar"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
