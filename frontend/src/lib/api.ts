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
  status: "FREE" | "OCCUPIED" | "WAITING_PAYMENT" | "OUT_OF_SERVICE" | "RESERVED";
  posX: number;
  posY: number;
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
  voided: boolean;
  voidReason?: string;
  version: number;
};

export type RestaurantOrder = {
  id: string;
  orderNumber: number;
  locationId: string;
  tableId: string;
  tableName: string;
  areaName: string;
  status: "OPEN" | "WAITING_PAYMENT" | "PAID" | "PARTIALLY_REFUNDED" | "REFUNDED" | "CANCELLED";
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
    voided: boolean;
    voidReason?: string;
  }>;
  version: number;
};

export type Payment = {
  id: string;
  orderId: string;
  method: "CASH" | "CARD";
  amount: number;
  refundedAmount: number;
  refundableAmount: number;
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
  cashRefunds: number;
  cardRefunds: number;
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

export type Sale = {
  orderId: string;
  orderNumber: number;
  tableName: string;
  areaName: string;
  closedAt: string;
  grossTotal: number;
  refundedTotal: number;
  total: number;
  cashTotal: number;
  cardTotal: number;
};

export type DailySales = {
  locationId: string;
  locationName: string;
  businessDate: string;
  timezone: string;
  currency: string;
  orderCount: number;
  grossSales: number;
  refunds: number;
  netSales: number;
  cashSales: number;
  cardSales: number;
  sales: Sale[];
};

export type ReportDashboard = {
  locationId: string;
  locationName: string;
  timezone: string;
  currency: string;
  from: string;
  to: string;
  orderCount: number;
  activeProducts: number;
  grossSales: number;
  refunds: number;
  netSales: number;
  dailySales: Array<{
    date: string;
    orderCount: number;
    grossSales: number;
    refunds: number;
    netSales: number;
  }>;
  categories: Array<{
    categoryId: string;
    name: string;
    activeProducts: number;
  }>;
  bestSellingProducts: Array<{
    productId: string;
    name: string;
    sku: string;
    quantitySold: number;
    grossSales: number;
  }>;
  paymentMethods: Array<{
    method: "CASH" | "CARD";
    paymentCount: number;
    grossAmount: number;
    refunds: number;
    netAmount: number;
  }>;
};

export type SalesReceipt = {
  documentType: "PAYMENT_RECEIPT";
  fiscalDocument: false;
  title: string;
  disclaimer: string;
  orderId: string;
  orderNumber: number;
  status: RestaurantOrder["status"];
  organizationName: string;
  locationId: string;
  locationName: string;
  timezone: string;
  currency: string;
  tableName: string;
  areaName: string;
  guestCount: number;
  openedBy: string;
  openedAt: string;
  closedAt: string;
  grossTotal: number;
  refundedTotal: number;
  total: number;
  items: Array<{
    productName: string;
    sku: string;
    quantity: number;
    unitPrice: number;
    taxRate: number;
    lineTotal: number;
  }>;
  taxes: Array<{
    taxRate: number;
    taxableBase: number;
    taxAmount: number;
    grossAmount: number;
  }>;
  payments: Array<{
    id: string;
    method: "CASH" | "CARD";
    amount: number;
    refundedAmount: number;
    refundableAmount: number;
    tenderedAmount?: number;
    changeAmount: number;
    externalReference?: string;
    paidAt: string;
  }>;
  refunds: Array<{
    id: string;
    paymentId: string;
    method: "CASH" | "CARD";
    amount: number;
    reason: string;
    refundedAt: string;
  }>;
};

export type StaffMember = {
  id: string;
  email: string;
  displayName: string;
  role: "OWNER" | "MANAGER" | "CASHIER" | "SERVER" | "KITCHEN";
  active: boolean;
  lastLoginAt?: string;
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
  const payload = await response.json().catch(() => null);
  const token = cookie("SGR_XSRF") ?? payload?.token;
  if (!token) throw new Error("No se recibió la protección CSRF");
  return decodeURIComponent(token);
}

const ENVELOPE_MASK = [
  0x7a, 0x3c, 0x9e, 0x15, 0xd2, 0x4b, 0x83, 0x61,
  0xe7, 0x29, 0x54, 0xb8, 0x0f, 0xc6, 0x92, 0x3a,
];

function obfuscateSecret(secret: string): string {
  const raw = new TextEncoder().encode(secret);
  const salt = new Uint8Array(4);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(salt);
  } else {
    for (let i = 0; i < 4; i++) salt[i] = (Math.random() * 256) & 0xff;
  }
  const out = new Uint8Array(4 + raw.length);
  out.set(salt, 0);
  for (let i = 0; i < raw.length; i++) {
    const maskByte = (ENVELOPE_MASK[i % ENVELOPE_MASK.length] ^ salt[i % 4] ^ ((i * 31) & 0xff)) & 0xff;
    out[4 + i] = raw[i] ^ maskByte;
  }
  let binary = "";
  for (let i = 0; i < out.length; i++) {
    binary += String.fromCharCode(out[i]);
  }
  const base64url = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `OBF1:${base64url}`;
}

