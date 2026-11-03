"use client";

import { ReactNode, useEffect } from "react";
import { RestaurantOrder } from "@/lib/api";

const money = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

type TaxBucket = { rate: number; base: number; tax: number; gross: number };

export type ReceiptKind = "preview" | "charge" | "paid";

export type ReceiptPayment = {
  method: "CASH" | "CARD";
  amount: number;
  changeAmount: number;
};

function taxBuckets(order: RestaurantOrder): TaxBucket[] {
  const map = new Map<number, TaxBucket>();
  for (const item of order.items) {
    if (item.voided) continue;
    const gross = item.quantity * item.unitPrice;
    const rate = item.taxRate ?? 0;
    const base = rate > 0 ? gross / (1 + rate / 100) : gross;
    const tax = gross - base;
    const current = map.get(rate) ?? { rate, base: 0, tax: 0, gross: 0 };
    current.base += base;
    current.tax += tax;
    current.gross += gross;
    map.set(rate, current);
  }
  return [...map.values()].sort((a, b) => a.rate - b.rate);
}

export function PreBillPreview({
  order,
  organizationName,
  locationName,
  servedBy,
  variant = "preview",
  payment,
  autoPrint = false,
  onClose,
  children,
}: {
  order: RestaurantOrder;
  organizationName: string;
  locationName: string;
  servedBy: string;
  variant?: ReceiptKind;
  payment?: ReceiptPayment;
  autoPrint?: boolean;
  onClose: () => void;
  children?: ReactNode;
}) {
  const lines = order.items.filter((item) => !item.voided);
  const taxes = taxBuckets(order);
  const ticketId = `receipt-ticket-${variant}`;
  const mark = variant === "paid" ? "COBRADO" : variant === "charge" ? "CUENTA" : "PRE-CUENTA";
  const kicker = variant === "paid" ? "Comprobante" : variant === "charge" ? "Cobro" : "Simulación de cobro";
  const title = variant === "paid" ? "Ticket cobrado" : variant === "charge" ? "Cobrar" : "Pre-cuenta";
  const foot = variant === "paid"
    ? "Gracias por su visita."
    : variant === "charge"
      ? "Pendiente de cobro. Confirme el importe con el cliente."
      : "No es factura. Documento informativo para el cliente.";

  function printTicket() {
    const ticket = document.getElementById(ticketId);
    if (!ticket) return;
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.position = "fixed";
    frame.style.left = "0";
    frame.style.top = "0";
    frame.style.width = "80mm";
    frame.style.height = "120mm";
    frame.style.opacity = "0";
    frame.style.pointerEvents = "none";
    frame.style.border = "0";
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    if (!doc) {
      frame.remove();
      return;
    }
    doc.open();
    doc.write(`<!doctype html><html><head><title>${mark}</title>
      <style>
        @page { size: 80mm auto; margin: 14mm 12mm 12mm 12mm; }
        html, body { margin: 0; background: #fff; color: #1e2a30; }
        body {
          box-sizing: border-box;
          padding: 8mm 7mm 10mm;
          font-family: "Courier New", Courier, monospace;
          font-size: 16px;
          line-height: 1.35;
          text-align: center;
        }
        p { margin: 4px 0; }
        .thermal-org { font-size: 20px; font-weight: 800; letter-spacing: 0.04em; }
        .thermal-mark { margin: 14px 0 10px; font-size: 18px; font-weight: 800; letter-spacing: 0.16em; }
        .thermal-meta, .thermal-foot, .muted { color: #5f6b73; }
        .thermal-foot { margin-top: 16px; font-size: 13px; }
        .thermal-rule { margin: 14px 0; border-top: 1px dashed #c9c3b7; }
        .thermal-line, .thermal-total { display: flex; justify-content: space-between; gap: 12px; text-align: left; margin: 6px 0; }
        .thermal-line.muted { font-size: 14px; }
        .thermal-total { font-size: 20px; font-weight: 800; }
      </style></head><body>${ticket.innerHTML}</body></html>`);
    doc.close();
    const cleanup = () => {
      if (frame.parentNode) frame.remove();
    };
    const runPrint = () => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    };
    frame.contentWindow?.addEventListener("afterprint", cleanup);
    window.setTimeout(runPrint, 120);
    window.setTimeout(cleanup, 60_000);
  }

  useEffect(() => {
    if (!autoPrint) return;
    const timer = window.setTimeout(printTicket, 250);
    return () => window.clearTimeout(timer);
  }, [autoPrint, ticketId, order.id, variant]);

  return (
    <div
      className="creation-modal-backdrop thermal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section className="creation-modal thermal-modal" role="dialog" aria-modal="true" aria-labelledby="prebill-title">
        <header>
          <div className="creation-modal-title">
            <div>
              <p>{kicker}</p>
              <h2 id="prebill-title">{title}</h2>
            </div>
          </div>
          <div className="thermal-modal-tools">
            <button type="button" className="thermal-tool print" aria-label="Imprimir" onClick={printTicket}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 8V4h10v4M7 17H5a2 2 0 0 1-2-2v-5h18v5a2 2 0 0 1-2 2h-2" />
                <rect x="7" y="13" width="10" height="7" rx="1" />
              </svg>
            </button>
            <button type="button" className="thermal-tool close" aria-label="Cerrar" onClick={onClose}>×</button>
          </div>
        </header>
        <article className="thermal-ticket" id={ticketId}>
          <p className="thermal-org">{organizationName}</p>
          <p>{locationName}</p>
          <p className="thermal-mark">{mark}</p>
          <p className="thermal-meta">
            {order.areaName} · {order.tableName}
            {order.orderNumber ? ` · Pedido #${order.orderNumber}` : " · Pedido nuevo"}
          </p>
          <p className="thermal-meta">
            {new Date(order.openedAt).toLocaleString("es-ES")} · {order.guestCount} comensales
          </p>
          <p className="thermal-meta">Atendido por {servedBy}</p>
          <div className="thermal-rule" />
          {lines.map((item) => (
            <div className="thermal-line" key={item.id}>
              <span>{item.quantity}× {item.productName}</span>
              <strong>{money.format(item.quantity * item.unitPrice)}</strong>
            </div>
          ))}
          <div className="thermal-rule" />
          {taxes.map((bucket) => (
            <div className="thermal-line muted" key={bucket.rate}>
              <span>IVA {bucket.rate}% · Base {money.format(bucket.base)}</span>
              <span>{money.format(bucket.tax)}</span>
            </div>
          ))}
          <div className="thermal-total">
            <span>TOTAL</span>
            <strong>{money.format(order.total)}</strong>
          </div>
          {variant === "paid" && payment && (
            <>
              <div className="thermal-line">
                <span>{payment.method === "CASH" ? "Efectivo" : "Tarjeta"}</span>
                <strong>{money.format(payment.amount)}</strong>
              </div>
              {payment.method === "CASH" && (
                <div className="thermal-line">
                  <span>Cambio</span>
                  <strong>{money.format(payment.changeAmount)}</strong>
                </div>
              )}
            </>
          )}
          <p className="thermal-foot">{foot}</p>
        </article>
        {children && <div className="thermal-pay">{children}</div>}
      </section>
    </div>
  );
}
