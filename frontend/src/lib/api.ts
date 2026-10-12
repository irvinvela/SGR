export type CurrentUser = {
  id: string;
  email: string;
  displayName: string;
  organizationId: string;
  organizationName: string;
  role: string;
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
