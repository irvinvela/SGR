"use client";

import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import {
  CurrentUser,
  DiningArea,
  DiningTable,
  Location,
  changeTableStatus,
  createArea,
  createTable,
  listAreas,
  listLocations,
  listTables,
} from "@/lib/api";

const statusLabels: Record<DiningTable["status"], string> = {
  FREE: "Libre",
  OCCUPIED: "Ocupada",
  WAITING_PAYMENT: "Pendiente de pago",
  OUT_OF_SERVICE: "Fuera de servicio",
};

export default function TablesPage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const [areas, setAreas] = useState<DiningArea[]>([]);
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listLocations()
      .then((result) => {
        setLocations(result);
        if (result[0]) setLocationId(result[0].id);
      })
      .catch((cause) => setError(cause.message));
  }, []);

  useEffect(() => {
    if (!locationId) return;
    Promise.all([listAreas(locationId), listTables(locationId)])
      .then(([areaResult, tableResult]) => {
        setAreas(areaResult);
        setTables(tableResult);
        setError("");
      })
      .catch((cause) => setError(cause.message));
  }, [locationId]);

  async function addArea(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    try {
      const area = await createArea({
        locationId,
        name: String(form.get("name")),
        sortOrder: areas.length,
      });
      setAreas((current) => [...current, area]);
      formElement.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo crear el salón");
    } finally {
      setBusy(false);
    }
  }

  async function addTable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    try {
      const table = await createTable({
        locationId,
        areaId: String(form.get("areaId")),
        code: String(form.get("code")),
        name: String(form.get("name")),
        capacity: Number(form.get("capacity")),
      });
      setTables((current) => [...current, table]);
      formElement.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo crear la mesa");
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(table: DiningTable, status: DiningTable["status"]) {
    setBusy(true);
    try {
      const updated = await changeTableStatus({
        tableId: table.id,
        status,
        expectedVersion: table.version,
      });
      setTables((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo actualizar la mesa");
      if (locationId) setTables(await listTables(locationId));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Salones y mesas">
      {(user) => (
        <>
          <div className="toolbar">
            <label>
              Local
              <select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>{location.name}</option>
                ))}
              </select>
            </label>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          {canManage(user) && (
            <section className="forms-grid">
              <form className="form-card" onSubmit={addArea}>
                <h2>Nuevo salón</h2>
                <label>Nombre<input name="name" maxLength={100} required /></label>
                <button className="primary-button" disabled={busy || !locationId}>Crear salón</button>
              </form>
              <form className="form-card" onSubmit={addTable}>
                <h2>Nueva mesa</h2>
                <label>
                  Salón
                  <select name="areaId" required>
                    <option value="">Seleccionar</option>
                    {areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
                  </select>
                </label>
                <label>Código<input name="code" maxLength={40} required /></label>
                <label>Nombre<input name="name" maxLength={100} required /></label>
                <label>Capacidad<input name="capacity" type="number" min={1} max={100} defaultValue={2} required /></label>
                <button className="primary-button" disabled={busy || areas.length === 0}>Crear mesa</button>
              </form>
            </section>
          )}
          <section className="entity-grid" aria-label="Mesas">
            {tables.map((table) => (
              <article className={`table-card status-${table.status.toLowerCase()}`} key={table.id}>
                <div className="card-heading">
                  <div>
                    <small>{table.areaName} · {table.code}</small>
                    <h2>{table.name}</h2>
                  </div>
                  <span>{table.capacity} plazas</span>
                </div>
                {table.status === "FREE" || table.status === "OUT_OF_SERVICE" ? (
                  <label>
                    Estado administrativo
                    <select
                      value={table.status}
                      disabled={busy}
                      onChange={(event) => updateStatus(table, event.target.value as DiningTable["status"])}
                    >
                      <option value="FREE">{statusLabels.FREE}</option>
                      <option value="OUT_OF_SERVICE">{statusLabels.OUT_OF_SERVICE}</option>
                    </select>
                  </label>
                ) : (
                  <span className="operational-status">{statusLabels[table.status]}</span>
                )}
              </article>
            ))}
          </section>
          {locationId && tables.length === 0 && (
            <p className="empty-state">Todavía no hay mesas configuradas para este local.</p>
          )}
        </>
      )}
    </AppShell>
  );
}

function canManage(user: CurrentUser) {
  return user.role === "OWNER" || user.role === "MANAGER";
}
