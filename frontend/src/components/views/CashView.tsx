"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  CashShift,
  Location,
  closeCashShift,
  createCashMovement,
  getCurrentCashShift,
  listCashShifts,
  listLocations,
  openCashShift,
} from "@/lib/api";

const money = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

export default function CashView() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const [current, setCurrent] = useState<CashShift | null>(null);
  const [history, setHistory] = useState<CashShift[]>([]);
  const [openRetryKey, setOpenRetryKey] = useState("");
  const [movementRetryKey, setMovementRetryKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
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
    if (locationId) refresh(locationId);
  }, [locationId]);

  async function refresh(selectedLocationId = locationId) {
    try {
      const [activeResult, historyResult] = await Promise.all([
        getCurrentCashShift(selectedLocationId),
        listCashShifts(selectedLocationId),
      ]);
      setCurrent(activeResult.shift);
      setHistory(historyResult);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar la caja");
    }
  }

  async function openShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const idempotencyKey = openRetryKey || crypto.randomUUID();
    setOpenRetryKey(idempotencyKey);
    setBusy(true);
    try {
      await openCashShift({
        locationId,
        openingAmount: Number(form.get("openingAmount")),
        idempotencyKey,
      });
      setOpenRetryKey("");
      setNotice("Turno de caja abierto.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo abrir el turno");
    } finally {
      setBusy(false);
    }
  }

  async function addMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const idempotencyKey = movementRetryKey || crypto.randomUUID();
    setMovementRetryKey(idempotencyKey);
    setBusy(true);
    try {
      await createCashMovement({
        cashShiftId: current.id,
        type: String(form.get("type")) as "PAID_IN" | "PAID_OUT",
        amount: Number(form.get("amount")),
        reason: String(form.get("reason")),
        idempotencyKey,
      });
      setMovementRetryKey("");
      formElement.reset();
      setNotice("Movimiento registrado.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo registrar el movimiento");
    } finally {
      setBusy(false);
    }
  }

  async function closeShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const result = await closeCashShift({
        cashShiftId: current.id,
        countedCash: Number(form.get("countedCash")),
        closingNote: String(form.get("closingNote")),
        expectedVersion: current.version,
      });
      setNotice(`Turno cerrado. Diferencia: ${money.format(result.cashDifference ?? 0)}.`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cerrar el turno");
    } finally {
      setBusy(false);
    }
  }

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
      {notice && <p className="success" role="status">{notice}</p>}

      {!current && locationId && (
        <form className="form-card cash-open-form" onSubmit={openShift}>
          <h2>Abrir turno</h2>
          <p>Indica el fondo inicial disponible en efectivo.</p>
          <label>
            Fondo inicial
            <input name="openingAmount" type="number" min="0" step="0.01" defaultValue="0.00" required />
          </label>
          <button className="primary-button" disabled={busy}>Abrir caja</button>
        </form>
      )}

      {current && (
        <>
          <section className="cash-summary">
            <header>
              <div>
                <small>Abierto por {current.openedBy}</small>
                <h2>Turno en curso</h2>
                <time>{new Date(current.openedAt).toLocaleString("es-ES")}</time>
              </div>
              <span className="payment-state paid">Abierto</span>
            </header>
            <div className="cash-metrics">
              <Metric label="Fondo inicial" value={current.openingAmount} />
              <Metric label="Ventas en efectivo" value={current.cashSales} />
              <Metric label="Ventas con tarjeta" value={current.cardSales} />
              <Metric label="Reembolsos en efectivo" value={-current.cashRefunds} />
              <Metric label="Reembolsos en tarjeta" value={-current.cardRefunds} />
              <Metric label="Entradas" value={current.paidIn} />
              <Metric label="Salidas" value={current.paidOut} />
              <Metric label="Efectivo esperado" value={current.expectedCash} emphasized />
            </div>
          </section>

          <div className="cash-actions">
            <form className="form-card" onSubmit={addMovement}>
              <h2>Movimiento de efectivo</h2>
              <label>
                Tipo
                <select name="type">
                  <option value="PAID_IN">Entrada</option>
                  <option value="PAID_OUT">Salida</option>
                </select>
              </label>
              <label>
                Importe
                <input name="amount" type="number" min="0.01" step="0.01" required />
              </label>
              <label>
                Motivo
                <input name="reason" maxLength={240} required />
              </label>
              <button className="secondary-button" disabled={busy}>Registrar movimiento</button>
            </form>

            <form className="form-card" onSubmit={closeShift}>
              <h2>Cerrar y arquear</h2>
              <p>El cierre se bloqueará mientras existan pedidos abiertos.</p>
              <label>
                Efectivo contado
                <input name="countedCash" type="number" min="0" step="0.01" required />
              </label>
              <label>
                Nota de cierre
                <input name="closingNote" maxLength={500} />
              </label>
              <button className="primary-button" disabled={busy}>Cerrar turno</button>
            </form>
          </div>

          {current.movements.length > 0 && (
            <section className="cash-movements">
              <h2>Movimientos del turno</h2>
              {current.movements.map((movement) => (
                <div key={movement.id}>
                  <span>{movement.type === "PAID_IN" ? "Entrada" : "Salida"} · {movement.reason}</span>
                  <strong>{movement.type === "PAID_IN" ? "+" : "−"}{money.format(movement.amount)}</strong>
                  <time>{new Date(movement.createdAt).toLocaleString("es-ES")}</time>
                </div>
              ))}
            </section>
          )}
        </>
      )}

      <section className="cash-history">
        <h2>Últimos turnos</h2>
        {history.filter((shift) => shift.status === "CLOSED").map((shift) => (
          <article key={shift.id}>
            <div>
              <strong>{new Date(shift.openedAt).toLocaleDateString("es-ES")}</strong>
              <small>{shift.openedBy} · {shift.closedBy}</small>
            </div>
            <span>
              Neto {money.format(
                shift.cashSales + shift.cardSales - shift.cashRefunds - shift.cardRefunds,
              )}
            </span>
            <span className={(shift.cashDifference ?? 0) === 0 ? "" : "difference"}>
              Diferencia {money.format(shift.cashDifference ?? 0)}
            </span>
          </article>
        ))}
        {history.every((shift) => shift.status !== "CLOSED") && (
          <p className="empty-state">Todavía no hay turnos cerrados.</p>
        )}
      </section>
    </>
  );
}

function Metric({ label, value, emphasized = false }: {
  label: string;
  value: number;
  emphasized?: boolean;
}) {
  return (
    <div className={emphasized ? "cash-metric emphasized" : "cash-metric"}>
      <span>{label}</span>
      <strong>{money.format(value)}</strong>
    </div>
  );
}
