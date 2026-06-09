'use strict';

const { getProviderValues } = require('./apiSettings');
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

function getFacebookCredentials() {
  const saved = getProviderValues('meta') || {};
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

async function resolveFacebookCredentials({ projectId } = {}) {
  const global = getFacebookCredentials();
  const pid = safeText(projectId);
  if (!pid) return global;

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
  const saved = getProviderValues('threads') || {};
  return {
    accessToken: safeText(process.env.THREADS_ACCESS_TOKEN) || safeText(saved.access_token),
    userId: safeText(process.env.THREADS_USER_ID) || safeText(saved.user_id),
    baseUrl: addNoTrailSlash(safeText(process.env.THREADS_BASE_URL) || safeText(saved.base_url) || 'https://graph.threads.net/v1.0'),
  };
}

function isThreadsConfigured(creds = getThreadsCredentials()) {
  return Boolean(creds.accessToken && creds.userId);
}

async function checkThreadsAuth(creds = getThreadsCredentials()) {
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
  const saved = getProviderValues('instagram') || {};
  return {
    accessToken: safeText(process.env.INSTAGRAM_ACCESS_TOKEN) || safeText(saved.access_token),
    igUserId: safeText(process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID) || safeText(saved.business_account_id),
    appId: safeText(process.env.INSTAGRAM_APP_ID) || safeText(saved.app_id),
    appSecret: safeText(process.env.INSTAGRAM_APP_SECRET) || safeText(saved.app_secret),
    baseUrl: addNoTrailSlash(safeText(process.env.INSTAGRAM_BASE_URL) || safeText(saved.base_url) || 'https://graph.facebook.com/v22.0'),
  };
}

function isInstagramConfigured(creds = getInstagramCredentials()) {
  return Boolean(creds.accessToken && creds.igUserId);
}

async function checkInstagramAuth(creds = getInstagramCredentials()) {
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
  isThreadsConfigured,
  checkThreadsAuth,
  createThreadsPost,
  getInstagramCredentials,
  isInstagramConfigured,
  checkInstagramAuth,
  createInstagramPost,
};

