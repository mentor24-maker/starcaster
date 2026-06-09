'use strict';

const { getProviderValues } = require('./apiSettings');
const { buildOAuthState } = require('./metaOAuthState');

const DEFAULT_SCOPES = [
  'pages_show_list',
  'pages_manage_posts',
  'pages_read_engagement',
].join(',');

function safeText(value) {
  return String(value || '').trim();
}

function addNoTrailSlash(url) {
  return safeText(url).replace(/\/+$/, '');
}

function getMetaAppCredentials() {
  const saved = getProviderValues('meta') || {};
  return {
    appId: safeText(process.env.FACEBOOK_APP_ID) || safeText(process.env.META_APP_ID) || safeText(saved.app_id),
    appSecret: safeText(process.env.FACEBOOK_APP_SECRET) || safeText(process.env.META_APP_SECRET) || safeText(saved.app_secret),
    graphVersion: 'v22.0',
    baseUrl: addNoTrailSlash(
      safeText(process.env.FACEBOOK_BASE_URL)
      || safeText(process.env.META_BASE_URL)
      || safeText(saved.base_url)
      || 'https://graph.facebook.com/v22.0'
    ),
  };
}

function isMetaAppConfigured(creds = getMetaAppCredentials()) {
  return Boolean(creds.appId && creds.appSecret);
}

function facebookDialogBase() {
  const creds = getMetaAppCredentials();
  const version = safeText(creds.graphVersion) || 'v22.0';
  return `https://www.facebook.com/${version}/dialog/oauth`;
}

function buildRedirectUri(origin) {
  const base = addNoTrailSlash(origin);
  return `${base}/api/promote/social/facebook/oauth/callback`;
}

async function fetchJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.headers || {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    return { ok: false, status: 0, error: `Network error: ${safeText(err?.message) || 'request failed'}` };
  }

  const raw = await response.text().catch(() => '');
  let data = null;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }

  if (!response.ok) {
    const message = safeText(data?.error?.message || data?.message || data?.error || raw) || `API error (${response.status})`;
    return { ok: false, status: response.status, error: message, data };
  }
  return { ok: true, status: response.status, data };
}

function buildOAuthStartUrl({ origin, projectId, userId } = {}) {
  const creds = getMetaAppCredentials();
  if (!isMetaAppConfigured(creds)) {
    return { ok: false, status: 400, error: 'Meta app_id and app_secret are required (Vercel env or Settings > APIs > Meta)' };
  }

  const stateRes = buildOAuthState({ projectId, userId });
  if (!stateRes.ok) return stateRes;

  const redirectUri = buildRedirectUri(origin);
  const params = new URLSearchParams({
    client_id: creds.appId,
    redirect_uri: redirectUri,
    state: stateRes.data,
    scope: DEFAULT_SCOPES,
    response_type: 'code',
  });

  return {
    ok: true,
    status: 200,
    data: {
      url: `${facebookDialogBase()}?${params.toString()}`,
      redirectUri,
      scopes: DEFAULT_SCOPES,
    },
  };
}

async function exchangeCodeForToken(code, redirectUri) {
  const creds = getMetaAppCredentials();
  const params = new URLSearchParams({
    client_id: creds.appId,
    client_secret: creds.appSecret,
    redirect_uri: redirectUri,
    code: safeText(code),
  });
  const url = `${creds.baseUrl}/oauth/access_token?${params.toString()}`;
  return fetchJson(url);
}

async function exchangeForLongLivedUserToken(shortLivedToken) {
  const creds = getMetaAppCredentials();
  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: creds.appId,
    client_secret: creds.appSecret,
    fb_exchange_token: safeText(shortLivedToken),
  });
  const url = `${creds.baseUrl}/oauth/access_token?${params.toString()}`;
  return fetchJson(url);
}

async function listManagedPages(userAccessToken) {
  const creds = getMetaAppCredentials();
  const params = new URLSearchParams({
    fields: 'id,name,access_token',
    access_token: safeText(userAccessToken),
    limit: '100',
  });
  const url = `${creds.baseUrl}/me/accounts?${params.toString()}`;
  const res = await fetchJson(url);
  if (!res.ok) return res;
  const pages = Array.isArray(res.data?.data) ? res.data.data : [];
  return {
    ok: true,
    status: res.status,
    data: pages.map((page) => ({
      id: safeText(page.id),
      name: safeText(page.name),
      access_token: safeText(page.access_token),
    })).filter((page) => page.id && page.access_token),
  };
}

async function completeOAuthCodeExchange(code, redirectUri) {
  const shortRes = await exchangeCodeForToken(code, redirectUri);
  if (!shortRes.ok) return shortRes;

  const shortToken = safeText(shortRes.data?.access_token);
  if (!shortToken) {
    return { ok: false, status: 500, error: 'Meta token response missing access_token', data: shortRes.data };
  }

  const longRes = await exchangeForLongLivedUserToken(shortToken);
  const userToken = longRes.ok ? safeText(longRes.data?.access_token) : shortToken;
  const pagesRes = await listManagedPages(userToken);
  if (!pagesRes.ok) return pagesRes;

  if (!pagesRes.data.length) {
    return {
      ok: false,
      status: 400,
      error: 'No Facebook Pages found for this account. Confirm you manage at least one Page and granted Page permissions.',
      data: { pages: [] },
    };
  }

  return {
    ok: true,
    status: 200,
    data: {
      pages: pagesRes.data,
      userTokenExchange: {
        shortLived: Boolean(shortToken),
        longLived: Boolean(longRes.ok && longRes.data?.access_token),
      },
    },
  };
}

module.exports = {
  DEFAULT_SCOPES,
  getMetaAppCredentials,
  isMetaAppConfigured,
  buildRedirectUri,
  buildOAuthStartUrl,
  completeOAuthCodeExchange,
  listManagedPages,
};
