/**
 * Bridge to the vanilla app shell. All builder network calls go through
 * App.api so project scoping (X-Project-ID) and session auth are applied.
 */

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
};

function getApp(): AppGlobal {
  const app = (window as unknown as { App?: AppGlobal }).App;
  if (!app || typeof app.api !== 'function') {
    throw new Error('Starcaster App shell is not available.');
  }
  return app;
}

/** Project-scope + session headers, mirroring what App.api() injects. */
export function starcasterScopedHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  try {
    const app = getApp();
    const projectId = app.projectContext?.getSessionProjectId?.() ?? '';
    if (projectId) headers['X-Project-ID'] = projectId;
    const token = app.getSessionToken?.();
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    // App shell missing (tests); fall back to cookie auth only.
  }
  return headers;
}

export function appApi(path: string, options?: RequestInit): Promise<StarcasterEnvelope> {
  return getApp().api(path, options);
}

/** Unwrap a list/record from { ok, data, ...legacyKeys } responses. */
export function unwrapEnvelope<T>(body: StarcasterEnvelope, ...keys: string[]): T {
  for (const key of keys) {
    if (body[key] !== undefined) return body[key] as T;
  }
  return body.data as T;
}
