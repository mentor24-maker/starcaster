'use strict';

/**
 * Facebook Pages, behind the contract. Connections 2 of 7 (86bbpz1e1).
 *
 * This is a MOVE, not a rewrite. Every line of Meta logic below came out of
 * lib/metaOAuth.js unchanged, and lib/metaOAuth.js now re-exports from here so
 * routes/engage.js and anything else keeps working. Porting a flow that already
 * works in production is the point of the slice: if the Facebook connection
 * breaks after this, the contract is the wrong shape — which is worth knowing
 * now, while one platform is on it, rather than after five are.
 *
 * The one deliberate behaviour change: the redirect_uri is built from the
 * PINNED origin (contract.js, PRODUCTION_ORIGIN) instead of from the request.
 * Meta rejects any redirect_uri it was not registered with, and the request
 * origin on a preview deployment is a hostname that has never been registered
 * and never will be.
 */

const { getProviderValues } = require('../../apiSettings');
const { buildOAuthState } = require('../../metaOAuthState');
const contract = require('../contract');

const PROVIDER = 'facebook_page';
const CALLBACK_PATH = '/api/promote/social/facebook/oauth/callback';

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

/**
 * Where Meta sends the browser back. Takes no origin on purpose — see the file
 * header. `buildRedirectUri(origin)` in lib/metaOAuth.js still accepts one for
 * compatibility and ignores it.
 */
function callbackUrl() {
  return contract.oauthCallbackUrl(CALLBACK_PATH);
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

  // `origin` is accepted and ignored: every caller used to pass the request's
  // origin, and the redirect must be the registered one. Kept in the signature
  // so the re-export in lib/metaOAuth.js is a true alias.
  void origin;
  const redirectUri = callbackUrl();
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

/**
 * One Page, in the shape every provider answers in — so the wizard can render a
 * list of accounts without knowing whose they are. Built through
 * `contract.account` rather than written out here, so the names are the ones
 * `verify`, `refresh` and `revoke` below read back: this account is handed
 * straight to them, and it used to come out as `{ id, label }` and be refused.
 * The provider's own row is kept on `raw` because the Page shape
 * (`access_token`, `name`) is what routes/engage.js and
 * projectSocialCredentialsStore already speak.
 */
function toAccount(page) {
  return contract.account({
    accountId: safeText(page?.id),
    accountLabel: safeText(page?.name),
    accessToken: safeText(page?.access_token),
    raw: { id: safeText(page?.id), name: safeText(page?.name), access_token: safeText(page?.access_token) },
  });
}

// ---------------------------------------------------------------------------
// The six.
// ---------------------------------------------------------------------------

function authorizeUrl({ projectId, userId } = {}) {
  return contract.normalize(buildOAuthStartUrl({ projectId, userId }), 400);
}

async function exchange({ code, redirectUri } = {}) {
  const trimmed = safeText(code);
  if (!trimmed) return contract.fail(400, 'An OAuth code is required to finish connecting a Facebook Page');
  const res = await completeOAuthCodeExchange(trimmed, safeText(redirectUri) || callbackUrl());
  if (!res.ok) return contract.normalize(res, 502);
  const pages = Array.isArray(res.data?.pages) ? res.data.pages : [];
  return contract.ok(200, {
    accounts: pages.map(toAccount),
    // The Page rows exactly as Meta sent them. routes/engage.js's page-selection
    // handoff stores these, and slice 2 must not change a byte of what it stores.
    pages,
    userTokenExchange: res.data?.userTokenExchange || null,
  });
}

async function listAccounts(input = {}) {
  const token = contract.accountRef(input).accessToken;
  if (!token) return contract.fail(400, 'A Facebook user access token is required to list Pages');
  const res = await listManagedPages(token);
  if (!res.ok) return contract.normalize(res, 502);
  const pages = Array.isArray(res.data) ? res.data : [];
  return contract.ok(res.status || 200, { accounts: pages.map(toAccount), pages });
}

/**
 * A Page access token derived from a long-lived user token does not expire, so
 * there is nothing here to refresh — which is a fact, not an error. It answers
 * ok with `refreshed: false` so a caller sweeping every connection (slice 6)
 * does not have to know which platforms have refresh tokens and which do not.
 */
async function refresh(input = {}) {
  const token = contract.accountRef(input).accessToken;
  if (!token) return contract.fail(400, 'A Facebook Page access token is required');
  return contract.ok(200, {
    refreshed: false,
    accessToken: token,
    reason: 'A Facebook Page token issued from a long-lived user token does not expire, so there is nothing to refresh. '
      + 'If it stops working, the client changed a permission and the connection must be made again.',
  });
}

async function verify(input = {}) {
  const { accountId: pageId, accessToken: token } = contract.accountRef(input);
  if (!pageId || !token) {
    return contract.fail(400, 'Facebook verify needs the Page id and its access token');
  }
  const creds = getMetaAppCredentials();
  const params = new URLSearchParams({ fields: 'id,name', access_token: token });
  const res = await fetchJson(`${creds.baseUrl}/${encodeURIComponent(pageId)}?${params.toString()}`);
  if (!res.ok) return contract.normalize(res, 502);
  return contract.ok(res.status || 200, {
    valid: true,
    accountId: safeText(res.data?.id) || pageId,
    accountLabel: safeText(res.data?.name),
  });
}

/**
 * Hand the permission back at Meta's end.
 *
 * Best effort, and it says which it managed: Meta can answer "this token is
 * already dead", which is a successful revoke by any reading a client cares
 * about. Deleting the stored row is the CALLER's job either way — a revoke that
 * failed at the provider must still not leave a token in the vault.
 */
async function revoke(input = {}) {
  const { accountId: pageId, accessToken: token } = contract.accountRef(input);
  if (!pageId || !token) {
    return contract.fail(400, 'Facebook revoke needs the Page id and its access token');
  }
  const creds = getMetaAppCredentials();
  const params = new URLSearchParams({ access_token: token });
  const res = await fetchJson(
    `${creds.baseUrl}/${encodeURIComponent(pageId)}/permissions?${params.toString()}`,
    { method: 'DELETE' }
  );
  if (!res.ok) {
    return contract.ok(200, {
      revokedAtProvider: false,
      reason: `Meta did not confirm the revoke (${res.error}). Remove the stored connection anyway, `
        + 'and the client can also remove Starcaster under Facebook Settings > Business Integrations.',
    });
  }
  return contract.ok(res.status || 200, { revokedAtProvider: true });
}

module.exports = {
  provider: PROVIDER,
  authKind: 'redirect',
  callbackPath: CALLBACK_PATH,
  callbackUrl,
  isConfigured: isMetaAppConfigured,

  authorizeUrl,
  exchange,
  listAccounts,
  refresh,
  verify,
  revoke,

  // The pre-contract surface, kept whole so lib/metaOAuth.js is a true alias.
  DEFAULT_SCOPES,
  getMetaAppCredentials,
  isMetaAppConfigured,
  buildOAuthStartUrl,
  completeOAuthCodeExchange,
  listManagedPages,
};
