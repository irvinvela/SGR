"use client";

import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAppNavigation } from "@/components/AppShell";
import { PreBillPreview, ReceiptKind, ReceiptPayment } from "@/components/PreBillPreview";
import { SearchField } from "@/components/SearchField";
import { SystemSelect } from "@/components/SystemSelect";
import {
  AddonGroup,
  CurrentUser,
  DiningArea,
  DiningTable,
  MenuCategory,
  OrderItem,
  OrderPaymentSummary,
  Product,
  RestaurantOrder,
  ServiceChannel,
  addOrderItem,
  correctOrderPayment,
  createPayment,
  editOrderItem,
  getCurrentCashShift,
  getOrderPaymentSummary,
  listAddonGroups,
  listAreas,
  listCategories,
  listOrders,
  listProducts,
  listTables,
  openOrder,
  itemGoesToBar,
  requestOrderPayment,
  sendOrderToBar,
  sendOrderToKitchen,
  updateOrderChannel,
  updateOrderGuests,
  voidOrderItem,
} from "@/lib/api";
import { liveTableStatus, orderForTable, withLiveTableStatus } from "@/lib/tableStatus";

const money = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

const tableLabels: Record<DiningTable["status"], string> = {
  FREE: "Libre",
  OCCUPIED: "Ocupada",
  WAITING_PAYMENT: "Cuenta",
  OUT_OF_SERVICE: "Fuera",
  RESERVED: "Reserva",
};

type Pane = "tables" | "menu" | "ticket";

function addMoney(total: number, delta: number) {
  return Math.round((total + delta) * 100) / 100;
}

function lineKey(orderId: string, productId: string, note?: string) {
  return `${orderId}\0${productId}\0${note ?? ""}`;
}

function samePendingLine(item: OrderItem, productId: string, note?: string) {
  return item.productId === productId
    && !item.sentToKitchen
    && !item.voided
    && (item.kitchenNote ?? "") === (note ?? "");
}

function groupsForProduct(groups: AddonGroup[], productId: string) {
  return groups.filter((group) => (
    group.productIds.includes(productId)
    && group.options.some((option) => option.available)
  ));
}

function addonExtra(groups: AddonGroup[], selected: Record<string, string[]>) {
  return groups.reduce((total, group) => {
    const extra = (selected[group.id] ?? []).reduce((sum, optionId) => {
      const option = group.options.find((item) => item.id === optionId);
      return option ? addMoney(sum, option.price) : sum;
    }, 0);
    return addMoney(total, extra);
  }, 0);
}

function formatAddonNote(groups: AddonGroup[], selected: Record<string, string[]>) {
  return groups.flatMap((group) => {
    const names = (selected[group.id] ?? [])
      .map((optionId) => group.options.find((option) => option.id === optionId)?.name)
      .filter((name): name is string => Boolean(name));
    return names.length ? [`${group.name}: ${names.join(", ")}`] : [];
  }).join(" · ");
}

function composeKitchenNote(addonNote: string, userNote: string) {
  return [addonNote.trim(), userNote.trim()].filter(Boolean).join("\n") || undefined;
}

function addonSelectionError(groups: AddonGroup[], selected: Record<string, string[]>) {
  for (const group of groups) {
    const count = selected[group.id]?.length ?? 0;
    const min = group.required ? Math.max(1, group.minSelect) : group.minSelect;
    if (count < min) {
      return min === 1 ? `Elige una opción en ${group.name}` : `Elige ${min} opciones en ${group.name}`;
    }
    if (count > group.maxSelect) {
      return `Como máximo ${group.maxSelect} en ${group.name}`;
    }
  }
  return "";
}

function mergeOpenOrders(
  current: RestaurantOrder[],
  incoming: RestaurantOrder[],
  syncing: Set<string>,
) {
  if (syncing.size === 0) return incoming;
  const kept = new Map(current.filter((order) => syncing.has(order.tableId)).map((order) => [order.tableId, order]));
  const merged = incoming.map((order) => {
    const local = kept.get(order.tableId);
    if (!local || local.id.startsWith("local:")) return local ?? order;
    if (order.status !== local.status || order.version > local.version) return order;
    const remoteSent = order.items.filter((item) => item.sentToKitchen).length;
    const localSent = local.items.filter((item) => item.sentToKitchen).length;
    return remoteSent > localSent ? order : local;
  });
  for (const order of current) {
    if (order.id.startsWith("local:") && syncing.has(order.tableId) && !merged.some((item) => item.tableId === order.tableId)) {
      merged.push(order);
    }
  }
  return merged;
}

function rememberLines(
  target: Map<string, { id: string; version: number; quantity: number }>,
  orders: RestaurantOrder[],
) {
  target.clear();
  for (const order of orders) {
    if (order.id.startsWith("local:")) continue;
    for (const item of order.items ?? []) {
      if (item.voided || item.sentToKitchen || item.id.startsWith("tmp:")) continue;
      target.set(lineKey(order.id, item.productId, item.kitchenNote), {
        id: item.id,
        version: item.version,
        quantity: Number(item.quantity),
      });
    }
  }
}