export async function login(email: string, secret: string, remember: boolean): Promise<CurrentUser> {
  const csrf = await ensureCsrf();
  const response = await fetch("/api/auth/session", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-SGR-XSRF": csrf,
    },
    body: JSON.stringify({ email, k: obfuscateSecret(secret), remember }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.message || body?.detail || "No se pudo iniciar sesión");
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
    throw new Error(body?.message || body?.detail || "La operación no se pudo completar");
  }
  if (response.status === 204) return undefined as T;
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

export const moveTable = (input: {
  tableId: string;
  posX: number;
  posY: number;
  expectedVersion: number;
}) => apiRequest<DiningTable>("/api/dining/tables/position", {
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

export const editOrderItem = (input: {
  itemId: string;
  quantity: number;
  kitchenNote?: string;
  expectedVersion: number;
}) => apiRequest<OrderItem>("/api/orders/items", {
  method: "PATCH",
  body: JSON.stringify(input),
});

export const voidOrderItem = (input: {
  itemId: string;
  reason: string;
  expectedVersion: number;
}) => apiRequest<OrderItem>("/api/orders/items/void", {
  method: "POST",
  body: JSON.stringify(input),
});

export const sendOrderToKitchen = (orderId: string, idempotencyKey: string) =>
  apiRequest<KitchenRound>("/api/orders/send-kitchen", {
    method: "POST",
    body: JSON.stringify({ orderId, idempotencyKey }),
  });

export const cancelOrder = (orderId: string, reason: string) =>
  apiRequest<RestaurantOrder>("/api/orders/cancel", {
    method: "POST",
    body: JSON.stringify({ orderId, reason }),
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

export const correctOrderPayment = (orderId: string, expectedVersion: number) =>
  apiRequest<OrderPaymentSummary>("/api/payments/correct", {
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

export const getDailySales = (locationId: string, businessDate: string) =>
  apiRequest<DailySales>(
    `/api/sales?locationId=${encodeURIComponent(locationId)}&businessDate=${encodeURIComponent(businessDate)}`,
  );

export const getReportDashboard = (locationId: string, from: string, to: string) =>
  apiRequest<ReportDashboard>(
    `/api/reports/dashboard?locationId=${encodeURIComponent(locationId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );

export const getSalesReceipt = (orderId: string) =>
  apiRequest<SalesReceipt>(
    `/api/sales/receipt?orderId=${encodeURIComponent(orderId)}`,
  );

export const createRefund = (input: {
  paymentId: string;
  amount: number;
  reason: string;
  idempotencyKey: string;
}) => apiRequest<{
  refund: SalesReceipt["refunds"][number];
  paymentRefundable: number;
  orderRefunded: number;
  orderStatus: RestaurantOrder["status"];
}>("/api/refunds", {
  method: "POST",
  body: JSON.stringify(input),
});

export const listStaff = () => apiRequest<StaffMember[]>("/api/staff");

export const createStaff = (input: {
  email: string;
  displayName: string;
  password: string;
  role: StaffMember["role"];
}) => apiRequest<StaffMember>("/api/staff", {
  method: "POST",
  body: JSON.stringify({
    email: input.email,
    displayName: input.displayName,
    k: obfuscateSecret(input.password),
    role: input.role,
  }),
});

export const changeStaffRole = (userId: string, role: StaffMember["role"]) =>
  apiRequest<StaffMember>("/api/staff/role", {
    method: "PATCH",
    body: JSON.stringify({ userId, role }),
  });

export const changeStaffStatus = (userId: string, active: boolean) =>
  apiRequest<StaffMember>("/api/staff/status", {
    method: "PATCH",
    body: JSON.stringify({ userId, active }),
  });

export const resetStaffPassword = (userId: string, secret: string) =>
  apiRequest<StaffMember>("/api/staff/credentials", {
    method: "POST",
    body: JSON.stringify({ userId, k: obfuscateSecret(secret) }),
  });

export const changeOwnPassword = (currentSecret: string, nextSecret: string) =>
  apiRequest<void>("/api/auth/credentials", {
    method: "POST",
    body: JSON.stringify({
      c: obfuscateSecret(currentSecret),
      n: obfuscateSecret(nextSecret),
    }),
  });
