"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { changeOwnPassword } from "@/lib/api";

export default function AccountPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get("currentPassword"));
    const newPassword = String(form.get("newPassword"));
    const confirmation = String(form.get("confirmation"));
    if (newPassword !== confirmation) {
      setError("La confirmación no coincide con la nueva contraseña.");
      return;
    }
    setBusy(true);
    try {
      await changeOwnPassword(currentPassword, newPassword);
      router.replace("/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cambiar la contraseña");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Mi cuenta">
      {(user) => (
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
              <input name="currentPassword" type="password" required />
            </label>
            <label>
              Nueva contraseña
              <input name="newPassword" type="password" minLength={12} maxLength={200} required />
            </label>
            <label>
              Confirmar nueva contraseña
              <input name="confirmation" type="password" minLength={12} maxLength={200} required />
            </label>
            <small>Mínimo 12 caracteres, con mayúsculas, minúsculas y números.</small>
            <button className="primary-button" disabled={busy}>
              {busy ? "Actualizando…" : "Cambiar contraseña"}
            </button>
          </form>
        </section>
      )}
    </AppShell>
  );
}
