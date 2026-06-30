export const ADMIN_SESSION_EXPIRED_CODE = "ADMIN_SESSION_EXPIRED";
export const ADMIN_SESSION_EXPIRED_EVENT = "starcaster-admin-session-expired";

export function isAdminApiRequestUrl(url: string) {
  return url.includes("/api/admin/") || url.includes("/api/import");
}

export function isAdminPublicAuthRequest(url: string, method: string) {
  const normalizedMethod = method.toUpperCase();

  if (normalizedMethod !== "POST") {
    return false;
  }

  return (
    url.includes("/api/admin/session") ||
    url.includes("/api/admin/register") ||
    url.includes("/api/admin/session/oauth")
  );
}

export async function signOutAdminSession() {
  await fetch("/api/admin/session", { method: "DELETE" });
}

export function dispatchAdminSessionExpired() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(ADMIN_SESSION_EXPIRED_EVENT));
}

export async function handleAdminSessionExpired(router: { push: (path: string) => void; refresh: () => void }) {
  await signOutAdminSession();
  router.push("/admin?expired=1");
  router.refresh();
}
