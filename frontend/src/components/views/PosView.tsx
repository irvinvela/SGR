"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useAppNavigation } from "@/components/AppShell";
import {
  CurrentUser,
  DiningArea,
  DiningTable,
  Location,
  MenuCategory,
  OrderItem,
  Product,
  RestaurantOrder,
  addOrderItem,
  correctOrderPayment,
  createPayment,
  editOrderItem,
  getCurrentCashShift,
  getOrderPaymentSummary,
  listAreas,
  listCategories,
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

const tableLabels: Record<DiningTable["status"], string> = {
  FREE: "Libre",
  OCCUPIED: "Ocupada",
  WAITING_PAYMENT: "Cuenta",
  OUT_OF_SERVICE: "Fuera",
  RESERVED: "Reserva",
};

type Pane = "tables" | "menu" | "ticket";

export default function PosView() {
  const { user, selectedOrderId, selectedTableId, navigate } = useAppNavigation();
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const [areas, setAreas] = useState<DiningArea[]>([]);
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<RestaurantOrder[]>([]);
  const [areaId, setAreaId] = useState("all");
  const [categoryId, setCategoryId] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [pane, setPane] = useState<Pane>("tables");
  const [cashShiftOpen, setCashShiftOpen] = useState(false);
  const [payMethod, setPayMethod] = useState<"CASH" | "CARD" | null>(null);
  const [tendered, setTendered] = useState("");
  const [retryKeys, setRetryKeys] = useState<Record<string, string>>({});
  const [payRetryKey, setPayRetryKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [noteDraft, setNoteDraft] = useState<{ product?: Product; item?: OrderItem } | null>(null);
  const [noteText, setNoteText] = useState("");
  const appliedNav = useRef("");
  const pressTimer = useRef<number | null>(null);

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
    const key = `${selectedOrderId ?? ""}:${selectedTableId ?? ""}`;
    if (!key.replace(":", "") || appliedNav.current === key) return;
    if (selectedOrderId) {
      setSelectedId(selectedOrderId);
      setPane("ticket");
      appliedNav.current = key;
      return;
    }
    if (!selectedTableId || !tables.length) return;
    const order = orders.find((item) => item.tableId === selectedTableId);
    if (order) {
      setSelectedId(order.id);
      setPane("menu");
    } else if (tables.some((table) => table.id === selectedTableId && (table.status === "FREE" || table.status === "RESERVED"))) {
      openTable(selectedTableId).catch(() => undefined);
    }
    appliedNav.current = key;
  }, [orders, selectedOrderId, selectedTableId, tables]);

  async function refresh(currentLocationId = locationId) {
    try {
      const [areaResult, tableResult, categoryResult, productResult, orderResult, shiftResult] = await Promise.all([
        listAreas(currentLocationId),
        listTables(currentLocationId),
        listCategories(currentLocationId),
        listProducts(currentLocationId),
        listOrders(currentLocationId),
        getCurrentCashShift(currentLocationId),
      ]);
      setAreas(areaResult);
      setTables(tableResult);
      setCategories(categoryResult);
      setProducts(productResult.filter((product) => product.available));
      setOrders(orderResult);
      setCashShiftOpen(Boolean(shiftResult.shift));
      setAreaId((current) => (
        current === "all" || areaResult.some((area) => area.id === current) ? current : "all"
      ));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar el punto de venta");
    }
  }

  const orderByTable = useMemo(
    () => new Map(orders.map((order) => [order.tableId, order])),
    [orders],
  );
  const selected = orders.find((order) => order.id === selectedId) ?? null;
  const visibleTables = tables.filter((table) => (
    table.status !== "OUT_OF_SERVICE"
    && (areaId === "all" || table.areaId === areaId)
  ));
  const visibleProducts = products.filter((product) => {
    if (categoryId !== "all" && product.categoryId !== categoryId) return false;
    if (!query.trim()) return true;
    return normalizeSearch(`${product.name} ${product.sku} ${product.categoryName}`).includes(normalizeSearch(query));
  });
  const pendingCount = selected
    ? selected.items.filter((item) => !item.sentToKitchen && !item.voided).length
    : 0;
  const locked = selected?.status === "WAITING_PAYMENT";
  const change = selected
    ? Math.max(0, Number(tendered || selected.total) - selected.total)
    : 0;

  async function openTable(tableId: string) {
    setBusy(true);
    try {
      const created = await openOrder({
        locationId,
        tableId,
        guestCount: 2,
      });
      setNotice("Mesa abierta.");
      await refresh();
      setSelectedId(created.id);
      setPane("menu");
      setPayMethod(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo abrir la mesa");
    } finally {
      setBusy(false);
    }
  }

  async function selectTable(table: DiningTable) {
    setError("");
    const order = orderByTable.get(table.id);
    if (order) {
      setSelectedId(order.id);
      setPayMethod(null);
      setTendered("");
      setPane(order.status === "WAITING_PAYMENT" ? "ticket" : "menu");
      return;
    }
    if (table.status === "FREE" || table.status === "RESERVED") await openTable(table.id);
  }

  async function addProduct(product: Product, kitchenNote?: string) {
    if (!selected) {
      setError("Selecciona o abre una mesa para añadir productos.");
      setPane("tables");
      return;
    }
    if (selected.status !== "OPEN") {
      setError("Corrige la cuenta antes de añadir productos.");
      setPane("ticket");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const note = kitchenNote?.trim() || undefined;
      const existing = selected.items.find((item) => (
        item.productId === product.id
        && !item.sentToKitchen
        && !item.voided
        && (item.kitchenNote ?? "") === (note ?? "")
      ));
      if (existing) {
        await editOrderItem({
          itemId: existing.id,
          quantity: existing.quantity + 1,
          kitchenNote: existing.kitchenNote,
          expectedVersion: existing.version,
        });
      } else {
        await addOrderItem({
          orderId: selected.id,
          productId: product.id,
          quantity: 1,
          kitchenNote: note,
        });
      }
      setNoteDraft(null);
      setNoteText("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo añadir el producto");
    } finally {
      setBusy(false);
    }
  }

  function cancelPress() {
    if (pressTimer.current) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }

  function startProductPress(product: Product) {
    cancelPress();
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      setNoteDraft({ product });
      setNoteText("");
    }, 450);
  }

  function finishProductPress(product: Product) {
    if (pressTimer.current) {
      cancelPress();
      addProduct(product);
    }
  }

  async function saveNote(event: FormEvent) {
    event.preventDefault();
    if (noteDraft?.product) {
      await addProduct(noteDraft.product, noteText);
      return;
    }
    if (!noteDraft?.item || !selected) return;
    setBusy(true);
    try {
      await editOrderItem({
        itemId: noteDraft.item.id,
        quantity: noteDraft.item.quantity,
        kitchenNote: noteText.trim(),
        expectedVersion: noteDraft.item.version,
      });
      setNoteDraft(null);
      setNoteText("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar la nota");
    } finally {
      setBusy(false);
    }
  }

  async function changeQty(item: RestaurantOrder["items"][number], delta: number) {
    if (!selected || selected.status !== "OPEN" || item.sentToKitchen || item.voided) return;
    const next = item.quantity + delta;
    setBusy(true);
    try {
      if (next <= 0) {
        await voidOrderItem({
          itemId: item.id,
          reason: "Retirada en punto de venta",
          expectedVersion: item.version,
        });
      } else {
        await editOrderItem({
          itemId: item.id,
          quantity: next,
          kitchenNote: item.kitchenNote,
          expectedVersion: item.version,
        });
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo actualizar la línea");
    } finally {
      setBusy(false);
    }
  }

  async function sendKitchen() {
    if (!selected) return;
    const idempotencyKey = retryKeys[selected.id] ?? crypto.randomUUID();
    setRetryKeys((current) => ({ ...current, [selected.id]: idempotencyKey }));
    setBusy(true);
    try {
      await sendOrderToKitchen(selected.id, idempotencyKey);
      setRetryKeys((current) => {
        const next = { ...current };
        delete next[selected.id];
        return next;
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo enviar a cocina");
    } finally {
      setBusy(false);
    }
  }

  async function requestBill() {
    if (!selected) return;
    setBusy(true);
    try {
      await requestOrderPayment(selected.id, selected.version);
      setNotice("Cuenta solicitada. El pedido queda bloqueado.");
      await refresh();
      setPane("ticket");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo solicitar la cuenta");
    } finally {
      setBusy(false);
    }
  }

  async function correctBill() {
    if (!selected) return;
    setBusy(true);
    try {
      await correctOrderPayment(selected.id, selected.version);
      setPayMethod(null);
      setTendered("");
      setNotice("Cuenta corregida.");
      await refresh();
      setPane("menu");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo corregir la cuenta");
    } finally {
      setBusy(false);
    }
  }

  async function collect() {
    if (!selected || !payMethod) return;
    const idempotencyKey = payRetryKey || crypto.randomUUID();
    setPayRetryKey(idempotencyKey);
    setBusy(true);
    try {
      const summary = await getOrderPaymentSummary(selected.id);
      const result = await createPayment({
        orderId: selected.id,
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
      if (result.summary.status === "PAID") {
        setSelectedId("");
        setPane("tables");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo registrar el cobro");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (selectedId && !orders.some((order) => order.id === selectedId)) {
      setSelectedId("");
      setPayMethod(null);
    }
  }, [orders, selectedId]);

  return (
    <div className="pos-view">
      <div className="toolbar tables-toolbar">
        <label>
          Local
          <select
            value={locationId}
            onChange={(event) => {
              setLocationId(event.target.value);
              setSelectedId("");
              setQuery("");
              setCategoryId("all");
              setPane("tables");
            }}
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>{location.name}</option>
            ))}
          </select>
        </label>
        {!cashShiftOpen && (
          <p className="pos-shift-hint">
            Sin turno abierto.{" "}
            <button type="button" className="inline-link-button" onClick={() => navigate("cash")}>
              Ir a turnos
            </button>
          </p>
        )}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}

      <div className={`pos-board pane-${pane}`}>
        <section className="pos-tables" aria-label="Mesas">
          <header className="pos-pane-head">
            <h2>Mesas</h2>
          </header>
          <div className="service-filters" role="group" aria-label="Salón">
            <button type="button" className="service-chip" aria-pressed={areaId === "all"} onClick={() => setAreaId("all")}>
              Todos
            </button>
            {areas.map((area) => (
              <button
                type="button"
                className="service-chip"
                key={area.id}
                aria-pressed={areaId === area.id}
                onClick={() => setAreaId(area.id)}
              >
                {area.name}
              </button>
            ))}
          </div>
          <div className="pos-table-grid">
            {visibleTables.map((table) => {
              const order = orderByTable.get(table.id);
              const on = order?.id === selectedId;
              return (
                <button
                  type="button"
                  key={table.id}
                  className={`pos-table status-${table.status.toLowerCase()} ${on ? "sel" : ""}`}
                  disabled={busy}
                  onClick={() => selectTable(table)}
                >
                  <strong>{table.name}</strong>
                  <small>{table.areaName}</small>
                  <span className={`service-pill status-${table.status.toLowerCase()}`}>
                    {tableLabels[table.status]}
                  </span>
                  {order && <em>{money.format(order.total)}</em>}
                </button>
              );
            })}
          </div>
        </section>

        <section className="pos-menu" aria-label="Carta">
          <header className="pos-pane-head">
            <h2>Carta</h2>
            <small>Mantén pulsado para nota de cocina</small>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar producto"
              aria-label="Buscar producto"
            />
          </header>
          <div className="service-filters" role="group" aria-label="Categoría">
            <button type="button" className="service-chip" aria-pressed={categoryId === "all"} onClick={() => setCategoryId("all")}>
              Todas
            </button>
            {categories.map((category) => (
              <button
                type="button"
                className="service-chip"
                key={category.id}
                aria-pressed={categoryId === category.id}
                onClick={() => setCategoryId(category.id)}
              >
                {category.name}
              </button>
            ))}
          </div>
          <div className="pos-product-grid">
            {visibleProducts.map((product) => (
                <button
                  type="button"
                  className="pos-product"
                  key={product.id}
                  disabled={busy || !canOperate(user)}
                  onPointerDown={() => startProductPress(product)}
                  onPointerUp={() => finishProductPress(product)}
                  onPointerCancel={cancelPress}
                  onPointerLeave={cancelPress}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    cancelPress();
                    setNoteDraft({ product });
                    setNoteText("");
                  }}
                >
                <small>{product.categoryName}</small>
                <strong>{product.name}</strong>
                <span>{money.format(product.price)}</span>
              </button>
            ))}
            {visibleProducts.length === 0 && (
              <p className="empty-state">No hay productos para este filtro.</p>
            )}
          </div>
        </section>

        <section className="pos-ticket" aria-label="Pedido actual">
          <header className="pos-pane-head">
            <h2>{selected ? selected.tableName : "Pedido"}</h2>
            {selected && <span>#{selected.orderNumber}</span>}
          </header>
          {!selected && (
            <p className="empty-state">Toca una mesa libre para abrir pedido o una ocupada para continuar.</p>
          )}
          {selected && (
            <>
              <p className={`service-pill status-${selected.status.toLowerCase()}`}>
                {selected.status === "WAITING_PAYMENT" ? "Cuenta solicitada" : "Abierto"}
              </p>
              {locked && (
                <p className="order-lock-banner">Pedido bloqueado hasta cobrar o corregir la cuenta.</p>
              )}
              <ul className="pos-lines">
                {selected.items.filter((item) => !item.voided).map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>{item.productName}</strong>
                      <small>{item.sentToKitchen ? "Enviado" : "Sin enviar"} · {money.format(item.quantity * item.unitPrice)}</small>
                      {item.kitchenNote && <em>{item.kitchenNote}</em>}
                      {selected.status === "OPEN" && !item.sentToKitchen && (
                        <button
                          type="button"
                          className="inline-link-button"
                          disabled={busy}
                          onClick={() => {
                            setNoteDraft({ item });
                            setNoteText(item.kitchenNote ?? "");
                          }}
                        >
                          {item.kitchenNote ? "Editar nota" : "Nota de cocina"}
                        </button>
                      )}
                    </div>
                    {selected.status === "OPEN" && !item.sentToKitchen ? (
                      <div className="pos-qty">
                        <button type="button" disabled={busy} onClick={() => changeQty(item, -1)} aria-label="Quitar">−</button>
                        <output>{item.quantity}</output>
                        <button type="button" disabled={busy} onClick={() => changeQty(item, 1)} aria-label="Añadir">+</button>
                      </div>
                    ) : (
                      <output>{item.quantity}</output>
                    )}
                  </li>
                ))}
              </ul>
              <div className="pos-total">
                <span>Total</span>
                <strong>{money.format(selected.total)}</strong>
              </div>
              {selected.status === "OPEN" && canOperate(user) && (
                <div className="pos-actions">
                  <button className="primary-button" disabled={busy || pendingCount === 0} onClick={sendKitchen}>
                    {pendingCount > 0 ? `Enviar ${pendingCount} a cocina` : "Todo enviado"}
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy || pendingCount > 0 || selected.items.length === 0}
                    onClick={requestBill}
                  >
                    Solicitar cuenta
                  </button>
                </div>
              )}
              {locked && canOperate(user) && (
                <div className="order-pay-panel">
                  {!cashShiftOpen && (
                    <p className="cash-warning">
                      Abre un turno para cobrar.{" "}
                      <button type="button" className="inline-link-button" onClick={() => navigate("cash")}>
                        Ir a turnos
                      </button>
                    </p>
                  )}
                  <div className="pay-method-grid">
                    <button type="button" className="pay-method" aria-pressed={payMethod === "CASH"} disabled={busy || !cashShiftOpen} onClick={() => setPayMethod("CASH")}>
                      Efectivo
                    </button>
                    <button type="button" className="pay-method" aria-pressed={payMethod === "CARD"} disabled={busy || !cashShiftOpen} onClick={() => setPayMethod("CARD")}>
                      Tarjeta
                    </button>
                  </div>
                  {payMethod === "CASH" && (
                    <label>
                      Efectivo recibido
                      <input type="number" min={selected.total} step="0.01" value={tendered} onChange={(event) => setTendered(event.target.value)} />
                    </label>
                  )}
                  {payMethod === "CASH" && (
                    <p className="change-preview">
                      <span>Cambio</span>
                      <strong>{money.format(change)}</strong>
                    </p>
                  )}
                  <button className="primary-button" disabled={busy || !cashShiftOpen || !payMethod} onClick={collect}>
                    {payMethod ? `Cobrar ${money.format(selected.total)}` : "Elige método"}
                  </button>
                  <button className="secondary-button" disabled={busy} onClick={correctBill}>
                    Corregir cuenta
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {noteDraft && (
        <div
          className="creation-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !busy) setNoteDraft(null);
          }}
        >
          <section className="creation-modal" role="dialog" aria-modal="true" aria-labelledby="pos-note-title">
            <header>
              <div className="creation-modal-title">
                <div>
                  <p>Cocina</p>
                  <h2 id="pos-note-title">
                    {noteDraft.product ? `Nota · ${noteDraft.product.name}` : "Nota de cocina"}
                  </h2>
                </div>
              </div>
              <button type="button" className="creation-modal-close" aria-label="Cerrar" onClick={() => setNoteDraft(null)} disabled={busy}>
                ×
              </button>
            </header>
            <form className="creation-modal-form" onSubmit={saveNote}>
              <label>
                Nota para cocina
                <input
                  value={noteText}
                  onChange={(event) => setNoteText(event.target.value)}
                  maxLength={500}
                  autoFocus
                  placeholder="Ej. sin cebolla, extra ají"
                />
              </label>
              <div className="creation-modal-actions">
                <button type="button" className="secondary-button" onClick={() => setNoteDraft(null)} disabled={busy}>
                  Cancelar
                </button>
                <button className="primary-button" disabled={busy}>
                  {noteDraft.product ? "Añadir" : "Guardar"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      <nav className="pos-mobile-nav" aria-label="Punto de venta">
        <button type="button" aria-pressed={pane === "tables"} onClick={() => setPane("tables")}>Mesas</button>
        <button type="button" aria-pressed={pane === "menu"} onClick={() => setPane("menu")}>Carta</button>
        <button type="button" aria-pressed={pane === "ticket"} onClick={() => setPane("ticket")}>
          Pedido{selected ? ` · ${money.format(selected.total)}` : ""}
        </button>
      </nav>
    </div>
  );
}

function canOperate(user: CurrentUser) {
  return ["OWNER", "MANAGER", "CASHIER", "SERVER"].includes(user.role);
}

function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
}
