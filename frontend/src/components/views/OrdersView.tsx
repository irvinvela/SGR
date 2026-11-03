"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useAppNavigation } from "@/components/AppShell";
import {
  CurrentUser,
  DiningTable,
  Product,
  RestaurantOrder,
  addOrderItem,
  cancelOrder,
  correctOrderPayment,
  createPayment,
  editOrderItem,
  getCurrentCashShift,
  getOrderPaymentSummary,
  listOrders,
  listProducts,
  listTables,
  openOrder,
  itemGoesToBar,
  requestOrderPayment,
  sendOrderToBar,
  sendOrderToKitchen,
  updateProductStations,
  voidOrderItem,
} from "@/lib/api";
import { SearchField } from "@/components/SearchField";
import { PreBillPreview, ReceiptKind, ReceiptPayment } from "@/components/PreBillPreview";
import { hasOpenPedido, liveTableStatus, orderForTable } from "@/lib/tableStatus";
import { SystemSelect } from "@/components/SystemSelect";

const money = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

type OrderChip = "todos" | "activos" | "unpaid" | "espera" | "cuenta";
type OrderMode = "service" | "manage";
type ChannelFilter = "all" | "DINE_IN" | "TAKEAWAY" | "DELIVERY";

const statusLabels: Record<RestaurantOrder["status"], string> = {
  OPEN: "Abierto",
  WAITING_PAYMENT: "Cuenta solicitada",
  PAID: "Pagado",
  PARTIALLY_REFUNDED: "Reembolsado parcial",
  REFUNDED: "Reembolsado",
  CANCELLED: "Anulado",
};

