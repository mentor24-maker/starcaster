/** Matches public/js/projectAdmin.js — cookie is auth-of-record; token backs up fetch calls. */
export const ADMIN_SESSION_TOKEN_KEY = "app.adminSessionToken";

/** Virtual action path — link text/button modules here to sign out (not a published page). */
export const ADMIN_LOGOUT_PATH = "/admin-logout";

/** Default admin sign-in page slug after logout. */
export const ADMIN_LOGIN_PATH = "/admin-login";

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

export function isAdminLogoutHref(href: string): boolean {
  const raw = String(href || "").trim();
  if (!raw) return false;
  if (raw.toLowerCase() === "#admin-logout") return true;
  try {
    const url = new URL(raw, "https://site.local");
    const path = url.pathname.replace(/\/$/, "") || "/";
    return path.toLowerCase() === ADMIN_LOGOUT_PATH;
  } catch {
    const path = raw.split("?")[0]?.split("#")[0]?.replace(/\/$/, "") || "";
    return path.toLowerCase() === ADMIN_LOGOUT_PATH;
  }
}

export async function signOutAdminAuth(): Promise<void> {
  try {
    await fetch("/api/admin/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...getAdminAuthHeaders(),
      },
    });
  } catch {
    /* cookie clear is best-effort; always drop local token */
  }
  setAdminSessionToken("");
}

export async function redirectAfterAdminLogout(loginPath = ADMIN_LOGIN_PATH): Promise<void> {
  await signOutAdminAuth();
  window.location.href = loginPath;
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
