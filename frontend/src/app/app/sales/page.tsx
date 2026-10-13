"use client";

import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import {
  DailySales,
  Location,
  SalesReceipt,
  createRefund,
  getDailySales,
  getSalesReceipt,
  listLocations,
} from "@/lib/api";

export default function SalesPage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const [businessDate, setBusinessDate] = useState("");
  const [daily, setDaily] = useState<DailySales | null>(null);
  const [receipt, setReceipt] = useState<SalesReceipt | null>(null);
  const [refundRetryKey, setRefundRetryKey] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    listLocations()
      .then((result) => {
        setLocations(result);
        if (result[0]) {
          setLocationId(result[0].id);
          setBusinessDate(dateInZone(result[0].timezone));
        }
      })
      .catch((cause) => setError(cause.message));
  }, []);

  useEffect(() => {
    if (!locationId || !businessDate) return;
    getDailySales(locationId, businessDate)
      .then((result) => {
        setDaily(result);
        setError("");
        const requestedId = new URLSearchParams(window.location.search).get("orderId");
        if (requestedId) loadReceipt(requestedId);
        else setReceipt(null);
      })
      .catch((cause) => setError(cause.message));
  }, [locationId, businessDate]);

  async function loadReceipt(orderId: string) {
    try {
      setReceipt(await getSalesReceipt(orderId));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar el comprobante");
    }
  }

  function changeLocation(nextLocationId: string) {
    setLocationId(nextLocationId);
    const location = locations.find((item) => item.id === nextLocationId);
    if (location) setBusinessDate(dateInZone(location.timezone));
  }

  async function refundPayment(
    event: FormEvent<HTMLFormElement>,
    paymentId: string,
  ) {
    event.preventDefault();
    if (!receipt || !daily) return;
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
      const [nextReceipt, nextDaily] = await Promise.all([
        getSalesReceipt(receipt.orderId),
        getDailySales(locationId, businessDate),
      ]);
      setReceipt(nextReceipt);
      setDaily(nextDaily);
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

  const currency = daily?.currency ?? "EUR";
  const money = new Intl.NumberFormat("es-ES", { style: "currency", currency });

  return (
    <AppShell title="Ventas">
      {(user) => (
        <>
          <div className="sales-controls">
            <label>
              Local
              <select value={locationId} onChange={(event) => changeLocation(event.target.value)}>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>{location.name}</option>
                ))}
              </select>
            </label>
            <label>
              Fecha operativa
              <input
                type="date"
                value={businessDate}
                onChange={(event) => setBusinessDate(event.target.value)}
              />
            </label>
          </div>
          {error && <p className="error no-print" role="alert">{error}</p>}
          {notice && <p className="success no-print" role="status">{notice}</p>}
          {daily && (
            <>
              <section className="sales-overview">
                <Metric label="Ventas netas" value={money.format(daily.netSales)} />
                <Metric label="Reembolsos" value={money.format(daily.refunds)} />
                <Metric label="Efectivo" value={money.format(daily.cashSales)} />
                <Metric label="Tarjeta" value={money.format(daily.cardSales)} />
              </section>
              <div className="sales-layout">
                <section className="sales-list">
                  <h2>Operaciones del día</h2>
                  {daily.sales.map((sale) => (
                    <button
                      type="button"
                      className={receipt?.orderId === sale.orderId ? "sale-row active" : "sale-row"}
                      key={sale.orderId}
                      onClick={() => loadReceipt(sale.orderId)}
                    >
                      <span>Mesa {sale.tableName}</span>
                      <strong>{money.format(sale.total)}</strong>
                      <small>
                        #{sale.orderNumber} · {formatDateTime(sale.closedAt, daily.timezone)}
                        {sale.refundedTotal > 0 && ` · Reembolsado ${money.format(sale.refundedTotal)}`}
                      </small>
                    </button>
                  ))}
                  {daily.sales.length === 0 && (
                    <p className="empty-state">No hay ventas para esta fecha.</p>
                  )}
                </section>
                {receipt ? (
                  <Receipt
                    receipt={receipt}
                    canRefund={["OWNER", "MANAGER"].includes(user.role)}
                    busy={busy}
                    onRefund={refundPayment}
                  />
                ) : (
                  <p className="empty-state receipt-placeholder">
                    Selecciona una venta para consultar su comprobante.
                  </p>
                )}
              </div>
            </>
          )}
        </>
      )}
    </AppShell>
  );
}

