"use client";

import { FormEvent, PointerEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useAppNavigation } from "@/components/AppShell";
import {
  CurrentUser,
  DiningArea,
  DiningTable,
  RestaurantOrder,
  changeTableStatus,
  createArea,
  createTable,
  listAreas,
  listOrders,
  listTables,
  moveTable,
} from "@/lib/api";
import { orderForTable, withLiveTableStatus } from "@/lib/tableStatus";
import { SystemSelect } from "@/components/SystemSelect";

const statusLabels: Record<DiningTable["status"], string> = {
  FREE: "Libre",
  OCCUPIED: "Ocupada",
  WAITING_PAYMENT: "Cuenta solicitada",
  OUT_OF_SERVICE: "Desactivada",
  RESERVED: "Reservada",
};

const money = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

type StatusFilter = "all" | DiningTable["status"];
type HallMode = "service" | "edit";

function isBusyStatus(status: DiningTable["status"]) {
  return status === "OCCUPIED" || status === "WAITING_PAYMENT";
}

function occupancyLabel(tables: DiningTable[]) {
  const busy = tables.filter((table) => isBusyStatus(table.status)).length;
  return `${busy} de ${tables.length} ocupadas`;
}

function formatElapsed(openedAt: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(openedAt)) / 60000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${minutes} min`;
  return `${hours} h ${rest} min`;
}

export default function TablesView() {
  const { user, navigate, locations, locationId } = useAppNavigation();
  const [areas, setAreas] = useState<DiningArea[]>([]);
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [orders, setOrders] = useState<RestaurantOrder[]>([]);
  const [areaId, setAreaId] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creationModal, setCreationModal] = useState<"area" | "table" | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "plan">("list");
  const [hallMode, setHallMode] = useState<HallMode>("service");
  const [showDetails, setShowDetails] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setAreaId("all");
    setStatusFilter("all");
    setSelectedId("");
  }, [locationId]);

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
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

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

  const orderByTable = useMemo(() => {
    const map = new Map<string, (typeof orders)[number]>();
    for (const table of tables) {
      const order = orderForTable(orders, table.id);
      if (order) map.set(table.id, order);
    }
    return map;
  }, [orders, tables]);
  const liveTables = useMemo(
    () => tables.map((table) => withLiveTableStatus(table, orderByTable.get(table.id))),
    [orderByTable, tables],
  );
  const scoped = useMemo(
    () => liveTables.filter((table) => areaId === "all" || table.areaId === areaId),
    [areaId, liveTables],
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
  const selected = liveTables.find((table) => table.id === selectedId) ?? null;
  const selectedOrder = selected ? orderByTable.get(selected.id) : undefined;
  const grouped = areas
    .map((area) => ({
      area,
      tables: visible.filter((table) => table.areaId === area.id),
    }))
    .filter((group) => group.tables.length > 0);
  const layoutEdit = hallMode === "edit" && viewMode === "plan" && canManage(user);
  const currentLocation = locations.find((location) => location.id === locationId);

  function openService(table: DiningTable) {
    const order = orderByTable.get(table.id);
    if (order) navigate("pos", { orderId: order.id, tableId: table.id });
    else if (table.status === "FREE" || table.status === "RESERVED") navigate("pos", { tableId: table.id });
  }

  return (
    <>
      {error && <p className="error" role="alert">{error}</p>}

      <div className="halls-view">
      <div className="service-filters" role="group" aria-label="Salón">
        <FilterChip
          pressed={areaId === "all"}
          icon={<HallsIcon />}
          label="Todos"
          hint={occupancyLabel(tables)}
          onClick={() => setAreaId("all")}
        />
        {areas.map((area) => {
          const areaTables = tables.filter((table) => table.areaId === area.id);
          return (
            <FilterChip
              key={area.id}
              pressed={areaId === area.id}
              icon={<AreaIcon />}
              label={area.name}
              hint={occupancyLabel(areaTables)}
              onClick={() => setAreaId(area.id)}
            />
          );
        })}
      </div>

      <div className="halls-controls">
        <div className="view-toggle" role="group" aria-label="Vista de mesas">
          <button type="button" className="service-chip" aria-pressed={viewMode === "list"} onClick={() => setViewMode("list")}>
            <ListIcon />
            Lista
          </button>
          <button type="button" className="service-chip" aria-pressed={viewMode === "plan"} onClick={() => setViewMode("plan")}>
            <PlanIcon />
            Plano
          </button>
        </div>
        <label className="halls-details">
          <input
            type="checkbox"
            checked={showDetails}
            onChange={(event) => setShowDetails(event.target.checked)}
          />
          Mostrar detalles del pedido
        </label>
        <div className="view-toggle" role="group" aria-label="Modo">
          <button type="button" className="service-chip" aria-pressed={hallMode === "service"} onClick={() => setHallMode("service")}>
            <ServiceIcon />
            Servicio
          </button>
          {canManage(user) && (
            <button type="button" className="service-chip" aria-pressed={hallMode === "edit"} onClick={() => setHallMode("edit")}>
              <EditIcon />
              Edición
            </button>
          )}
        </div>
        {hallMode === "edit" && canManage(user) && (
          <div className="table-creation-actions">
            <button type="button" className="toolbar-action-button" onClick={() => openCreationModal("area")} disabled={!locationId}>
              <AreaIcon />
              <span>Nuevo salón</span>
            </button>
            <button type="button" className="toolbar-action-button" onClick={() => openCreationModal("table")} disabled={!locationId}>
              <TableIcon />
              <span>Nueva mesa</span>
            </button>
          </div>
        )}
        {layoutEdit && (
          <p className="halls-hint">Arrastra las mesas para guardar el plano.</p>
        )}
      </div>

      <div className="service-filters" role="group" aria-label="Estado de mesa">
        <FilterChip pressed={statusFilter === "all"} icon={<HallsIcon />} label="Todas" count={counts.all} onClick={() => setStatusFilter("all")} />
        <FilterChip pressed={statusFilter === "FREE"} icon={<FreeIcon />} label="Libres" count={counts.FREE} tone="ok" onClick={() => setStatusFilter("FREE")} />
        <FilterChip pressed={statusFilter === "OCCUPIED"} icon={<OccupiedIcon />} label="Ocupadas" count={counts.OCCUPIED} tone="warn" onClick={() => setStatusFilter("OCCUPIED")} />
        <FilterChip pressed={statusFilter === "WAITING_PAYMENT"} icon={<BillIcon />} label="Cuentas solicitadas" count={counts.WAITING_PAYMENT} tone="bill" onClick={() => setStatusFilter("WAITING_PAYMENT")} />
        <FilterChip pressed={statusFilter === "RESERVED"} icon={<ReservedIcon />} label="Reservadas" count={counts.RESERVED} tone="reserve" onClick={() => setStatusFilter("RESERVED")} />
        <FilterChip pressed={statusFilter === "OUT_OF_SERVICE"} icon={<OffIcon />} label="Desactivadas" count={counts.OUT_OF_SERVICE} onClick={() => setStatusFilter("OUT_OF_SERVICE")} />
      </div>

      <div className="halls-board">
        <div className="halls-main">
          {viewMode === "plan" && (
            <FloorPlan
              areas={areas.filter((area) => areaId === "all" || area.id === areaId)}
              tables={visible}
              orders={orderByTable}
              selectedId={selectedId}
              showDetails={showDetails}
              layoutEdit={layoutEdit}
              onSelect={setSelectedId}
              onMove={savePosition}
              onPreview={(tableId, posX, posY) => {
                setTables((current) => current.map((item) => (
                  item.id === tableId ? { ...item, posX, posY } : item
                )));
              }}
            />
          )}
          {viewMode === "list" && grouped.map((group) => (
            <section className="halls-group" key={group.area.id} aria-label={group.area.name}>
              <h3><AreaIcon /> {group.area.name} <span>{group.tables.length} {group.tables.length === 1 ? "mesa" : "mesas"}</span></h3>
              <div className="entity-grid halls-grid">
                {group.tables.map((table) => (
                  <TableCard
                    key={table.id}
                    table={table}
                    order={orderByTable.get(table.id)}
                    selected={table.id === selectedId}
                    showDetails={showDetails}
                    now={now}
                    onSelect={() => setSelectedId(table.id)}
                    onOpen={() => openService(table)}
                  />
                ))}
              </div>
            </section>
          ))}
          {locationId && tables.length === 0 && (
            <p className="empty-state">Todavía no hay mesas configuradas para este local.</p>
          )}
          {tables.length > 0 && visible.length === 0 && (
            <p className="empty-state">Ninguna mesa coincide con estos filtros.</p>
          )}
        </div>

        <aside className="halls-inspector" aria-live="polite">
          {!selected && (
            <div className="halls-inspector-empty">
              <TableIcon />
              <h2>Elige una mesa</h2>
              <p>
                {currentLocation
                  ? `Toca una mesa de ${currentLocation.name} para ver su estado y abrir su comanda.`
                  : "Toca una mesa para ver su estado y abrir su comanda."}
              </p>
            </div>
          )}
          {selected && (
            <>
              <span className={`service-pill status-${selected.status.toLowerCase()}`}>
                <StatusGlyph status={selected.status} />
                {statusLabels[selected.status]}
              </span>
              <h2>{selected.name}</h2>
              <p className="table-card-meta">
                {selected.areaName} · {selected.capacity} {selected.capacity === 1 ? "plaza" : "plazas"}
              </p>
              {selectedOrder && showDetails && (
                <dl className="halls-inspector-stats">
                  <div>
                    <dt>Comensales</dt>
                    <dd>{selectedOrder.guestCount}</dd>
                  </div>
                  <div>
                    <dt>Tiempo</dt>
                    <dd>{formatElapsed(selectedOrder.openedAt, now)}</dd>
                  </div>
                  <div>
                    <dt>Pedido</dt>
                    <dd>#{selectedOrder.orderNumber}</dd>
                  </div>
                  <div>
                    <dt>Total</dt>
                    <dd>{money.format(selectedOrder.total)}</dd>
                  </div>
                </dl>
              )}
              <div className="table-card-actions">
                {canOperate(user) && (selected.status === "FREE" || selected.status === "RESERVED") && (
                  <button type="button" className="primary-button" disabled={busy} onClick={() => openService(selected)}>
                    <ServiceIcon />
                    Abrir pedido
                  </button>
                )}
                {canOperate(user) && selected.status === "OCCUPIED" && (
                  <button type="button" className="primary-button" disabled={busy || !selectedOrder} onClick={() => openService(selected)}>
                    <ServiceIcon />
                    Abrir pedido
                  </button>
                )}
                {canOperate(user) && selected.status === "WAITING_PAYMENT" && (
                  <>
                    <button type="button" className="primary-button" disabled={busy || !selectedOrder} onClick={() => selectedOrder && navigate("checkout", { orderId: selectedOrder.id, tableId: selected.id })}>
                      <BillIcon />
                      Ir a caja
                    </button>
                    <button type="button" className="secondary-button" disabled={busy || !selectedOrder} onClick={() => openService(selected)}>
                      <ServiceIcon />
                      Ver en POS
                    </button>
                  </>
                )}
                {canOperate(user) && selected.status === "FREE" && (
                  <button type="button" className="secondary-button" disabled={busy} onClick={() => updateStatus(selected, "RESERVED")}>
                    <ReservedIcon />
                    Reservar
                  </button>
                )}
                {canOperate(user) && selected.status === "RESERVED" && (
                  <button type="button" className="secondary-button" disabled={busy} onClick={() => updateStatus(selected, "FREE")}>
                    <FreeIcon />
                    Quitar reserva
                  </button>
                )}
                {hallMode === "edit" && canManage(user) && (selected.status === "FREE" || selected.status === "OUT_OF_SERVICE") && (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => updateStatus(selected, selected.status === "FREE" ? "OUT_OF_SERVICE" : "FREE")}
                  >
                    {selected.status === "FREE" ? "Desactivar" : "Reactivar"}
                  </button>
                )}
              </div>
            </>
          )}
        </aside>
      </div>

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
                  <p>Salones y Mesas</p>
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
                  <input name="name" maxLength={100} placeholder="Ej. Terraza" autoFocus required />
                </label>
                <div className="creation-modal-actions">
                  <button type="button" className="secondary-button" onClick={() => setCreationModal(null)} disabled={busy}>
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
                  <SystemSelect
                    className="fill"
                    name="areaId"
                    defaultValue=""
                    autoFocus
                    required
                    options={[
                      { value: "", label: "Seleccionar salón" },
                      ...areas.map((area) => ({
                        value: area.id,
                        label: area.name,
                      })),
                    ]}
                  />
                </label>
                <div className="split-fields">
                  <label>
                    Código
                    <input name="code" maxLength={40} placeholder="Ej. M-14" required />
                  </label>
                  <label>
                    Capacidad
                    <input name="capacity" type="number" min={1} max={100} defaultValue={2} required />
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
                  <button type="button" className="secondary-button" onClick={() => setCreationModal(null)} disabled={busy}>
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
      </div>
    </>
  );
}

function TableCard({
  table,
  order,
  selected,
  showDetails,
  now,
  onSelect,
  onOpen,
}: {
  table: DiningTable;
  order?: RestaurantOrder;
  selected: boolean;
  showDetails: boolean;
  now: number;
  onSelect: () => void;
  onOpen: () => void;
}) {
  return (
    <article
      className={`table-card status-${table.status.toLowerCase()} ${selected ? "selected" : ""}`}
      onClick={onSelect}
      onDoubleClick={onOpen}
    >
      <div className="card-heading">
        <span className={`service-pill status-${table.status.toLowerCase()}`}>
          <StatusGlyph status={table.status} />
          {statusLabels[table.status]}
        </span>
      </div>
      <h2>{table.name}</h2>
      <p className="table-card-meta">
        {table.capacity} {table.capacity === 1 ? "plaza" : "plazas"}
      </p>
      {order && showDetails && (
        <p className="table-card-order">
          <span><GuestIcon /> {order.guestCount} · {formatElapsed(order.openedAt, now)}</span>
          <strong>{money.format(order.total)}</strong>
        </p>
      )}
    </article>
  );
}

function FloorPlan({
  areas,
  tables,
  orders,
  selectedId,
  showDetails,
  layoutEdit,
  onSelect,
  onMove,
  onPreview,
}: {
  areas: DiningArea[];
  tables: DiningTable[];
  orders: Map<string, RestaurantOrder>;
  selectedId: string;
  showDetails: boolean;
  layoutEdit: boolean;
  onSelect: (tableId: string) => void;
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
                  className={`floor-table status-${table.status.toLowerCase()} ${selectedId === table.id ? "selected" : ""} ${drag.current?.id === table.id ? "dragging" : ""}`}
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
                    onSelect(table.id);
                  }}
                >
                  <strong>{table.name}</strong>
                  <small>{statusLabels[table.status]}</small>
                  {order && showDetails && <small>{money.format(order.total)}</small>}
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
  icon,
  label,
  count,
  hint,
  pressed,
  tone,
  onClick,
}: {
  icon?: ReactNode;
  label: string;
  count?: number;
  hint?: string;
  pressed: boolean;
  tone?: "ok" | "warn" | "bill" | "reserve";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`service-chip ${hint ? "service-chip-stack" : ""} ${tone ? `tone-${tone}` : ""}`}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <span>{icon}{label}</span>
      {hint && <small>{hint}</small>}
      {count !== undefined && <strong>{count}</strong>}
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

function HallsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 10h16v10H4Z" />
      <path d="M8 10V7l4-3 4 3v3" />
      <path d="M10 20v-5h4v5" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 7h12M8 12h12M8 17h12" />
      <circle cx="4.5" cy="7" r="1" />
      <circle cx="4.5" cy="12" r="1" />
      <circle cx="4.5" cy="17" r="1" />
    </svg>
  );
}

function PlanIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M10 4.5v15" />
    </svg>
  );
}

function ServiceIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 11h14v2.5a7 7 0 0 1-14 0Z" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20h4.2L19 9.2 14.8 5 4 15.8Z" />
      <path d="M12.8 7l4.2 4.2" />
    </svg>
  );
}

function FreeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="7.5" />
    </svg>
  );
}

function OccupiedIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="3" />
      <path d="M6 18a6 6 0 0 1 12 0" />
    </svg>
  );
}

function BillIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="3.5" width="12" height="17" rx="1.5" />
      <path d="M9 8h6M9 12h6M9 16h3.5" />
    </svg>
  );
}

function ReservedIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="10" width="14" height="9" rx="1.5" />
      <path d="M8 10V8a4 4 0 0 1 8 0v2" />
    </svg>
  );
}

function OffIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="7.5" />
      <path d="M8 8l8 8" />
    </svg>
  );
}

function GuestIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="3" />
      <path d="M6 19a6 6 0 0 1 12 0" />
    </svg>
  );
}

function StatusGlyph({ status }: { status: DiningTable["status"] }) {
  if (status === "FREE") return <FreeIcon />;
  if (status === "OCCUPIED") return <OccupiedIcon />;
  if (status === "WAITING_PAYMENT") return <BillIcon />;
  if (status === "RESERVED") return <ReservedIcon />;
  return <OffIcon />;
}
