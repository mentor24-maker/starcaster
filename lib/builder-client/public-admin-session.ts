/** Matches public/js/projectAdmin.js — cookie is auth-of-record; token backs up fetch calls. */
export const ADMIN_SESSION_TOKEN_KEY = "app.adminSessionToken";

export function getAdminSessionToken(): string {
  try {
    return String(window.localStorage.getItem(ADMIN_SESSION_TOKEN_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function setAdminSessionToken(token: string): void {
  try {
    const value = String(token || "").trim();
    if (value) window.localStorage.setItem(ADMIN_SESSION_TOKEN_KEY, value);
    else window.localStorage.removeItem(ADMIN_SESSION_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function getAdminAuthHeaders(): Record<string, string> {
  const token = getAdminSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function readApiErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const record = body as Record<string, unknown>;
  const err = record.error;
  if (typeof err === "string" && err.trim()) return err.trim();
  if (err && typeof err === "object" && "message" in err) {
    const message = String((err as { message?: unknown }).message || "").trim();
    if (message) return message;
  }
  return fallback;
}
