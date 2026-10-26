"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useAppNavigation } from "@/components/AppShell";
import {
  CurrentUser,
  DiningTable,
  Location,
  Product,
  RestaurantOrder,
  addOrderItem,
  cancelOrder,
  correctOrderPayment,
  createPayment,
  editOrderItem,
  getCurrentCashShift,
  getOrderPaymentSummary,
  listLocations,
  listOrders,
  listProducts,
  listTables,
  openOrder,
  requestOrderPayment,
  sendOrderToKitchen,
  voidOrderItem,
} from "@/lib/api";

const money = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

type OrderChip = "todos" | "activos" | "cuenta";

const statusLabels: Record<RestaurantOrder["status"], string> = {
  OPEN: "Abierto",
  WAITING_PAYMENT: "Cuenta solicitada",
  PAID: "Pagado",
  PARTIALLY_REFUNDED: "Reembolsado parcial",
  REFUNDED: "Reembolsado",
  CANCELLED: "Anulado",
};

export default function OrdersView() {
  const { user, selectedOrderId, selectedTableId, navigate } = useAppNavigation();
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<RestaurantOrder[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [chip, setChip] = useState<OrderChip>("activos");
  const [query, setQuery] = useState("");
  const [openModal, setOpenModal] = useState(false);
  const [openTableId, setOpenTableId] = useState("");
  const [cashShiftOpen, setCashShiftOpen] = useState(false);
  const [payMethod, setPayMethod] = useState<"CASH" | "CARD" | null>(null);
  const [tendered, setTendered] = useState("");
  const [retryKeys, setRetryKeys] = useState<Record<string, string>>({});
  const [payRetryKey, setPayRetryKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const appliedNav = useRef("");

  useEffect(() => {
    listLocations()
      .then((result) => {
        setLocations(result);
        if (result[0]) setLocationId(result[0].id);
      })
      .catch((cause) => setError(cause.message));
  }, []);

  useEffect(() => {
    if (locationId) refresh(locationId);
  }, [locationId]);

  useEffect(() => {
    if (!openModal) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) setOpenModal(false);
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [openModal, busy]);

  useEffect(() => {
    const key = `${selectedOrderId ?? ""}:${selectedTableId ?? ""}`;
    if (!key.replace(":", "") || appliedNav.current === key) return;
    if (selectedOrderId) {
      setSelectedId(selectedOrderId);
      if (orders.some((order) => order.id === selectedOrderId && order.status === "WAITING_PAYMENT")) {
        setChip("cuenta");
      }
      appliedNav.current = key;
      return;
    }
    if (!selectedTableId || !tables.length) return;
    const order = orders.find((item) => item.tableId === selectedTableId);
    if (order) {
      setSelectedId(order.id);
      setChip(order.status === "WAITING_PAYMENT" ? "cuenta" : "activos");
    } else if (tables.some((table) => table.id === selectedTableId && table.status === "FREE")) {
      setOpenTableId(selectedTableId);
      setOpenModal(true);
    }
    appliedNav.current = key;
  }, [orders, selectedOrderId, selectedTableId, tables]);

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

  async function sendKitchen(orderId: string) {
    const idempotencyKey = retryKeys[orderId] ?? crypto.randomUUID();
    setRetryKeys((current) => ({ ...current, [orderId]: idempotencyKey }));
    setBusy(true);
    try {
      await sendOrderToKitchen(orderId, idempotencyKey);
      setRetryKeys((current) => {
        const next = { ...current };
        delete next[orderId];
        return next;
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo enviar la ronda");
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
      await requestOrderPayment(order.id, order.version);
      setNotice("Cuenta solicitada. El pedido queda bloqueado hasta cobrar o corregir.");
      await refresh();
      setChip("cuenta");
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
      await refresh();
      if (result.summary.status === "PAID") setSelectedId("");
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

  const freeTables = tables.filter((table) => table.status === "FREE");
  const counts = useMemo(() => ({
    todos: orders.length,
    activos: orders.filter((order) => order.status === "OPEN").length,
    cuenta: orders.filter((order) => order.status === "WAITING_PAYMENT").length,
  }), [orders]);
  const visible = useMemo(() => {
    const normalized = normalizeSearch(query);
    return orders.filter((order) => {
      if (chip === "activos" && order.status !== "OPEN") return false;
      if (chip === "cuenta" && order.status !== "WAITING_PAYMENT") return false;
      if (!normalized) return true;
      return normalizeSearch([
        String(order.orderNumber),
        order.tableName,
        order.areaName,
      ].join(" ")).includes(normalized);
    });
  }, [chip, orders, query]);
  const selected = orders.find((order) => order.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId && !orders.some((order) => order.id === selectedId)) {
      setSelectedId("");
      setPayMethod(null);
    }
  }, [orders, selectedId]);

  return (
    <>
      <div className="toolbar tables-toolbar">
        <label>
          Local
          <select
            value={locationId}
            onChange={(event) => {
              setLocationId(event.target.value);
              setSelectedId("");
              setQuery("");
              setChip("activos");
            }}
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>{location.name}</option>
            ))}
          </select>
        </label>
        <label className="catalog-search">
          Buscar pedido
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Número o mesa"
          />
        </label>
        {canOperate(user) && (
          <button
            type="button"
            className="toolbar-action-button"
            onClick={() => {
              setError("");
              setOpenTableId(freeTables[0]?.id ?? "");
              setOpenModal(true);
            }}
            disabled={!locationId || freeTables.length === 0}
          >
            Abrir mesa
          </button>
        )}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}
      <div className="service-filters" role="group" aria-label="Filtro de pedidos">
        <FilterChip pressed={chip === "todos"} label="Todos" count={counts.todos} onClick={() => setChip("todos")} />
        <FilterChip pressed={chip === "activos"} label="Activos" count={counts.activos} tone="ok" onClick={() => setChip("activos")} />
        <FilterChip pressed={chip === "cuenta"} label="Cuenta solicitada" count={counts.cuenta} tone="bill" onClick={() => setChip("cuenta")} />
      </div>
      <div className="orders-workspace">
        <section className="order-list" aria-label="Pedidos">
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
              <span className="r2">{order.areaName} · Pedido #{order.orderNumber}</span>
              <span className={`service-pill status-${order.status.toLowerCase()}`}>
                {statusLabels[order.status]}
              </span>
            </button>
          ))}
          {locationId && orders.length === 0 && (
            <p className="empty-state">No hay pedidos abiertos en este local.</p>
          )}
          {orders.length > 0 && visible.length === 0 && (
            <p className="empty-state">Ningún pedido coincide con estos filtros.</p>
          )}
        </section>
        <section className="order-workspace" aria-label="Detalle del pedido">
          {!selected && (
            <p className="empty-state">Selecciona un pedido o abre una mesa libre.</p>
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
              onEditItem={editItem}
              onVoidItem={voidItem}
              onRequestPayment={() => requestPayment(selected)}
              onCorrectPayment={() => correctPayment(selected)}
              onCollect={() => collectPayment(selected)}
              onCancel={(event) => cancel(event, selected.id)}
              onGoCash={() => navigate("cash")}
            />
          )}
        </section>
      </div>
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
                <select
                  name="tableId"
                  value={openTableId}
                  onChange={(event) => setOpenTableId(event.target.value)}
                  required
                >
                  <option value="">Seleccionar</option>
                  {freeTables.map((table) => (
                    <option key={table.id} value={table.id}>{table.areaName} · {table.name}</option>
                  ))}
                </select>
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
                  {busy ? "Abriendo…" : "Abrir pedido"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
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
  onEditItem,
  onVoidItem,
  onRequestPayment,
  onCorrectPayment,
  onCollect,
  onCancel,
  onGoCash,
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
  onEditItem: (event: FormEvent<HTMLFormElement>, item: RestaurantOrder["items"][number]) => void;
  onVoidItem: (event: FormEvent<HTMLFormElement>, item: RestaurantOrder["items"][number]) => void;
  onRequestPayment: () => void;
  onCorrectPayment: () => void;
  onCollect: () => void;
  onCancel: (event: FormEvent<HTMLFormElement>) => void;
  onGoCash: () => void;
}) {
  const pendingCount = order.items.filter((item) => !item.sentToKitchen && !item.voided).length;
  const locked = order.status === "WAITING_PAYMENT";
  const editable = canOperate(user) && order.status === "OPEN";
  const change = Math.max(0, Number(tendered || order.total) - order.total);

  return (
    <article className="order-card order-detail">
      <header className="order-card-header">
        <div>
          <small>{order.areaName} · Pedido #{order.orderNumber} · {order.guestCount} comensales</small>
          <h2>{order.tableName}</h2>
        </div>
        <div className="order-detail-head">
          <span className={`service-pill status-${order.status.toLowerCase()}`}>
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
                <button className="secondary-button" disabled={busy}>Actualizar</button>
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
            <select name="productId" required>
              <option value="">Añadir producto</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} · {money.format(product.price)}
                </option>
              ))}
            </select>
            <input name="quantity" type="number" min="0.001" step="0.001" defaultValue="1" required />
            <input name="kitchenNote" maxLength={500} placeholder="Nota de cocina" />
            <button className="secondary-button" disabled={busy}>Añadir</button>
          </form>
          <div className="order-detail-actions">
            <button
              className="primary-button"
              disabled={busy || pendingCount === 0}
              onClick={onSendKitchen}
            >
              {pendingCount > 0 ? `Enviar ${pendingCount} a cocina` : "Todo enviado"}
            </button>
            <button
              className="secondary-button"
              disabled={busy || pendingCount > 0 || order.items.length === 0}
              onClick={onRequestPayment}
            >
              Solicitar cuenta
            </button>
          </div>
        </>
      )}
      {locked && canOperate(user) && (
        <div className="order-pay-panel">
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
              Efectivo
            </button>
            <button
              type="button"
              className="pay-method"
              aria-pressed={payMethod === "CARD"}
              onClick={() => onPayMethod("CARD")}
              disabled={busy || !cashShiftOpen}
            >
              Tarjeta
            </button>
          </div>
          {payMethod === "CASH" && (
            <label>
              Efectivo recibido
              <input
                type="number"
                min={order.total}
                step="0.01"
                value={tendered}
                onChange={(event) => onTendered(event.target.value)}
                placeholder={String(order.total)}
              />
            </label>
          )}
          {payMethod === "CASH" && (
            <p className="change-preview">
              <span>Cambio estimado</span>
              <strong>{money.format(change)}</strong>
            </p>
          )}
          <button
            className="primary-button"
            disabled={busy || !cashShiftOpen || !payMethod}
            onClick={onCollect}
          >
            {payMethod
              ? `Confirmar cobro de ${money.format(order.total)} ${payMethod === "CASH" ? "en efectivo" : "con tarjeta"}`
              : "Selecciona un método"}
          </button>
          <button className="secondary-button" disabled={busy} onClick={onCorrectPayment}>
            Corregir cuenta
          </button>
        </div>
      )}
      {["OWNER", "MANAGER"].includes(user.role) && (
        <form className="cancel-order-form" onSubmit={onCancel}>
          <input name="reason" maxLength={500} placeholder="Motivo de anulación" required />
          <button className="danger-button" disabled={busy}>Anular pedido</button>
        </form>
      )}
    </article>
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
      <span>{label}</span>
      <strong>{count}</strong>
    </button>
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
