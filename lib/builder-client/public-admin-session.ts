/** Matches public/js/projectAdmin.js — cookie is auth-of-record; token backs up fetch calls. */
export const ADMIN_SESSION_TOKEN_KEY = "app.adminSessionToken";

/** Non-HttpOnly cookie set alongside the session — readable by client JS to show admin UI. */
export const ADMIN_NAV_COOKIE_NAME = "app_admin_nav";

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

/** Returns true when the non-HttpOnly admin nav cookie is present (user is logged in as admin). */
export function isAdminNavCookieSet(): boolean {
  if (typeof document === "undefined") return false;
  try {
    return document.cookie.split(";").some((c) => c.trim().startsWith(`${ADMIN_NAV_COOKIE_NAME}=`));
  } catch {
    return false;
  }
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