function Receipt({ receipt, canRefund, busy, onRefund }: {
  receipt: SalesReceipt;
  canRefund: boolean;
  busy: boolean;
  onRefund: (event: FormEvent<HTMLFormElement>, paymentId: string) => void;
}) {
  const money = new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: receipt.currency,
  });
  return (
    <article className="receipt-panel">
      <button className="secondary-button print-button no-print" onClick={() => window.print()}>
        Imprimir
      </button>
      <header className="receipt-header">
        <strong>{receipt.organizationName}</strong>
        <span>{receipt.locationName}</span>
        <h2>{receipt.title}</h2>
        <p>{receipt.disclaimer}</p>
      </header>
      <dl className="receipt-meta">
        <div><dt>Pedido</dt><dd>#{receipt.orderNumber}</dd></div>
        <div><dt>Fecha</dt><dd>{formatDateTime(receipt.closedAt, receipt.timezone)}</dd></div>
        <div><dt>Mesa</dt><dd>{receipt.areaName} · {receipt.tableName}</dd></div>
        <div><dt>Atendido por</dt><dd>{receipt.openedBy}</dd></div>
        <div><dt>Comensales</dt><dd>{receipt.guestCount}</dd></div>
      </dl>
      <div className="receipt-items">
        <div className="receipt-row receipt-labels">
          <span>Producto</span><span>Cant.</span><span>Precio</span><span>Total</span>
        </div>
        {receipt.items.map((item, index) => (
          <div className="receipt-row" key={`${item.sku}-${index}`}>
            <span>{item.productName}</span>
            <span>{item.quantity}</span>
            <span>{money.format(item.unitPrice)}</span>
            <strong>{money.format(item.lineTotal)}</strong>
          </div>
        ))}
      </div>
      <div className="receipt-total">
        <span>Total original</span>
        <strong>{money.format(receipt.grossTotal)}</strong>
      </div>
      {receipt.refundedTotal > 0 && (
        <div className="receipt-adjustment">
          <span>Reembolsado</span><strong>−{money.format(receipt.refundedTotal)}</strong>
          <span>Neto</span><strong>{money.format(receipt.total)}</strong>
        </div>
      )}
      <section className="receipt-taxes">
        <h3>Desglose de IVA de la venta original</h3>
        <div className="tax-row tax-labels">
          <span>Tipo</span><span>Base</span><span>IVA</span><span>Bruto</span>
        </div>
        {receipt.taxes.map((tax) => (
          <div className="tax-row" key={tax.taxRate}>
            <span>{tax.taxRate}%</span>
            <span>{money.format(tax.taxableBase)}</span>
            <span>{money.format(tax.taxAmount)}</span>
            <span>{money.format(tax.grossAmount)}</span>
          </div>
        ))}
      </section>
      <section className="receipt-payments">
        <h3>Pagos</h3>
        {receipt.payments.map((payment, index) => (
          <div key={`${payment.paidAt}-${index}`}>
            <span>{payment.method === "CASH" ? "Efectivo" : "Tarjeta"}</span>
            <strong>{money.format(payment.amount)}</strong>
            {payment.tenderedAmount != null && (
              <small>
                Recibido {money.format(payment.tenderedAmount)} · Cambio {money.format(payment.changeAmount)}
              </small>
            )}
            {payment.refundedAmount > 0 && (
              <small>Reembolsado {money.format(payment.refundedAmount)}</small>
            )}
            {canRefund && payment.refundableAmount > 0 && (
              <form
                className="refund-form no-print"
                onSubmit={(event) => onRefund(event, payment.id)}
              >
                {payment.method === "CARD" && (
                  <small>Procese primero la devolución en el terminal de tarjeta.</small>
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
                <input name="reason" maxLength={500} placeholder="Motivo del reembolso" required />
                <button className="danger-button" disabled={busy}>Reembolsar</button>
              </form>
            )}
          </div>
        ))}
      </section>
      {receipt.refunds.length > 0 && (
        <section className="receipt-refunds">
          <h3>Reembolsos</h3>
          {receipt.refunds.map((refund) => (
            <div key={refund.id}>
              <span>{formatDateTime(refund.refundedAt, receipt.timezone)} · {refund.reason}</span>
              <strong>−{money.format(refund.amount)}</strong>
            </div>
          ))}
        </section>
      )}
      <footer>{receipt.title.toUpperCase()}</footer>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function dateInZone(timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatDateTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: timezone,
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
