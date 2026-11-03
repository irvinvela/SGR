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
import { SystemSelect } from "@/components/SystemSelect";

const roleLabels: Record<StaffMember["role"], string> = {
  OWNER: "Propietario",
  MANAGER: "Gerente",
  CASHIER: "Caja",
  SERVER: "Camarero",
  KITCHEN: "Cocina",
};

type StaffChip = "all" | "active" | "inactive";

export default function StaffView() {
  const { user } = useAppNavigation();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [filter, setFilter] = useState<StaffChip>("all");
  const [selectedId, setSelectedId] = useState("");

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!createModalOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) setCreateModalOpen(false);
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [createModalOpen, busy]);

  function showCreateModal() {
    setError("");
    setNotice("");
    setCreateModalOpen(true);
  }

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
      setCreateModalOpen(false);
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

  const visible = staff.filter((member) => canView(user, member)).filter((member) => {
    if (filter === "active") return member.active;
    if (filter === "inactive") return !member.active;
    return true;
  });
  const selected = visible.find((member) => member.id === selectedId) ?? visible[0];
  const manageable = selected ? canManage(user, selected) : false;
  const isSelf = selected?.id === user.id;

  return (
    <div className="staff-view">
      <div className="pos-toolbar cash-topbar">
        <div className="pos-chip-row">
          <button type="button" className="pos-chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            Todos <strong>{staff.filter((member) => canView(user, member)).length}</strong>
          </button>
          <button type="button" className="pos-chip" aria-pressed={filter === "active"} onClick={() => setFilter("active")}>
            Activos
          </button>
          <button type="button" className="pos-chip" aria-pressed={filter === "inactive"} onClick={() => setFilter("inactive")}>
            Inactivos
          </button>
        </div>
        <button type="button" className="pos-shift-button" onClick={showCreateModal}>
          <CreateUserIcon />
          Crear usuario
        </button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="pos-pane-hint cash-notice" role="status">{notice}</p>}

      <div className="staff-board">
        <section className="cash-pane">
          <div className="pos-pane-head">
            <h2><span>1</span> Equipo</h2>
          </div>
          <div className="cash-ticket-list">
            {visible.map((member) => (
              <button
                type="button"
                key={member.id}
                className={`staff-person ${member.id === selected?.id ? "sel" : ""} ${member.active ? "" : "inactive"}`}
                onClick={() => setSelectedId(member.id)}
              >
                <strong>{member.displayName}{member.id === user.id ? " (usted)" : ""}</strong>
                <span>{roleLabels[member.role]} · {member.email}</span>
                <em>{member.active ? "Activo" : "Inactivo"}</em>
              </button>
            ))}
            {visible.length === 0 && <p className="pos-pane-hint">No hay usuarios en este filtro.</p>}
          </div>
        </section>

        <section className="cash-pane">
          <div className="pos-pane-head">
            <h2><span>2</span> Ficha</h2>
            {selected && (
              <span className={`service-pill ${selected.active ? "status-open" : "status-out_of_service"}`}>
                {selected.active ? "Activo" : "Inactivo"}
              </span>
            )}
          </div>
          {selected ? (
            <>
              <p className="pos-pane-hint">{selected.email}</p>
              <div className="cash-metric-grid staff-detail-grid">
                <div className="cash-tile">
                  <span>Nombre</span>
                  <strong>{selected.displayName}</strong>
                </div>
                <div className="cash-tile">
                  <span>Rol</span>
                  <strong>{roleLabels[selected.role]}</strong>
                </div>
                <div className="cash-tile">
                  <span>Último acceso</span>
                  <strong>
                    {selected.lastLoginAt
                      ? new Date(selected.lastLoginAt).toLocaleString("es-ES")
                      : "Nunca"}
                  </strong>
                </div>
              </div>
              {manageable ? (
                <div className="staff-detail-actions">
                  <label>
                    Rol
                    <SystemSelect
                      className="fill"
                      value={selected.role}
                      disabled={busy || isSelf}
                      onChange={(next) => updateRole(selected, next as StaffMember["role"])}
                      options={assignableRoles(user).map((role) => ({
                        value: role,
                        label: roleLabels[role],
                      }))}
                    />
                  </label>
                  <button
                    className={selected.active ? "danger-button" : "cash-pane-action"}
                    disabled={busy || isSelf}
                    onClick={() => updateStatus(selected)}
                  >
                    {selected.active ? "Desactivar" : "Activar"}
                  </button>
                  {!isSelf && (
                    <form onSubmit={(event) => resetPassword(event, selected)}>
                      <input
                        name="k"
                        type="password"
                        minLength={12}
                        maxLength={200}
                        placeholder="Nueva contraseña"
                        required
                      />
                      <button className="cash-pane-action" disabled={busy}>Restablecer</button>
                    </form>
                  )}
                </div>
              ) : (
                <p className="pos-pane-hint">No puede modificar este usuario.</p>
              )}
            </>
          ) : (
            <p className="pos-pane-hint">Selecciona un miembro del equipo.</p>
          )}
        </section>
      </div>
      {createModalOpen && (
        <div
          className="creation-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !busy) setCreateModalOpen(false);
          }}
        >
          <section
            className="creation-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-user-modal-title"
          >
            <header>
              <div className="creation-modal-title">
                <span><CreateUserIcon /></span>
                <div>
                  <p>Personal</p>
                  <h2 id="create-user-modal-title">Crear usuario</h2>
                </div>
              </div>
              <button
                type="button"
                className="creation-modal-close"
                aria-label="Cerrar"
                onClick={() => setCreateModalOpen(false)}
                disabled={busy}
              >
                ×
              </button>
            </header>
            {error && <p className="error" role="alert">{error}</p>}
            <form className="creation-modal-form" onSubmit={addStaff}>
              <label>
                Nombre
                <input name="displayName" maxLength={160} autoFocus required />
              </label>
              <label>
                Correo
                <input name="email" type="email" maxLength={254} required />
              </label>
              <label>
                Rol
                <SystemSelect
                  className="fill"
                  name="role"
                  defaultValue={assignableRoles(user)[0] ?? ""}
                  options={assignableRoles(user).map((role) => ({
                    value: role,
                    label: roleLabels[role],
                  }))}
                />
              </label>
              <label>
                Contraseña inicial
                <input name="k" type="password" minLength={12} maxLength={200} required />
              </label>
              <p className="creation-modal-description">
                Mínimo 12 caracteres, con mayúsculas, minúsculas y números.
              </p>
              <div className="creation-modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setCreateModalOpen(false)}
                  disabled={busy}
                >
                  Cancelar
                </button>
                <button className="primary-button" disabled={busy}>
                  {busy ? "Creando…" : "Crear usuario"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
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

function CreateUserIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="7" r="3" />
      <path d="M3.5 19v-2.5A4.5 4.5 0 0 1 8 12h2a4.5 4.5 0 0 1 4.5 4.5V19M17.5 8v6M14.5 11h6" />
    </svg>
  );
}
