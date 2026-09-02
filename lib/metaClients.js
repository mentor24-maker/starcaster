'use strict';

const { environmentValues, resolveCredentials } = require('./connections/resolveCredentials');
const projectSocialCredentialsStore = require('./projectSocialCredentialsStore');

function safeText(value) {
  return String(value || '').trim();
}

function addNoTrailSlash(url) {
  return safeText(url).replace(/\/+$/, '');
}

function buildUrl(base, path, query = {}) {
  const root = addNoTrailSlash(base);
  const p = String(path || '').startsWith('/') ? String(path || '') : `/${String(path || '')}`;
  const url = new URL(`${root}${p}`);
  Object.entries(query || {}).forEach(([k, v]) => {
    if (v == null || String(v).trim() === '') return;
    url.searchParams.set(k, String(v));
  });
  return url.toString();
}

async function fetchJson(method, url, body = null, timeoutMs = 30000) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return { ok: false, status: 0, endpoint: url, error: `Network error: ${safeText(err?.message) || 'request failed'}` };
  }

  const raw = await response.text().catch(() => '');
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { raw }; }
  if (!response.ok) {
    const message = safeText(payload?.error?.message || payload?.message || payload?.error || raw) || `API error (${response.status})`;
    return { ok: false, status: response.status, endpoint: url, error: message, data: payload };
  }
  return { ok: true, status: response.status, endpoint: url, data: payload };
}

/**
 * A refusal, wearing the same coat as a credentials object.
 *
 * The credentials are BLANKED, not merely flagged. An earlier draft returned
 * `{ ...global, ok: false }` — which reads correctly and posts catastrophically,
 * because every caller here passes the object straight into a publish function
 * that only looks at `accessToken`. A refusal carrying a working platform-wide
 * token IS the wrong-account post, arriving through the guard written to stop
 * it. `isXConfigured` is false on this shape, and the publish functions check
 * `ok === false` explicitly so the resolver's own sentence survives.
 */
function credentialRefusal(resolved, baseUrl) {
  return {
    ok: false,
    status: resolved.status || 503,
    error: resolved.error,
    accessToken: '',
    pageId: '',
    pageName: '',
    userId: '',
    igUserId: '',
    appId: '',
    appSecret: '',
    baseUrl: baseUrl || '',
    source: 'error',
  };
}

/** A publish/verify call handed a refusal, in that call's own envelope. */
function refusalResult(creds) {
  return {
    ok: false,
    status: creds.status || 503,
    error: safeText(creds.error) || 'Credentials could not be resolved',
    code: 'CONNECTION_LOOKUP_FAILED',
  };
}

function isRefusal(creds) {
  return Boolean(creds && creds.ok === false);
}

function getFacebookCredentials() {
  const saved = environmentValues('meta');
  return {
    accessToken: safeText(process.env.FACEBOOK_ACCESS_TOKEN) || safeText(process.env.META_ACCESS_TOKEN) || safeText(saved.access_token),
    pageId: safeText(process.env.FACEBOOK_PAGE_ID) || safeText(process.env.META_PAGE_ID) || safeText(saved.page_id),
    pageName: '',
    appId: safeText(process.env.FACEBOOK_APP_ID) || safeText(process.env.META_APP_ID) || safeText(saved.app_id),
    appSecret: safeText(process.env.FACEBOOK_APP_SECRET) || safeText(process.env.META_APP_SECRET) || safeText(saved.app_secret),
    baseUrl: addNoTrailSlash(safeText(process.env.FACEBOOK_BASE_URL) || safeText(process.env.META_BASE_URL) || safeText(saved.base_url) || 'https://graph.facebook.com/v22.0'),
    source: 'global',
  };
}

