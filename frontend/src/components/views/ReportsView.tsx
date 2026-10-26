"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  Location,
  ReportDashboard,
  getReportDashboard,
  listLocations,
} from "@/lib/api";

export default function ReportsView() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [dashboard, setDashboard] = useState<ReportDashboard | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    listLocations()
      .then((result) => {
        setLocations(result);
        if (!result[0]) {
          setError("No hay locales disponibles.");
          setBusy(false);
          return;
        }
        const end = dateInZone(result[0].timezone);
        setLocationId(result[0].id);
        setTo(end);
        setFrom(shiftDate(end, -89));
      })
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : "No se pudieron cargar los locales");
        setBusy(false);
      });
  }, []);

  useEffect(() => {
    if (!locationId || !from || !to) return;
    if (from > to) {
      setError("La fecha inicial debe ser anterior a la fecha final.");
      return;
    }
    setBusy(true);
    getReportDashboard(locationId, from, to)
      .then((result) => {
        setDashboard(result);
        setError("");
      })
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : "No se pudieron cargar los reportes");
      })
      .finally(() => setBusy(false));
  }, [locationId, from, to]);

  function changeLocation(nextId: string) {
    setLocationId(nextId);
    const location = locations.find((item) => item.id === nextId);
    if (location) {
      const end = dateInZone(location.timezone);
      setTo(end);
      setFrom(shiftDate(end, -89));
    }
  }

  const money = useMemo(
    () => new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: dashboard?.currency ?? "EUR",
    }),
    [dashboard?.currency],
  );

  return (
    <section className="reports-view">
      {error && <p className="error" role="alert">{error}</p>}
      {busy && <p className="report-loading" role="status">Actualizando reportes…</p>}

      <div className={dashboard ? "report-overview" : "report-overview report-overview-pending"}>
        <div className="report-controls">
          <label>
            Local
            <select value={locationId} onChange={(event) => changeLocation(event.target.value)}>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>{location.name}</option>
              ))}
            </select>
          </label>
          <label>
            Desde
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label>
            Hasta
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
        </div>

        {dashboard && (
            <section className="report-summary" aria-label="Resumen del período">
              <ReportMetric label="Ventas netas" value={money.format(dashboard.netSales)} />
              <ReportMetric label="Pedidos cobrados" value={String(dashboard.orderCount)} />
              <ReportMetric label="Productos activos" value={String(dashboard.activeProducts)} />
              <ReportMetric label="Reembolsos" value={money.format(dashboard.refunds)} />
            </section>
        )}
      </div>

      {dashboard && (
          <div className="reports-grid">
            <article className="report-card report-card-daily">
              <ReportHeading
                title="Venta diaria"
                description="Ventas cobradas menos reembolsos, agrupadas por fecha operativa."
              />
              <DailySalesChart dashboard={dashboard} money={money} />
            </article>

            <article className="report-card report-card-payment">
              <ReportHeading
                title="Cobros por método"
                description="Importe bruto cobrado en efectivo y tarjeta durante el período."
              />
              <PaymentChart dashboard={dashboard} money={money} />
            </article>

            <article className="report-card">
              <ReportHeading
                title="Productos activos por categoría"
                description="Distribución actual de la carta del local."
              />
              <CategoryChart dashboard={dashboard} />
            </article>

            <article className="report-card">
              <ReportHeading
                title="Productos más vendidos"
                description="Productos con mayor cantidad vendida durante el período."
              />
              <BestSellingProductsChart dashboard={dashboard} money={money} />
            </article>
          </div>
      )}
    </section>
  );
}

function ReportMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ReportHeading({ title, description }: { title: string; description: string }) {
  return (
    <header className="report-card-heading">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </header>
  );
}

function DailySalesChart({
  dashboard,
  money,
}: {
  dashboard: ReportDashboard;
  money: Intl.NumberFormat;
}) {
  const points = dashboard.dailySales.filter(
    (point) => point.orderCount > 0 || point.refunds > 0,
  );
  const max = Math.max(...points.map((point) => point.grossSales), 0);
  if (!points.length || max <= 0) {
    return <p className="empty-state">No hay ventas en el período seleccionado.</p>;
  }
  return (
    <>
      <div className="report-daily-scroll">
        <div
          className="report-daily-chart"
          style={{ minWidth: `${Math.max(620, points.length * 58)}px` }}
          aria-label="Gráfico de venta diaria"
        >
          {points.map((point) => {
            const grossHeight = Math.max(4, (point.grossSales / max) * 100);
            const netHeight = Math.max(0, (point.netSales / max) * 100);
            return (
              <div className="report-day" key={point.date}>
                <div className="report-day-value">{money.format(point.netSales)}</div>
                <div className="report-bar-track">
                  <div
                    className="report-bar-gross"
                    style={{ height: `${grossHeight}%` }}
                    title={`Bruto ${money.format(point.grossSales)}`}
                  />
                  <div
                    className="report-bar-net"
                    style={{ height: `${netHeight}%` }}
                    title={`Neto ${money.format(point.netSales)}`}
                  />
                </div>
                <time dateTime={point.date}>{shortDate(point.date)}</time>
                <small>{point.orderCount} {point.orderCount === 1 ? "pedido" : "pedidos"}</small>
              </div>
            );
          })}
        </div>
      </div>
      <div className="report-legend">
        <span><i className="legend-net" />Venta neta</span>
        <span><i className="legend-gross" />Bruto antes de reembolsos</span>
      </div>
    </>
  );
}

