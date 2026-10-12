export type CurrentUser = {
  id: string;
  email: string;
  displayName: string;
  organizationId: string;
  organizationName: string;
  role: string;
};

export type Location = {
  id: string;
  name: string;
  code: string;
  timezone: string;
};

export type DiningArea = {
  id: string;
  locationId: string;
  name: string;
  sortOrder: number;
};

export type DiningTable = {
  id: string;
  locationId: string;
  areaId: string;
  areaName: string;
  code: string;
  name: string;
  capacity: number;
  status: "FREE" | "OCCUPIED" | "WAITING_PAYMENT" | "OUT_OF_SERVICE";
  version: number;
};

export type MenuCategory = {
  id: string;
  locationId: string;
  name: string;
  code: string;
  sortOrder: number;
};

export type Product = {
  id: string;
  locationId: string;
  categoryId: string;
  categoryName: string;
  name: string;
  sku: string;
  description?: string;
  price: number;
  taxRate: number;
  available: boolean;
  version: number;
};

export type OrderItem = {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  kitchenNote?: string;
  sentToKitchen: boolean;
};

export type RestaurantOrder = {
  id: string;
  orderNumber: number;
  locationId: string;
  tableId: string;
  tableName: string;
  areaName: string;
  status: "OPEN" | "WAITING_PAYMENT" | "PAID" | "CANCELLED";
  guestCount: number;
  notes?: string;
  openedAt: string;
  version: number;
  total: number;
  items: OrderItem[];
};

export type KitchenRound = {
  id: string;
  orderId: string;
  orderNumber: number;
  tableName: string;
  areaName: string;
  roundNumber: number;
  status: "QUEUED" | "PREPARING" | "READY" | "COMPLETED";
  sentAt: string;
  items: Array<{
    id: string;
    productName: string;
    quantity: number;
    kitchenNote?: string;
  }>;
  version: number;
};

export type Payment = {
  id: string;
  orderId: string;
  method: "CASH" | "CARD";
  amount: number;
  tenderedAmount?: number;
  changeAmount: number;
  externalReference?: string;
  idempotencyKey: string;
  status: "COMPLETED" | "VOIDED";
  paidAt: string;
};

export type OrderPaymentSummary = {
  orderId: string;
  orderNumber: number;
  status: RestaurantOrder["status"];
  locationId: string;
  tableId: string;
  tableName: string;
  areaName: string;
  total: number;
  paid: number;
  balance: number;
  payments: Payment[];
};

export type CashMovement = {
  id: string;
  cashShiftId: string;
  type: "PAID_IN" | "PAID_OUT";
  amount: number;
  reason: string;
  idempotencyKey: string;
  createdAt: string;
};

export type CashShift = {
  id: string;
  locationId: string;
  status: "OPEN" | "CLOSED";
  openingAmount: number;
  openedBy: string;
  openedAt: string;
  cashSales: number;
  cardSales: number;
  paidIn: number;
  paidOut: number;
  expectedCash: number;
  closingCountedCash?: number;
  cashDifference?: number;
  closedBy?: string;
  closedAt?: string;
  closingNote?: string;
  version: number;
  movements: CashMovement[];
};

function cookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${name}=`))
    ?.split("=")
    .slice(1)
    .join("=");
}

async function ensureCsrf(): Promise<string> {
  const response = await fetch("/api/auth/csrf", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("No se pudo iniciar una sesión segura");
  await response.json();
  const token = cookie("SGR_XSRF");
  if (!token) throw new Error("No se recibió la protección CSRF");
  return decodeURIComponent(token);
}

export async function login(email: string, password: string, remember: boolean): Promise<CurrentUser> {
  const csrf = await ensureCsrf();
  const response = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-SGR-XSRF": csrf,
    },
    body: JSON.stringify({ email, password, remember }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.message || "No se pudo iniciar sesión");
  }
  return response.json();
}

export async function currentUser(): Promise<CurrentUser | null> {
  const response = await fetch("/api/auth/me", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("No se pudo consultar la sesión");
  return response.json();
}

export async function logout(): Promise<void> {
  const csrf = await ensureCsrf();
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
    headers: { "X-SGR-XSRF": csrf },
  });
  if (!response.ok) throw new Error("No se pudo cerrar la sesión");
}

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (method !== "GET" && method !== "HEAD") {
    headers.set("X-SGR-XSRF", await ensureCsrf());
  }
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.message || "La operación no se pudo completar");
  }
  return response.json();
}

export const listLocations = () => apiRequest<Location[]>("/api/locations");

export const listAreas = (locationId: string) =>
  apiRequest<DiningArea[]>(`/api/dining/areas?locationId=${encodeURIComponent(locationId)}`);

export const createArea = (input: { locationId: string; name: string; sortOrder: number }) =>
  apiRequest<DiningArea>("/api/dining/areas", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const listTables = (locationId: string) =>
  apiRequest<DiningTable[]>(`/api/dining/tables?locationId=${encodeURIComponent(locationId)}`);

export const createTable = (input: {
  locationId: string;
  areaId: string;
  code: string;
  name: string;
  capacity: number;
}) => apiRequest<DiningTable>("/api/dining/tables", {
  method: "POST",
  body: JSON.stringify(input),
});

export const changeTableStatus = (input: {
  tableId: string;
  status: DiningTable["status"];
  expectedVersion: number;
}) => apiRequest<DiningTable>("/api/dining/tables/status", {
  method: "PATCH",
  body: JSON.stringify(input),
});

export const listCategories = (locationId: string) =>
  apiRequest<MenuCategory[]>(`/api/catalog/categories?locationId=${encodeURIComponent(locationId)}`);

export const createCategory = (input: {
  locationId: string;
  name: string;
  code: string;
  sortOrder: number;
}) => apiRequest<MenuCategory>("/api/catalog/categories", {
  method: "POST",
  body: JSON.stringify(input),
});

export const listProducts = (locationId: string) =>
  apiRequest<Product[]>(`/api/catalog/products?locationId=${encodeURIComponent(locationId)}`);

export const createProduct = (input: {
  locationId: string;
  categoryId: string;
  name: string;
  sku: string;
  description?: string;
  price: number;
  taxRate: number;
}) => apiRequest<Product>("/api/catalog/products", {
  method: "POST",
  body: JSON.stringify(input),
});

export const changeProductAvailability = (input: {
  productId: string;
  available: boolean;
  expectedVersion: number;
}) => apiRequest<Product>("/api/catalog/products/availability", {
  method: "PATCH",
  body: JSON.stringify(input),
});

export const listOrders = (locationId: string) =>
  apiRequest<RestaurantOrder[]>(`/api/orders?locationId=${encodeURIComponent(locationId)}`);

export const openOrder = (input: {
  locationId: string;
  tableId: string;
  guestCount: number;
  notes?: string;
}) => apiRequest<RestaurantOrder>("/api/orders", {
  method: "POST",
  body: JSON.stringify(input),
});

export const addOrderItem = (input: {
  orderId: string;
  productId: string;
  quantity: number;
  kitchenNote?: string;
}) => apiRequest<OrderItem>("/api/orders/items", {
  method: "POST",
  body: JSON.stringify(input),
});

export const sendOrderToKitchen = (orderId: string, idempotencyKey: string) =>
  apiRequest<KitchenRound>("/api/orders/send-kitchen", {
    method: "POST",
    body: JSON.stringify({ orderId, idempotencyKey }),
  });

export const listKitchenRounds = (locationId: string) =>
  apiRequest<KitchenRound[]>(`/api/kitchen/rounds?locationId=${encodeURIComponent(locationId)}`);

export const changeKitchenRoundStatus = (input: {
  roundId: string;
  status: "PREPARING" | "READY" | "COMPLETED";
  expectedVersion: number;
}) => apiRequest<KitchenRound>("/api/kitchen/rounds/status", {
  method: "PATCH",
  body: JSON.stringify(input),
});

export const requestOrderPayment = (orderId: string, expectedVersion: number) =>
  apiRequest<OrderPaymentSummary>("/api/payments/request", {
    method: "POST",
    body: JSON.stringify({ orderId, expectedVersion }),
  });

export const getOrderPaymentSummary = (orderId: string) =>
  apiRequest<OrderPaymentSummary>(
    `/api/payments/summary?orderId=${encodeURIComponent(orderId)}`,
  );

export const createPayment = (input: {
  orderId: string;
  method: "CASH" | "CARD";
  amount: number;
  tenderedAmount?: number;
  externalReference?: string;
  idempotencyKey: string;
}) => apiRequest<{ payment: Payment; summary: OrderPaymentSummary }>("/api/payments", {
  method: "POST",
  body: JSON.stringify(input),
});

export const getCurrentCashShift = (locationId: string) =>
  apiRequest<{ shift: CashShift | null }>(
    `/api/cash-shifts/current?locationId=${encodeURIComponent(locationId)}`,
  );

export const listCashShifts = (locationId: string) =>
  apiRequest<CashShift[]>(
    `/api/cash-shifts?locationId=${encodeURIComponent(locationId)}`,
  );

export const openCashShift = (input: {
  locationId: string;
  openingAmount: number;
  idempotencyKey: string;
}) => apiRequest<CashShift>("/api/cash-shifts/open", {
  method: "POST",
  body: JSON.stringify(input),
});

export const createCashMovement = (input: {
  cashShiftId: string;
  type: CashMovement["type"];
  amount: number;
  reason: string;
  idempotencyKey: string;
}) => apiRequest<CashShift>("/api/cash-shifts/movements", {
  method: "POST",
  body: JSON.stringify(input),
});

export const closeCashShift = (input: {
  cashShiftId: string;
  countedCash: number;
  closingNote?: string;
  expectedVersion: number;
}) => apiRequest<CashShift>("/api/cash-shifts/close", {
  method: "POST",
  body: JSON.stringify(input),
});
