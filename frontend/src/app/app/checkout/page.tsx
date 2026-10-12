"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import {
  Location,
  OrderPaymentSummary,
  RestaurantOrder,
  createPayment,
  getOrderPaymentSummary,
  listLocations,
  listOrders,
} from "@/lib/api";

const money = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

export default function CheckoutPage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const [orders, setOrders] = useState<RestaurantOrder[]>([]);
  const [orderId, setOrderId] = useState("");
  const [summary, setSummary] = useState<OrderPaymentSummary | null>(null);
  const [method, setMethod] = useState<"CASH" | "CARD">("CASH");
  const [amount, setAmount] = useState("");
  const [tendered, setTendered] = useState("");
  const [retryKey, setRetryKey] = useState("");
  const [notice, setNotice] = useState("");
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
    refreshOrders(locationId);
  }, [locationId]);

  useEffect(() => {
    if (!orderId) {
      setSummary(null);
      return;
    }
    getOrderPaymentSummary(orderId)
      .then((result) => {
        setSummary(result);
        setAmount(String(result.balance));
        setTendered("");
        setError("");
      })
      .catch((cause) => setError(cause.message));
  }, [orderId]);

  async function refreshOrders(currentLocationId = locationId) {
    try {
      const result = (await listOrders(currentLocationId))
        .filter((order) => order.status === "WAITING_PAYMENT");
      setOrders(result);
      const requestedId = new URLSearchParams(window.location.search).get("orderId");
      const nextId = result.some((order) => order.id === requestedId)
        ? requestedId!
        : result.some((order) => order.id === orderId)
          ? orderId
          : result[0]?.id ?? "";
      setOrderId(nextId);
      if (!nextId) setSummary(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar la caja");
    }
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!summary) return;
    const idempotencyKey = retryKey || crypto.randomUUID();
    setRetryKey(idempotencyKey);
    setBusy(true);
    setNotice("");
    try {
      const result = await createPayment({
        orderId: summary.orderId,
        method,
        amount: Number(amount),
        tenderedAmount: method === "CASH" ? Number(tendered) : undefined,
        externalReference: method === "CARD"
          ? String(new FormData(event.currentTarget).get("reference") ?? "")
          : undefined,
        idempotencyKey,
      });
      setRetryKey("");
      setSummary(result.summary);
      setAmount(String(result.summary.balance));
      setTendered("");
      setNotice(
        result.summary.status === "PAID"
          ? `Pedido cerrado. Cambio: ${money.format(result.payment.changeAmount)}`
          : `Pago registrado. Saldo: ${money.format(result.summary.balance)}`,
      );
      if (result.summary.status === "PAID") {
        await refreshOrders();
        setSummary(result.summary);
        setOrderId(result.summary.orderId);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo registrar el pago");
    } finally {
      setBusy(false);
    }
  }

  const estimatedChange = useMemo(() => {
    if (method !== "CASH") return 0;
    return Math.max(0, Number(tendered || 0) - Number(amount || 0));
  }, [amount, method, tendered]);

  return (
    <AppShell title="Caja">
      {() => (
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
          {notice && <p className="success" role="status">{notice}</p>}
          <div className="checkout-layout">
            <section className="checkout-orders">
              <h2>Cuentas pendientes</h2>
              {orders.map((order) => (
                <button
                  type="button"
                  className={order.id === orderId ? "checkout-order active" : "checkout-order"}
                  key={order.id}
                  onClick={() => {
                    setOrderId(order.id);
                    setNotice("");
                    setRetryKey("");
                  }}
                >
                  <span>{order.areaName} · {order.tableName}</span>
                  <strong>{money.format(order.total)}</strong>
                  <small>Pedido #{order.orderNumber}</small>
                </button>
              ))}
              {orders.length === 0 && (
                <p className="empty-state">No hay cuentas pendientes.</p>
              )}
            </section>
            {summary && (
              <section className="checkout-panel">
                <header>
                  <div>
                    <small>{summary.areaName} · Pedido #{summary.orderNumber}</small>
                    <h2>{summary.tableName}</h2>
                  </div>
                  <span className={`payment-state ${summary.status.toLowerCase()}`}>
                    {summary.status === "PAID" ? "Pagado" : "Pendiente"}
                  </span>
                </header>
                <dl className="payment-totals">
                  <div><dt>Total</dt><dd>{money.format(summary.total)}</dd></div>
                  <div><dt>Pagado</dt><dd>{money.format(summary.paid)}</dd></div>
                  <div className="balance"><dt>Saldo</dt><dd>{money.format(summary.balance)}</dd></div>
                </dl>
                {summary.status === "WAITING_PAYMENT" && (
                  <form className="payment-form" onSubmit={submitPayment}>
                    <label>
                      Método
                      <select value={method} onChange={(event) => setMethod(event.target.value as "CASH" | "CARD")}>
                        <option value="CASH">Efectivo</option>
                        <option value="CARD">Tarjeta</option>
                      </select>
                    </label>
                    <label>
                      Importe a aplicar
                      <input
                        type="number"
                        min="0.01"
                        max={summary.balance}
                        step="0.01"
                        value={amount}
                        onChange={(event) => setAmount(event.target.value)}
                        required
                      />
                    </label>
                    {method === "CASH" ? (
                      <label>
                        Efectivo recibido
                        <input
                          type="number"
                          min={amount || "0.01"}
                          step="0.01"
                          value={tendered}
                          onChange={(event) => setTendered(event.target.value)}
                          required
                        />
                      </label>
                    ) : (
                      <label>
                        Referencia (opcional)
                        <input name="reference" maxLength={120} />
                      </label>
                    )}
                    <div className="change-preview">
                      <span>Cambio estimado</span>
                      <strong>{money.format(estimatedChange)}</strong>
                    </div>
                    <button className="primary-button" disabled={busy}>
                      {busy ? "Registrando…" : "Registrar pago"}
                    </button>
                  </form>
                )}
                {summary.payments.length > 0 && (
                  <div className="payment-history">
                    <h3>Pagos registrados</h3>
                    {summary.payments.map((payment) => (
                      <div key={payment.id}>
                        <span>{payment.method === "CASH" ? "Efectivo" : "Tarjeta"}</span>
                        <strong>{money.format(payment.amount)}</strong>
                        <time>{new Date(payment.paidAt).toLocaleString("es-ES")}</time>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}