/**
 * This project's own Facebook Page grant if it has one, otherwise the
 * platform-wide keys.
 *
 * THREE places are consulted, in this order, and the order is the whole
 * subtlety of Connections 3 of 7 (86bbpz1ed):
 *
 *   1. project_connections      the new vault (slice 1), written by the wizard
 *   2. project_social_credentials  the ORIGINAL per-project table, which is
 *                               live in production today and is what the
 *                               working Facebook Page connect flow writes
 *   3. the environment          Starcaster's own keys
 *
 * (2) is not legacy debt to be skipped past. Deleting it here would have taken
 * every already-connected client's Page off their own account and put their
 * posts back on Starcaster's — silently, because posting to the wrong account
 * looks exactly like success. It stays until a migration moves those rows, and
 * a connection in the new vault simply outranks it.
 */
async function resolveFacebookCredentials({ projectId, userId } = {}) {
  const global = getFacebookCredentials();
  const pid = safeText(projectId);
  if (!pid) return global;

  const resolved = await resolveCredentials('facebook_page', pid, { userId });
  if (!resolved.ok) {
    // The resolver refuses only when it could not TELL whether a connection
    // exists. Carrying on to the shared keys on the strength of that is the
    // wrong-account post it exists to prevent, so the refusal is passed up.
    return credentialRefusal(resolved, global.baseUrl);
  }
  if (resolved.data.source === 'connection') {
    const values = resolved.data.values;
    return {
      ...global,
      accessToken: safeText(values.access_token),
      pageId: safeText(values.page_id),
      pageName: safeText(resolved.data.accountLabel),
      source: 'connection',
    };
  }

  const stored = await projectSocialCredentialsStore.getFacebookPage(pid);
  if (stored?.pageId && stored?.accessToken) {
    return {
      ...global,
      accessToken: stored.accessToken,
      pageId: stored.pageId,
      pageName: safeText(stored.pageName),
      source: 'project',
    };
  }
  return global;
}

function isFacebookConfigured(creds) {
  const resolved = creds || getFacebookCredentials();
  return Boolean(resolved.accessToken && resolved.pageId);
}

async function checkFacebookAuth(creds = getFacebookCredentials()) {
  if (isRefusal(creds)) return refusalResult(creds);
  if (!isFacebookConfigured(creds)) {
    return { ok: false, status: 400, error: 'Facebook access_token and page_id are required' };
  }
  const url = buildUrl(creds.baseUrl, `/${encodeURIComponent(creds.pageId)}`, {
    fields: 'id,name',
    access_token: creds.accessToken,
  });
  return fetchJson('GET', url);
}

async function createFacebookPost(textInput, options = {}, creds = getFacebookCredentials()) {
  if (isRefusal(creds)) return refusalResult(creds);
  const text = safeText(textInput);
  if (!text) return { ok: false, status: 400, error: 'Post text is required' };
  if (!isFacebookConfigured(creds)) {
    return { ok: false, status: 400, error: 'Facebook access_token and page_id are required' };
  }

  const imageUrl = safeText(options?.imageUrl);
  if (imageUrl) {
    const url = buildUrl(creds.baseUrl, `/${encodeURIComponent(creds.pageId)}/photos`, {
      access_token: creds.accessToken,
      url: imageUrl,
      caption: text,
      published: 'true',
    });
    const created = await fetchJson('POST', url);
    if (!created.ok) return created;
    return {
      ok: true,
      status: created.status,
      endpoint: created.endpoint,
      data: {
        id: safeText(created.data?.post_id || created.data?.id),
        endpoint: created.endpoint,
      },
    };
  }

  const url = buildUrl(creds.baseUrl, `/${encodeURIComponent(creds.pageId)}/feed`, {
    access_token: creds.accessToken,
    message: text,
  });
  const created = await fetchJson('POST', url);
  if (!created.ok) return created;
  return {
    ok: true,
    status: created.status,
    endpoint: created.endpoint,
    data: {
      id: safeText(created.data?.id),
      endpoint: created.endpoint,
    },
  };
}

