"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAppNavigation } from "@/components/AppShell";
import {
  CurrentUser,
  StaffMember,
  changeStaffRole,
  changeStaffStatus,
  createStaff,
  listStaff,
  resetStaffPassword,
} from "@/lib/api";

const roleLabels: Record<StaffMember["role"], string> = {
  OWNER: "Propietario",
  MANAGER: "Gerente",
  CASHIER: "Caja",
  SERVER: "Camarero",
  KITCHEN: "Cocina",
};

export default function StaffView() {
  const { user } = useAppNavigation();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    try {
      setStaff(await listStaff());
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar el personal");
    }
  }

  async function addStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    try {
      await createStaff({
        email: String(form.get("email")),
        displayName: String(form.get("displayName")),
        password: String(form.get("k")),
        role: String(form.get("role")) as StaffMember["role"],
      });
      formElement.reset();
      setNotice("Usuario creado. Entregue la contraseña inicial por un canal seguro.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo crear el usuario");
    } finally {
      setBusy(false);
    }
  }

  async function updateRole(member: StaffMember, role: StaffMember["role"]) {
    setBusy(true);
    try {
      await changeStaffRole(member.id, role);
      setNotice("Rol actualizado; las sesiones anteriores quedaron invalidadas.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cambiar el rol");
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(member: StaffMember) {
    setBusy(true);
    try {
      await changeStaffStatus(member.id, !member.active);
      setNotice(member.active ? "Usuario desactivado." : "Usuario activado.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cambiar el estado");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>, member: StaffMember) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const password = String(new FormData(formElement).get("k"));
    setBusy(true);
    try {
      await resetStaffPassword(member.id, password);
      formElement.reset();
      setNotice("Contraseña restablecida; las sesiones anteriores quedaron invalidadas.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo restablecer la contraseña");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}
      <div className="staff-layout">
        <form className="form-card staff-create" onSubmit={addStaff}>
          <h2>Nuevo usuario</h2>
          <label>
            Nombre
            <input name="displayName" maxLength={160} required />
          </label>
          <label>
            Correo
            <input name="email" type="email" maxLength={254} required />
          </label>
          <label>
            Rol
            <select name="role">
              {assignableRoles(user).map((role) => (
                <option key={role} value={role}>{roleLabels[role]}</option>
              ))}
            </select>
          </label>
          <label>
            Contraseña inicial
            <input name="k" type="password" minLength={12} maxLength={200} required />
          </label>
          <small>Mínimo 12 caracteres, con mayúsculas, minúsculas y números.</small>
          <button className="primary-button" disabled={busy}>Crear usuario</button>
        </form>

        <section className="staff-list">
          {staff
            .filter((member) => canView(user, member))
            .map((member) => {
              const manageable = canManage(user, member);
              const isSelf = member.id === user.id;
              return (
                <article className={member.active ? "staff-card" : "staff-card inactive"} key={member.id}>
                  <header>
                    <div>
                      <small>{member.email}</small>
                      <h2>{member.displayName}{isSelf ? " (usted)" : ""}</h2>
                    </div>
                    <span className="operational-status">
                      {member.active ? "Activo" : "Inactivo"}
                    </span>
                  </header>
                  <p>
                    Último acceso: {member.lastLoginAt
                      ? new Date(member.lastLoginAt).toLocaleString("es-ES")
                      : "Nunca"}
                  </p>
                  {manageable ? (
                    <div className="staff-actions">
                      <label>
                        Rol
                        <select
                          value={member.role}
                          disabled={busy || isSelf}
                          onChange={(event) => updateRole(
                            member,
                            event.target.value as StaffMember["role"],
                          )}
                        >
                          {assignableRoles(user).map((role) => (
                            <option key={role} value={role}>{roleLabels[role]}</option>
                          ))}
                        </select>
                      </label>
                      <button
                        className={member.active ? "danger-button" : "secondary-button"}
                        disabled={busy || isSelf}
                        onClick={() => updateStatus(member)}
                      >
                        {member.active ? "Desactivar" : "Activar"}
                      </button>
                      {!isSelf && (
                        <form onSubmit={(event) => resetPassword(event, member)}>
                          <input
                            name="k"
                            type="password"
                            minLength={12}
                            maxLength={200}
                            placeholder="Nueva contraseña"
                            required
                          />
                          <button className="secondary-button" disabled={busy}>Restablecer</button>
                        </form>
                      )}
                    </div>
                  ) : (
                    <strong>{roleLabels[member.role]}</strong>
                  )}
                </article>
              );
            })}
        </section>
      </div>
    </>
  );
}

function assignableRoles(user: CurrentUser): StaffMember["role"][] {
  return user.role === "OWNER"
    ? ["OWNER", "MANAGER", "CASHIER", "SERVER", "KITCHEN"]
    : ["CASHIER", "SERVER", "KITCHEN"];
}

function canManage(user: CurrentUser, member: StaffMember): boolean {
  if (user.role === "OWNER") return true;
  return user.role === "MANAGER"
    && ["CASHIER", "SERVER", "KITCHEN"].includes(member.role);
}

function canView(user: CurrentUser, member: StaffMember): boolean {
  if (user.role === "OWNER") return true;
  return member.role !== "OWNER";
}
