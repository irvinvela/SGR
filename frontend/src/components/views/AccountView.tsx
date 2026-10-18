"use client";

import { FormEvent, useState } from "react";
import { useAppNavigation } from "@/components/AppShell";
import { changeOwnPassword } from "@/lib/api";

export default function AccountView() {
  const { user } = useAppNavigation();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get("c"));
    const newPassword = String(form.get("n"));
    const confirmation = String(form.get("v"));
    if (newPassword !== confirmation) {
      setError("La confirmación no coincide con la nueva contraseña.");
      return;
    }
    setBusy(true);
    try {
      await changeOwnPassword(currentPassword, newPassword);
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem("sgr.activeSection");
        window.sessionStorage.removeItem("sgr.selectedOrderId");
        window.localStorage.removeItem("sgr.lastActivity");
        window.location.replace("/");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cambiar la contraseña");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="account-panel">
      <div>
        <p className="eyebrow">{user.role}</p>
        <h2>{user.displayName}</h2>
        <p>{user.email}</p>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <form className="form-card" onSubmit={submit}>
        <h2>Cambiar contraseña</h2>
        <label>
          Contraseña actual
          <input name="c" type="password" required />
        </label>
        <label>
          Nueva contraseña
          <input name="n" type="password" minLength={12} maxLength={200} required />
        </label>
        <label>
          Confirmar nueva contraseña
          <input name="v" type="password" minLength={12} maxLength={200} required />
        </label>
        <small>Mínimo 12 caracteres, con mayúsculas, minúsculas y números.</small>
        <button className="primary-button" disabled={busy}>
          {busy ? "Actualizando…" : "Cambiar contraseña"}
        </button>
      </form>
    </section>
  );
}