function CategoryChart({ dashboard }: { dashboard: ReportDashboard }) {
  const categories = dashboard.categories.filter((category) => category.activeProducts > 0);
  const max = Math.max(...categories.map((category) => category.activeProducts), 1);
  if (!categories.length) {
    return <p className="empty-state">No hay productos activos.</p>;
  }
  return (
    <div className="report-category-chart" aria-label="Productos activos por categoría">
      {categories.map((category) => (
        <div className="report-category-row" key={category.categoryId}>
          <span title={category.name}>{category.name}</span>
          <div className="report-category-track">
            <div style={{ width: `${(category.activeProducts / max) * 100}%` }} />
          </div>
          <strong>{category.activeProducts}</strong>
        </div>
      ))}
    </div>
  );
}

function BestSellingProductsChart({
  dashboard,
  money,
}: {
  dashboard: ReportDashboard;
  money: Intl.NumberFormat;
}) {
  const products = dashboard.bestSellingProducts ?? [];
  const max = Math.max(...products.map((product) => product.quantitySold), 1);
  const quantity = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 3 });
  if (!products.length) {
    return <p className="empty-state">No hay productos vendidos en el período seleccionado.</p>;
  }
  return (
    <div className="report-best-sellers" aria-label="Productos más vendidos">
      {products.map((product, index) => (
        <div className="report-best-seller-row" key={product.productId}>
          <span className="report-best-seller-rank">{index + 1}</span>
          <div>
            <header>
              <span title={product.name}>{product.name}</span>
              <strong>{quantity.format(product.quantitySold)}</strong>
            </header>
            <div className="report-best-seller-track">
              <div style={{ width: `${(product.quantitySold / max) * 100}%` }} />
            </div>
            <small>{product.sku} · {money.format(product.grossSales)}</small>
          </div>
        </div>
      ))}
    </div>
  );
}

function PaymentChart({
  dashboard,
  money,
}: {
  dashboard: ReportDashboard;
  money: Intl.NumberFormat;
}) {
  const cash = dashboard.paymentMethods.find((item) => item.method === "CASH");
  const card = dashboard.paymentMethods.find((item) => item.method === "CARD");
  const cashAmount = cash?.grossAmount ?? 0;
  const cardAmount = card?.grossAmount ?? 0;
  const total = cashAmount + cardAmount;
  const cashShare = total > 0 ? (cashAmount / total) * 100 : 0;
  if (total <= 0) {
    return <p className="empty-state">No hay cobros en el período seleccionado.</p>;
  }
  return (
    <div className="report-payment-layout">
      <div
        className="report-donut"
        style={{ "--cash-share": `${cashShare}%` } as CSSProperties}
        role="img"
        aria-label={`Efectivo ${cashShare.toFixed(1)} %, tarjeta ${(100 - cashShare).toFixed(1)} %`}
      >
        <div>
          <strong>{money.format(total)}</strong>
          <span>Total cobrado</span>
        </div>
      </div>
      <div className="report-payment-legend">
        <PaymentLegend
          className="cash"
          label="Efectivo"
          amount={cashAmount}
          count={cash?.paymentCount ?? 0}
          money={money}
        />
        <PaymentLegend
          className="card"
          label="Tarjeta"
          amount={cardAmount}
          count={card?.paymentCount ?? 0}
          money={money}
        />
      </div>
    </div>
  );
}

function PaymentLegend({
  className,
  label,
  amount,
  count,
  money,
}: {
  className: string;
  label: string;
  amount: number;
  count: number;
  money: Intl.NumberFormat;
}) {
  return (
    <div>
      <i className={className} />
      <span>{label}<small>{count} {count === 1 ? "cobro" : "cobros"}</small></span>
      <strong>{money.format(amount)}</strong>
    </div>
  );
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

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}
