"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAppNavigation } from "@/components/AppShell";
import { SalesSankey } from "@/components/SalesSankey";
import {
  DailySales,
  SalesReceipt,
  createRefund,
  getDailySales,
  getSalesReceipt,
} from "@/lib/api";

export default function SalesView() {
  const { user, selectedOrderId, locations, locationId, rememberSelection, navigate } = useAppNavigation();
  const [businessDate, setBusinessDate] = useState("");
  const [daily, setDaily] = useState<DailySales | null>(null);
  const [receipt, setReceipt] = useState<SalesReceipt | null>(null);
  const [refundRetryKey, setRefundRetryKey] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedArea, setSelectedArea] = useState<string | null>(null);

  useEffect(() => {
    setBusinessDate("");
    setDaily(null);
  }, [locationId]);

  useEffect(() => {
    if (!locationId) return;
    setSelectedArea(null);
    getDailySales(locationId, businessDate || undefined)
      .then((result) => {
        setDaily(result);
        const nextDate = isoDate(result.businessDate);
        if (!businessDate && nextDate) setBusinessDate(nextDate);
        setError("");
        if (selectedOrderId && result.sales.some((sale) => sale.orderId === selectedOrderId)) {
          loadReceipt(selectedOrderId);
        } else {
          setReceipt(null);
        }
      })
      .catch((cause) => setError(cause.message));
  }, [locationId, businessDate, selectedOrderId]);

  async function loadReceipt(orderId: string) {
    try {
      setReceipt(await getSalesReceipt(orderId));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar el comprobante");
    }
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

  const visibleSales = daily?.sales.filter((sale) => !selectedArea || sale.areaName === selectedArea) ?? [];

  return (
    <section className="sales-view">
      <div className="sales-controls">
        <label>
          Fecha operativa
          <input
            type="date"
            value={businessDate}
            onChange={(event) => {
              setBusinessDate(event.target.value);
              setSelectedArea(null);
            }}
          />
        </label>
        <button type="button" className="inline-link-button no-print" onClick={() => navigate("checkout")}>
          Ir a caja
        </button>
      </div>
      {error && <p className="error no-print" role="alert">{error}</p>}
      {notice && <p className="success no-print" role="status">{notice}</p>}
      {daily && (
        <>
          <section className="sales-overview">
            <Metric label="Ventas netas" value={money.format(daily.netSales)} />
            <Metric label="Pedidos" value={String(daily.orderCount)} />
            <Metric label="Efectivo" value={money.format(daily.cashSales)} />
            <Metric label="Tarjeta" value={money.format(daily.cardSales)} />
          </section>
          <article className="sales-flow no-print">
            <header>
              <h2>Flujo del día</h2>
              <p>Ventas cobradas por salón, hacia efectivo, tarjeta y reembolsos. Pulsa un salón para filtrar las operaciones.</p>
            </header>
            <SalesSankey
              daily={daily}
              money={money}
              selectedArea={selectedArea}
              onSelectArea={setSelectedArea}
            />
          </article>
          <div className="sales-layout">
            <section className="sales-list">
              <h2>{selectedArea ? `Operaciones · ${selectedArea}` : "Operaciones del día"}</h2>
              {visibleSales.map((sale) => (
                <button
                  type="button"
                  className={receipt?.orderId === sale.orderId ? "sale-row active" : "sale-row"}
                  key={sale.orderId}
                  onClick={() => {
                    rememberSelection({ orderId: sale.orderId });
                    loadReceipt(sale.orderId);
                  }}
                >
                  <span>Mesa {sale.tableName}</span>
                  <strong>{money.format(sale.total)}</strong>
                  <small>
                    #{sale.orderNumber} · {formatDateTime(sale.closedAt, daily.timezone)}
                    {sale.refundedTotal > 0 && ` · Reembolsado ${money.format(sale.refundedTotal)}`}
                  </small>
                </button>
              ))}
              {visibleSales.length === 0 && (
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
    </section>
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

function isoDate(value: string | number[] | undefined): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  if (Array.isArray(value) && value.length >= 3) {
    return `${value[0]}-${String(value[1]).padStart(2, "0")}-${String(value[2]).padStart(2, "0")}`;
  }
  return "";
}

function formatDateTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: timezone,
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
