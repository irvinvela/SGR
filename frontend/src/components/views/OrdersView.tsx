"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAppNavigation } from "@/components/AppShell";
import {
  CurrentUser,
  DiningTable,
  Location,
  Product,
  RestaurantOrder,
  addOrderItem,
  cancelOrder,
  editOrderItem,
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

export default function OrdersView() {
  const { user, navigate } = useAppNavigation();
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<RestaurantOrder[]>([]);
  const [retryKeys, setRetryKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
    refresh(locationId);
  }, [locationId]);

  async function refresh(currentLocationId = locationId) {
    try {
      const [tableResult, productResult, orderResult] = await Promise.all([
        listTables(currentLocationId),
        listProducts(currentLocationId),
        listOrders(currentLocationId),
      ]);
      setTables(tableResult);
      setProducts(productResult.filter((product) => product.available));
      setOrders(orderResult);
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
      await openOrder({
        locationId,
        tableId: String(form.get("tableId")),
        guestCount: Number(form.get("guestCount")),
        notes: String(form.get("notes")),
      });
      formElement.reset();
      await refresh();
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
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo solicitar la cuenta");
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
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo anular el pedido");
    } finally {
      setBusy(false);
    }
  }

  const freeTables = tables.filter((table) => table.status === "FREE");

  return (
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
      {canOperate(user) && (
        <form className="order-open-form" onSubmit={createOrder}>
          <h2>Abrir mesa</h2>
          <label>
            Mesa libre
            <select name="tableId" required>
              <option value="">Seleccionar</option>
              {freeTables.map((table) => (
                <option key={table.id} value={table.id}>{table.areaName} · {table.name}</option>
              ))}
            </select>
          </label>
          <label>Comensales<input name="guestCount" type="number" min={1} max={999} defaultValue={2} required /></label>
          <label>Nota<input name="notes" maxLength={500} /></label>
          <button className="primary-button" disabled={busy || freeTables.length === 0}>Abrir pedido</button>
        </form>
      )}
      <section className="orders-grid">
        {orders.map((order) => {
          const pendingCount = order.items.filter((item) => !item.sentToKitchen).length;
          return (
            <article className="order-card" key={order.id}>
              <header className="order-card-header">
                <div>
                  <small>{order.areaName} · Pedido #{order.orderNumber}</small>
                  <h2>{order.tableName}</h2>
                </div>
                <strong>{money.format(order.total)}</strong>
              </header>
              <ul className="order-items">
                {order.items.map((item) => (
                  <li key={item.id}>
                    <span>{item.quantity} × {item.productName}</span>
                    <span>{money.format(item.quantity * item.unitPrice)}</span>
                    <small>{item.sentToKitchen ? "Enviado" : "Pendiente"}</small>
                    {item.kitchenNote && <em>{item.kitchenNote}</em>}
                    {order.status === "OPEN" && !item.sentToKitchen && canOperate(user) && (
                      <form className="item-edit-form" onSubmit={(event) => editItem(event, item)}>
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
                    {order.status === "OPEN"
                      && (!item.sentToKitchen || ["OWNER", "MANAGER"].includes(user.role)) && (
                      <form className="item-void-form" onSubmit={(event) => voidItem(event, item)}>
                        <input
                          name="reason"
                          maxLength={500}
                          placeholder={item.sentToKitchen
                            ? "Motivo obligatorio para cocina"
                            : "Motivo de retirada"}
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
              {canOperate(user) && order.status === "OPEN" && (
                <>
                  <form className="inline-order-form" onSubmit={(event) => addItem(event, order.id)}>
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
                  <button
                    className="primary-button"
                    disabled={busy || pendingCount === 0}
                    onClick={() => sendKitchen(order.id)}
                  >
                    {pendingCount > 0 ? `Enviar ${pendingCount} a cocina` : "Todo enviado"}
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy || pendingCount > 0 || order.items.length === 0}
                    onClick={() => requestPayment(order)}
                  >
                    Solicitar cuenta
                  </button>
                </>
              )}
              {order.status === "WAITING_PAYMENT" && (
                <button
                  type="button"
                  className="checkout-link"
                  onClick={() => navigate("checkout", { orderId: order.id })}
                >
                  Cobrar pedido
                </button>
              )}
              {["OWNER", "MANAGER"].includes(user.role) && (
                <form className="cancel-order-form" onSubmit={(event) => cancel(event, order.id)}>
                  <input name="reason" maxLength={500} placeholder="Motivo de anulación" required />
                  <button className="danger-button" disabled={busy}>Anular pedido</button>
                </form>
              )}
            </article>
          );
        })}
      </section>
      {locationId && orders.length === 0 && (
        <p className="empty-state">No hay pedidos abiertos en este local.</p>
      )}
    </>
  );
}

function canOperate(user: CurrentUser) {
  return ["OWNER", "MANAGER", "CASHIER", "SERVER"].includes(user.role);
}