export default function OrdersView() {
  const { user, selectedOrderId, selectedTableId, rememberSelection, navigate, locationId, locations, activeSection } = useAppNavigation();
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<RestaurantOrder[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [chip, setChip] = useState<OrderChip>("activos");
  const [mode, setMode] = useState<OrderMode>("service");
  const [query, setQuery] = useState("");
  const [tableFilter, setTableFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<ChannelFilter>("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [openModal, setOpenModal] = useState(false);
  const [stationConfigOpen, setStationConfigOpen] = useState(false);
  const [stationDraft, setStationDraft] = useState<Record<string, Product["prepStation"]>>({});
  const [stationQuery, setStationQuery] = useState("");
  const [openTableId, setOpenTableId] = useState("");
  const [cashShiftOpen, setCashShiftOpen] = useState(false);
  const [payMethod, setPayMethod] = useState<"CASH" | "CARD" | null>(null);
  const [tendered, setTendered] = useState("");
  const [retryKeys, setRetryKeys] = useState<Record<string, string>>({});
  const [payRetryKey, setPayRetryKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [receipt, setReceipt] = useState<{
    order: RestaurantOrder;
    kind: ReceiptKind;
    payment?: ReceiptPayment;
  } | null>(null);
  const [ready, setReady] = useState(false);
  const appliedNav = useRef("");

  useEffect(() => {
    setSelectedId("");
    setQuery("");
    setChip("activos");
    setMode("service");
    setTableFilter("all");
    setTypeFilter("all");
    setStatusFilter("all");
    if (locationId) refresh(locationId);
    else setReady(false);
  }, [locationId]);

  useEffect(() => {
    if (activeSection !== "orders") {
      setNotice("");
      setReceipt(null);
    }
  }, [activeSection]);

  useEffect(() => {
    if (!openModal && !stationConfigOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || busy) return;
      if (stationConfigOpen) setStationConfigOpen(false);
      else setOpenModal(false);
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [openModal, stationConfigOpen, busy]);

  useEffect(() => {
    const key = `${selectedOrderId ?? ""}:${selectedTableId ?? ""}`;
    if (!key.replace(":", "") || appliedNav.current === key) return;
    if (selectedOrderId) {
      if (selectedId !== selectedOrderId) setSelectedId(selectedOrderId);
      if (orders.some((order) => order.id === selectedOrderId && order.status === "WAITING_PAYMENT")) {
        setChip("cuenta");
      }
      appliedNav.current = key;
      return;
    }
    if (!selectedTableId || !tables.length) return;
    const order = orderForTable(orders, selectedTableId);
    if (order && (order.items ?? []).some((item) => !item.voided)) {
      setSelectedId(order.id);
      setChip(order.status === "WAITING_PAYMENT" ? "cuenta" : "activos");
    }
    appliedNav.current = key;
  }, [orders, selectedId, selectedOrderId, selectedTableId, tables]);

  async function refresh(currentLocationId = locationId) {
    try {
      const [tableResult, productResult, orderResult, shiftResult] = await Promise.all([
        listTables(currentLocationId),
        listProducts(currentLocationId),
        listOrders(currentLocationId),
        getCurrentCashShift(currentLocationId),
      ]);
      setTables(tableResult);
      setProducts(productResult.filter((product) => product.available));
      setOrders(orderResult);
      setCashShiftOpen(Boolean(shiftResult.shift));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudieron cargar los pedidos");
    } finally {
      setReady(true);
    }
  }

  async function createOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    try {
      const created = await openOrder({
        locationId,
        tableId: String(form.get("tableId")),
        guestCount: Number(form.get("guestCount")),
        notes: String(form.get("notes")),
      });
      formElement.reset();
      setOpenModal(false);
      setNotice("Pedido abierto.");
      await refresh();
      setSelectedId(created.id);
      setChip("activos");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo abrir la mesa");
    } finally {
      setBusy(false);
    }
  }

  async function addItem(event: FormEvent<HTMLFormElement>, orderId: string) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    try {
      await addOrderItem({
        orderId,
        productId: String(form.get("productId")),
        quantity: Number(form.get("quantity")),
        kitchenNote: String(form.get("kitchenNote")),
      });
      formElement.reset();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo añadir el producto");
    } finally {
      setBusy(false);
    }
  }

  function openStationConfig() {
    setError("");
    setStationQuery("");
    setStationDraft(Object.fromEntries(products.map((product) => [product.id, product.prepStation ?? "KITCHEN"])));
    setStationConfigOpen(true);
  }

  function moveStation(productId: string, station: Product["prepStation"]) {
    setStationDraft((current) => ({ ...current, [productId]: station }));
  }

  async function saveStationConfig() {
    if (!locationId) return;
    const assignments = products
      .map((product) => ({
        productId: product.id,
        station: stationDraft[product.id] ?? product.prepStation ?? "KITCHEN",
      }))
      .filter((assignment) => {
        const current = products.find((product) => product.id === assignment.productId);
        return current && current.prepStation !== assignment.station;
      });
    if (assignments.length === 0) {
      setStationConfigOpen(false);
      return;
    }
    setBusy(true);
    try {
      const updated = await updateProductStations({ locationId, assignments });
      setProducts(updated);
      setStationConfigOpen(false);
      setNotice("Configuración de envío actualizada.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar la configuración");
    } finally {
      setBusy(false);
    }
  }

  async function sendKitchen(orderId: string) {
    await sendStation(orderId, "kitchen");
  }

  async function sendBar(orderId: string) {
    await sendStation(orderId, "bar");
  }

  async function sendStation(orderId: string, station: "kitchen" | "bar") {
    const key = `${station}:${orderId}`;
    const idempotencyKey = retryKeys[key] ?? crypto.randomUUID();
    setRetryKeys((current) => ({ ...current, [key]: idempotencyKey }));
    setBusy(true);
    try {
      if (station === "bar") {
        await sendOrderToBar(orderId, idempotencyKey);
      } else {
        await sendOrderToKitchen(orderId, idempotencyKey);
      }
      setRetryKeys((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : station === "bar" ? "No se pudo enviar a barra" : "No se pudo enviar la ronda");
    } finally {
      setBusy(false);
    }
  }

  async function editItem(
    event: FormEvent<HTMLFormElement>,
    item: RestaurantOrder["items"][number],
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await editOrderItem({
        itemId: item.id,
        quantity: Number(form.get("quantity")),
        kitchenNote: String(form.get("kitchenNote")),
        expectedVersion: item.version,
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo editar la partida");
    } finally {
      setBusy(false);
    }
  }

  async function voidItem(
    event: FormEvent<HTMLFormElement>,
    item: RestaurantOrder["items"][number],
  ) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const reason = String(new FormData(formElement).get("reason"));
    setBusy(true);
    try {
      await voidOrderItem({
        itemId: item.id,
        reason,
        expectedVersion: item.version,
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo anular la partida");
    } finally {
      setBusy(false);
    }
  }

  async function requestPayment(order: RestaurantOrder) {
    setBusy(true);
    try {
      if (order.status === "OPEN") {
        await requestOrderPayment(order.id, order.version);
        setNotice("Cuenta solicitada. El pedido queda bloqueado hasta cobrar o corregir.");
      }
      await refresh();
      setChip("cuenta");
      setReceipt({ order, kind: "charge" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo solicitar la cuenta");
    } finally {
      setBusy(false);
    }
  }

  async function correctPayment(order: RestaurantOrder) {
    setBusy(true);
    try {
      await correctOrderPayment(order.id, order.version);
      setPayMethod(null);
      setTendered("");
      setNotice("Cuenta corregida. Ya puedes editar el pedido.");
      await refresh();
      setChip("activos");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo corregir la cuenta");
    } finally {
      setBusy(false);
    }
  }

  async function collectPayment(order: RestaurantOrder) {
    if (!payMethod) return;
    const idempotencyKey = payRetryKey || crypto.randomUUID();
    setPayRetryKey(idempotencyKey);
    setBusy(true);
    try {
      const summary = await getOrderPaymentSummary(order.id);
      const result = await createPayment({
        orderId: order.id,
        method: payMethod,
        amount: summary.balance,
        tenderedAmount: payMethod === "CASH" ? Number(tendered || summary.balance) : undefined,
        idempotencyKey,
      });
      setPayRetryKey("");
      setPayMethod(null);
      setTendered("");
      setNotice(
        result.summary.status === "PAID"
          ? `Pedido cobrado. Cambio: ${money.format(result.payment.changeAmount)}`
          : `Pago registrado. Saldo: ${money.format(result.summary.balance)}`,
      );
      if (result.summary.status === "PAID") {
        setReceipt({
          order,
          kind: "paid",
          payment: {
            method: payMethod,
            amount: result.payment.amount,
            changeAmount: result.payment.changeAmount,
          },
        });
      }
      await refresh();
      if (result.summary.status === "PAID") {
        setSelectedId("");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo registrar el cobro");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(
    event: FormEvent<HTMLFormElement>,
    orderId: string,
  ) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const reason = String(new FormData(formElement).get("reason"));
    setBusy(true);
    try {
      await cancelOrder(orderId, reason);
      formElement.reset();
      setNotice("Pedido anulado.");
      await refresh();
      setSelectedId("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo anular el pedido");
    } finally {
      setBusy(false);
    }
  }

  const freeTables = tables.filter((table) => {
    const status = liveTableStatus(table, orderForTable(orders, table.id));
    return status === "FREE" || status === "RESERVED";
  });
  const occupiedTables = useMemo(() => {
    const seen = new Set<string>();
    return orders.filter((order) => {
      if (!(order.items ?? []).some((item) => !item.voided && Number(item.quantity) > 0)
        && order.status !== "WAITING_PAYMENT") {
        return false;
      }
      if (seen.has(order.tableId)) return false;
      seen.add(order.tableId);
      return true;
    });
  }, [orders]);
  const liveOrders = useMemo(
    () => orders.filter((order) => hasOpenPedido(order) || order.status === "WAITING_PAYMENT"),
    [orders],
  );
  const counts = useMemo(() => ({
    todos: liveOrders.length,
    activos: liveOrders.filter((order) => order.status === "OPEN").length,
    unpaid: liveOrders.filter((order) => order.status === "OPEN" || order.status === "WAITING_PAYMENT").length,
    espera: liveOrders.filter((order) => hasPendingKitchen(order)).length,
    cuenta: liveOrders.filter((order) => order.status === "WAITING_PAYMENT").length,
  }), [liveOrders]);
  const visible = useMemo(() => {
    const normalized = normalizeSearch(query);
    return liveOrders.filter((order) => {
      if (chip === "activos" && order.status !== "OPEN") return false;
      if (chip === "unpaid" && order.status !== "OPEN" && order.status !== "WAITING_PAYMENT") return false;
      if (chip === "espera" && !hasPendingKitchen(order)) return false;
      if (chip === "cuenta" && order.status !== "WAITING_PAYMENT") return false;
      if (tableFilter !== "all" && order.tableId !== tableFilter) return false;
      if (typeFilter !== "all" && (order.orderType ?? "DINE_IN") !== typeFilter) return false;
      if (statusFilter !== "all" && order.status !== statusFilter) return false;
      if (!normalized) return true;
      return normalizeSearch([
        String(order.orderNumber),
        order.tableName,
        order.areaName,
      ].join(" ")).includes(normalized);
    });
  }, [chip, liveOrders, query, statusFilter, tableFilter, typeFilter]);
  const selected = orders.find((order) => order.id === selectedId) ?? null;

  useEffect(() => {
    if (activeSection !== "orders" || !selected) return;
    rememberSelection({ orderId: selected.id, tableId: selected.tableId });
  }, [activeSection, rememberSelection, selected]);

  useEffect(() => {
    if (selectedId && !orders.some((order) => order.id === selectedId)) {
      setSelectedId("");
      setPayMethod(null);
    }
  }, [orders, selectedId]);

  return (
    <>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}

      <div className="orders-view">
      <div className="orders-head">
        <div className="service-filters" role="group" aria-label="Filtro de pedidos">
          <FilterChip pressed={chip === "todos"} icon={<ListIcon />} label="Todos" count={counts.todos} onClick={() => setChip("todos")} />
          <FilterChip pressed={chip === "activos"} icon={<ActiveIcon />} label="Activos" count={counts.activos} tone="ok" onClick={() => setChip("activos")} />
          <FilterChip pressed={chip === "unpaid"} icon={<UnpaidIcon />} label="No pagado" count={counts.unpaid} onClick={() => setChip("unpaid")} />
          <FilterChip pressed={chip === "espera"} icon={<WaitIcon />} label="En espera" count={counts.espera} tone="warn" onClick={() => setChip("espera")} />
          <FilterChip pressed={chip === "cuenta"} icon={<BillIcon />} label="Cuenta solicitada" count={counts.cuenta} tone="bill" onClick={() => setChip("cuenta")} />
        </div>
        {canOperate(user) && ready && (
          <div className="orders-head-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                setError("");
                setOpenTableId(freeTables[0]?.id ?? "");
                setOpenModal(true);
              }}
              disabled={!locationId || freeTables.length === 0}
            >
              <PlusIcon />
              Abrir mesa
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={openStationConfig}
              disabled={!locationId || products.length === 0}
            >
              <GearIcon />
              Configurar
            </button>
          </div>
        )}
      </div>

      <div className="halls-controls">
        <div className="view-toggle" role="tablist" aria-label="Modo de pedidos">
          <button type="button" className="service-chip" aria-pressed={mode === "service"} onClick={() => setMode("service")}>
            <ServiceIcon />
            Servicio
          </button>
          <button type="button" className="service-chip" aria-pressed={mode === "manage"} onClick={() => setMode("manage")}>
            <EditIcon />
            Gestión
          </button>
        </div>
        <SearchField
          className="orders-search"
          value={query}
          onChange={setQuery}
          placeholder="Buscar por número de pedido..."
          aria-label="Buscar pedido"
        />
        <label className="orders-filter">
          <SystemSelect
            aria-label="Filtrar por mesa"
            value={tableFilter}
            onChange={setTableFilter}
            options={[
              { value: "all", label: "Todas las mesas" },
              ...occupiedTables.map((order) => ({
                value: order.tableId,
                label: order.tableName,
              })),
            ]}
          />
        </label>
        <label className="orders-filter">
          <SystemSelect
            aria-label="Filtrar por tipo"
            value={typeFilter}
            onChange={(value) => setTypeFilter(value as ChannelFilter)}
            options={[
              { value: "all", label: "Todos los tipos" },
              { value: "DINE_IN", label: "En el local" },
              { value: "TAKEAWAY", label: "Para llevar" },
              { value: "DELIVERY", label: "Delivery" },
            ]}
          />
        </label>
        <label className="orders-filter">
          <SystemSelect
            aria-label="Filtrar por estado"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "all", label: "Todos los estados" },
              { value: "OPEN", label: "Abierto" },
              { value: "WAITING_PAYMENT", label: "Cuenta solicitada" },
            ]}
          />
        </label>
      </div>

      <div className="orders-workspace">
        <section className="order-list" aria-label="Pedidos">
          <header className="order-list-head">
            <ListIcon />
            {visible.length} {visible.length === 1 ? "pedido" : "pedidos"}
          </header>
          {visible.map((order) => (
            <button
              type="button"
              key={order.id}
              className={`order-row status-${order.status.toLowerCase()} ${order.id === selectedId ? "sel" : ""}`}
              aria-pressed={order.id === selectedId}
              onClick={() => {
                setSelectedId(order.id);
                setPayMethod(null);
                setTendered("");
                setError("");
              }}
            >
              <span className="r1">
                <strong>{order.tableName}</strong>
                <b>{money.format(order.total)}</b>
              </span>
              <span className="r2">#{order.orderNumber} · {timeAgo(order.openedAt)}</span>
              <span className={`service-pill status-${order.status.toLowerCase()}`}>
                <StatusGlyph status={order.status} pending={hasPendingKitchen(order)} />
                {statusLabels[order.status]}
              </span>
            </button>
          ))}
          {locationId && liveOrders.length === 0 && (
            <p className="empty-state">No hay pedidos abiertos en este local.</p>
          )}
          {liveOrders.length > 0 && visible.length === 0 && (
            <p className="empty-state">Ningún pedido coincide con estos filtros.</p>
          )}
        </section>
        <section className="order-workspace" aria-label="Detalle del pedido">
          {!selected && (
            <div className="order-empty">
              <BillIcon />
              <strong>Elige un pedido</strong>
              <p>Toca un pedido de la lista para ver sus productos, enviarlo a cocina o solicitar la cuenta.</p>
            </div>
          )}
          {selected && (
            <OrderDetail
              order={selected}
              user={user}
              products={products}
              busy={busy}
              cashShiftOpen={cashShiftOpen}
              payMethod={payMethod}
              tendered={tendered}
              onPayMethod={setPayMethod}
              onTendered={setTendered}
              onAddItem={(event) => addItem(event, selected.id)}
              onSendKitchen={() => sendKitchen(selected.id)}
              onSendBar={() => sendBar(selected.id)}
              onEditItem={editItem}
              onVoidItem={voidItem}
              onPreBill={() => setReceipt({ order: selected, kind: "preview" })}
              onRequestPayment={() => void requestPayment(selected)}
              onCorrectPayment={() => correctPayment(selected)}
              onCollect={() => collectPayment(selected)}
              onCancel={(event) => cancel(event, selected.id)}
              onGoCash={() => navigate("cash")}
              onGoPos={() => navigate("pos", { orderId: selected.id, tableId: selected.tableId })}
              onGoCheckout={() => navigate("checkout", { orderId: selected.id, tableId: selected.tableId })}
              onGoKitchen={() => {
                try { window.sessionStorage.setItem("sgr.stationTab", "KITCHEN"); } catch { /* ignore */ }
                navigate("bar", { orderId: selected.id, tableId: selected.tableId });
              }}
              onGoBar={() => {
                try { window.sessionStorage.setItem("sgr.stationTab", "BAR"); } catch { /* ignore */ }
                navigate("bar", { orderId: selected.id, tableId: selected.tableId });
              }}
              manage={mode === "manage"}
            />
          )}
        </section>
      </div>
      {stationConfigOpen && (
        <div
          className="creation-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !busy) setStationConfigOpen(false);
          }}
        >
          <section className="creation-modal station-config-modal" role="dialog" aria-modal="true" aria-labelledby="station-config-title">
            <header>
              <div className="creation-modal-title">
                <span><GearIcon /></span>
                <div>
                  <p>Pedidos</p>
                  <h2 id="station-config-title">Envío a cocina y barra</h2>
                </div>
              </div>
              <button
                type="button"
                className="creation-modal-close"
                aria-label="Cerrar"
                onClick={() => setStationConfigOpen(false)}
                disabled={busy}
              >
                ×
              </button>
            </header>
            {error && <p className="error" role="alert">{error}</p>}
            <div className="creation-modal-form">
              <p className="creation-modal-description">
                Mueve cada producto al grupo que debe recibirlo. El listado parte de la configuración actual.
              </p>
              <SearchField
                value={stationQuery}
                onChange={setStationQuery}
                placeholder="Buscar producto..."
                aria-label="Buscar producto"
              />
              <div className="station-config-grid">
                <StationColumn
                  title="Cocina"
                  station="KITCHEN"
                  products={products.filter((product) => (
                    (stationDraft[product.id] ?? product.prepStation) === "KITCHEN"
                    && (!stationQuery || normalizeSearch(`${product.name} ${product.categoryName}`).includes(normalizeSearch(stationQuery)))
                  ))}
                  onMove={(productId) => moveStation(productId, "BAR")}
                  moveLabel="A barra"
                />
                <StationColumn
                  title="Barra"
                  station="BAR"
                  products={products.filter((product) => (
                    (stationDraft[product.id] ?? product.prepStation) === "BAR"
                    && (!stationQuery || normalizeSearch(`${product.name} ${product.categoryName}`).includes(normalizeSearch(stationQuery)))
                  ))}
                  onMove={(productId) => moveStation(productId, "KITCHEN")}
                  moveLabel="A cocina"
                />
              </div>
              <div className="creation-modal-actions">
                <button type="button" className="secondary-button" onClick={() => setStationConfigOpen(false)} disabled={busy}>
                  Cancelar
                </button>
                <button type="button" className="primary-button" onClick={() => void saveStationConfig()} disabled={busy}>
                  {busy ? "Guardando…" : "Guardar"}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
      {openModal && (
        <div
          className="creation-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !busy) setOpenModal(false);
          }}
        >
          <section className="creation-modal" role="dialog" aria-modal="true" aria-labelledby="open-order-title">
            <header>
              <div className="creation-modal-title">
                <span><TableIcon /></span>
                <div>
                  <p>Pedidos</p>
                  <h2 id="open-order-title">Abrir mesa</h2>
                </div>
              </div>
              <button
                type="button"
                className="creation-modal-close"
                aria-label="Cerrar"
                onClick={() => setOpenModal(false)}
                disabled={busy}
              >
                ×
              </button>
            </header>
            {error && <p className="error" role="alert">{error}</p>}
            <form className="creation-modal-form" onSubmit={createOrder}>
              <label>
                Mesa libre
                <SystemSelect
                  className="fill"
                  name="tableId"
                  value={openTableId}
                  onChange={setOpenTableId}
                  required
                  options={[
                    { value: "", label: "Seleccionar" },
                    ...freeTables.map((table) => ({
                      value: table.id,
                      label: `${table.areaName} · ${table.name}`,
                    })),
                  ]}
                />
              </label>
              <label>
                Comensales
                <input name="guestCount" type="number" min={1} max={999} defaultValue={2} required />
              </label>
              <label>
                Nota
                <input name="notes" maxLength={500} />
              </label>
              <div className="creation-modal-actions">
                <button type="button" className="secondary-button" onClick={() => setOpenModal(false)} disabled={busy}>
                  Cancelar
                </button>
                <button className="primary-button" disabled={busy || freeTables.length === 0}>
                  <PlusIcon />
                  {busy ? "Abriendo…" : "Abrir pedido"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {receipt && (
        <PreBillPreview
          key={`${receipt.kind}:${receipt.order.id}:${receipt.order.version}`}
          order={receipt.order}
          organizationName={user.organizationName}
          locationName={locations.find((location) => location.id === locationId)?.name ?? ""}
          servedBy={user.displayName}
          variant={receipt.kind}
          payment={receipt.payment}
          autoPrint={receipt.kind === "charge" || receipt.kind === "paid"}
          onClose={() => setReceipt(null)}
        />
      )}
      </div>
    </>
  );
}

function OrderDetail({
  order,
  user,
  products,
  busy,
  cashShiftOpen,
  payMethod,
  tendered,
  onPayMethod,
  onTendered,
  onAddItem,
  onSendKitchen,
  onSendBar,
  onEditItem,
  onVoidItem,
  onPreBill,
  onRequestPayment,
  onCorrectPayment,
  onCollect,
  onCancel,
  onGoCash,
  onGoPos,
  onGoCheckout,
  onGoKitchen,
  onGoBar,
  manage,
}: {
  order: RestaurantOrder;
  user: CurrentUser;
  products: Product[];
  busy: boolean;
  cashShiftOpen: boolean;
  payMethod: "CASH" | "CARD" | null;
  tendered: string;
  onPayMethod: (method: "CASH" | "CARD") => void;
  onTendered: (value: string) => void;
  onAddItem: (event: FormEvent<HTMLFormElement>) => void;
  onSendKitchen: () => void;
  onSendBar: () => void;
  onEditItem: (event: FormEvent<HTMLFormElement>, item: RestaurantOrder["items"][number]) => void;
  onVoidItem: (event: FormEvent<HTMLFormElement>, item: RestaurantOrder["items"][number]) => void;
  onPreBill: () => void;
  onRequestPayment: () => void;
  onCorrectPayment: () => void;
  onCollect: () => void;
  onCancel: (event: FormEvent<HTMLFormElement>) => void;
  onGoCash: () => void;
  onGoPos: () => void;
  onGoCheckout: () => void;
  onGoKitchen: () => void;
  onGoBar: () => void;
  manage: boolean;
}) {
  const pendingItems = order.items.filter((item) => !item.sentToKitchen && !item.voided);
  const kitchenPendingCount = pendingItems.filter((item) => !isDrinkItem(item, products)).length;
  const barPendingCount = pendingItems.filter((item) => isDrinkItem(item, products)).length;
  const locked = order.status === "WAITING_PAYMENT";
  const editable = canOperate(user) && order.status === "OPEN";
  const change = Math.max(0, Number(tendered || order.total) - order.total);

  return (
    <article className="order-card order-detail">
      <header className="order-card-header">
        <div>
          <small>{order.areaName} · Pedido #{order.orderNumber} · {order.guestCount} comensales</small>
          <h2><TableIcon /> {order.tableName}</h2>
        </div>
        <div className="order-detail-head">
          <div className="order-flow-links">
            <button type="button" className="inline-link-button" onClick={onGoPos}>Punto de venta</button>
            <button type="button" className="inline-link-button" onClick={onGoKitchen}>Cocina</button>
            <button type="button" className="inline-link-button" onClick={onGoBar}>Barra</button>
            {locked && (
              <button type="button" className="inline-link-button" onClick={onGoCheckout}>Caja</button>
            )}
          </div>
          <span className={`service-pill status-${order.status.toLowerCase()}`}>
            <StatusGlyph status={order.status} pending={hasPendingKitchen(order)} />
            {statusLabels[order.status]}
          </span>
          <strong>{money.format(order.total)}</strong>
        </div>
      </header>
      {locked && (
        <p className="order-lock-banner">
          La cuenta está solicitada. No se pueden añadir, quitar ni anular líneas hasta cobrar o corregir.
        </p>
      )}
      <ul className="order-items">
        {order.items.map((item) => (
          <li key={item.id} className={item.voided ? "voided" : undefined}>
            <span>{item.quantity} × {item.productName}</span>
            <span>{money.format(item.quantity * item.unitPrice)}</span>
            <small>{item.voided ? "Anulada" : item.sentToKitchen ? "Enviado" : "Sin enviar"}</small>
            {item.kitchenNote && <em>{item.kitchenNote}</em>}
            {editable && !item.sentToKitchen && !item.voided && (
              <form className="item-edit-form" onSubmit={(event) => onEditItem(event, item)}>
                <input
                  name="quantity"
                  type="number"
                  min="0.001"
                  step="0.001"
                  defaultValue={item.quantity}
                  required
                />
                <input
                  name="kitchenNote"
                  maxLength={500}
                  defaultValue={item.kitchenNote ?? ""}
                  placeholder="Nota de cocina"
                />
                <button className="secondary-button" disabled={busy}><EditIcon /> Actualizar</button>
              </form>
            )}
            {editable && !item.voided && (!item.sentToKitchen || ["OWNER", "MANAGER"].includes(user.role)) && (
              <form className="item-void-form" onSubmit={(event) => onVoidItem(event, item)}>
                <input
                  name="reason"
                  maxLength={500}
                  placeholder={item.sentToKitchen ? "Motivo obligatorio para cocina" : "Motivo de retirada"}
                  required
                />
                <button className="danger-button" disabled={busy}>
                  <OffIcon />
                  {item.sentToKitchen ? "Anular enviada" : "Quitar"}
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <>
          <form className="inline-order-form" onSubmit={onAddItem}>
            <SystemSelect
              className="fill"
              name="productId"
              required
              options={[
                { value: "", label: "Añadir producto" },
                ...products.map((product) => ({
                  value: product.id,
                  label: `${product.name} · ${money.format(product.price)}`,
                })),
              ]}
            />
            <input name="quantity" type="number" min="0.001" step="0.001" defaultValue="1" required />
            <input name="kitchenNote" maxLength={500} placeholder="Nota de cocina" />
            <button className="secondary-button" disabled={busy}><PlusIcon /> Añadir</button>
          </form>
          <div className="order-detail-actions">
            <button
              className="primary-button"
              disabled={busy || kitchenPendingCount === 0}
              onClick={onSendKitchen}
            >
              <KitchenIcon />
              {kitchenPendingCount > 0 ? `Enviar ${kitchenPendingCount} a cocina` : "Cocina al día"}
            </button>
            <button
              className="primary-button"
              disabled={busy || barPendingCount === 0}
              onClick={onSendBar}
            >
              <BarIcon />
              {barPendingCount > 0 ? `Enviar ${barPendingCount} a barra` : "Barra al día"}
            </button>
            <button
              className="secondary-button"
              disabled={busy || order.items.filter((item) => !item.voided).length === 0}
              onClick={onPreBill}
            >
              <BillIcon />
              Pre-cuenta
            </button>
            <button
              className="primary-button"
              disabled={busy || pendingItems.length > 0 || order.items.filter((item) => !item.voided).length === 0}
              onClick={onRequestPayment}
            >
              <CashIcon />
              Cobrar
            </button>
          </div>
        </>
      )}
      {locked && canOperate(user) && (
        <div className="order-pay-panel">
          <button type="button" className="secondary-button" disabled={busy} onClick={onPreBill}>
            <BillIcon />
            Pre-cuenta
          </button>
          <p>El cliente confirma el importe. Elige el método y cobra {money.format(order.total)}.</p>
          {!cashShiftOpen && (
            <p className="cash-warning">
              Debe existir un turno abierto para cobrar.{" "}
              <button type="button" className="inline-link-button" onClick={onGoCash}>
                Ir a turnos de caja
              </button>
            </p>
          )}
          <div className="pay-method-grid" role="group" aria-label="Método de cobro">
            <button
              type="button"
              className="pay-method"
              aria-pressed={payMethod === "CASH"}
              onClick={() => onPayMethod("CASH")}
              disabled={busy || !cashShiftOpen}
            >
              <CashIcon />
              Efectivo
            </button>
            <button
              type="button"
              className="pay-method"
              aria-pressed={payMethod === "CARD"}
              onClick={() => onPayMethod("CARD")}
              disabled={busy || !cashShiftOpen}
            >
              <CardIcon />
              Tarjeta
            </button>
          </div>
          {payMethod === "CASH" && (
            <div className="pos-pay-fields">
              <label className="pos-pay-field">
                <span>Efectivo recibido</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={order.total}
                  step="0.01"
                  value={tendered}
                  onChange={(event) => onTendered(event.target.value)}
                  placeholder={String(order.total)}
                />
              </label>
              <p className="change-preview pos-pay-change">
                <span>Cambio estimado</span>
                <strong>{money.format(change)}</strong>
              </p>
            </div>
          )}
          <button
            className="primary-button"
            disabled={busy || !cashShiftOpen || !payMethod}
            onClick={onCollect}
          >
            <CashIcon />
            {payMethod
              ? `Cobrar ${money.format(order.total)} ${payMethod === "CASH" ? "en efectivo" : "con tarjeta"}`
              : "Elige método"}
          </button>
          <button className="secondary-button" disabled={busy} onClick={onCorrectPayment}>
            <EditIcon />
            Corregir cuenta
          </button>
        </div>
      )}
      {["OWNER", "MANAGER"].includes(user.role) && (manage || order.status === "OPEN") && (
        <form className="cancel-order-form" onSubmit={onCancel}>
          <input name="reason" maxLength={500} placeholder="Motivo de anulación" required />
          <button className="danger-button" disabled={busy}><OffIcon /> Anular pedido</button>
        </form>
      )}
    </article>
  );
}

function FilterChip({
  icon,
  label,
  count,
  pressed,
  tone,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  count: number;
  pressed: boolean;
  tone?: "ok" | "warn" | "bill";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`service-chip ${tone ? `tone-${tone}` : ""}`}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <span>{icon}{label}</span>
      <strong>{count}</strong>
    </button>
  );
}

function StatusGlyph({ status, pending }: { status: RestaurantOrder["status"]; pending?: boolean }) {
  if (pending && status === "OPEN") return <WaitIcon />;
  if (status === "WAITING_PAYMENT") return <BillIcon />;
  if (status === "OPEN") return <ActiveIcon />;
  return <ListIcon />;
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

function ActiveIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="7.5" />
      <path d="M8.2 12.2 10.8 15l5-6" />
    </svg>
  );
}

function UnpaidIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="6" width="14" height="12" rx="2" />
      <path d="M5 10h14M9 14h3" />
    </svg>
  );
}

function WaitIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 4h10M7 20h10M8 4c0 5 8 5 8 10v6M8 20v-6c0-5 8-5 8-10" />
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

function ServiceIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 8h13l-1.2 9H8.2Z" />
      <path d="M9 8V6.5A3 3 0 0 1 12 3.5 3 3 0 0 1 15 6.5V8" />
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

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 6v12M6 12h12" />
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

function KitchenIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 11h14v8H5Z" />
      <path d="M8 11V7h8v4M9 15h6" />
    </svg>
  );
}

function BarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 5h10l-1.2 9H8.2Z" />
      <path d="M12 14v5M9 19h6" />
    </svg>
  );
}

