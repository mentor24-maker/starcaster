import { isPrivateSiteSlug } from "./public-site-page-slugs";

/** Matches public/js/projectAdmin.js — cookie is auth-of-record; token backs up fetch calls. */
export const ADMIN_SESSION_TOKEN_KEY = "app.adminSessionToken";

/** Non-HttpOnly cookie set alongside the session — readable by client JS to show admin UI. */
export const ADMIN_NAV_COOKIE_NAME = "app_admin_nav";

/** Virtual action path — link text/button modules here to sign out (not a published page). */
export const ADMIN_LOGOUT_PATH = "/admin-logout";

/** Default admin sign-in page slug after logout. */
export const ADMIN_LOGIN_PATH = "/admin-login";

/** The fixed corner button on a tenant site, or null when it should not show. */
export type AdminCornerLink = { label: string; href: string; ariaLabel: string };

/**
 * What the corner button on a tenant site does.
 *
 * It only ever shows to someone whose browser carries the admin nav cookie —
 * that cookie is a "this browser has been an admin" marker, deliberately
 * longer-lived than any session, NOT proof of a live one.
 *
 * Which side of the door you are on decides the rest:
 *
 * - On an admin page it signs you out. A private slug is only ever served to a
 *   live admin session, so anyone seeing one is signed in, and the admin header
 *   needs no Logout link of its own.
 * - On the public site it stays the way IN. It is the only route to the admin
 *   area from the front of the site; making it a logout button everywhere would
 *   leave no way back in (operator's call, 2026-08-17).
 *
 * `admin-login` is deliberately not a private slug, so it lands here as public
 * and keeps saying "Admin" — offering "Logout" beside a sign-in form would be
 * nonsense.
 */
export function adminCornerLink(
  slug: string,
  options: { isAdminNav: boolean }
): AdminCornerLink | null {
  if (!options?.isAdminNav) return null;
  return isPrivateSiteSlug(slug)
    ? { label: "Logout", href: ADMIN_LOGOUT_PATH, ariaLabel: "Log out of the admin area" }
    : { label: "Admin", href: ADMIN_LOGIN_PATH, ariaLabel: "Admin" };
}

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