function getThreadsCredentials() {
  // environmentValues already resolves Settings-saved values over env vars
  // (env is the fallback), so do not re-read process.env here -- that would
  // flip the precedence back and make Settings edits silently do nothing.
  const saved = environmentValues('threads');
  return {
    accessToken: safeText(saved.access_token),
    userId: safeText(saved.user_id),
    baseUrl: addNoTrailSlash(safeText(saved.base_url) || 'https://graph.threads.net/v1.0'),
  };
}

/**
 * This project's own Threads connection if it has a live one, otherwise the
 * platform-wide keys. Same envelope-free shape as `getThreadsCredentials`, with
 * a `source` on it so a log line can say which account actually posted.
 */
async function resolveThreadsCredentials({ projectId, userId } = {}) {
  const global = getThreadsCredentials();
  const pid = safeText(projectId);
  if (!pid) return { ...global, source: 'environment' };
  const resolved = await resolveCredentials('threads', pid, { userId });
  if (!resolved.ok) {
    return credentialRefusal(resolved, global.baseUrl);
  }
  const values = resolved.data.values;
  return {
    accessToken: safeText(values.access_token),
    userId: safeText(values.user_id),
    baseUrl: addNoTrailSlash(safeText(values.base_url) || global.baseUrl),
    source: resolved.data.source,
  };
}

function isThreadsConfigured(creds = getThreadsCredentials()) {
  return Boolean(creds.accessToken && creds.userId);
}

async function checkThreadsAuth(creds = getThreadsCredentials()) {
  if (isRefusal(creds)) return refusalResult(creds);
  if (!isThreadsConfigured(creds)) {
    return { ok: false, status: 400, error: 'Threads access_token and user_id are required' };
  }
  const url = buildUrl(creds.baseUrl, '/me', {
    fields: 'id,username',
    access_token: creds.accessToken,
  });
  return fetchJson('GET', url);
}

async function createThreadsPost(textInput, options = {}, creds = getThreadsCredentials()) {
  if (isRefusal(creds)) return refusalResult(creds);
  const text = safeText(textInput);
  if (!text) return { ok: false, status: 400, error: 'Post text is required' };
  if (!isThreadsConfigured(creds)) {
    return { ok: false, status: 400, error: 'Threads access_token and user_id are required' };
  }

  const imageUrl = safeText(options?.imageUrl);
  const createParams = {
    access_token: creds.accessToken,
    media_type: imageUrl ? 'IMAGE' : 'TEXT',
    text,
    ...(imageUrl ? { image_url: imageUrl } : {}),
  };
  const createUrl = buildUrl(creds.baseUrl, `/${encodeURIComponent(creds.userId)}/threads`, createParams);
  const createRes = await fetchJson('POST', createUrl);
  if (!createRes.ok) return createRes;

  const creationId = safeText(createRes.data?.id);
  if (!creationId) return { ok: false, status: 500, endpoint: createRes.endpoint, error: 'Threads create response missing creation id', data: createRes.data };

  const publishUrl = buildUrl(creds.baseUrl, `/${encodeURIComponent(creds.userId)}/threads_publish`, {
    access_token: creds.accessToken,
    creation_id: creationId,
  });
  const publishRes = await fetchJson('POST', publishUrl);
  if (!publishRes.ok) return publishRes;

  return {
    ok: true,
    status: publishRes.status,
    endpoint: publishRes.endpoint,
    data: {
      id: safeText(publishRes.data?.id),
      endpoint: publishRes.endpoint,
      creationId,
    },
  };
}

function getInstagramCredentials() {
  const saved = environmentValues('instagram');
  return {
    accessToken: safeText(process.env.INSTAGRAM_ACCESS_TOKEN) || safeText(saved.access_token),
    igUserId: safeText(process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID) || safeText(saved.business_account_id),
    appId: safeText(process.env.INSTAGRAM_APP_ID) || safeText(saved.app_id),
    appSecret: safeText(process.env.INSTAGRAM_APP_SECRET) || safeText(saved.app_secret),
    baseUrl: addNoTrailSlash(safeText(process.env.INSTAGRAM_BASE_URL) || safeText(saved.base_url) || 'https://graph.facebook.com/v22.0'),
  };
}

