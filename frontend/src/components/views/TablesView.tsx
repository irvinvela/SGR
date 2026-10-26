"use client";

import { FormEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { useAppNavigation } from "@/components/AppShell";
import {
  CurrentUser,
  DiningArea,
  DiningTable,
  Location,
  RestaurantOrder,
  changeTableStatus,
  createArea,
  createTable,
  listAreas,
  listLocations,
  listOrders,
  listTables,
  moveTable,
} from "@/lib/api";

const statusLabels: Record<DiningTable["status"], string> = {
  FREE: "Libre",
  OCCUPIED: "Ocupada",
  WAITING_PAYMENT: "Cuenta solicitada",
  OUT_OF_SERVICE: "Fuera de servicio",
  RESERVED: "Reservada",
};

const money = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

type StatusFilter = "all" | DiningTable["status"];

export default function TablesView() {
  const { user, navigate } = useAppNavigation();
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const [areas, setAreas] = useState<DiningArea[]>([]);
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [orders, setOrders] = useState<RestaurantOrder[]>([]);
  const [areaId, setAreaId] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creationModal, setCreationModal] = useState<"area" | "table" | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "plan">("plan");
  const [layoutEdit, setLayoutEdit] = useState(false);

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
    Promise.all([listAreas(locationId), listTables(locationId), listOrders(locationId)])
      .then(([areaResult, tableResult, orderResult]) => {
        setAreas(areaResult);
        setTables(tableResult);
        setOrders(orderResult);
        setAreaId((current) => (
          current === "all" || areaResult.some((area) => area.id === current) ? current : "all"
        ));
        setError("");
      })
      .catch((cause) => setError(cause.message));
  }, [locationId]);

  useEffect(() => {
    if (!creationModal) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) setCreationModal(null);
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [creationModal, busy]);

  function openCreationModal(modal: "area" | "table") {
    setError("");
    setCreationModal(modal);
  }

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
      setCreationModal(null);
      setError("");
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
      setCreationModal(null);
      setError("");
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

  async function savePosition(table: DiningTable, posX: number, posY: number) {
    try {
      const updated = await moveTable({
        tableId: table.id,
        posX,
        posY,
        expectedVersion: table.version,
      });
      setTables((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo mover la mesa");
      if (locationId) setTables(await listTables(locationId));
    }
  }

  const scoped = useMemo(
    () => tables.filter((table) => areaId === "all" || table.areaId === areaId),
    [areaId, tables],
  );
  const counts = useMemo(() => {
    const next = { all: 0, FREE: 0, OCCUPIED: 0, WAITING_PAYMENT: 0, OUT_OF_SERVICE: 0, RESERVED: 0 };
    scoped.forEach((table) => {
      next.all += 1;
      next[table.status] += 1;
    });
    return next;
  }, [scoped]);
  const visible = scoped.filter((table) => statusFilter === "all" || table.status === statusFilter);
  const orderByTable = useMemo(
    () => new Map(orders.map((order) => [order.tableId, order])),
    [orders],
  );

  function openService(table: DiningTable) {
    const order = orderByTable.get(table.id);
    if (order) navigate("pos", { orderId: order.id });
    else if (table.status === "FREE" || table.status === "RESERVED") navigate("pos", { tableId: table.id });
  }

  return (
    <>
      <div className="toolbar tables-toolbar">
        <label>
          Local
          <select
            value={locationId}
            onChange={(event) => {
              setLocationId(event.target.value);
              setAreaId("all");
              setStatusFilter("all");
            }}
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>{location.name}</option>
            ))}
          </select>
        </label>
        {canManage(user) && (
          <div className="table-creation-actions">
            <button
              type="button"
              className="toolbar-action-button"
              onClick={() => openCreationModal("area")}
              disabled={!locationId}
            >
              <AreaIcon />
              <span>Nuevo salón</span>
            </button>
            <button
              type="button"
              className="toolbar-action-button"
              onClick={() => openCreationModal("table")}
              disabled={!locationId}
            >
              <TableIcon />
              <span>Nueva mesa</span>
            </button>
          </div>
        )}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="view-toggle" role="group" aria-label="Vista de mesas">
        <button type="button" className="service-chip" aria-pressed={viewMode === "plan"} onClick={() => setViewMode("plan")}>
          Plano
        </button>
        <button type="button" className="service-chip" aria-pressed={viewMode === "list"} onClick={() => setViewMode("list")}>
          Lista
        </button>
        {canManage(user) && viewMode === "plan" && (
          <button
            type="button"
            className="service-chip"
            aria-pressed={layoutEdit}
            onClick={() => setLayoutEdit((current) => !current)}
          >
            {layoutEdit ? "Listo" : "Mover mesas"}
          </button>
        )}
      </div>
      <div className="service-filters" role="group" aria-label="Salón">
        <FilterChip
          pressed={areaId === "all"}
          label="Todos"
          count={tables.length}
          onClick={() => setAreaId("all")}
        />
        {areas.map((area) => (
          <FilterChip
            key={area.id}
            pressed={areaId === area.id}
            label={area.name}
            count={tables.filter((table) => table.areaId === area.id).length}
            onClick={() => setAreaId(area.id)}
          />
        ))}
      </div>
      <div className="service-filters" role="group" aria-label="Estado de mesa">
        <FilterChip pressed={statusFilter === "all"} label="Todas" count={counts.all} onClick={() => setStatusFilter("all")} />
        <FilterChip pressed={statusFilter === "FREE"} label="Libres" count={counts.FREE} tone="ok" onClick={() => setStatusFilter("FREE")} />
        <FilterChip pressed={statusFilter === "OCCUPIED"} label="Ocupadas" count={counts.OCCUPIED} tone="warn" onClick={() => setStatusFilter("OCCUPIED")} />
        <FilterChip pressed={statusFilter === "WAITING_PAYMENT"} label="Cuenta solicitada" count={counts.WAITING_PAYMENT} tone="bill" onClick={() => setStatusFilter("WAITING_PAYMENT")} />
        <FilterChip pressed={statusFilter === "OUT_OF_SERVICE"} label="Fuera de servicio" count={counts.OUT_OF_SERVICE} onClick={() => setStatusFilter("OUT_OF_SERVICE")} />
        <FilterChip pressed={statusFilter === "RESERVED"} label="Reservadas" count={counts.RESERVED} tone="reserve" onClick={() => setStatusFilter("RESERVED")} />
      </div>
      {viewMode === "plan" && (
        <FloorPlan
          areas={areas.filter((area) => areaId === "all" || area.id === areaId)}
          tables={visible}
          orders={orderByTable}
          layoutEdit={layoutEdit && canManage(user)}
          onOpen={openService}
          onMove={savePosition}
          onPreview={(tableId, posX, posY) => {
            setTables((current) => current.map((item) => (
              item.id === tableId ? { ...item, posX, posY } : item
            )));
          }}
        />
      )}
      {viewMode === "list" && (
      <section className="entity-grid" aria-label="Mesas">
        {visible.map((table) => {
          const order = orderByTable.get(table.id);
          return (
            <article className={`table-card status-${table.status.toLowerCase()}`} key={table.id}>
              <div className="card-heading">
                <div>
                  <small>{table.areaName} · {table.code}</small>
                  <h2>{table.name}</h2>
                </div>
                <span className={`service-pill status-${table.status.toLowerCase()}`}>
                  {statusLabels[table.status]}
                </span>
              </div>
              <p className="table-card-meta">
                {table.capacity} {table.capacity === 1 ? "plaza" : "plazas"}
                {order ? ` · Pedido #${order.orderNumber} · ${order.guestCount} comensales` : ""}
              </p>
              <div className="table-card-actions">
                {canOperate(user) && (table.status === "FREE" || table.status === "RESERVED") && (
                  <button
                    type="button"
                    className="primary-button"
                    disabled={busy}
                    onClick={() => openService(table)}
                  >
                    Abrir pedido
                  </button>
                )}
                {canOperate(user) && table.status === "FREE" && (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => updateStatus(table, "RESERVED")}
                  >
                    Reservar
                  </button>
                )}
                {canOperate(user) && table.status === "RESERVED" && (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => updateStatus(table, "FREE")}
                  >
                    Quitar reserva
                  </button>
                )}
                {canOperate(user) && table.status === "OCCUPIED" && (
                  <button
                    type="button"
                    className="primary-button"
                    disabled={busy || !order}
                    onClick={() => openService(table)}
                  >
                    Abrir pedido
                  </button>
                )}
                {canOperate(user) && table.status === "WAITING_PAYMENT" && (
                  <button
                    type="button"
                    className="primary-button"
                    disabled={busy || !order}
                    onClick={() => openService(table)}
                  >
                    Ver cuenta
                  </button>
                )}
                {canManage(user) && (table.status === "FREE" || table.status === "OUT_OF_SERVICE") && (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => updateStatus(
                      table,
                      table.status === "FREE" ? "OUT_OF_SERVICE" : "FREE",
                    )}
                  >
                    {table.status === "FREE" ? "Desactivar" : "Reactivar"}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </section>
      )}
      {locationId && tables.length === 0 && (
        <p className="empty-state">Todavía no hay mesas configuradas para este local.</p>
      )}
      {tables.length > 0 && visible.length === 0 && (
        <p className="empty-state">Ninguna mesa coincide con estos filtros.</p>
      )}
      {creationModal && (
        <div
          className="creation-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !busy) setCreationModal(null);
          }}
        >
          <section
            className="creation-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="creation-modal-title"
          >
            <header>
              <div className="creation-modal-title">
                <span>{creationModal === "area" ? <AreaIcon /> : <TableIcon />}</span>
                <div>
                  <p>Salones y mesas</p>
                  <h2 id="creation-modal-title">
                    {creationModal === "area" ? "Nuevo salón" : "Nueva mesa"}
                  </h2>
                </div>
              </div>
              <button
                type="button"
                className="creation-modal-close"
                aria-label="Cerrar"
                onClick={() => setCreationModal(null)}
                disabled={busy}
              >
                ×
              </button>
            </header>
            {error && <p className="error" role="alert">{error}</p>}
            {creationModal === "area" ? (
              <form className="creation-modal-form" onSubmit={addArea}>
                <label>
                  Nombre del salón
                  <input
                    name="name"
                    maxLength={100}
                    placeholder="Ej. Terraza"
                    autoFocus
                    required
                  />
                </label>
                <div className="creation-modal-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setCreationModal(null)}
                    disabled={busy}
                  >
                    Cancelar
                  </button>
                  <button className="primary-button" disabled={busy || !locationId}>
                    {busy ? "Creando…" : "Crear salón"}
                  </button>
                </div>
              </form>
            ) : (
              <form className="creation-modal-form" onSubmit={addTable}>
                <label>
                  Salón
                  <select name="areaId" defaultValue="" autoFocus required>
                    <option value="">Seleccionar salón</option>
                    {areas.map((area) => (
                      <option key={area.id} value={area.id}>{area.name}</option>
                    ))}
                  </select>
                </label>
                <div className="split-fields">
                  <label>
                    Código
                    <input name="code" maxLength={40} placeholder="Ej. M-14" required />
                  </label>
                  <label>
                    Capacidad
                    <input
                      name="capacity"
                      type="number"
                      min={1}
                      max={100}
                      defaultValue={2}
                      required
                    />
                  </label>
                </div>
                <label>
                  Nombre de la mesa
                  <input name="name" maxLength={100} placeholder="Ej. Mesa 14" required />
                </label>
                {areas.length === 0 && (
                  <p className="creation-modal-hint">
                    Primero debes crear un salón para poder añadir una mesa.
                  </p>
                )}
                <div className="creation-modal-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setCreationModal(null)}
                    disabled={busy}
                  >
                    Cancelar
                  </button>
                  <button className="primary-button" disabled={busy || areas.length === 0}>
                    {busy ? "Creando…" : "Crear mesa"}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function FloorPlan({
  areas,
  tables,
  orders,
  layoutEdit,
  onOpen,
  onMove,
  onPreview,
}: {
  areas: DiningArea[];
  tables: DiningTable[];
  orders: Map<string, RestaurantOrder>;
  layoutEdit: boolean;
  onOpen: (table: DiningTable) => void;
  onMove: (table: DiningTable, posX: number, posY: number) => void;
  onPreview: (tableId: string, posX: number, posY: number) => void;
}) {
  const drag = useRef<{ id: string; moved: boolean } | null>(null);

  function point(event: PointerEvent<HTMLElement>, areaEl: HTMLElement) {
    const box = areaEl.getBoundingClientRect();
    const x = Math.min(94, Math.max(6, ((event.clientX - box.left) / box.width) * 100));
    const y = Math.min(90, Math.max(10, ((event.clientY - box.top) / box.height) * 100));
    return { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) };
  }

  return (
    <div className="floor-plan" aria-label="Plano de mesas">
      {areas.map((area) => {
        const areaTables = tables.filter((table) => table.areaId === area.id);
        return (
          <section key={area.id} className="floor-area">
            <h3>{area.name}</h3>
            {areaTables.map((table) => {
              const order = orders.get(table.id);
              return (
                <button
                  type="button"
                  key={table.id}
                  className={`floor-table status-${table.status.toLowerCase()} ${drag.current?.id === table.id ? "dragging" : ""}`}
                  style={{ left: `${Number(table.posX)}%`, top: `${Number(table.posY)}%` }}
                  onPointerDown={(event) => {
                    if (!layoutEdit) return;
                    drag.current = { id: table.id, moved: false };
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    if (!layoutEdit || drag.current?.id !== table.id) return;
                    const areaEl = event.currentTarget.parentElement;
                    if (!areaEl) return;
                    drag.current.moved = true;
                    const next = point(event, areaEl);
                    onPreview(table.id, next.x, next.y);
                  }}
                  onPointerUp={(event) => {
                    if (layoutEdit && drag.current?.id === table.id && drag.current.moved) {
                      const areaEl = event.currentTarget.parentElement;
                      if (areaEl) {
                        const next = point(event, areaEl);
                        onMove(table, next.x, next.y);
                      }
                      drag.current = null;
                      return;
                    }
                    drag.current = null;
                    if (!layoutEdit) onOpen(table);
                  }}
                >
                  <strong>{table.name}</strong>
                  <small>{statusLabels[table.status]}</small>
                  {order && <small>{money.format(order.total)}</small>}
                </button>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

function FilterChip({
  label,
  count,
  pressed,
  tone,
  onClick,
}: {
  label: string;
  count: number;
  pressed: boolean;
  tone?: "ok" | "warn" | "bill" | "reserve";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`service-chip ${tone ? `tone-${tone}` : ""}`}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <span>{label}</span>
      <strong>{count}</strong>
    </button>
  );
}

function canManage(user: CurrentUser) {
  return user.role === "OWNER" || user.role === "MANAGER";
}

function canOperate(user: CurrentUser) {
  return ["OWNER", "MANAGER", "CASHIER", "SERVER"].includes(user.role);
}

function AreaIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20V5h16v15M4 9h16M8 5v4M16 5v4" />
      <path d="M9 20v-6h6v6" />
    </svg>
  );
}

function TableIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="7" width="14" height="8" rx="1.5" />
      <path d="M7 15v5M17 15v5M8.5 7V4M15.5 7V4" />
    </svg>
  );
}
