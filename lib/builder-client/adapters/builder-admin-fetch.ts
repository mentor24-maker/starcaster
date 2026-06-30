/**
 * Drop-in replacement for `fetch` used by the ported Builder components.
 * Rewrites /api/admin/* paths to starcaster's project-scoped endpoints,
 * injects scope/session headers, and re-keys response JSON to the shapes
 * the components expect. Components keep using readAdminJson() unchanged.
 */

import type { AdminMediaItem } from '../admin-media-shared';
import { starcasterScopedHeaders } from './starcaster-app';
import { assetToAdminMediaItem } from './use-gallery-media-library';

type JsonObject = Record<string, unknown>;

/** Component-expected key ← API key, re-keyed in response bodies per resource. */
const RESPONSE_KEY_MAPS: Record<string, Array<[string, string]>> = {
  pages: [],
  'cell-modules': [
    ['cellModules', 'modules'],
    ['cellModule', 'module']
  ],
  polls: [['polls', 'data']]
};

const PATH_REWRITES: Array<[RegExp, string, string]> = [
  [/^\/api\/admin\/page-templates(\/|$)/, '/api/builder/page-templates$1', 'page-templates'],
  // Specific landing-pages sub-routes must come before the general pages rewrite.
  [/^\/api\/admin\/pages\/bulk-create-with-model$/, '/api/builder/landing-pages/bulk-create-with-model', 'pages'],
  [/^\/api\/admin\/pages\/populate-from-acquire$/, '/api/builder/landing-pages/populate-from-acquire', 'pages'],
  [/^\/api\/admin\/pages(\/|$)/, '/api/builder/landing-pages$1', 'pages'],
  [/^\/api\/admin\/page-snapshots(\/|$)/, '/api/builder/page-snapshots$1', 'page-snapshots'],
  [/^\/api\/admin\/acquire-runs(\/|$)/, '/api/builder/acquire-runs$1', 'acquire-runs'],
  [/^\/api\/admin\/cell-modules(\/|$)/, '/api/builder/modules$1', 'cell-modules'],
  [/^\/api\/admin\/saved-sections(\/|$)/, '/api/builder/saved-sections$1', 'saved-sections'],
  [/^\/api\/admin\/products(\/|$)/, '/api/builder/products$1', 'products'],
  [/^\/api\/admin\/themes(\/|$)/, '/api/builder/themes$1', 'themes'],
  [/^\/api\/admin\/polls(\/|$)/, '/api/polls$1', 'polls']
];

function jsonResponse(body: JsonObject, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function applyResponseKeys(body: JsonObject, resource: string): JsonObject {
  const map = RESPONSE_KEY_MAPS[resource];
  if (!map) return body;
  const next: JsonObject = { ...body };
  for (const [componentKey, apiKey] of map) {
    if (next[componentKey] === undefined && next[apiKey] !== undefined) {
      next[componentKey] = next[apiKey];
    }
  }
  return next;
}

/** Flatten starcaster error envelopes ({ error: { message } }) to a plain string. */
function flattenError(body: JsonObject): JsonObject {
  const err = body.error;
  if (err && typeof err === 'object' && !Array.isArray(err)) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string') {
      return { ...body, error: message };
    }
  }
  return body;
}

async function readFileAsBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function listMedia(): Promise<Response> {
  const response = await fetch('/api/assets', {
    headers: starcasterScopedHeaders(),
    credentials: 'include'
  });
  const body = (await response.json().catch(() => ({}))) as JsonObject;
  if (!response.ok) {
    return jsonResponse(flattenError(body), response.status);
  }
  const assets = (Array.isArray(body.assets) ? body.assets : Array.isArray(body.data) ? body.data : []) as Array<
    Record<string, unknown>
  >;
  const media = assets
    .map(assetToAdminMediaItem)
    .filter((item): item is AdminMediaItem => Boolean(item));
  return jsonResponse({ media, total: media.length, limit: media.length, offset: 0 });
}

async function uploadMedia(init: RequestInit): Promise<Response> {
  const formData = init.body;
  if (!(formData instanceof FormData)) {
    return jsonResponse({ error: 'A media file is required.' }, 400);
  }
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return jsonResponse({ error: 'A media file is required.' }, 400);
  }

  const fileBase64 = await readFileAsBase64(file);
  const category = String(formData.get('media_category') ?? '');
  const aspect = String(formData.get('aspect') ?? '');

  const response = await fetch('/api/assets/import-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...starcasterScopedHeaders() },
    credentials: 'include',
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type || 'image/jpeg',
      fileBase64,
      assetName: file.name,
      category,
      aspect
    })
  });
  const body = (await response.json().catch(() => ({}))) as JsonObject;
  if (!response.ok) {
    return jsonResponse(flattenError(body), response.status);
  }
  const asset = (body.asset ?? (body.data as JsonObject | undefined)?.asset ?? body.data ?? null) as Record<
    string,
    unknown
  > | null;
  const media = asset ? assetToAdminMediaItem(asset) : null;
  if (!media) {
    return jsonResponse({ error: 'Upload succeeded but the asset could not be read back.' }, 500);
  }
  return jsonResponse({ media }, 201);
}

export async function builderAdminFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const [path, query = ''] = input.split('?');
  const method = String(init.method ?? 'GET').toUpperCase();

  if (path === '/api/admin/media') {
    if (method === 'GET') return listMedia();
    if (method === 'POST') return uploadMedia(init);
    return jsonResponse({ error: `Unsupported media operation ${method}.` }, 405);
  }

  for (const [pattern, replacement, resource] of PATH_REWRITES) {
    if (!pattern.test(path)) continue;

    const target = path.replace(pattern, replacement) + (query ? `?${query}` : '');
    const headers: Record<string, string> = {
      ...starcasterScopedHeaders(),
      ...((init.headers as Record<string, string>) ?? {})
    };
    if (typeof init.body === 'string' && !headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(target, { ...init, headers, credentials: 'include' });
    const body = (await response.json().catch(() => ({}))) as JsonObject;
    const transformed = response.ok ? applyResponseKeys(body, resource) : flattenError(body);
    return jsonResponse(transformed, response.status);
  }

  // Unmapped paths (e.g. /api/contact in preview) fall through to plain fetch.
  return fetch(input, init);
}