/**
 * This project's own Instagram connection if it has a live one, otherwise the
 * platform-wide keys.
 *
 * The app id and secret are deliberately kept from the environment: an
 * Instagram grant is one account's token against STARCASTER's Meta app, not a
 * new app of the client's, and blanking those two would fail the token
 * exchange with a Meta error naming none of this.
 */
async function resolveInstagramCredentials({ projectId, userId } = {}) {
  const global = getInstagramCredentials();
  const pid = safeText(projectId);
  if (!pid) return { ...global, source: 'environment' };
  const resolved = await resolveCredentials('instagram', pid, { userId });
  if (!resolved.ok) {
    return credentialRefusal(resolved, global.baseUrl);
  }
  const values = resolved.data.values;
  return {
    accessToken: safeText(values.access_token),
    igUserId: safeText(values.business_account_id),
    appId: safeText(values.app_id) || global.appId,
    appSecret: safeText(values.app_secret) || global.appSecret,
    baseUrl: addNoTrailSlash(safeText(values.base_url) || global.baseUrl),
    source: resolved.data.source,
  };
}

function isInstagramConfigured(creds = getInstagramCredentials()) {
  return Boolean(creds.accessToken && creds.igUserId);
}

async function checkInstagramAuth(creds = getInstagramCredentials()) {
  if (isRefusal(creds)) return refusalResult(creds);
  if (!isInstagramConfigured(creds)) {
    return { ok: false, status: 400, error: 'Instagram access_token and business_account_id are required' };
  }
  const url = buildUrl(creds.baseUrl, `/${encodeURIComponent(creds.igUserId)}`, {
    fields: 'id,username',
    access_token: creds.accessToken,
  });
  return fetchJson('GET', url);
}

async function createInstagramPost(textInput, options = {}, creds = getInstagramCredentials()) {
  if (isRefusal(creds)) return refusalResult(creds);
  const text = safeText(textInput);
  if (!isInstagramConfigured(creds)) {
    return { ok: false, status: 400, error: 'Instagram access_token and business_account_id are required' };
  }
  const imageUrl = safeText(options?.imageUrl);
  if (!imageUrl) {
    return { ok: false, status: 400, error: 'Instagram posting requires an image URL. Add a campaign primary image.' };
  }

  const createUrl = buildUrl(creds.baseUrl, `/${encodeURIComponent(creds.igUserId)}/media`, {
    access_token: creds.accessToken,
    image_url: imageUrl,
    caption: text,
  });
  const container = await fetchJson('POST', createUrl);
  if (!container.ok) return container;
  const creationId = safeText(container.data?.id);
  if (!creationId) {
    return { ok: false, status: 500, endpoint: container.endpoint, error: 'Instagram media container response missing id', data: container.data };
  }

  const publishUrl = buildUrl(creds.baseUrl, `/${encodeURIComponent(creds.igUserId)}/media_publish`, {
    access_token: creds.accessToken,
    creation_id: creationId,
  });
  const published = await fetchJson('POST', publishUrl);
  if (!published.ok) return published;
  return {
    ok: true,
    status: published.status,
    endpoint: published.endpoint,
    data: {
      id: safeText(published.data?.id),
      endpoint: published.endpoint,
      creationId,
    },
  };
}

module.exports = {
  getFacebookCredentials,
  resolveFacebookCredentials,
  isFacebookConfigured,
  checkFacebookAuth,
  createFacebookPost,
  getThreadsCredentials,
  resolveThreadsCredentials,
  isThreadsConfigured,
  checkThreadsAuth,
  createThreadsPost,
  getInstagramCredentials,
  resolveInstagramCredentials,
  isInstagramConfigured,
  checkInstagramAuth,
  createInstagramPost,
};

