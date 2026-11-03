"use client";

import { useMemo, useState } from "react";
import { DailySales } from "@/lib/api";

const NODE_W = 10;
const COL_X = [72, 250, 460];
const VIEW_W = 620;
const GAP = 10;
const PAD_Y = 8;
const AREA_COLORS = ["#9bb8c9", "#e6c19a", "#e3adb4", "#c5d4a8", "#b7c4d4", "#d8c4a4"];

type Node = {
  id: string;
  label: string;
  column: 0 | 1 | 2;
  value: number;
  color: string;
  x: number;
  y: number;
  h: number;
  inY: number;
  outY: number;
};

type Link = {
  source: string;
  target: string;
  value: number;
  color: string;
  d?: string;
};

export function SalesSankey({
  daily,
  money,
  selectedArea,
  onSelectArea,
}: {
  daily: DailySales;
  money: Intl.NumberFormat;
  selectedArea?: string | null;
  onSelectArea?: (area: string | null) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);

  const chart = useMemo(() => layout(daily), [daily]);

  if (chart.total <= 0) {
    return <p className="empty-state">No hay importes para dibujar el flujo de este día.</p>;
  }

  return (
    <div className="sales-sankey">
      <svg
        viewBox={`0 0 ${VIEW_W} ${chart.height}`}
        role="img"
        aria-label="Flujo de ventas del día por salón y método de cobro"
      >
        {chart.links.map((link) => {
          const key = `${link.source}-${link.target}`;
          const active = !hover || hover === key || hover === link.source || hover === link.target;
          return (
            <path
              key={key}
              d={link.d}
              fill={link.color}
              opacity={active ? 0.78 : 0.18}
              onMouseEnter={() => setHover(key)}
              onMouseLeave={() => setHover(null)}
            >
              <title>
                {chart.nodes[link.source].label} → {chart.nodes[link.target].label}: {money.format(link.value)}
              </title>
            </path>
          );
        })}
        {Object.values(chart.nodes).map((node) => {
          const selected = selectedArea && node.id === `area:${selectedArea}`;
          const faded = hover && hover !== node.id && !hover.includes(node.id);
          return (
            <g
              key={node.id}
              opacity={faded ? 0.35 : 1}
              style={{ cursor: node.column === 1 ? "pointer" : "default" }}
              onMouseEnter={() => setHover(node.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => {
                if (node.column !== 1 || !onSelectArea) return;
                const name = node.id.slice(5);
                onSelectArea(selectedArea === name ? null : name);
              }}
            >
              <rect
                x={node.x}
                y={node.y}
                width={NODE_W}
                height={node.h}
                rx={3}
                fill={node.color}
                stroke={selected ? "var(--primary)" : "none"}
                strokeWidth={selected ? 2 : 0}
              />
              <text
                x={node.column === 0 ? node.x - 8 : node.x + NODE_W + 8}
                y={node.y + node.h / 2 - 6}
                textAnchor={node.column === 0 ? "end" : "start"}
                dominantBaseline="middle"
                fill="var(--text)"
                fontSize={11}
                fontWeight={700}
              >
                {node.label}
              </text>
              <text
                x={node.column === 0 ? node.x - 8 : node.x + NODE_W + 8}
                y={node.y + node.h / 2 + 8}
                textAnchor={node.column === 0 ? "end" : "start"}
                dominantBaseline="middle"
                fill="var(--muted)"
                fontSize={10}
              >
                {money.format(node.value)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function layout(daily: DailySales) {
  const areas = new Map<string, { gross: number; cash: number; card: number; refund: number }>();
  for (const sale of daily.sales) {
    const current = areas.get(sale.areaName) ?? { gross: 0, cash: 0, card: 0, refund: 0 };
    current.gross += sale.grossTotal;
    current.cash += sale.cashTotal;
    current.card += sale.cardTotal;
    current.refund += sale.refundedTotal;
    areas.set(sale.areaName, current);
  }

  let cash = 0;
  let card = 0;
  let refund = 0;
  let gross = 0;
  for (const area of areas.values()) {
    cash += area.cash;
    card += area.card;
    refund += area.refund;
    gross += area.gross;
  }
  const total = Math.max(gross, cash + card + refund, 0.01);

  const nodes: Record<string, Node> = {};
  const add = (id: string, label: string, column: 0 | 1 | 2, value: number, color: string) => {
    if (value <= 0.004) return;
    nodes[id] = {
      id,
      label,
      column,
      value,
      color,
      x: COL_X[column],
      y: 0,
      h: 0,
      inY: 0,
      outY: 0,
    };
  };

  add("ventas", "Ventas", 0, gross || cash + card + refund, "#9aa3a8");
  [...areas.entries()].forEach(([name, area], index) => {
    add(`area:${name}`, name, 1, area.gross || area.cash + area.card + area.refund, AREA_COLORS[index % AREA_COLORS.length]);
  });
  add("efectivo", "Efectivo", 2, cash, "#e6c19a");
  add("tarjeta", "Tarjeta", 2, card, "#9bb8c9");
  add("reembolso", "Reembolsos", 2, refund, "#d46a62");

  const innerH = 148;
  const height = innerH + PAD_Y * 2 + 12;
  placeColumn(nodes, 0, innerH);
  placeColumn(nodes, 1, innerH);
  placeColumn(nodes, 2, innerH);

  const links: Link[] = [];
  for (const [name, area] of areas.entries()) {
    const source = nodes[`area:${name}`];
    if (!source || !nodes.ventas) continue;
    links.push({
      source: "ventas",
      target: source.id,
      value: source.value,
      color: source.color,
    });
    pushLink(links, nodes, source.id, "efectivo", area.cash, source.color);
    pushLink(links, nodes, source.id, "tarjeta", area.card, source.color);
    pushLink(links, nodes, source.id, "reembolso", area.refund, "#e3adb4");
  }

  for (const link of links) {
    const source = nodes[link.source];
    const target = nodes[link.target];
    const sh = (link.value / source.value) * source.h;
    const th = (link.value / target.value) * target.h;
    const y0 = source.y + source.outY;
    const y1 = target.y + target.inY;
    source.outY += sh;
    target.inY += th;
    const x0 = source.x + NODE_W;
    const x1 = target.x;
    const mid = (x0 + x1) / 2;
    link.d = [
      `M ${x0} ${y0}`,
      `C ${mid} ${y0}, ${mid} ${y1}, ${x1} ${y1}`,
      `L ${x1} ${y1 + th}`,
      `C ${mid} ${y1 + th}, ${mid} ${y0 + sh}, ${x0} ${y0 + sh}`,
      "Z",
    ].join(" ");
  }

  return { nodes, links, height, total };
}

function placeColumn(nodes: Record<string, Node>, column: 0 | 1 | 2, innerH: number) {
  const list = Object.values(nodes).filter((node) => node.column === column);
  const sum = list.reduce((acc, node) => acc + node.value, 0) || 1;
  const usable = innerH - GAP * Math.max(0, list.length - 1);
  let y = PAD_Y;
  for (const node of list) {
    node.h = Math.max(22, (node.value / sum) * usable);
    node.y = y;
    y += node.h + GAP;
  }
}

function pushLink(
  links: Link[],
  nodes: Record<string, Node>,
  source: string,
  target: string,
  value: number,
  color: string,
) {
  if (value <= 0.004 || !nodes[source] || !nodes[target]) return;
  links.push({ source, target, value, color });
}