export default function PosView() {
  const { user, selectedOrderId, selectedTableId, rememberSelection, navigate, locationId, locations, activeSection } = useAppNavigation();
  const [areas, setAreas] = useState<DiningArea[]>([]);
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [addonGroups, setAddonGroups] = useState<AddonGroup[]>([]);
  const [orders, setOrders] = useState<RestaurantOrder[]>([]);
  const [areaId, setAreaId] = useState("all");
  const [categoryId, setCategoryId] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(selectedOrderId ?? "");
  const [pickedTableId, setPickedTableId] = useState(selectedTableId ?? "");
  const [floorReady, setFloorReady] = useState("");
  const [pane, setPane] = useState<Pane>(() => (
    selectedOrderId ? "ticket" : selectedTableId ? "menu" : "tables"
  ));
  const [cashShiftOpen, setCashShiftOpen] = useState<boolean | null>(null);
  const [payMethod, setPayMethod] = useState<"CASH" | "CARD" | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [paySummary, setPaySummary] = useState<OrderPaymentSummary | null>(null);
  const [tendered, setTendered] = useState("");
  const [retryKeys, setRetryKeys] = useState<Record<string, string>>({});
  const [payRetryKey, setPayRetryKey] = useState("");
  const [withPhoto, setWithPhoto] = useState(true);
  const [channel, setChannel] = useState<ServiceChannel>("DINE_IN");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [receipt, setReceipt] = useState<{
    order: RestaurantOrder;
    kind: ReceiptKind;
    payment?: ReceiptPayment;
  } | null>(null);
  const [noteDraft, setNoteDraft] = useState<{ product?: Product; item?: OrderItem } | null>(null);
  const [noteText, setNoteText] = useState("");
  const [qtyDraft, setQtyDraft] = useState<{ item: OrderItem; value: string } | null>(null);
  const [addonDraft, setAddonDraft] = useState<{
    product: Product;
    selected: Record<string, string[]>;
    note: string;
  } | null>(null);
  const appliedNav = useRef("");
  const refreshRequest = useRef(0);
  const locationRef = useRef(locationId);
  const ordersRef = useRef(orders);
  const writeTail = useRef(new Map<string, Promise<void>>());
  const syncingRef = useRef(new Set<string>());
  const confirmedLine = useRef(new Map<string, { id: string; version: number; quantity: number }>());
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    setHeaderSlot(document.getElementById("workspace-header-actions"));
  }, [activeSection]);

  useEffect(() => {
    if (activeSection !== "pos") {
      setNotice("");
      setReceipt(null);
    }
  }, [activeSection]);

  useEffect(() => {
    if (locationRef.current === locationId) return;
    locationRef.current = locationId;
    setSelectedId("");
    setPickedTableId("");
    setQuery("");
    setCategoryId("all");
    setAreaId("all");
    setPane("tables");
    setTables([]);
    setOrders([]);
    setFloorReady("");
    appliedNav.current = "";
  }, [locationId]);

  useEffect(() => {
    if (!locationId) return;
    refresh(locationId);
  }, [locationId]);

  useEffect(() => {
    if (activeSection !== "pos" || !locationId || !floorReady.startsWith(`${locationId}:`)) return;
    refresh(locationId);
  }, [activeSection]);

  useLayoutEffect(() => {
    const key = `${selectedOrderId ?? ""}:${selectedTableId ?? ""}`;
    if (!key.replace(":", "") || appliedNav.current === key) return;
    if (selectedOrderId) {
      if (selectedId === selectedOrderId) {
        appliedNav.current = key;
        return;
      }
      setSelectedId(selectedOrderId);
      setPane("ticket");
      appliedNav.current = key;
      return;
    }
    if (!selectedTableId || !tables.length) return;
    const currentOrder = orders.find((item) => item.id === selectedId);
    if (pickedTableId === selectedTableId || currentOrder?.tableId === selectedTableId) {
      appliedNav.current = key;
      return;
    }
    const table = tables.find((item) => item.id === selectedTableId);
    if (table) setAreaId(table.areaId);
    const order = orderForTable(orders, selectedTableId);
    if (order && (order.items ?? []).some((item) => !item.voided && Number(item.quantity) > 0)) {
      setSelectedId(order.id);
      setPane("menu");
    } else {
      setPickedTableId(selectedTableId);
      setSelectedId("");
      setPane("menu");
    }
    appliedNav.current = key;
  }, [orders, pickedTableId, selectedId, selectedOrderId, selectedTableId, tables]);

  async function refresh(currentLocationId = locationId) {
    const request = ++refreshRequest.current;
    const current = () => request === refreshRequest.current;
    const jobs = await Promise.allSettled([
      listAreas(currentLocationId).then((areaResult) => {
        if (!current()) return;
        setAreas(areaResult);
        setAreaId((existing) => (
          existing !== "all" && areaResult.some((area) => area.id === existing)
            ? existing
            : areaResult[0]?.id ?? "all"
        ));
      }),
      listTables(currentLocationId).then((tableResult) => {
        if (!current()) return;
        setTables((existing) => (
          syncingRef.current.size === 0
            ? tableResult
            : tableResult.map((table) => (
              syncingRef.current.has(table.id)
                ? existing.find((item) => item.id === table.id) ?? table
                : table
            ))
        ));
      }),
      listCategories(currentLocationId).then((categoryResult) => {
        if (!current()) return;
        setCategories(categoryResult);
        setCategoryId((existing) => (
          existing !== "all" && categoryResult.some((category) => category.id === existing)
            ? existing
            : categoryResult[0]?.id ?? "all"
        ));
      }),
      listProducts(currentLocationId).then((productResult) => {
        if (current()) setProducts(productResult.filter((product) => product.available));
      }),
      listAddonGroups(currentLocationId).then((addonResult) => {
        if (current()) setAddonGroups(addonResult);
      }).catch(() => {
        if (current()) setAddonGroups([]);
      }),
      listOrders(currentLocationId).then((orderResult) => {
        if (!current()) return;
        const next = mergeOpenOrders(ordersRef.current, orderResult, syncingRef.current);
        ordersRef.current = next;
        setOrders(next);
        if (syncingRef.current.size === 0) rememberLines(confirmedLine.current, next);
      }),
      getCurrentCashShift(currentLocationId).then((shiftResult) => {
        if (current()) setCashShiftOpen(Boolean(shiftResult.shift));
      }),
    ]);
    if (!current()) return;
    const failed = jobs.find((job) => job.status === "rejected");
    if (jobs[0].status === "fulfilled" && jobs[1].status === "fulfilled" && jobs[5].status === "fulfilled") {
      setFloorReady(`${currentLocationId}:${request}`);
    }
    if (failed?.status === "rejected") {
      const cause = failed.reason;
      setError(cause instanceof Error ? cause.message : "No se pudo cargar el punto de venta");
      return;
    }
    setError("");
  }

  const orderByTable = useMemo(() => {
    const map = new Map<string, RestaurantOrder>();
    for (const table of tables) {
      const order = orderForTable(orders, table.id);
      if (order) map.set(table.id, order);
    }
    return map;
  }, [orders, tables]);
  const selected = orders.find((order) => order.id === selectedId) ?? null;

  useEffect(() => {
    if (activeSection !== "pos") return;
    const tableId = selected?.tableId || pickedTableId;
    if (!tableId) return;
    rememberSelection({
      orderId: selected && !selected.id.startsWith("local:") ? selected.id : undefined,
      tableId,
    });
  }, [activeSection, pickedTableId, rememberSelection, selected]);
  const selectedTable = tables.find((table) => table.id === selected?.tableId) ?? null;
  const tableNumber = tableBadge(selectedTable?.name ?? selected?.tableName ?? "", selectedTable?.code ?? "");
  const visibleTables = tables
    .map((table) => withLiveTableStatus(table, orderByTable.get(table.id)))
    .filter((table) => (
      table.status !== "OUT_OF_SERVICE"
      && (areaId === "all" || table.areaId === areaId)
    ));
  const pickedTable = tables.find((table) => table.id === pickedTableId) ?? null;
  const activeTableId = selectedTable?.id || pickedTableId;

  const search = query.trim();
  const visibleProducts = products.filter((product) => {
    if (search) {
      return normalizeSearch(`${product.name} ${product.sku} ${product.categoryName}`).includes(normalizeSearch(search));
    }
    if (categoryId !== "all" && product.categoryId !== categoryId) return false;
    return true;
  });
  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );
  const isDrinkLine = (item: OrderItem) => itemGoesToBar(item, productById.get(item.productId));
  const pendingItems = selected
    ? selected.items.filter((item) => !item.sentToKitchen && !item.voided)
    : [];
  const kitchenPendingItems = pendingItems.filter((item) => !isDrinkLine(item));
  const drinkPendingItems = pendingItems.filter((item) => isDrinkLine(item));
  const sentItems = selected
    ? selected.items.filter((item) => item.sentToKitchen && !item.voided)
    : [];
  const kitchenPendingCount = kitchenPendingItems.length;
  const barPendingCount = drinkPendingItems.length;
  const itemCount = selected
    ? selected.items.filter((item) => !item.voided).reduce((sum, item) => sum + item.quantity, 0)
    : 0;
  const locked = selected?.status === "WAITING_PAYMENT";
  const due = paySummary && paySummary.orderId === selected?.id ? paySummary.balance : selected?.total ?? 0;
  const collectAmount = Number(payAmount || due);
  const change = payMethod === "CASH"
    ? Math.max(0, Number(tendered || collectAmount) - collectAmount)
    : 0;
  const qtyByProduct = useMemo(() => {
    const map = new Map<string, number>();
    if (!selected) return map;
    for (const item of selected.items) {
      if (item.voided) continue;
      map.set(item.productId, (map.get(item.productId) ?? 0) + item.quantity);
    }
    return map;
  }, [selected]);

  async function selectTable(table: DiningTable) {
    setError("");
    setPickedTableId(table.id);
    const order = orderByTable.get(table.id);
    if (order) {
      setSelectedId(order.id);
      setPayMethod(null);
      setTendered("");
      setPane(order.status === "WAITING_PAYMENT" ? "ticket" : "menu");
      return;
    }
    setSelectedId("");
    setPayMethod(null);
    setTendered("");
    const live = liveTableStatus(table, order);
    if (live === "FREE" || live === "RESERVED") setPane("menu");
  }

  function updateOrders(recipe: (orders: RestaurantOrder[]) => RestaurantOrder[]) {
    const next = recipe(ordersRef.current);
    ordersRef.current = next;
    setOrders(next);
  }

  function enqueue(tableId: string, job: () => Promise<void>) {
    syncingRef.current.add(tableId);
    const previous = writeTail.current.get(tableId) ?? Promise.resolve();
    const run = previous
      .catch(() => undefined)
      .then(job)
      .catch(() => undefined)
      .finally(() => {
        if (writeTail.current.get(tableId) === run) {
          syncingRef.current.delete(tableId);
          writeTail.current.delete(tableId);
        }
      });
    writeTail.current.set(tableId, run);
    return run;
  }

  async function settle(tableId: string) {
    const tail = writeTail.current.get(tableId);
    if (tail) await tail;
    syncingRef.current.delete(tableId);
    writeTail.current.delete(tableId);
    return ordersRef.current.find((order) => order.tableId === tableId && !order.id.startsWith("local:")) ?? null;
  }

  async function ensureRealOrder(table: DiningTable) {
    const live = ordersRef.current.find((order) => (
      order.tableId === table.id && !order.id.startsWith("local:") && order.status === "OPEN"
    ));
    if (live) return live;
    const created = await openOrder({ locationId, tableId: table.id, guestCount: 2, orderType: channel });
    updateOrders((list) => {
      const local = list.find((order) => order.id === `local:${table.id}`);
      if (!local) return list.some((order) => order.id === created.id) ? list : [...list, created];
      return list.map((order) => (
        order.id === local.id
          ? { ...created, items: local.items, total: local.total, orderType: local.orderType ?? created.orderType }
          : order
      ));
    });
    setSelectedId((current) => current === `local:${table.id}` ? created.id : current);
    return ordersRef.current.find((order) => order.id === created.id) ?? created;
  }

  function placeOptimisticItem(orderId: string, product: Product, note: string | undefined, unitPrice: number) {
    const tempId = `tmp:${crypto.randomUUID()}`;
    updateOrders((list) => list.map((order) => {
      if (order.id !== orderId) return order;
      const items = order.items ?? [];
      const existing = items.find((item) => samePendingLine(item, product.id, note));
      if (existing) {
        return {
          ...order,
          total: addMoney(order.total, unitPrice),
          items: items.map((item) => (
            item.id === existing.id ? { ...item, quantity: item.quantity + 1 } : item
          )),
        };
      }
      const created: OrderItem = {
        id: tempId,
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        quantity: 1,
        unitPrice,
        taxRate: product.taxRate,
        kitchenNote: note,
        sentToKitchen: false,
        voided: false,
        prepStation: product.prepStation,
        version: 0,
      };
      return { ...order, total: addMoney(order.total, unitPrice), items: [...items, created] };
    }));
  }

  function undoOptimisticItem(tableId: string, productId: string, note: string | undefined, price: number) {
    updateOrders((list) => list.flatMap((order) => {
      if (order.tableId !== tableId) return [order];
      let changed = false;
      const items = order.items.flatMap((item) => {
        if (changed || !samePendingLine(item, productId, note)) return [item];
        changed = true;
        if (item.quantity <= 1) return [];
        return [{ ...item, quantity: item.quantity - 1 }];
      });
      if (!changed) return [order];
      if (order.id.startsWith("local:") && items.length === 0) return [];
      return [{ ...order, items, total: addMoney(order.total, -price) }];
    }));
  }

  function requestProduct(product: Product) {
    const groups = groupsForProduct(addonGroups, product.id);
    if (groups.length === 0) {
      void addProduct(product);
      return;
    }
    setAddonDraft({
      product,
      selected: Object.fromEntries(groups.map((group) => [group.id, []])),
      note: "",
    });
  }

  function toggleAddon(group: AddonGroup, optionId: string) {
    setAddonDraft((current) => {
      if (!current) return current;
      const selected = current.selected[group.id] ?? [];
      const has = selected.includes(optionId);
      let next: string[];
      if (group.maxSelect <= 1) {
        next = has ? [] : [optionId];
      } else if (has) {
        next = selected.filter((id) => id !== optionId);
      } else if (selected.length >= group.maxSelect) {
        return current;
      } else {
        next = [...selected, optionId];
      }
      return { ...current, selected: { ...current.selected, [group.id]: next } };
    });
  }

  function saveAddons(event: FormEvent) {
    event.preventDefault();
    if (!addonDraft) return;
    const groups = groupsForProduct(addonGroups, addonDraft.product.id);
    const invalid = addonSelectionError(groups, addonDraft.selected);
    if (invalid) {
      setError(invalid);
      return;
    }
    const extra = addonExtra(groups, addonDraft.selected);
    void addProduct(addonDraft.product, {
      kitchenNote: addonDraft.note,
      displayNote: composeKitchenNote(formatAddonNote(groups, addonDraft.selected), addonDraft.note),
      extra,
      optionIds: Object.values(addonDraft.selected).flat(),
    });
  }

  async function addProduct(
    product: Product,
    options?: { kitchenNote?: string; displayNote?: string; extra?: number; optionIds?: string[] },
  ) {
    const userNote = options?.kitchenNote?.trim() || undefined;
    const note = options?.displayNote?.trim() || userNote;
    const extra = options?.extra ?? 0;
    const unitPrice = addMoney(product.price, extra);
    const optionIds = options?.optionIds;
    setNoteDraft(null);
    setNoteText("");
    setAddonDraft(null);
    setError("");
    const table = tables.find((item) => item.id === pickedTableId) ?? null;
    let order = ordersRef.current.find((item) => item.id === selectedId) ?? null;
    if (!order && table) {
      order = ordersRef.current.find((item) => item.tableId === table.id && item.status === "OPEN") ?? null;
    }
    const live = table ? liveTableStatus(table, order) : "FREE";
    if (!order && table && (live === "FREE" || live === "RESERVED")) {
      const localId = `local:${table.id}`;
      order = {
        id: localId,
        orderNumber: 0,
        locationId,
        tableId: table.id,
        tableName: table.name,
        areaName: table.areaName,
        status: "OPEN",
        guestCount: 2,
        openedAt: new Date().toISOString(),
        version: 0,
        total: 0,
        items: [],
        orderType: channel,
      };
      updateOrders((list) => [...list, order as RestaurantOrder]);
      setSelectedId(localId);
      setPickedTableId(table.id);
      setPane("menu");
    }
    if (!order) {
      setError("Selecciona o abre una mesa para añadir productos.");
      setPane("tables");
      return;
    }
    if (order.status !== "OPEN") {
      setError("Corrige la cuenta antes de añadir productos.");
      setPane("ticket");
      return;
    }
    const previousStatus = table?.status;
    placeOptimisticItem(order.id, product, note, unitPrice);
    const tableId = order.tableId;
    enqueue(tableId, async () => {
      let opened = false;
      try {
        const liveTable = tables.find((item) => item.id === tableId) ?? table;
        const real = await ensureRealOrder(liveTable ?? {
          id: tableId,
          locationId,
          areaId: "",
          areaName: order?.areaName ?? "",
          code: "",
          name: order?.tableName ?? "",
          capacity: 2,
          status: "OCCUPIED",
          posX: 0,
          posY: 0,
          version: 0,
        });
        opened = true;
        const key = lineKey(real.id, product.id, note);
        const known = confirmedLine.current.get(key);
        if (!known) {
          const saved = await addOrderItem({
            orderId: real.id,
            productId: product.id,
            quantity: 1,
            kitchenNote: userNote,
            addonOptionIds: optionIds,
          });
          confirmedLine.current.set(key, {
            id: saved.id,
            version: saved.version,
            quantity: Number(saved.quantity),
          });
          updateOrders((list) => list.map((item) => {
            if (item.id !== real.id) return item;
            let replaced = false;
            return {
              ...item,
              items: item.items.map((line) => {
                if (replaced || !line.id.startsWith("tmp:") || !samePendingLine(line, product.id, note)) return line;
                replaced = true;
                return { ...line, id: saved.id, version: saved.version, unitPrice: Number(saved.unitPrice) };
              }),
            };
          }));
          return;
        }
        const saved = await editOrderItem({
          itemId: known.id,
          quantity: known.quantity + 1,
          kitchenNote: note,
          expectedVersion: known.version,
        });
        confirmedLine.current.set(key, {
          id: saved.id,
          version: saved.version,
          quantity: Number(saved.quantity),
        });
          updateOrders((list) => list.map((item) => {
            if (item.id !== real.id) return item;
            return {
              ...item,
              items: item.items.map((line) => (
                samePendingLine(line, product.id, note)
                  ? { ...line, id: saved.id, version: saved.version, unitPrice: Number(saved.unitPrice) }
                  : line
              )),
            };
          }));
      } catch (cause) {
        undoOptimisticItem(tableId, product.id, note, unitPrice);
        const local = ordersRef.current.find((item) => item.id === `local:${tableId}`);
        if (!opened && !local && previousStatus && previousStatus !== "OCCUPIED") {
          setTables((current) => current.map((item) => (
            item.id === tableId ? { ...item, status: previousStatus } : item
          )));
          setSelectedId((current) => current === `local:${tableId}` ? "" : current);
        }
        setError(cause instanceof Error ? cause.message : "No se pudo añadir el producto");
      }
    });
  }

  async function saveNote(event: FormEvent) {
    event.preventDefault();
    if (noteDraft?.product) {
      await addProduct(noteDraft.product, { kitchenNote: noteText });
      return;
    }
    if (!noteDraft?.item || !selected) return;
    setBusy(true);
    try {
      await editOrderItem({
        itemId: noteDraft.item.id,
        quantity: noteDraft.item.quantity,
        kitchenNote: noteText.trim(),
        expectedVersion: noteDraft.item.version,
      });
      setNoteDraft(null);
      setNoteText("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar la nota");
    } finally {
      setBusy(false);
    }
  }

  function setItemQuantity(item: OrderItem, quantity: number) {
    changeQty(item, quantity - item.quantity);
  }

  async function saveQty(event: FormEvent) {
    event.preventDefault();
    if (!qtyDraft) return;
    const parsed = Number.parseInt(qtyDraft.value, 10);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 999) {
      setError("Introduce una cantidad entre 0 y 999.");
      return;
    }
    setItemQuantity(qtyDraft.item, parsed);
    setQtyDraft(null);
  }

  async function changeQty(item: OrderItem, delta: number) {
    if (!selected || selected.status !== "OPEN" || item.sentToKitchen || item.voided) return;
    const next = item.quantity + delta;
    if (next < 0) return;
    const tableId = selected.tableId;
    const orderId = selected.id;
    const note = item.kitchenNote;
    const price = item.unitPrice;
    updateOrders((list) => list.map((order) => {
      if (order.id !== orderId) return order;
      const items = order.items.flatMap((line) => {
        if (line.id !== item.id) return [line];
        if (next === 0) return [];
        return [{ ...line, quantity: next }];
      });
      return { ...order, items, total: addMoney(order.total, price * delta) };
    }));
    enqueue(tableId, async () => {
      try {
        const real = await ensureRealOrder({
          id: tableId,
          locationId,
          areaId: "",
          areaName: selected.areaName,
          code: "",
          name: selected.tableName,
          capacity: selected.guestCount,
          status: "OCCUPIED",
          posX: 0,
          posY: 0,
          version: 0,
        });
        const key = lineKey(real.id, item.productId, note);
        const known = confirmedLine.current.get(key);
        if (!known) {
          if (delta < 0) return;
          const saved = await addOrderItem({
            orderId: real.id,
            productId: item.productId,
            quantity: 1,
            kitchenNote: note,
          });
          confirmedLine.current.set(key, { id: saved.id, version: saved.version, quantity: Number(saved.quantity) });
          updateOrders((list) => list.map((order) => {
            if (order.id !== real.id) return order;
            let replaced = false;
            return {
              ...order,
              items: order.items.map((line) => {
                if (replaced || !line.id.startsWith("tmp:") || !samePendingLine(line, item.productId, note)) return line;
                replaced = true;
                return { ...line, id: saved.id, version: saved.version, unitPrice: Number(saved.unitPrice) };
              }),
            };
          }));
          return;
        }
        const target = known.quantity + delta;
        if (target <= 0) {
          await voidOrderItem({
            itemId: known.id,
            reason: "Retirada en punto de venta",
            expectedVersion: known.version,
          });
          confirmedLine.current.delete(key);
          return;
        }
        const saved = await editOrderItem({
          itemId: known.id,
          quantity: target,
          kitchenNote: note,
          expectedVersion: known.version,
        });
        confirmedLine.current.set(key, { id: saved.id, version: saved.version, quantity: Number(saved.quantity) });
        updateOrders((list) => list.map((order) => {
          if (order.id !== real.id) return order;
          return {
            ...order,
            items: order.items.map((line) => (
              line.id === item.id || line.id === saved.id
                ? { ...line, id: saved.id, version: saved.version }
                : line
            )),
          };
        }));
      } catch (cause) {
        updateOrders((list) => list.flatMap((order) => {
          if (order.tableId !== tableId) return [order];
          let changed = false;
          const items = order.items.flatMap((line) => {
            if (changed || !samePendingLine(line, item.productId, note)) return [line];
            changed = true;
            const quantity = line.quantity - delta;
            if (quantity <= 0) return [];
            return [{ ...line, quantity }];
          });
          if (!changed) {
            if (delta >= 0) return [order];
            return [{ ...order, items: [...order.items, { ...item, quantity: 1 }], total: addMoney(order.total, price) }];
          }
          if (order.id.startsWith("local:") && items.length === 0) return [];
          return [{ ...order, items, total: addMoney(order.total, -(price * delta)) }];
        }));
        setError(cause instanceof Error ? cause.message : "No se pudo actualizar la línea");
      }
    });
  }

  async function changeChannel(next: ServiceChannel) {
    if (channel === next) return;
    setChannel(next);
    const current = selected ?? ordersRef.current.find((order) => order.id === selectedId);
    if (!current || current.status !== "OPEN") return;
    updateOrders((list) => list.map((order) => (
      order.id === current.id ? { ...order, orderType: next } : order
    )));
    enqueue(current.tableId, async () => {
      try {
        const live = await settle(current.tableId);
        const order = live ?? ordersRef.current.find((item) => item.tableId === current.tableId);
        if (!order || order.id.startsWith("local:")) return;
        const saved = await updateOrderChannel({
          orderId: order.id,
          orderType: next,
          expectedVersion: order.version,
        });
        updateOrders((list) => list.map((item) => (
          item.id === saved.id ? { ...item, orderType: saved.orderType, version: saved.version } : item
        )));
      } catch (cause) {
        const restored = current.orderType ?? "DINE_IN";
        setChannel(restored);
        updateOrders((list) => list.map((item) => (
          item.id === current.id ? { ...item, orderType: restored } : item
        )));
        setError(cause instanceof Error ? cause.message : "No se pudo guardar el tipo de pedido");
      }
    });
  }

  async function changeGuests(delta: number) {
    if (!selected || selected.status !== "OPEN") return;
    const live = await settle(selected.tableId);
    const order = live ?? selected;
    if (order.id.startsWith("local:")) return;
    const guestCount = Math.max(1, Math.min(999, order.guestCount + delta));
    if (guestCount === order.guestCount) return;
    setBusy(true);
    try {
      await updateOrderGuests({
        orderId: order.id,
        guestCount,
        expectedVersion: order.version,
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo actualizar los comensales");
    } finally {
      setBusy(false);
    }
  }

  async function clearPending() {
    if (!selected || pendingItems.length === 0) return;
    setBusy(true);
    try {
      const live = await settle(selected.tableId);
      const order = live ?? selected;
      if (order.id.startsWith("local:")) return;
      for (const item of order.items.filter((line) => !line.sentToKitchen && !line.voided)) {
        await voidOrderItem({
          itemId: item.id,
          reason: "Vaciar pendientes",
          expectedVersion: item.version,
        });
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudieron vaciar las partidas pendientes");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function sendKitchen() {
    await sendStation("kitchen");
  }

  async function sendBar() {
    await sendStation("bar");
  }

  async function sendStation(station: "kitchen" | "bar") {
    if (!selected) return;
    setBusy(true);
    try {
      const live = await settle(selected.tableId);
      const order = live ?? selected;
      if (order.id.startsWith("local:")) {
        setError("El pedido todavía no se guardó.");
        return;
      }
      const key = `${station}:${order.id}`;
      const idempotencyKey = retryKeys[key] ?? crypto.randomUUID();
      setRetryKeys((current) => ({ ...current, [key]: idempotencyKey }));
      if (station === "bar") {
        await sendOrderToBar(order.id, idempotencyKey);
      } else {
        await sendOrderToKitchen(order.id, idempotencyKey);
      }
      setRetryKeys((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : station === "bar" ? "No se pudo enviar a barra" : "No se pudo enviar a cocina");
    } finally {
      setBusy(false);
    }
  }

  async function requestBill() {
    if (!selected) return;
    setBusy(true);
    try {
      const live = await settle(selected.tableId);
      const order = live ?? selected;
      if (order.id.startsWith("local:")) {
        setError("El pedido todavía no se guardó.");
        return;
      }
      if (order.status === "OPEN") {
        await requestOrderPayment(order.id, order.version);
        setNotice("Cuenta solicitada. El pedido queda bloqueado.");
      }
      await refresh();
      setPane("ticket");
      const summary = await getOrderPaymentSummary(order.id);
      setPaySummary(summary);
      setPayAmount(String(summary.balance));
      setReceipt({ order: live ?? selected, kind: "charge" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo solicitar la cuenta");
    } finally {
      setBusy(false);
    }
  }

  async function correctBill() {
    if (!selected) return;
    setBusy(true);
    try {
      const live = await settle(selected.tableId);
      const order = live ?? selected;
      await correctOrderPayment(order.id, order.version);
      setPayMethod(null);
      setPayAmount("");
      setPaySummary(null);
      setTendered("");
      setNotice("Cuenta corregida.");
      await refresh();
      setPane("menu");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo corregir la cuenta");
    } finally {
      setBusy(false);
    }
  }

  async function collect() {
    if (!selected || !payMethod) return;
    setBusy(true);
    try {
      const live = await settle(selected.tableId);
      const order = live ?? selected;
      const idempotencyKey = payRetryKey || crypto.randomUUID();
      setPayRetryKey(idempotencyKey);
      const summary = await getOrderPaymentSummary(order.id);
      const amount = Number(payAmount || summary.balance);
      if (!Number.isFinite(amount) || amount <= 0) {
        setError("Introduce un importe mayor que 0.");
        return;
      }
      if (amount - summary.balance > 0.0001) {
        setError(`El importe no puede superar el saldo (${money.format(summary.balance)}).`);
        return;
      }
      const result = await createPayment({
        orderId: order.id,
        method: payMethod,
        amount,
        tenderedAmount: payMethod === "CASH" ? Number(tendered || amount) : undefined,
        idempotencyKey,
      });
      setPayRetryKey("");
      setPaySummary(result.summary);
      setPayAmount(result.summary.balance > 0 ? String(result.summary.balance) : "");
      setPayMethod(null);
      setTendered("");
      setNotice(
        result.summary.status === "PAID"
          ? `Pedido cobrado. Cambio: ${money.format(result.payment.changeAmount)}`
          : `Pago registrado. Saldo: ${money.format(result.summary.balance)}`,
      );
      if (result.summary.status === "PAID") {
        setReceipt({
          order,
          kind: "paid",
          payment: {
            method: payMethod,
            amount: result.payment.amount,
            changeAmount: result.payment.changeAmount,
          },
        });
      }
      await refresh();
      if (result.summary.status === "PAID") {
        setSelectedId("");
        setPaySummary(null);
        setPane("tables");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo registrar el cobro");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const order = orders.find((item) => item.id === selectedId);
    setChannel(order?.orderType ?? "DINE_IN");
  }, [selectedId]);

  useEffect(() => {
    if (selectedId && !orders.some((order) => order.id === selectedId)) {
      setSelectedId("");
      setPayMethod(null);
      setPaySummary(null);
      setPayAmount("");
    }
  }, [orders, selectedId]);

  useEffect(() => {
    if (!selectedId || selected?.status !== "WAITING_PAYMENT") {
      if (selected?.status !== "WAITING_PAYMENT") setPaySummary(null);
      return;
    }
    let cancelled = false;
    getOrderPaymentSummary(selectedId)
      .then((summary) => {
        if (cancelled) return;
        setPaySummary(summary);
        setPayAmount((current) => current || String(summary.balance));
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "No se pudo cargar el saldo");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, selected?.status, selected?.version]);

  const ticketKicker = !selected
    ? ""
    : selected.status === "WAITING_PAYMENT"
      ? "Cuenta solicitada"
      : sentItems.length === 0
        ? "Nuevo pedido"
        : `Pedido #${selected.orderNumber}`;

  return (
    <div className="pos-view">
      {activeSection === "pos" && headerSlot && createPortal(
        <div className="pos-toolbar">
          <button type="button" className="pos-shift-button" onClick={() => navigate("cash")}>
            <RegisterIcon />
            {cashShiftOpen ? "Turno abierto" : "Abrir turno"}
          </button>
        </div>,
        headerSlot,
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}

      <div className={`pos-board pane-${pane}`}>
        <section className="pos-tables" aria-label="Mesas">
          <header className="pos-pane-head">
            <h2><span>1</span> Mesas</h2>
          </header>
          <div className="pos-chip-row" role="group" aria-label="Salón">
            {areas.map((area) => (
              <button
                type="button"
                className="pos-chip"
                key={area.id}
                aria-pressed={areaId === area.id}
                onClick={() => setAreaId(area.id)}
              >
                {area.name}
              </button>
            ))}
          </div>
          <p className="pos-pane-hint">Toca una mesa libre para empezar un pedido en sala. Al cambiar de mesa, el pedido se mantiene.</p>
          <div className="pos-table-grid">
            {visibleTables.map((table) => {
              const on = table.id === activeTableId;
              return (
                <button
                  type="button"
                  key={table.id}
                  className={`pos-table status-${table.status.toLowerCase()} ${on ? "sel" : ""}`}
                  disabled={busy}
                  onClick={() => selectTable(table)}
                >
                  <strong>{table.name}</strong>
                  <small className="pos-table-status">
                    <span aria-hidden="true">{on ? "✓" : table.status === "OCCUPIED" || table.status === "WAITING_PAYMENT" ? "×" : "○"}</span>
                    {on ? "Actual" : tableLabels[table.status]}
                  </small>
                </button>
              );
            })}
          </div>
        </section>

        <section className="pos-menu" aria-label="Productos">
          <header className="pos-pane-head">
            <h2><span>2</span> Productos</h2>
          </header>
          <div className="pos-menu-tools">
            <div className="pos-view-toggle" role="group" aria-label="Presentación de la carta">
              <button type="button" aria-pressed={withPhoto} onClick={() => setWithPhoto(true)}>
                <PhotoIcon />
                Con foto
              </button>
              <button type="button" aria-pressed={!withPhoto} onClick={() => setWithPhoto(false)}>
                <ListIcon />
                Solo nombre
              </button>
            </div>
            <SearchField
              className="pos-search"
              value={query}
              onChange={setQuery}
              placeholder="Buscar producto..."
              aria-label="Buscar producto"
            />
          </div>
          <div className="pos-category-row">
            <SystemSelect
              className={`pos-category-select${categoryId === "all" ? " is-marked" : ""}`}
              aria-label="Categoría"
              value={categoryId}
              onChange={setCategoryId}
              options={[
                { value: "all", label: "Todos" },
                ...categories.map((category) => ({ value: category.id, label: category.name })),
              ]}
            />
            <div className="pos-chip-row pos-chip-scroll" role="group" aria-label="Categorías">
              <button
                type="button"
                className="pos-chip"
                aria-pressed={categoryId === "all"}
                onClick={() => setCategoryId("all")}
              >
                Todos
              </button>
              {categories.map((category) => (
                <button
                  type="button"
                  className="pos-chip"
                  key={category.id}
                  aria-pressed={categoryId === category.id}
                  onClick={() => setCategoryId(category.id)}
                >
                  {category.name}
                </button>
              ))}
            </div>
          </div>
          <div className={`pos-product-grid ${withPhoto ? "with-photo" : "names"}`}>
            {visibleProducts.map((product) => {
              const qty = qtyByProduct.get(product.id) ?? 0;
              return (
                <article className={`pos-product ${withPhoto ? "with-photo" : "name-only"} ${qty > 0 ? "in-ticket" : ""}`} key={product.id}>
                  {qty > 0 && <span className="pos-product-qty">×{qty}</span>}
                  <button
                    type="button"
                    className="pos-product-body"
                    disabled={busy || !canOperate(user)}
                    onClick={() => requestProduct(product)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      if (groupsForProduct(addonGroups, product.id).length) {
                        requestProduct(product);
                        return;
                      }
                      setNoteDraft({ product });
                      setNoteText("");
                    }}
                  >
                    {withPhoto && <ProductMark name={product.name} category={product.categoryName} />}
                    <strong>{product.name}</strong>
                    <span className="pos-product-price">{money.format(product.price)}</span>
                  </button>
                  <div className="pos-product-actions">
                    <button
                      type="button"
                      className="pos-product-note"
                      disabled={busy || !canOperate(user)}
                      aria-label={`Añadir ${product.name} con nota de cocina`}
                      title="Nota de cocina"
                      onClick={() => {
                        if (groupsForProduct(addonGroups, product.id).length) {
                          requestProduct(product);
                          return;
                        }
                        setNoteDraft({ product });
                        setNoteText("");
                      }}
                    >
                      <NoteIcon />
                    </button>
                    <button
                      type="button"
                      className="pos-product-add"
                      disabled={busy || !canOperate(user)}
                      aria-label={`Añadir ${product.name}`}
                      onClick={() => requestProduct(product)}
                    >
                      +
                    </button>
                  </div>
                </article>
              );
            })}
            {visibleProducts.length === 0 && (
              <p className="empty-state">
                {search
                  ? "No hay productos para esta búsqueda."
                  : "No hay productos para esta categoría."}
              </p>
            )}
          </div>
        </section>

        <section className="pos-ticket" aria-label="Pedido actual">
          <header className="pos-pane-head">
            <h2><span>3</span> Pedido actual</h2>
            {ticketKicker.startsWith("Pedido #") && <p className="pos-ticket-kicker">{ticketKicker}</p>}
          </header>
          {!selected && !pickedTable && (
            <p className="empty-state pos-ticket-empty">Toca una mesa libre para abrir pedido o una ocupada para continuar.</p>
          )}
          {!selected && pickedTable && (
            <div className="pos-ticket-scroll">
              <p className="pos-ticket-kicker">Nuevo pedido</p>
              <div className="pos-table-banner">
                <span>{tableBadge(pickedTable.name, pickedTable.code)}</span>
                <strong>{pickedTable.name} · {pickedTable.areaName}</strong>
              </div>
              <p className="empty-state">Añade un producto para abrir el pedido de esta mesa.</p>
            </div>
          )}
          {selected && (
            <>
              <div className="pos-ticket-scroll">
                {ticketKicker.startsWith("Pedido #") ? null : <p className="pos-ticket-kicker">{ticketKicker}</p>}
                <div className="pos-channel" role="group" aria-label="Tipo de pedido">
                  <button type="button" aria-pressed={channel === "DINE_IN"} disabled={busy || locked} onClick={() => changeChannel("DINE_IN")}>
                    <DineInIcon />
                    En el local
                  </button>
                  <button type="button" aria-pressed={channel === "TAKEAWAY"} disabled={busy || locked} onClick={() => changeChannel("TAKEAWAY")}>
                    <BagIcon />
                    Para llevar
                  </button>
                  <button type="button" aria-pressed={channel === "DELIVERY"} disabled={busy || locked} onClick={() => changeChannel("DELIVERY")}>
                    <DeliveryIcon />
                    Delivery
                  </button>
                </div>
                <button type="button" className="pos-inbox" onClick={() => navigate("orders", selected ? { orderId: selected.id, tableId: selected.tableId } : undefined)}>
                  <span><GlobeIcon /> Bandeja de pedidos en línea</span>
                  <span className="pos-inbox-count">Ver</span>
                </button>
                <div className="pos-table-banner">
                  <span>{tableNumber}</span>
                  <strong>{selected.tableName} · {selected.areaName}</strong>
                </div>
                <div className="pos-guests">
                  <span><GuestIcon /> Comensales</span>
                  <div className="pos-qty">
                    <button type="button" disabled={busy || locked} onClick={() => changeGuests(-1)} aria-label="Quitar comensal">−</button>
                    <output>{selected.guestCount}</output>
                    <button type="button" disabled={busy || locked} onClick={() => changeGuests(1)} aria-label="Añadir comensal">+</button>
                  </div>
                </div>
                {locked && (
                  <p className="order-lock-banner">Pedido bloqueado hasta cobrar o corregir la cuenta.</p>
                )}
                {kitchenPendingItems.length > 0 && (
                  <div className="pos-ticket-group">
                    <div className="pos-ticket-group-head">
                      <strong>Pendientes de cocina · {kitchenPendingItems.reduce((sum, item) => sum + item.quantity, 0)} artículos</strong>
                      <button type="button" className="inline-link-button" disabled={busy} onClick={clearPending}>
                        Vaciar pendientes
                      </button>
                    </div>
                    <ul className="pos-lines">
                      {kitchenPendingItems.map((item) => (
                        <li key={item.id}>
                          {selected.status === "OPEN" ? (
                            <div className="pos-qty">
                              <button type="button" disabled={busy} onClick={() => changeQty(item, -1)} aria-label="Quitar">−</button>
                              <button
                                type="button"
                                className="pos-qty-value"
                                disabled={busy}
                                aria-label={`Cantidad ${item.quantity}. Cambiar`}
                                onClick={() => setQtyDraft({ item, value: String(item.quantity) })}
                              >
                                {item.quantity}×
                              </button>
                              <button type="button" disabled={busy} onClick={() => changeQty(item, 1)} aria-label="Añadir">+</button>
                            </div>
                          ) : (
                            <output className="pos-line-qty">{item.quantity}×</output>
                          )}
                          <strong className="pos-line-name">{item.productName}</strong>
                          <span className="pos-line-price">{money.format(item.quantity * item.unitPrice)}</span>
                          {(item.kitchenNote || selected.status === "OPEN") && (
                            <div className="pos-line-note">
                              {item.kitchenNote && <em>{item.kitchenNote}</em>}
                              {selected.status === "OPEN" && (
                                <button
                                  type="button"
                                  className="pos-note-button"
                                  disabled={busy}
                                  onClick={() => {
                                    setNoteDraft({ item });
                                    setNoteText(item.kitchenNote ?? "");
                                  }}
                                >
                                  <NoteIcon />
                                  {item.kitchenNote ? "Editar nota" : "Nota de cocina"}
                                </button>
                              )}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {drinkPendingItems.length > 0 && (
                  <div className="pos-ticket-group">
                    <div className="pos-ticket-group-head">
                      <strong>Bebidas · {drinkPendingItems.reduce((sum, item) => sum + item.quantity, 0)} artículos</strong>
                    </div>
                    <ul className="pos-lines">
                      {drinkPendingItems.map((item) => (
                        <li key={item.id}>
                          {selected.status === "OPEN" ? (
                            <div className="pos-qty">
                              <button type="button" disabled={busy} onClick={() => changeQty(item, -1)} aria-label="Quitar">−</button>
                              <button
                                type="button"
                                className="pos-qty-value"
                                disabled={busy}
                                aria-label={`Cantidad ${item.quantity}. Cambiar`}
                                onClick={() => setQtyDraft({ item, value: String(item.quantity) })}
                              >
                                {item.quantity}×
                              </button>
                              <button type="button" disabled={busy} onClick={() => changeQty(item, 1)} aria-label="Añadir">+</button>
                            </div>
                          ) : (
                            <output className="pos-line-qty">{item.quantity}×</output>
                          )}
                          <strong className="pos-line-name">{item.productName}</strong>
                          <span className="pos-line-price">{money.format(item.quantity * item.unitPrice)}</span>
                          {(item.kitchenNote || selected.status === "OPEN") && (
                            <div className="pos-line-note">
                              {item.kitchenNote && <em>{item.kitchenNote}</em>}
                              {selected.status === "OPEN" && (
                                <button
                                  type="button"
                                  className="pos-note-button"
                                  disabled={busy}
                                  onClick={() => {
                                    setNoteDraft({ item });
                                    setNoteText(item.kitchenNote ?? "");
                                  }}
                                >
                                  <NoteIcon />
                                  {item.kitchenNote ? "Editar nota" : "Nota de cocina"}
                                </button>
                              )}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {sentItems.length > 0 && (
                  <div className="pos-ticket-group">
                    <div className="pos-ticket-group-head">
                      <strong>Enviado a cocina · {sentItems.reduce((sum, item) => sum + item.quantity, 0)} artículos</strong>
                    </div>
                    <ul className="pos-lines">
                      {sentItems.map((item) => (
                        <li key={item.id}>
                          <output className="pos-line-qty">{item.quantity}×</output>
                          <strong className="pos-line-name">{item.productName}</strong>
                          <span className="pos-line-price">{money.format(item.quantity * item.unitPrice)}</span>
                          {item.kitchenNote && <em className="pos-line-note">{item.kitchenNote}</em>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {selected.items.filter((item) => !item.voided).length === 0 && (
                  <p className="empty-state">Añade productos desde la carta.</p>
                )}
                <footer className="pos-ticket-foot">
                  <div className="pos-total">
                    <span>Ítems</span>
                    <strong>{itemCount}</strong>
                  </div>
                  <div className="pos-total pos-subtotal">
                    <span>Subtotal</span>
                    <strong>{money.format(selected.total)}</strong>
                  </div>
                  {selected.status === "OPEN" && canOperate(user) && (
                    <div className="pos-actions">
                      <button className="primary-button" disabled={busy || kitchenPendingCount === 0} onClick={sendKitchen}>
                        Enviar a cocina
                      </button>
                      <button className="primary-button" disabled={busy || barPendingCount === 0} onClick={sendBar}>
                        Enviar a barra
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busy || selected.items.filter((item) => !item.voided).length === 0}
                        onClick={() => setReceipt({ order: selected, kind: "preview" })}
                      >
                        Pre-cuenta
                      </button>
                      <button
                        className="pos-collect-button"
                        disabled={busy || pendingItems.length > 0 || selected.items.filter((item) => !item.voided).length === 0}
                        onClick={requestBill}
                      >
                        Cobrar
                      </button>
                    </div>
                  )}
                </footer>
                {locked && canOperate(user) && (
                  <div className="order-pay-panel">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => setReceipt({ order: selected, kind: "preview" })}
                    >
                      Pre-cuenta
                    </button>
                    {cashShiftOpen === false && (
                      <p className="cash-warning">
                        Abre un turno para cobrar.{" "}
                        <button type="button" className="inline-link-button" onClick={() => navigate("cash")}>
                          Ir a turnos
                        </button>
                        {" "}
                        <button type="button" className="inline-link-button" onClick={() => navigate("checkout", { orderId: selected.id, tableId: selected.tableId })}>
                          Ir a caja
                        </button>
                      </p>
                    )}
                    <div className="pay-method-grid">
                      <button type="button" className="pay-method" aria-pressed={payMethod === "CASH"} disabled={busy || cashShiftOpen !== true} onClick={() => setPayMethod("CASH")}>
                        Efectivo
                      </button>
                      <button type="button" className="pay-method" aria-pressed={payMethod === "CARD"} disabled={busy || cashShiftOpen !== true} onClick={() => setPayMethod("CARD")}>
                        Tarjeta
                      </button>
                    </div>
                    <div className="pos-pay-summary">
                      <p>
                        <span>Total</span>
                        <strong>{money.format(paySummary?.total ?? selected.total)}</strong>
                      </p>
                      <p>
                        <span>Pagado</span>
                        <strong>{money.format(paySummary?.paid ?? 0)}</strong>
                      </p>
                      <p>
                        <span>Saldo</span>
                        <strong>{money.format(due)}</strong>
                      </p>
                    </div>
                    {(paySummary?.payments.length ?? 0) > 0 && (
                      <ul className="pos-pay-log">
                        {paySummary!.payments.map((payment) => (
                          <li key={payment.id}>
                            <span>{payment.method === "CASH" ? "Efectivo" : "Tarjeta"}</span>
                            <strong>{money.format(payment.amount)}</strong>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className={`pos-pay-fields${payMethod === "CASH" ? " has-cash" : ""}`}>
                      <label className="pos-pay-field">
                        <span>Importe a cobrar</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0.01}
                          max={due}
                          step="0.01"
                          value={payAmount}
                          onChange={(event) => setPayAmount(event.target.value)}
                        />
                      </label>
                      {payMethod === "CASH" && (
                        <label className="pos-pay-field">
                          <span>Efectivo recibido</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            min={collectAmount}
                            step="0.01"
                            value={tendered}
                            onChange={(event) => setTendered(event.target.value)}
                          />
                        </label>
                      )}
                      {payMethod === "CASH" && (
                        <p className="change-preview pos-pay-change">
                          <span>Cambio</span>
                          <strong>{money.format(change)}</strong>
                        </p>
                      )}
                    </div>
                    <button className="pos-collect-button" disabled={busy || cashShiftOpen !== true || !payMethod || due <= 0} onClick={collect}>
                      {payMethod ? `Cobrar ${money.format(collectAmount)}` : "Elige método"}
                    </button>
                    <button className="secondary-button" disabled={busy} onClick={correctBill}>
                      Corregir cuenta
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {qtyDraft && (
        <div
          className="creation-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !busy) setQtyDraft(null);
          }}
        >
          <section className="creation-modal" role="dialog" aria-modal="true" aria-labelledby="pos-qty-title">
            <header>
              <div className="creation-modal-title">
                <div>
                  <p>Pedido actual</p>
                  <h2 id="pos-qty-title">Cantidad · {qtyDraft.item.productName}</h2>
                </div>
              </div>
              <button type="button" className="creation-modal-close" aria-label="Cerrar" onClick={() => setQtyDraft(null)} disabled={busy}>
                ×
              </button>
            </header>
            <form className="creation-modal-form" onSubmit={saveQty}>
              <label>
                Unidades
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={999}
                  step={1}
                  value={qtyDraft.value}
                  onChange={(event) => setQtyDraft({ ...qtyDraft, value: event.target.value })}
                  autoFocus
                />
              </label>
              <p className="creation-modal-description">0 retira la partida pendiente. El más y el menos siguen cambiando de uno en uno.</p>
              <div className="creation-modal-actions">
                <button type="button" className="secondary-button" onClick={() => setQtyDraft(null)} disabled={busy}>
                  Cancelar
                </button>
                <button className="primary-button" disabled={busy}>
                  Actualizar
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {addonDraft && (
        <div
          className="creation-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !busy) setAddonDraft(null);
          }}
        >
          <section className="creation-modal pos-addon-modal" role="dialog" aria-modal="true" aria-labelledby="pos-addon-title">
            <header>
              <div className="creation-modal-title">
                <div>
                  <p>Adicionales</p>
                  <h2 id="pos-addon-title">{addonDraft.product.name}</h2>
                </div>
              </div>
              <button type="button" className="creation-modal-close" aria-label="Cerrar" onClick={() => setAddonDraft(null)} disabled={busy}>
                ×
              </button>
            </header>
            <form className="creation-modal-form" onSubmit={saveAddons}>
              {groupsForProduct(addonGroups, addonDraft.product.id).map((group) => {
                const selected = addonDraft.selected[group.id] ?? [];
                return (
                  <fieldset className="pos-addon-group" key={group.id}>
                    <legend>
                      {group.name}
                      <span>
                        {group.required || group.minSelect > 0 ? "Obligatorio" : "Opcional"}
                        {group.maxSelect > 1 ? ` · hasta ${group.maxSelect}` : ""}
                      </span>
                    </legend>
                    <div className="pos-addon-options">
                      {group.options.filter((option) => option.available).map((option) => {
                        const pressed = selected.includes(option.id);
                        return (
                          <button
                            type="button"
                            className="pos-addon-option"
                            key={option.id}
                            aria-pressed={pressed}
                            onClick={() => toggleAddon(group, option.id)}
                          >
                            <strong>{option.name}</strong>
                            <span>{option.price > 0 ? `+ ${money.format(option.price)}` : "Incluido"}</span>
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                );
              })}
              <label>
                Nota para cocina
                <textarea
                  value={addonDraft.note}
                  onChange={(event) => setAddonDraft({ ...addonDraft, note: event.target.value })}
                  maxLength={500}
                  rows={2}
                  placeholder="Opcional"
                />
              </label>
              <p className="creation-modal-description">
                Total línea {money.format(addMoney(addonDraft.product.price, addonExtra(groupsForProduct(addonGroups, addonDraft.product.id), addonDraft.selected)))}
              </p>
              <div className="creation-modal-actions">
                <button type="button" className="secondary-button" onClick={() => setAddonDraft(null)} disabled={busy}>
                  Cancelar
                </button>
                <button className="primary-button" disabled={busy}>
                  Añadir
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {noteDraft && (
        <div
          className="creation-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !busy) setNoteDraft(null);
          }}
        >
          <section className="creation-modal" role="dialog" aria-modal="true" aria-labelledby="pos-note-title">
            <header>
              <div className="creation-modal-title">
                <div>
                  <p>Cocina</p>
                  <h2 id="pos-note-title">
                    {noteDraft.product ? `Nota · ${noteDraft.product.name}` : "Nota de cocina"}
                  </h2>
                </div>
              </div>
              <button type="button" className="creation-modal-close" aria-label="Cerrar" onClick={() => setNoteDraft(null)} disabled={busy}>
                ×
              </button>
            </header>
            <form className="creation-modal-form" onSubmit={saveNote}>
              <label>
                Nota para cocina
                <textarea
                  value={noteText}
                  onChange={(event) => setNoteText(event.target.value)}
                  maxLength={500}
                  rows={4}
                  autoFocus
                  placeholder="Ej. sin cebolla, extra ají"
                />
              </label>
              <div className="creation-modal-actions">
                <button type="button" className="secondary-button" onClick={() => setNoteDraft(null)} disabled={busy}>
                  Cancelar
                </button>
                <button className="primary-button" disabled={busy}>
                  {noteDraft.product ? "Añadir" : "Guardar"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {receipt && (
        <PreBillPreview
          key={`${receipt.kind}:${receipt.order.id}:${receipt.order.version}`}
          order={receipt.order}
          organizationName={user.organizationName}
          locationName={locations.find((location) => location.id === locationId)?.name ?? ""}
          servedBy={user.displayName}
          variant={receipt.kind}
          payment={receipt.payment}
          autoPrint={receipt.kind === "charge" || receipt.kind === "paid"}
          onClose={() => setReceipt(null)}
        />
      )}
      <nav className="pos-mobile-nav" aria-label="Punto de venta">
        <button type="button" aria-pressed={pane === "tables"} onClick={() => setPane("tables")}>Mesas</button>
        <button type="button" aria-pressed={pane === "menu"} onClick={() => setPane("menu")}>Productos</button>
        <button type="button" aria-pressed={pane === "ticket"} onClick={() => setPane("ticket")}>
          Pedido{selected ? ` · ${money.format(selected.total)}` : ""}
        </button>
      </nav>
    </div>
  );
}

function canOperate(user: CurrentUser) {
  return ["OWNER", "MANAGER", "CASHIER", "SERVER"].includes(user.role);
}

function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
}

function ProductMark({ name, category }: { name: string; category: string }) {
  const kind = productKind(`${name} ${category}`);
  return (
    <span className="pos-product-avatar" aria-hidden="true">
      <ProductGlyph kind={kind} />
    </span>
  );
}

function productKind(label: string) {
  const text = normalizeSearch(label);
  const rules: Array<[ProductGlyphKind, string[]]> = [
    ["coffee", ["cafe", "coffee", "expreso", "expreso", "capuccino", "te "]],
    ["beer", ["cerveza", "beer"]],
    ["wine", ["vino", "copa de"]],
    ["dessert", ["postre", "helado", "suspiro", "torta", "brownie", "flan", "dulce"]],
    ["drink", ["chicha", "jugo", "agua", "refresco", "gaseosa", "limonada", "bebida", "inca kola", "soda"]],
    ["salad", ["ensalada", "verdura", "lechuga"]],
    ["fries", ["frita", "yuca", "camote"]],
    ["rice", ["arroz"]],
    ["fish", ["ceviche", "pescado", "marisc", "langost", "camaron", "pulpo", "concha"]],
    ["grill", ["anticucho", "parrilla", "lomo", "pollo", "carne", "entrana", "chuleta", "asado", "bistec", "chancho"]],
    ["bowl", ["sopa", "chupe", "causa", "aji ", "crema", "caldo", "chicharron"]],
  ];
  for (const [kind, words] of rules) {
    if (words.some((word) => text.includes(word))) return kind;
  }
  return "plate";
}

type ProductGlyphKind = "coffee" | "beer" | "wine" | "dessert" | "drink" | "salad" | "fries" | "rice" | "fish" | "grill" | "bowl" | "plate";

function ProductGlyph({ kind }: { kind: ProductGlyphKind }) {
  if (kind === "coffee") {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M6 9h9v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4Z" />
        <path d="M15 11h2.2a2.3 2.3 0 0 1 0 4.6H15" />
        <path d="M8 6.2c.5-.8.5-1.4 0-2.2M11 6.2c.5-.8.5-1.4 0-2.2" />
      </svg>
    );
  }
  if (kind === "beer") {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M7 8h7v10a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3Z" />
        <path d="M14 10h2.2a2 2 0 0 1 0 4H14" />
        <path d="M9 5.5c.4-.7.4-1.2 0-1.9M11.5 5.5c.4-.7.4-1.2 0-1.9" />
      </svg>
    );
  }
  if (kind === "wine") {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M8 4h8l-1.2 6.2a4 4 0 0 1-7.6 0Z" />
        <path d="M12 14.2V20M9 20h6" />
      </svg>
    );
  }
  if (kind === "dessert") {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M8 14c0-3 2-5 4-5s4 2 4 5v2H8Z" />
        <path d="M7 16h10v2.2a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2Z" />
        <path d="M12 9V6.5" />
      </svg>
    );
  }
  if (kind === "drink") {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M7 5h10l-1.2 12.2a3 3 0 0 1-3 2.8h-1.6a3 3 0 0 1-3-2.8Z" />
        <path d="M9 9h6" />
      </svg>
    );
  }
  if (kind === "salad") {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M6 13c0 4 2.6 6 6 6s6-2 6-6Z" />
        <path d="M12 13c0-4 2.2-7 6-8-1 4-3 6.2-6 8Z" />
        <path d="M12 13C12 8.5 9.2 6 5 5c1.2 4 3.2 6.2 7 8Z" />
      </svg>
    );
  }
  if (kind === "fries") {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M8 10h8l-1 9H9Z" />
        <path d="M9.5 10V7M12 10V6M14.5 10V7.5" />
      </svg>
    );
  }
  if (kind === "rice") {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M5 11h14v6.5a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3Z" />
        <path d="M8 11c.4-2 1.6-3.2 4-3.2S15.6 9 16 11" />
      </svg>
    );
  }
  if (kind === "fish") {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M4 12c3-4 7-5 11-4 2 .4 4 1.2 5 2-1.4 1.4-4 2-4 2s-2.4.6-4 2c-4.6 1-8 .2-12-2 1.4-.7 2.6-1.2 4 0Z" />
        <circle cx="15.2" cy="10.6" r="0.6" />
      </svg>
    );
  }
  if (kind === "grill") {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M6 8h12v2.2a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5Z" />
        <path d="M8 8V5.5M12 8V4.5M16 8V5.5M9 18.5h6" />
      </svg>
    );
  }
  if (kind === "bowl") {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M5 11h14v1.5a6 6 0 0 1-6 6h-2a6 6 0 0 1-6-6Z" />
        <path d="M8 8.2c.6-.8.6-1.5 0-2.4M12 8.2c.6-.8.6-1.5 0-2.4M16 8.2c.6-.8.6-1.5 0-2.4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24">
      <path d="M5 12h14" />
      <path d="M7 12c0 4 2.2 6.5 5 6.5S17 16 17 12" />
      <path d="M9 7.5V5M12 7.5V4.5M15 7.5V5" />
    </svg>
  );
}

function tableBadge(name: string, code: string) {
  const digits = name.match(/\d+/)?.[0];
  if (digits) return digits;
  const shortCode = code.trim().slice(0, 3);
  return shortCode || "·";
}

function RegisterIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="3.5" width="16" height="12" rx="2" />
      <path d="M7 19.5h10M8 9h8M8 12h5" />
    </svg>
  );
}

function PhotoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.4" />
      <path d="m7 16 3.2-3.2L13 15l2-2 2.5 3" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 7h11M8 12h11M8 17h11" />
      <circle cx="4.5" cy="7" r="1" />
      <circle cx="4.5" cy="12" r="1" />
      <circle cx="4.5" cy="17" r="1" />
    </svg>
  );
}

function DineInIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 10h16v2.2a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6Z" />
      <path d="M8 10V6.5M12 10V5M16 10V6.5" />
    </svg>
  );
}

function BagIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.5 8h11l-.8 11H7.3Z" />
      <path d="M9 8V6.5A3 3 0 0 1 12 3.5 3 3 0 0 1 15 6.5V8" />
    </svg>
  );
}

function DeliveryIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="7" cy="16.5" r="2" />
      <circle cx="17" cy="16.5" r="2" />
      <path d="M5 16.5H3.5v-5l2.2-4h6.3v9M12 8.5h4.2L19.5 12v4.5H19" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16M12 4c2.2 2.4 3.3 5.1 3.3 8S14.2 17.6 12 20c-2.2-2.4-3.3-5.1-3.3-8S9.8 6.4 12 4Z" />
    </svg>
  );
}

function GuestIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="3" />
      <path d="M6 19a6 6 0 0 1 12 0" />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 4.5h9.5L18.5 8v11.5H6Z" />
      <path d="M15.5 4.5V8H18.5M8.5 12h7M8.5 15.5h5" />
    </svg>
  );
}