function isDrinkItem(item: RestaurantOrder["items"][number], products: Product[]) {
  const product = products.find((entry) => entry.id === item.productId);
  return itemGoesToBar(item, product);
}

function StationColumn({
  title,
  station,
  products,
  onMove,
  moveLabel,
}: {
  title: string;
  station: Product["prepStation"];
  products: Product[];
  onMove: (productId: string) => void;
  moveLabel: string;
}) {
  return (
    <section className="station-column" data-station={station}>
      <header>
        {station === "BAR" ? <BarIcon /> : <KitchenIcon />}
        <h3>{title}</h3>
        <span>{products.length}</span>
      </header>
      <ul>
        {products.length === 0 && <li className="station-empty">Sin productos</li>}
        {products.map((product) => (
          <li key={product.id}>
            <button type="button" onClick={() => onMove(product.id)}>
              <span>
                <strong>{product.name}</strong>
                <small>{product.categoryName}</small>
              </span>
              <em>{moveLabel}</em>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13a7.6 7.6 0 0 0 .1-2l2-1.5-2-3.5-2.4.6a7.7 7.7 0 0 0-1.7-1L15 3h-6l-.4 2.6a7.7 7.7 0 0 0-1.7 1L6.5 6 4.5 9.5 6.5 11a7.6 7.6 0 0 0 0 2l-2 1.5 2 3.5 2.4-.6a7.7 7.7 0 0 0 1.7 1L9 21h6l.4-2.6a7.7 7.7 0 0 0 1.7-1l2.4.6 2-3.5Z" />
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

function CashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="7" width="17" height="11" rx="2" />
      <circle cx="12" cy="12.5" r="2.2" />
    </svg>
  );
}

function CardIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="6" width="17" height="12" rx="2" />
      <path d="M3.5 10h17" />
    </svg>
  );
}

function canOperate(user: CurrentUser) {
  return ["OWNER", "MANAGER", "CASHIER", "SERVER"].includes(user.role);
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
}

function hasPendingKitchen(order: RestaurantOrder) {
  return order.status === "OPEN" && order.items.some((item) => !item.sentToKitchen && !item.voided);
}

function timeAgo(iso: string) {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `hace ${hours} h ${rest} min` : `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "hace 1 d" : `hace ${days} d`;
}
