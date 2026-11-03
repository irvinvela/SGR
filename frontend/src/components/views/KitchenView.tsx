"use client";

import { useEffect, useState } from "react";
import { useAppNavigation } from "@/components/AppShell";
import {
  CurrentUser,
  KitchenRound,
  changeKitchenRoundStatus,
  listKitchenRounds,
} from "@/lib/api";

const statusLabels: Record<KitchenRound["status"], string> = {
  QUEUED: "Nueva",
  PREPARING: "En preparación",
  READY: "Lista",
  COMPLETED: "Completada",
};

const nextStatus: Partial<Record<KitchenRound["status"], "PREPARING" | "READY" | "COMPLETED">> = {
  QUEUED: "PREPARING",
  PREPARING: "READY",
  READY: "COMPLETED",
};

const STATION_KEY = "sgr.stationTab";

function readStation(): "KITCHEN" | "BAR" {
  if (typeof window === "undefined") return "BAR";
  try {
    return window.sessionStorage.getItem(STATION_KEY) === "KITCHEN" ? "KITCHEN" : "BAR";
  } catch {
    return "BAR";
  }
}

export default function KitchenView() {
  const { user, locationId, navigate, activeSection } = useAppNavigation();
  const [station, setStation] = useState<"KITCHEN" | "BAR">(readStation);
  const [rounds, setRounds] = useState<KitchenRound[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bar = station === "BAR";

  useEffect(() => {
    if (activeSection !== "bar" && activeSection !== "kitchen") return;
    setStation(readStation());
  }, [activeSection]);

  function selectStation(next: "KITCHEN" | "BAR") {
    setStation(next);
    try {
      window.sessionStorage.setItem(STATION_KEY, next);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!locationId) return;
    let active = true;
    const load = () => listKitchenRounds(locationId, station)
      .then((result) => {
        if (active) {
          setRounds(result);
          setError("");
        }
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      });
    load();
    const timer = window.setInterval(load, 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [locationId, station]);

  async function advance(round: KitchenRound) {
    const status = nextStatus[round.status];
    if (!status) return;
    setBusy(true);
    try {
      const updated = await changeKitchenRoundStatus({
        roundId: round.id,
        status,
        expectedVersion: round.version,
      });
      setRounds((current) => status === "COMPLETED"
        ? current.filter((item) => item.id !== updated.id && item.id !== round.id)
        : current.map((item) => item.id === updated.id ? updated : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : bar ? "No se pudo actualizar la ronda de barra" : "No se pudo actualizar la ronda");
      setRounds(await listKitchenRounds(locationId, station));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="view-toggle station-toggle" role="tablist" aria-label="Estación">
        <button
          type="button"
          className="service-chip"
          role="tab"
          aria-selected={station === "KITCHEN"}
          aria-pressed={station === "KITCHEN"}
          onClick={() => selectStation("KITCHEN")}
        >
          Cocina
        </button>
        <button
          type="button"
          className="service-chip"
          role="tab"
          aria-selected={station === "BAR"}
          aria-pressed={station === "BAR"}
          onClick={() => selectStation("BAR")}
        >
          Barra
        </button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <section className="kitchen-board" aria-label={bar ? "Rondas activas de barra" : "Rondas activas de cocina"}>
        {(["QUEUED", "PREPARING", "READY"] as KitchenRound["status"][]).map((status) => (
          <div className="kitchen-column" key={status}>
            <header>
              <h2>{statusLabels[status]}</h2>
              <span>{rounds.filter((round) => round.status === status).length}</span>
            </header>
            {rounds.filter((round) => round.status === status).map((round) => (
              <article className="kitchen-ticket" key={round.id}>
                <div className="ticket-heading">
                  <button
                    type="button"
                    className="kitchen-ticket-open"
                    onClick={() => navigate("pos", { orderId: round.orderId })}
                  >
                    <small>Ronda {round.roundNumber} · #{round.orderNumber}</small>
                    <h3>{round.tableName}</h3>
                    <small>{round.areaName}</small>
                  </button>
                  <time>{formatTime(round.sentAt)}</time>
                </div>
                <ul>
                  {round.items.map((item) => (
                    <li className={item.voided ? "voided" : undefined} key={item.id}>
                      <strong>{item.quantity} × {item.productName}</strong>
                      {item.kitchenNote && <em>{item.kitchenNote}</em>}
                      {item.voided && (
                        <em>ANULADO · {item.voidReason}</em>
                      )}
                    </li>
                  ))}
                </ul>
                {canAdvance(user) && nextStatus[round.status] && (
                  <button className="primary-button" disabled={busy} onClick={() => advance(round)}>
                    {round.status === "QUEUED" && "Empezar"}
                    {round.status === "PREPARING" && "Marcar lista"}
                    {round.status === "READY" && "Completar"}
                  </button>
                )}
              </article>
            ))}
          </div>
        ))}
      </section>
      {rounds.length === 0 && (
        <p className="empty-state">
          {bar ? "No hay rondas activas en barra." : "No hay rondas activas en cocina."}
        </p>
      )}
    </>
  );
}

function canAdvance(user: CurrentUser) {
  return ["OWNER", "MANAGER", "KITCHEN"].includes(user.role);
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
