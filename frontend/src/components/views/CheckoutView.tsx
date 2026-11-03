"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAppNavigation } from "@/components/AppShell";
import {
  OrderPaymentSummary,
  RestaurantOrder,
  createPayment,
  createRefund,
  getCurrentCashShift,
  getOrderPaymentSummary,
  listOrders,
} from "@/lib/api";

const money = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

export default function CheckoutView() {
  const { user, selectedOrderId, selectedTableId, navigate, locationId } = useAppNavigation();
  const [orders, setOrders] = useState<RestaurantOrder[]>([]);
  const [orderId, setOrderId] = useState("");
  const [summary, setSummary] = useState<OrderPaymentSummary | null>(null);
  const [cashShiftOpen, setCashShiftOpen] = useState(false);
  const [method, setMethod] = useState<"CASH" | "CARD">("CASH");
  const [amount, setAmount] = useState("");
  const [tendered, setTendered] = useState("");
  const [retryKey, setRetryKey] = useState("");
  const [refundRetryKey, setRefundRetryKey] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!locationId) return;
    refreshOrders(locationId);
  }, [locationId, selectedOrderId]);

  async function loadSummary(id: string) {
    const result = await getOrderPaymentSummary(id);
    setSummary(result);
    setAmount(String(result.balance));
    setTendered("");
    setError("");
    return result;
  }

  async function refreshOrders(currentLocationId = locationId, keepPaidId?: string) {
    try {
      const [orderResult, shiftResult] = await Promise.all([
        listOrders(currentLocationId),
        getCurrentCashShift(currentLocationId),
      ]);
      const result = orderResult.filter((order) => order.status === "WAITING_PAYMENT");
      setCashShiftOpen(Boolean(shiftResult.shift));
      setOrders(result);
      const nextId = keepPaidId
        ?? (result.some((order) => order.id === selectedOrderId) ? selectedOrderId!
          : result.some((order) => order.id === orderId) ? orderId
            : result[0]?.id ?? "");
      setOrderId(nextId);
      if (keepPaidId) return;
      if (!nextId) {
        setSummary(null);
        return;
      }
      await loadSummary(nextId);
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
        await refreshOrders(locationId, result.summary.orderId);
        setSummary(result.summary);
        setOrderId(result.summary.orderId);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo registrar el pago");
    } finally {
      setBusy(false);
    }
  }

  async function refundPayment(
    event: FormEvent<HTMLFormElement>,
    paymentId: string,
  ) {
    event.preventDefault();
    if (!summary) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const idempotencyKey = refundRetryKey || crypto.randomUUID();
    setRefundRetryKey(idempotencyKey);
    setBusy(true);
    try {
      await createRefund({
        paymentId,
        amount: Number(form.get("amount")),
        reason: String(form.get("reason")),
        idempotencyKey,
      });
      const nextSummary = await getOrderPaymentSummary(summary.orderId);
      setSummary(nextSummary);
      setAmount(String(nextSummary.balance));
      setRefundRetryKey("");
      formElement.reset();
      setNotice("Reembolso registrado.");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo registrar el reembolso");
    } finally {
      setBusy(false);
    }
  }

  const estimatedChange = useMemo(() => {
    if (method !== "CASH") return 0;
    return Math.max(0, Number(tendered || 0) - Number(amount || 0));
  }, [amount, method, tendered]);

  return (
    <div className="checkout-view">
      <div className="pos-toolbar cash-topbar">
        <div className="pos-chip-row" role="status">
          <span className="pos-chip" aria-pressed={cashShiftOpen}>
            {cashShiftOpen ? "Turno abierto" : "Sin turno"}
          </span>
          <span className="pos-chip" aria-pressed={orders.length > 0}>
            {orders.length} {orders.length === 1 ? "cuenta" : "cuentas"}
          </span>
        </div>
        <div className="cash-topbar-actions">
          {(selectedOrderId || selectedTableId) && (
            <button
              type="button"
              className="pos-shift-button"
              onClick={() => navigate("pos", { orderId: selectedOrderId, tableId: selectedTableId })}
            >
              Volver al TPV
            </button>
          )}
          <button type="button" className="pos-shift-button" onClick={() => navigate("cash")}>
            Turnos de caja
          </button>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="pos-pane-hint cash-notice" role="status">{notice}</p>}
      {!cashShiftOpen && locationId && (
        <p className="cash-warning">
          Debe existir un turno abierto para cobrar.
        </p>
      )}

      <div className="cash-board checkout-board">
        <section className="cash-pane">
          <div className="pos-pane-head">
            <h2><span>1</span> Cuentas</h2>
          </div>
          <div className="cash-ticket-list">
            {orders.map((order) => (
              <button
                type="button"
                className={order.id === orderId ? "checkout-order-card sel" : "checkout-order-card"}
                key={order.id}
                onClick={() => {
                  setOrderId(order.id);
                  setNotice("");
                  setRetryKey("");
                  void loadSummary(order.id);
                }}
              >
                <strong>{order.tableName}</strong>
                <span>{order.areaName} · Pedido #{order.orderNumber}</span>
                <b>{money.format(order.total)}</b>
              </button>
            ))}
            {orders.length === 0 && (
              <p className="pos-pane-hint">No hay cuentas pendientes.</p>
            )}
          </div>
        </section>

        <section className="cash-pane">
          <div className="pos-pane-head">
            <h2><span>2</span> Cobro</h2>
            {summary && (
              <span className={`service-pill ${summary.status === "PAID" ? "status-open" : "status-waiting_payment"}`}>
                {summary.status === "PAID" ? "Pagado" : "Cuenta solicitada"}
              </span>
            )}
          </div>
          {summary ? (
            <>
              <p className="pos-pane-hint">{summary.areaName} · {summary.tableName} · Pedido #{summary.orderNumber}</p>
              <div className="cash-metric-grid checkout-totals">
                <div className="cash-tile">
                  <span>Total</span>
                  <strong>{money.format(summary.total)}</strong>
                </div>
                <div className="cash-tile">
                  <span>Pagado</span>
                  <strong>{money.format(summary.paid)}</strong>
                </div>
                <div className="cash-tile emphasized">
                  <span>Saldo</span>
                  <strong>{money.format(summary.balance)}</strong>
                </div>
              </div>
              {summary.status === "WAITING_PAYMENT" && cashShiftOpen && (
                <form className="checkout-pay-form" onSubmit={submitPayment}>
                  <div className="pos-chip-row">
                    <button type="button" className="pos-chip" aria-pressed={method === "CASH"} onClick={() => setMethod("CASH")}>
                      Efectivo
                    </button>
                    <button type="button" className="pos-chip" aria-pressed={method === "CARD"} onClick={() => setMethod("CARD")}>
                      Tarjeta
                    </button>
                  </div>
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
                  <div className="cash-tile emphasized">
                    <span>Cambio estimado</span>
                    <strong>{money.format(estimatedChange)}</strong>
                  </div>
                  <button className="cash-pane-action primary" disabled={busy}>
                    {busy ? "Registrando…" : "Registrar pago"}
                  </button>
                </form>
              )}
              {["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(summary.status)
                && ["OWNER", "MANAGER", "CASHIER"].includes(user.role) && (
                <button
                  type="button"
                  className="cash-pane-action"
                  onClick={() => navigate("sales", { orderId: summary.orderId })}
                >
                  Ver comprobante
                </button>
              )}
            </>
          ) : (
            <p className="pos-pane-hint">Selecciona una cuenta para cobrar.</p>
          )}
        </section>

        <section className="cash-pane cash-pane-ticket">
          <div className="pos-pane-head">
            <h2><span>3</span> Pagos</h2>
          </div>
          <div className="cash-ticket-list">
            {summary && summary.payments.length > 0 ? summary.payments.map((payment) => (
              <article key={payment.id} className="cash-ticket-line">
                <div>
                  <strong>{payment.method === "CASH" ? "Efectivo" : "Tarjeta"}</strong>
                  <time>{new Date(payment.paidAt).toLocaleString("es-ES")}</time>
                  {payment.refundedAmount > 0 && (
                    <span>Reembolsado {money.format(payment.refundedAmount)}</span>
                  )}
                </div>
                <b>{money.format(payment.amount)}</b>
                {["OWNER", "MANAGER"].includes(user.role) && payment.refundableAmount > 0 && (
                  <form className="checkout-refund" onSubmit={(event) => refundPayment(event, payment.id)}>
                    {payment.method === "CARD" && (
                      <small>Procese primero la devolución en el terminal.</small>
                    )}
                    <input
                      name="amount"
                      type="number"
                      min="0.01"
                      max={payment.refundableAmount}
                      step="0.01"
                      defaultValue={payment.refundableAmount}
                      required
                    />
                    <input name="reason" maxLength={500} placeholder="Motivo" required />
                    <button className="danger-button" disabled={busy}>Reembolsar</button>
                  </form>
                )}
              </article>
            )) : (
              <p className="pos-pane-hint">Aún no hay pagos en esta cuenta.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
