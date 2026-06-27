/**
 * Bridge to the vanilla app shell. Builder network calls use these helpers so
 * project scoping (X-Project-ID) and session auth work on the main app and on
 * tenant admin sites (admin session token + __SITE_CONFIG__ project id).
 */

import { getAdminSessionToken } from '../public-admin-session';

export type StarcasterEnvelope = {
  ok?: boolean;
  data?: unknown;
  meta?: { total?: number } & Record<string, unknown>;
  [key: string]: unknown;
};

type AppGlobal = {
  api: (path: string, options?: RequestInit) => Promise<StarcasterEnvelope>;
  getSessionToken?: () => string | null;
  projectContext?: { getSessionProjectId?: () => string };
  CURRENT_PROJECT_ID_STORAGE_KEY?: string;
};

function readWindow(): (Window & typeof globalThis) | null {
  return typeof window !== 'undefined' ? window : null;
}

function readApp(): AppGlobal | null {
  const win = readWindow();
  const app = win ? (win as unknown as { App?: AppGlobal }).App : undefined;
  if (!app || typeof app.api !== 'function') return null;
  return app;
}

/** Active project id from App shell, tenant site config, or localStorage. */
export function resolveSessionProjectId(): string {
  const app = readApp();
  const fromApp = app?.projectContext?.getSessionProjectId?.() ?? '';
  if (fromApp) return fromApp;

  const win = readWindow();
  if (!win) return '';

  try {
    const fromSiteConfig =
      (win as unknown as { __SITE_CONFIG__?: { projectId?: string } }).__SITE_CONFIG__?.projectId ?? '';
    if (fromSiteConfig) return String(fromSiteConfig).trim();
  } catch {
    /* ignore */
  }

  try {
    const key = app?.CURRENT_PROJECT_ID_STORAGE_KEY ?? 'alphire.currentProjectId';
    return String(win.localStorage.getItem(key) || '').trim();
  } catch {
    return '';
  }
}

/** Platform session token first; fall back to tenant admin session token. */
export function resolveSessionAuthToken(): string {
  const app = readApp();
  const platformToken = app?.getSessionToken?.() ?? '';
  if (platformToken) return String(platformToken).trim();

  const win = readWindow();
  if (!win) return '';

  try {
    return getAdminSessionToken();
  } catch {
    return '';
  }
}

/** Project-scope + session headers, mirroring what App.api() injects. */
export function starcasterScopedHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const projectId = resolveSessionProjectId();
  if (projectId) headers['X-Project-ID'] = projectId;
  const token = resolveSessionAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export function appApi(path: string, options?: RequestInit): Promise<StarcasterEnvelope> {
  const app = readApp();
  if (app) return app.api(path, options);
  return starcasterApi(path, options);
}

/**
 * Fetch helper for builder islands when the full App shell is not loaded
 * (tenant public/admin sites). Uses the same auth + project headers as App.api.
 */
export async function starcasterApi(path: string, options: RequestInit = {}): Promise<StarcasterEnvelope> {
  const headers: Record<string, string> = {
    ...starcasterScopedHeaders(),
    ...((options.headers as Record<string, string>) ?? {})
  };
  if (typeof options.body === 'string' && !headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(path, { ...options, headers, credentials: 'include' });
  const raw = await res.text();
  let body: StarcasterEnvelope | null = null;
  if (raw) {
    try {
      body = JSON.parse(raw) as StarcasterEnvelope;
    } catch {
      body = null;
    }
  }

  if (!body) {
    throw new Error(`Invalid API response (${res.status}) from ${path}`);
  }

  if (!res.ok) {
    const err = body.error;
    const text =
      (typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message?: unknown }).message || '')
        : typeof err === 'string'
          ? err
          : '') ||
      String(body.message || res.statusText || 'Request failed');
    throw new Error(text || 'Request failed');
  }

  return body;
}

/** Unwrap a list/record from { ok, data, ...legacyKeys } responses. */
export function unwrapEnvelope<T>(body: StarcasterEnvelope, ...keys: string[]): T {
  for (const key of keys) {
    if (body[key] !== undefined) return body[key] as T;
  }
  return body.data as T;
}
