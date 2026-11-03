"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAppNavigation } from "@/components/AppShell";
import {
  CashShift,
  closeCashShift,
  createCashMovement,
  getCurrentCashShift,
  getOwnerPinStatus,
  listCashShifts,
  listOrders,
  openCashShift,
  setOwnerPin,
} from "@/lib/api";
import { hasOpenPedido } from "@/lib/tableStatus";

const money = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

type PinMode = "setup" | "confirm" | "open" | "close" | "change";

export default function CashView() {
  const { user, locationId, selectedOrderId, selectedTableId, navigate } = useAppNavigation();
  const [current, setCurrent] = useState<CashShift | null>(null);
  const [history, setHistory] = useState<CashShift[]>([]);
  const [pinStatus, setPinStatus] = useState<{ configured: boolean; locked: boolean } | null>(null);
  const [openRetryKey, setOpenRetryKey] = useState("");
  const [movementRetryKey, setMovementRetryKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [openingAmount, setOpeningAmount] = useState("0.00");
  const [openAmountOpen, setOpenAmountOpen] = useState(false);
  const [movementType, setMovementType] = useState<"PAID_IN" | "PAID_OUT" | null>(null);
  const [movementAmount, setMovementAmount] = useState("");
  const [movementReason, setMovementReason] = useState("");
  const [countedCash, setCountedCash] = useState("");
  const [countedCard, setCountedCard] = useState("");
  const [closingNote, setClosingNote] = useState("");
  const [closeOpen, setCloseOpen] = useState(false);
  const [pinMode, setPinMode] = useState<PinMode | null>(null);
  const [pinValue, setPinValue] = useState("");
  const [pinDraft, setPinDraft] = useState("");
  const [closedShift, setClosedShift] = useState<CashShift | null>(null);
  const [historyShift, setHistoryShift] = useState<CashShift | null>(null);
  const [showOpenDetail, setShowOpenDetail] = useState(false);
  const [justOpened, setJustOpened] = useState(false);
  const [movementDone, setMovementDone] = useState(false);
  const [closeOwnerPin, setCloseOwnerPin] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const managePin =
    user.role === "OWNER" || user.role === "MANAGER" || user.role === "CASHIER";

  useEffect(() => {
    if (locationId) refresh(locationId);
  }, [locationId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || busy) return;
      if (pinMode) {
        setPinMode(null);
        setPinValue("");
        return;
      }
      if (openAmountOpen) {
        setOpenAmountOpen(false);
        return;
      }
      if (movementDone || movementType) {
        setMovementDone(false);
        setMovementType(null);
        return;
      }
      if (closeOpen) {
        setCloseOpen(false);
        setCloseOwnerPin("");
        return;
      }
      setJustOpened(false);
      setShowOpenDetail(false);
      setClosedShift(null);
      setHistoryShift(null);
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [busy, openAmountOpen, movementType, movementDone, closeOpen, pinMode]);

  async function refresh(selectedLocationId = locationId) {
    try {
      const [activeResult, historyResult, pinResult] = await Promise.all([
        getCurrentCashShift(selectedLocationId),
        listCashShifts(selectedLocationId),
        getOwnerPinStatus(),
      ]);
      setCurrent(activeResult.shift);
      setHistory(historyResult);
      setPinStatus(pinResult);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar la caja");
    }
  }

  function startOpen() {
    setError("");
    setNotice("");
    if (!pinStatus?.configured) {
      if (managePin) {
        setPinDraft("");
        setPinMode("setup");
        setPinValue("");
        return;
      }
      setError("El propietario debe configurar el PIN de caja antes de abrir un turno.");
      return;
    }
    if (pinStatus.locked) {
      setError("El PIN está bloqueado. Espere unos minutos.");
      return;
    }
    setOpeningAmount("0.00");
    setOpenAmountOpen(true);
  }

  function requestOpenPin(event: FormEvent) {
    event.preventDefault();
    setOpenAmountOpen(false);
    setPinMode("open");
    setPinValue("");
  }

  async function submitPin() {
    if (pinValue.length < 4) {
      setError("El PIN debe tener entre 4 y 6 dígitos.");
      return;
    }
    if (pinMode === "setup") {
      setPinDraft(pinValue);
      setPinValue("");
      setPinMode("confirm");
      setError("");
      return;
    }
    if (pinMode === "change" && !pinDraft) {
      setPinDraft(pinValue);
      setPinValue("");
      setError("");
      return;
    }
    if (pinMode === "confirm" || pinMode === "change") {
      if (pinMode === "confirm" && pinValue !== pinDraft) {
        setError("Los PIN no coinciden.");
        setPinValue("");
        return;
      }
      setBusy(true);
      try {
        const changing = pinMode === "change";
        const next = changing ? pinValue : pinDraft || pinValue;
        await setOwnerPin({
          pin: next,
          currentPin: changing ? pinDraft : undefined,
        });
        setPinMode(null);
        setPinValue("");
        setPinDraft("");
        setNotice("PIN del propietario guardado.");
        await refresh();
        if (!changing && !current) {
          setOpeningAmount("0.00");
          setOpenAmountOpen(true);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "No se pudo guardar el PIN");
        setPinValue("");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (pinMode === "open") {
      await confirmOpen(pinValue);
      return;
    }
    if (pinMode === "close") {
      setCloseOwnerPin(pinValue);
      setPinMode(null);
      setPinValue("");
      setCloseOpen(true);
      setError("");
    }
  }

  async function confirmOpen(pin: string) {
    const idempotencyKey = openRetryKey || crypto.randomUUID();
    setOpenRetryKey(idempotencyKey);
    setBusy(true);
    try {
      await openCashShift({
        locationId,
        openingAmount: Number(openingAmount),
        idempotencyKey,
        ownerPin: pin,
      });
      setOpenRetryKey("");
      setPinMode(null);
      setPinValue("");
      setNotice("");
      setShowOpenDetail(false);
      setJustOpened(true);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo abrir el turno");
      setPinValue("");
    } finally {
      setBusy(false);
    }
  }

  async function addMovement(event: FormEvent) {
    event.preventDefault();
    if (!current || !movementType) return;
    const idempotencyKey = movementRetryKey || crypto.randomUUID();
    setMovementRetryKey(idempotencyKey);
    setBusy(true);
    try {
      await createCashMovement({
        cashShiftId: current.id,
        type: movementType,
        amount: Number(movementAmount),
        reason: movementReason.trim(),
        idempotencyKey,
      });
      setMovementRetryKey("");
      setMovementDone(true);
      setNotice("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo registrar el movimiento");
    } finally {
      setBusy(false);
    }
  }

  async function startClose() {
    if (!current) return;
    setBusy(true);
    try {
      const openTickets = (await listOrders(locationId)).filter((order) => hasOpenPedido(order));
      if (openTickets.length > 0) {
        setError(
          openTickets.length === 1
            ? "Hay 1 pedido abierto. Cóbralo o anúlalo antes de cerrar caja."
            : `Hay ${openTickets.length} pedidos abiertos. Cóbralos o anúlalos antes de cerrar caja.`,
        );
        return;
      }
      setError("");
      setCountedCash(current.expectedCash.toFixed(2));
      setCountedCard((current.expectedCard ?? current.cardSales - current.cardRefunds).toFixed(2));
      setClosingNote("");
      setCloseOwnerPin("");
      setPinMode("close");
      setPinValue("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo comprobar los pedidos abiertos");
    } finally {
      setBusy(false);
    }
  }

  async function confirmClose(pin: string) {
    if (!current) return;
    setBusy(true);
    try {
      const latest = (await getCurrentCashShift(locationId)).shift ?? current;
      const closed = await closeCashShift({
        cashShiftId: latest.id,
        countedCash: Number(countedCash || latest.expectedCash),
        countedCard: Number(countedCard || latest.expectedCard || 0),
        closingNote,
        expectedVersion: latest.version,
        ownerPin: pin,
      });
      setPinMode(null);
      setPinValue("");
      setCloseOpen(false);
      setCloseOwnerPin("");
      setClosedShift(closed);
      setShowOpenDetail(false);
      setJustOpened(false);
      setNotice("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cerrar el turno");
      setPinValue("");
      setPinMode("close");
      setCloseOpen(false);
    } finally {
      setBusy(false);
    }
  }

  function startChangePin() {
    setError("");
    setPinDraft("");
    setPinValue("");
    setPinMode("change");
  }

  const pinTitle = {
    setup: "Crear PIN del propietario",
    confirm: "Repite el PIN",
    change: pinDraft ? "Nuevo PIN" : "PIN actual",
    open: "PIN del propietario",
    close: "PIN del propietario",
  }[pinMode ?? "open"];

  const expectedCard = current
    ? (current.expectedCard ?? current.cardSales - current.cardRefunds)
    : 0;
  const closedHistory = history.filter((shift) => shift.status === "CLOSED");
  const cashCountDiff = current ? Number(countedCash || 0) - current.expectedCash : 0;
  const cardCountDiff = current ? Number(countedCard || 0) - expectedCard : 0;
  const duration = useMemo(
    () => (current ? formatDuration(current.openedAt, now) : ""),
    [current, now],
  );
  const reviewedShift = closedShift ?? historyShift;

  return (
    <div className="cash-view">
      <div className="pos-toolbar cash-topbar">
        <div className="pos-chip-row" role="status">
          <span className="pos-chip" aria-pressed={Boolean(current)}>
            <CashRegisterIcon />
            {current ? "Turno abierto" : "Sin turno"}
          </span>
          {pinStatus && (
            <span className="pos-chip" aria-pressed={pinStatus.configured && !pinStatus.locked}>
              <LockIcon />
              {pinStatus.locked ? "PIN bloqueado" : pinStatus.configured ? "PIN activo" : "PIN pendiente"}
            </span>
          )}
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
          {managePin && pinStatus && !pinStatus.configured && (
            <button type="button" className="pos-shift-button" onClick={() => {
              setError("");
              setNotice("");
              setPinDraft("");
              setPinValue("");
              setPinMode("setup");
            }} disabled={busy}>
              <LockIcon />
              Configurar PIN
            </button>
          )}
          {managePin && pinStatus?.configured && (
            <button type="button" className="pos-shift-button" onClick={startChangePin} disabled={busy}>
              <LockIcon />
              Cambiar PIN
            </button>
          )}
          {!current && (
            <button
              type="button"
              className="pos-shift-button pos-shift-button-primary"
              onClick={startOpen}
              disabled={!locationId || busy}
            >
              <CashRegisterIcon />
              Abrir turno
            </button>
          )}
        </div>
      </div>
      {error && !pinMode && !closeOpen && !movementType && !movementDone && <p className="error" role="alert">{error}</p>}
      {notice && <p className="pos-pane-hint cash-notice" role="status">{notice}</p>}

      <div className="cash-stage">
        {pinMode ? (
          <div className="cash-ficha cash-ficha-narrow">
            {pinMode === "close" && (
              <ol className="cash-close-steps">
                <li className="current">PIN del propietario</li>
                <li>Conteo y cuadre</li>
                <li>Resumen</li>
              </ol>
            )}
            <header className="cash-close-title">
              <p>Turnos de caja</p>
              <h2>{pinTitle}</h2>
            </header>
            <p className="pos-pane-hint">
              {pinMode === "open" || pinMode === "close"
                ? "Introduce el PIN del propietario para autorizar la operación."
                : pinMode === "change" && !pinDraft
                  ? "Introduce el PIN actual y, a continuación, el nuevo."
                  : "El PIN tiene entre 4 y 6 dígitos. No uses la contraseña de acceso."}
            </p>
            {error && <p className="error" role="alert">{error}</p>}
            <PinPad
              value={pinValue}
              busy={busy}
              onDigit={(digit) => {
                setError("");
                setPinValue((value) => (digit === "⌫" ? value.slice(0, -1) : value.length >= 6 ? value : value + digit));
              }}
            />
            <div className="cash-close-footer">
              <button type="button" className="pos-shift-button" disabled={busy} onClick={() => { setPinMode(null); setPinValue(""); }}>Cancelar</button>
              <button type="button" className="pos-shift-button pos-shift-button-primary" disabled={busy || pinValue.length < 4} onClick={() => void submitPin()}>
                {busy ? "Comprobando…" : pinMode === "confirm" ? "Guardar PIN" : "Autorizar"}
              </button>
            </div>
          </div>
        ) : openAmountOpen && !current ? (
          <form className="cash-ficha cash-ficha-narrow creation-modal-form" onSubmit={requestOpenPin}>
            <header className="cash-close-title">
              <p>Turnos de caja</p>
              <h2>Apertura del turno</h2>
            </header>
            <p className="pos-pane-hint">Indica el fondo inicial. A continuación se pedirá el PIN del propietario.</p>
            <label>
              Fondo inicial
              <input name="openingAmount" type="number" min={0} step="0.01" value={openingAmount} onChange={(event) => setOpeningAmount(event.target.value)} autoFocus required />
            </label>
            <div className="cash-close-footer">
              <button type="button" className="pos-shift-button" onClick={() => setOpenAmountOpen(false)} disabled={busy}>Cancelar</button>
              <button className="pos-shift-button pos-shift-button-primary" disabled={busy}>Continuar</button>
            </div>
          </form>
        ) : closeOpen && current ? (
          <form className="cash-ficha" onSubmit={(event) => { event.preventDefault(); void confirmClose(closeOwnerPin); }}>
            <ol className="cash-close-steps">
              <li className="done">PIN verificado</li>
              <li className="current">Conteo y cuadre</li>
              <li>Resumen</li>
            </ol>
            <header className="cash-close-title">
              <p>Cerrar turno</p>
              <h2>Cuadre de caja</h2>
            </header>
            {error && <p className="error" role="alert">{error}</p>}
            <label className="cash-field">
              Efectivo contado
              <input type="number" min={0} step="0.01" value={countedCash} onChange={(event) => setCountedCash(event.target.value)} required />
            </label>
            <p className={`creation-modal-hint ${cashCountDiff === 0 ? "" : "difference"}`}>
              Esperado {money.format(current.expectedCash)} · Diferencia {money.format(cashCountDiff)}
            </p>
            <label className="cash-field">
              Tarjeta contada
              <input type="number" min={0} step="0.01" value={countedCard} onChange={(event) => setCountedCard(event.target.value)} required />
            </label>
            <p className={`creation-modal-hint ${cardCountDiff === 0 ? "" : "difference"}`}>
              Esperado {money.format(expectedCard)} · Diferencia {money.format(cardCountDiff)}
            </p>
            <label className="cash-field">
              Nota de cierre
              <input maxLength={500} value={closingNote} onChange={(event) => setClosingNote(event.target.value)} />
            </label>
            <div className="cash-close-footer">
              <button type="button" className="pos-shift-button" onClick={() => { setCloseOpen(false); setCloseOwnerPin(""); }} disabled={busy}>Cancelar</button>
              <button className="pos-shift-button pos-shift-button-primary" disabled={busy}>{busy ? "Cerrando…" : "Cerrar turno"}</button>
            </div>
          </form>
        ) : movementDone && movementType ? (
          <div className="cash-ficha cash-ficha-narrow cash-success">
            <span className="service-pill status-open"><ActiveIcon /> Listo</span>
            <h2>{movementType === "PAID_IN" ? "Entrada registrada" : "Salida registrada"}</h2>
            <strong>{money.format(Number(movementAmount || 0))}</strong>
            {movementReason ? <p>{movementReason}</p> : null}
            <button
              type="button"
              className="pos-shift-button pos-shift-button-primary"
              onClick={() => {
                setMovementDone(false);
                setMovementType(null);
                setMovementAmount("");
                setMovementReason("");
                setShowOpenDetail(true);
              }}
            >
              Volver al turno
            </button>
          </div>
        ) : movementType ? (
          <form className="cash-ficha cash-ficha-narrow creation-modal-form" onSubmit={addMovement}>
            <header className="cash-close-title">
              <p>Efectivo</p>
              <h2>{movementType === "PAID_IN" ? "Registrar entrada" : "Registrar salida"}</h2>
            </header>
            {error && <p className="error" role="alert">{error}</p>}
            <label>
              Importe
              <input type="number" min="0.01" step="0.01" value={movementAmount} onChange={(event) => setMovementAmount(event.target.value)} required autoFocus />
            </label>
            <label>
              Motivo {movementType === "PAID_IN" ? "(opcional)" : ""}
              <input
                maxLength={240}
                value={movementReason}
                onChange={(event) => setMovementReason(event.target.value)}
                required={movementType === "PAID_OUT"}
                placeholder={movementType === "PAID_IN" ? "Opcional" : undefined}
              />
            </label>
            <div className="cash-close-footer">
              <button type="button" className="pos-shift-button" onClick={() => setMovementType(null)} disabled={busy}>Cancelar</button>
              <button className="pos-shift-button pos-shift-button-primary" disabled={busy}>{busy ? "Registrando…" : "Registrar"}</button>
            </div>
          </form>
        ) : reviewedShift ? (
          <CloseSummary
            shift={reviewedShift}
            onBack={() => {
              setClosedShift(null);
              setHistoryShift(null);
            }}
            onOpenNew={!current ? startOpen : undefined}
          />
        ) : current && justOpened && !showOpenDetail ? (
          <div className="cash-ficha">
            <header className="cash-shift-head">
              <div>
                <p>Abierto por {current.openedBy}</p>
                <h2>Turno abierto</h2>
                <small>{new Date(current.openedAt).toLocaleString("es-ES")}{duration ? ` · ${duration}` : ""}</small>
              </div>
              <div className="cash-shift-hero">
                <span>Efectivo esperado</span>
                <strong>{money.format(current.expectedCash)}</strong>
              </div>
            </header>
            <div className="cash-close-footer">
              <button type="button" className="pos-shift-button" onClick={() => setJustOpened(false)}>← Volver a turnos</button>
              <button type="button" className="pos-shift-button pos-shift-button-primary" onClick={() => { setJustOpened(false); setShowOpenDetail(true); }}>Ver detalle</button>
            </div>
          </div>
        ) : current && showOpenDetail ? (
          <>
            <button type="button" className="cash-back" onClick={() => setShowOpenDetail(false)}>← Volver a turnos</button>
            <header className="cash-shift-head">
              <div>
                <p>Abierto por {current.openedBy}</p>
                <h2>Detalle del turno</h2>
                <small>
                  {new Date(current.openedAt).toLocaleString("es-ES")}
                  {duration ? ` · ${duration}` : ""}
                </small>
              </div>
              <div className="cash-shift-hero">
                <span>Efectivo esperado</span>
                <strong>{money.format(current.expectedCash)}</strong>
                <em className="service-pill status-open"><ActiveIcon /> Abierto</em>
              </div>
            </header>
            <div className="cash-metric-grid">
              <Metric label="Fondo inicial" value={current.openingAmount} />
              <Metric label="Ventas en efectivo" value={current.cashSales} />
              <Metric label="Ventas con tarjeta" value={current.cardSales} />
              <Metric label="Reembolsos efectivo" value={-current.cashRefunds} />
              <Metric label="Reembolsos tarjeta" value={-current.cardRefunds} />
              <Metric label="Entradas" value={current.paidIn} />
              <Metric label="Salidas" value={current.paidOut} />
              <Metric label="Efectivo esperado" value={current.expectedCash} emphasized />
              <Metric label="Tarjeta esperada" value={expectedCard} emphasized />
            </div>
            <div className="cash-shift-actions">
              <button type="button" className="cash-pane-action" disabled={busy} onClick={() => { setMovementType("PAID_IN"); setError(""); }}>
                <PlusIcon /> Entrada
              </button>
              <button type="button" className="cash-pane-action" disabled={busy} onClick={() => { setMovementType("PAID_OUT"); setError(""); }}>
                <MinusIcon /> Salida
              </button>
              <button
                type="button"
                className="cash-pane-action primary"
                disabled={busy}
                onClick={() => void startClose()}
              >
                <BillIcon /> Cerrar y cuadrar
              </button>
            </div>
            <div className="cash-shift-movements">
              <h3>Movimientos</h3>
              {current.movements.length > 0 ? current.movements.map((movement) => (
                <article key={movement.id} className="cash-movement-row">
                  <div>
                    <strong>{movement.type === "PAID_IN" ? "Entrada" : "Salida"}</strong>
                    {movement.reason ? <span>{movement.reason}</span> : null}
                  </div>
                  <time>{new Date(movement.createdAt).toLocaleString("es-ES")}</time>
                  <b className={movement.type === "PAID_IN" ? "in" : "out"}>
                    {movement.type === "PAID_IN" ? "+" : "−"}{money.format(movement.amount)}
                  </b>
                </article>
              )) : (
                <p className="pos-pane-hint">Sin entradas ni salidas en este turno.</p>
              )}
            </div>
          </>
        ) : (
          <>
            <header className="cash-shift-head">
              <div>
                <p>Turnos de caja</p>
                <h2>Turnos</h2>
                <small>Toca un turno para ver el detalle, el cuadre o el historial.</small>
              </div>
            </header>
            {current ? (
              <button type="button" className="cash-history-row cash-open-row" onClick={() => { setJustOpened(false); setShowOpenDetail(true); }}>
                <div>
                  <strong>Turno en curso</strong>
                  <span>{current.openedBy} · {new Date(current.openedAt).toLocaleString("es-ES")}{duration ? ` · ${duration}` : ""}</span>
                </div>
                <b>{money.format(current.expectedCash)}</b>
                <small className="ok">Abierto</small>
              </button>
            ) : (
              <div className="cash-empty">
                <h2>Sin turno abierto</h2>
                <p>Abre el turno con el fondo inicial y el PIN del propietario para poder cobrar en el TPV.</p>
              </div>
            )}
            <div className="cash-shift-movements cash-history-block">
              <h3>Últimos turnos</h3>
              {closedHistory.length > 0 ? closedHistory.map((shift) => (
                <button
                  type="button"
                  key={shift.id}
                  className="cash-history-row"
                  onClick={() => setHistoryShift(shift)}
                >
                  <div>
                    <strong>{new Date(shift.openedAt).toLocaleDateString("es-ES")}</strong>
                    <span>{shift.openedBy}{shift.closedBy ? ` · ${shift.closedBy}` : ""}</span>
                  </div>
                  <b>{money.format(shift.cashSales + shift.cardSales - shift.cashRefunds - shift.cardRefunds)}</b>
                  <small className={(shift.cashDifference ?? 0) === 0 ? "ok" : "difference"}>
                    Efectivo {money.format(shift.cashDifference ?? 0)}
                  </small>
                </button>
              )) : (
                <p className="pos-pane-hint">Todavía no hay turnos cerrados.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CloseSummary({
  shift,
  onBack,
  onOpenNew,
}: {
  shift: CashShift;
  onBack: () => void;
  onOpenNew?: () => void;
}) {
  const expectedCard = shift.expectedCard ?? shift.cardSales - shift.cardRefunds;
  const countedCash = shift.closingCountedCash ?? shift.expectedCash;
  const countedCard = shift.closingCountedCard ?? expectedCard;
  const cashDiff = shift.cashDifference ?? countedCash - shift.expectedCash;
  const cardDiff = shift.cardDifference ?? countedCard - expectedCard;
  const netSales = shift.cashSales + shift.cardSales - shift.cashRefunds - shift.cardRefunds;
  const leaveInDrawer = shift.openingAmount;
  const withdraw = Math.max(0, countedCash - leaveInDrawer);
  const activity = [
    {
      at: shift.openedAt,
      text: `Apertura de turno · fondo inicial ${money.format(shift.openingAmount)}`,
      who: `${shift.openedBy} · PIN del propietario`,
    },
    ...shift.movements.map((movement) => ({
      at: movement.createdAt,
      text: `${movement.type === "PAID_IN" ? "Entrada" : "Salida"}${movement.reason ? ` · ${movement.reason}` : ""} · ${movement.type === "PAID_IN" ? "+" : "−"}${money.format(movement.amount)}`,
      who: shift.openedBy,
    })),
    ...(shift.closedAt
      ? [{
          at: shift.closedAt,
          text: `Cierre · efectivo contado ${money.format(countedCash)} · datáfono ${money.format(countedCard)} · diferencia ${money.format(cashDiff)}`,
          who: `${shift.closedBy ?? "Propietario"} · PIN`,
        }]
      : []),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return (
    <div className="cash-close-page">
      <header className="cash-close-title">
        <p>Turnos de caja</p>
        <h2>Cierre de turno</h2>
      </header>
      <ol className="cash-close-steps">
        <li className="done">PIN verificado</li>
        <li className="done">Conteo y cuadre</li>
        <li className="current">Resumen</li>
      </ol>
      <div className="cash-close-hero">
        <div>
          <h3>Turno cerrado</h3>
          <p>
            {shift.closedAt
              ? `Cerrado el ${new Date(shift.closedAt).toLocaleString("es-ES")}${shift.closedBy ? ` por ${shift.closedBy}` : ""}, con PIN`
              : "Resumen del turno"}
          </p>
        </div>
        <div className="cash-shift-hero">
          <span>Ventas del turno</span>
          <strong>{money.format(netSales)}</strong>
        </div>
      </div>
      <div className="cash-close-grid">
        <span />
        <span>Sistema</span>
        <span>Contado</span>
        <span>Diferencia</span>
        <b>Efectivo</b>
        <b>{money.format(shift.expectedCash)}</b>
        <b>{money.format(countedCash)}</b>
        <VarianceBadge value={cashDiff} />
        <b>Tarjeta</b>
        <b>{money.format(expectedCard)}</b>
        <b>{money.format(countedCard)}</b>
        <VarianceBadge value={cardDiff} />
      </div>
      <div className="cash-close-split">
        <article>
          <span>Nota de cierre</span>
          <p>{shift.closingNote || "Sin nota."}</p>
        </article>
        <article className="next">
          <span>Para el próximo turno</span>
          <p>Dejar en caja (fondo inicial) <strong>{money.format(leaveInDrawer)}</strong></p>
          <p>Retirar del cajón <strong>{money.format(withdraw)}</strong></p>
        </article>
      </div>
      <div className="cash-shift-movements">
        <h3>Registro de actividad</h3>
        {activity.map((row) => (
          <article key={`${row.at}-${row.text}`} className="cash-movement-row">
            <div>
              <strong>{row.text}</strong>
              <span>{row.who}</span>
            </div>
            <time>{new Date(row.at).toLocaleString("es-ES")}</time>
          </article>
        ))}
      </div>
      <div className="cash-close-footer">
        <button type="button" className="pos-shift-button" onClick={onBack}>← Volver a turnos</button>
        <div className="cash-topbar-actions">
          <button type="button" className="pos-shift-button" onClick={() => printCloseSummary(shift)}>Imprimir resumen</button>
          {onOpenNew ? (
            <button type="button" className="pos-shift-button pos-shift-button-primary" onClick={onOpenNew}>
              Abrir nuevo turno
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PinPad({
  value,
  busy,
  onDigit,
}: {
  value: string;
  busy: boolean;
  onDigit: (digit: string) => void;
}) {
  return (
    <div className="cash-pin">
      <div className="cash-pin-dots" aria-hidden="true">
        {Array.from({ length: Math.max(4, value.length) }, (_, index) => (
          <span key={index} className={index < value.length ? "filled" : ""} />
        ))}
      </div>
      <div className="cash-pin-pad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((key) => (
          key === "" ? <span key="blank" /> : (
            <button type="button" key={key} disabled={busy} onClick={() => onDigit(key)}>{key}</button>
          )
        ))}
      </div>
    </div>
  );
}

function printCloseSummary(shift: CashShift) {
  const expectedCard = shift.expectedCard ?? shift.cardSales - shift.cardRefunds;
  const countedCash = shift.closingCountedCash ?? shift.expectedCash;
  const countedCard = shift.closingCountedCard ?? expectedCard;
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.width = "80mm";
  frame.style.height = "120mm";
  frame.style.opacity = "0";
  frame.style.border = "0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(`<!doctype html><html><head><title>CIERRE</title>
    <style>
      @page { size: 80mm auto; margin: 10mm; }
      body { font-family: sans-serif; font-size: 13px; }
      h1 { font-size: 16px; }
      p { display: flex; justify-content: space-between; margin: 4px 0; }
    </style></head><body>
    <h1>CIERRE DE TURNO</h1>
    <p><span>Cajero</span><b>${shift.openedBy}</b></p>
    <p><span>Apertura</span><b>${new Date(shift.openedAt).toLocaleString("es-ES")}</b></p>
    ${shift.closedAt ? `<p><span>Cierre</span><b>${new Date(shift.closedAt).toLocaleString("es-ES")}</b></p>` : ""}
    <p><span>Efectivo sistema</span><b>${money.format(shift.expectedCash)}</b></p>
    <p><span>Efectivo contado</span><b>${money.format(countedCash)}</b></p>
    <p><span>Tarjeta sistema</span><b>${money.format(expectedCard)}</b></p>
    <p><span>Tarjeta contada</span><b>${money.format(countedCard)}</b></p>
    ${shift.closingNote ? `<p><span>Nota</span><b>${shift.closingNote}</b></p>` : ""}
    </body></html>`);
  doc.close();
  frame.contentWindow?.focus();
  frame.contentWindow?.print();
  window.setTimeout(() => frame.remove(), 1500);
}

function VarianceBadge({ value }: { value: number }) {
  if (Math.abs(value) < 0.005) {
    return <span className="cash-variance ok">Cuadra</span>;
  }
  return (
    <span className={`cash-variance ${value < 0 ? "short" : "over"}`}>
      {value < 0 ? `Faltan ${money.format(Math.abs(value))}` : `Sobra ${money.format(value)}`}
    </span>
  );
}

function formatDuration(openedAt: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - new Date(openedAt).getTime()) / 60000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return `${hours} h ${rest} min`;
}

function Metric({ label, value, emphasized = false }: { label: string; value: number; emphasized?: boolean }) {
  return (
    <div className={emphasized ? "cash-tile emphasized" : "cash-tile"}>
      <span>{label}</span>
      <strong>{money.format(value)}</strong>
    </div>
  );
}

function CashRegisterIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 9h14v10H5zM8 9V5h7l2 4M8 13h3M14 13h2M8 16h8" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="10" width="14" height="10" rx="1.5" />
      <path d="M8 10V8a4 4 0 0 1 8 0v2" />
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

function MinusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 12h12" />
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

function ActiveIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="7.5" />
      <path d="M8.2 12.2 10.8 15l5-6" />
    </svg>
  );
}
