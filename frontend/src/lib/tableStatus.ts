import { DiningTable, RestaurantOrder } from "@/lib/api";

export function hasOpenPedido(order?: RestaurantOrder | null): boolean {
  if (!order) return false;
  if (order.status !== "OPEN" && order.status !== "WAITING_PAYMENT") return false;
  return (order.items ?? []).some((item) => !item.voided && Number(item.quantity) > 0);
}

export function orderForTable(
  orders: RestaurantOrder[],
  tableId: string,
): RestaurantOrder | undefined {
  const matches = orders.filter((order) => order.tableId === tableId);
  return matches.find((order) => hasOpenPedido(order))
    ?? matches.find((order) => order.status === "OPEN" || order.status === "WAITING_PAYMENT");
}

export function liveTableStatus(
  table: DiningTable,
  order?: RestaurantOrder | null,
): DiningTable["status"] {
  if (table.status === "OUT_OF_SERVICE") return "OUT_OF_SERVICE";
  if (hasOpenPedido(order)) {
    return order?.status === "WAITING_PAYMENT" ? "WAITING_PAYMENT" : "OCCUPIED";
  }
  if (table.status === "RESERVED") return "RESERVED";
  return "FREE";
}

export function withLiveTableStatus(
  table: DiningTable,
  order?: RestaurantOrder | null,
): DiningTable {
  const status = liveTableStatus(table, order);
  return status === table.status ? table : { ...table, status };
}
