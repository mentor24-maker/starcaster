'use strict';

/**
 * One way to ask "do these credentials work, and whose are they?" for every
 * provider.
 *
 * Before this, verification was ad hoc: 30 providers were configurable, 6 had
 * an auth-test HTTP endpoint, 8 had a "Run Test" button, and the UI picked
 * between them with a hand-written if/else chain — which is exactly why Buffer
 * and YouTube never got one. Ten live integrations could only be checked by
 * triggering the feature and reading a raw API error.
 *
 * Every verifier returns the same shape, so callers never special-case a
 * provider:
 *
 *   {
 *     provider:  'x',
 *     ok:        true,
 *     code:      null | one of credentialErrors CODES | NOT_VERIFIABLE,
 *     identity:  { label: '@dachristensen', id: '18223886' } | null,
 *     detail:    'raw text from the provider, for the details pane',
 *     message:   'operator-facing sentence (only when !ok)',
 *     checkedAt: ISO timestamp,
 *   }
 *
 * Two honesty rules, both learned the hard way:
 *
 * 1. `identity` answers "as whom?". A passing check that cannot say which
 *    account it authenticated as is half an answer — on a multi-tenant platform
 *    where each project posts as a different identity, publishing to the wrong
 *    account is a serious failure. Where a provider can tell us, we ask.
 * 2. NOT_VERIFIABLE is never reported as success. Telegram's old "test" only
 *    checked whether fields were filled in and never contacted Telegram, so it
 *    passed on invalid credentials. "We cannot check this" and "this works" must
 *    never look the same.
 */

const { CODES, describeCredentialFailure, codeFromHttpStatus } = require('./credentialErrors');
const { getProviderValues } = require('./apiSettings');

/** Not a failure — we have no way to check this provider. Distinct from ok:false. */
const NOT_VERIFIABLE = 'not_verifiable';

function safeText(value) {
  return String(value == null ? '' : value).trim();
}

/** Build the uniform success result. */
function verified(provider, { identity = null, detail = '', status = 200 } = {}) {
  return {
    provider,
    ok: true,
    code: null,
    status,
    identity,
    detail: safeText(detail),
    message: '',
    checkedAt: new Date().toISOString(),
  };
}

/** Build the uniform failure result, with the message assembled centrally. */
function failed(provider, { code, detail = '', fix = '', status = 0 } = {}) {
  const resolved = code || CODES.REJECTED;
  return {
    provider,
    ok: false,
    code: resolved,
    status,
    identity: null,
    detail: safeText(detail),
    message: describeCredentialFailure({ provider, code: resolved, detail, fix }),
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Adapt a legacy client result ({ ok, status, error, data }) to the uniform
 * shape. Clients that already classify (xClient, post Phase 1) pass their own
 * `code` through; the rest are classified from the HTTP status.
 */
function fromLegacyResult(provider, result, { identity = null, fix = '' } = {}) {
  if (result && result.ok) {
    return verified(provider, { identity, status: result.status || 200 });
  }
  const status = Number(result?.status || 0) || 0;
  // Our own clients return 400 from their pre-flight guard when values are not
  // set — that is "you have not finished configuring this", not "the provider
  // refused you". Only safe to assume for OUR results, which is why this lives
  // here rather than in codeFromHttpStatus.
  const code = result?.code
    || (status === 400 ? CODES.MISSING : (status ? codeFromHttpStatus(status) : CODES.UNREACHABLE));
  // A client that already produced an operator-facing message (Phase 1 clients)
  // should not have it rebuilt and doubled up.
  if (result?.code && result?.error) {
    return {
      provider,
      ok: false,
      code: result.code,
      status,
      identity: null,
      detail: safeText(result.error),
      message: safeText(result.error),
      checkedAt: new Date().toISOString(),
    };
  }
  return failed(provider, { code, detail: result?.error, fix, status });
}

/**
 * The common shape of a key-only check: one authenticated GET, where a 200
 * means the key is good. Used by the providers that have no client library.
 *
 * There is no identity to report for most of these — an API key belongs to an
 * account but the endpoints do not say which, and inventing a label would be
 * worse than admitting it. Where a provider CAN name the account (Drive,
 * Supabase) the verifier reports it instead of using this helper.
 */
async function simpleKeyCheck(provider, { apiKey, url, headers = {}, fix = '' }) {
  if (!safeText(apiKey)) {
    return failed(provider, { code: CODES.MISSING, status: 400, fix });
  }
  let response;
  let payload = null;
  try {
    response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json', ...headers } });
    payload = await response.json().catch(() => null);
  } catch (err) {
    return failed(provider, { code: CODES.UNREACHABLE, detail: err.message || String(err) });
  }
  if (!response.ok) {
    const detail = safeText(payload?.error?.message)
      || safeText(payload?.error?.type)
      || safeText(payload?.message)
      || response.statusText;
    return failed(provider, { code: codeFromHttpStatus(response.status), status: response.status, detail, fix });
  }
  return verified(provider, { status: response.status });
}

/**
 * provider key -> async () => uniform result.
 *
 * Adding a provider means adding a row here. That is the whole point: the old
 * if/else chain in the Settings UI is why providers silently went unverifiable.
 */
const VERIFIERS = {
  async x() {
    const xClient = require('./xClient');
    const res = await xClient.checkAuth();
    const user = res?.data?.user || null;
    const username = safeText(user?.username);
    const accessToken = safeText(xClient.getXCredentials().accessToken);
    const accountId = safeText(user?.id) || accessToken.split('-')[0] || '';
    return fromLegacyResult('x', res, {
      identity: username ? { label: `@${username}`, id: accountId } : null,
    });
  },

  async bluesky() {
    const blueskyClient = require('./blueskyClient');
    const creds = blueskyClient.getBlueskyCredentials();
    if (!blueskyClient.isConfigured(creds)) {
      return failed('bluesky', {
        code: CODES.MISSING,
        status: 400,
        fix: 'Bluesky needs an Identifier (full handle or email, no @) and an App Password.',
      });
    }
    const res = await blueskyClient.createSession(creds);
    const handle = safeText(res?.data?.handle) || safeText(creds.identifier);
    return fromLegacyResult('bluesky', res, {
      identity: res?.ok ? { label: handle ? `@${handle}` : 'connected', id: safeText(res.did) } : null,
      fix: 'Bluesky app passwords are revoked when regenerated — create a fresh one at '
        + 'Settings > Privacy and Security > App Passwords, and use your full handle as the Identifier.',
    });
  },

  async reddit() {
    const redditClient = require('./redditClient');
    if (!redditClient.isConfigured()) {
      return failed('reddit', {
        code: CODES.MISSING,
        status: 400,
        fix: 'Reddit needs a Client ID, Client Secret, and Refresh Token.',
      });
    }
    const res = await redditClient.checkAuth();
    const name = safeText(res?.data?.name);
    return fromLegacyResult('reddit', res, {
      identity: name ? { label: `u/${name}`, id: safeText(res?.data?.id) } : null,
      fix: 'Reddit refresh tokens are invalidated when the app password changes or access is '
        + 'revoked. Re-authorize the app to get a new refresh token.',
    });
  },

  async buffer() {
    const bufferClient = require('./bufferClient');
    if (!bufferClient.isConfigured()) {
      return failed('buffer', {
        code: CODES.MISSING,
        status: 400,
        fix: 'Buffer needs an API key (access token) from your Buffer developer app.',
      });
    }
    const res = await bufferClient.checkAuth();
    const orgs = Array.isArray(res?.data?.organizations) ? res.data.organizations : [];
    const first = orgs[0] || null;
    return fromLegacyResult('buffer', res, {
      identity: first ? { label: safeText(first.name) || 'Buffer organization', id: safeText(first.id) } : null,
    });
  },

  /**
   * Facebook is the one provider whose credentials are per-project: a Page
   * connected through Settings > Connections is stored per project and beats the
   * global env values. Verifying without the project scope checks the wrong
   * credentials and reports a failure for a Page that actually works.
   */
  async facebook(options = {}) {
    const metaClients = require('./metaClients');
    const creds = await metaClients.resolveFacebookCredentials({ projectId: options.projectId });
    if (!metaClients.isFacebookConfigured(creds)) {
      return failed('facebook', {
        code: CODES.MISSING,
        status: 400,
        fix: 'Facebook needs a Page access token and Page ID. Use the Connect button in '
          + 'Settings > Connections to authorize a Page for this project.',
      });
    }
    const res = await metaClients.checkFacebookAuth(creds);
    const name = safeText(res?.data?.name) || safeText(creds.pageName);
    const scope = creds.source === 'project' ? 'this project' : 'the global env values';
    return fromLegacyResult('facebook', res, {
      identity: name ? { label: name, id: safeText(res?.data?.id) || safeText(creds.pageId) } : null,
      fix: `Checked the Page credentials for ${scope}. Facebook Page tokens expire — reconnect `
        + 'the Page via the Connect button in Settings > Connections to mint a fresh long-lived token.',
    });
  },

  async threads() {
    const metaClients = require('./metaClients');
    if (!metaClients.isThreadsConfigured()) {
      return failed('threads', {
        code: CODES.MISSING,
        status: 400,
        fix: 'Threads needs a user access token and user ID from the Meta app.',
      });
    }
    const res = await metaClients.checkThreadsAuth();
    const name = safeText(res?.data?.username) || safeText(res?.data?.name);
    return fromLegacyResult('threads', res, {
      identity: name ? { label: `@${name}`, id: safeText(res?.data?.id) } : null,
      fix: 'Threads tokens are short-lived unless exchanged for a long-lived one. Re-authorize '
        + 'the Meta app to mint a fresh token.',
    });
  },

  async instagram() {
    const metaClients = require('./metaClients');
    if (!metaClients.isInstagramConfigured()) {
      return failed('instagram', {
        code: CODES.MISSING,
        status: 400,
        fix: 'Instagram needs a user access token and the Instagram Business account ID.',
      });
    }
    const res = await metaClients.checkInstagramAuth();
    const name = safeText(res?.data?.username) || safeText(res?.data?.name);
    return fromLegacyResult('instagram', res, {
      identity: name ? { label: `@${name}`, id: safeText(res?.data?.id) } : null,
      fix: 'Instagram publishing needs a Business account reachable through a Page the token '
        + 'can see — the usual cause is a missing business_management scope.',
    });
  },

  /**
   * Telegram had no real check: the old status endpoint reported whether the
   * fields were filled in and never contacted Telegram, so it "passed" with a
   * bogus token. getMe is the cheap authenticated call that actually verifies.
   */
  async telegram() {
    const telegramClient = require('./telegramClient');
    const creds = telegramClient.getTelegramCredentials();
    if (!telegramClient.isConfigured(creds)) {
      return failed('telegram', {
        code: CODES.MISSING,
        status: 400,
        fix: 'Telegram needs a Bot Token from @BotFather and a Chat ID for the destination.',
      });
    }
    const base = safeText(creds.baseUrl) || 'https://api.telegram.org';
    let response;
    let payload = null;
    try {
      response = await fetch(`${base}/bot${creds.botToken}/getMe`, { method: 'GET' });
      payload = await response.json().catch(() => null);
    } catch (err) {
      return failed('telegram', { code: CODES.UNREACHABLE, detail: err.message || String(err) });
    }
    if (!response.ok || !payload?.ok) {
      return failed('telegram', {
        code: codeFromHttpStatus(response.status),
        status: response.status,
        detail: safeText(payload?.description) || response.statusText,
        fix: 'Bot tokens are invalidated when regenerated in @BotFather. Generate a new token there.',
      });
    }
    const username = safeText(payload?.result?.username);
    return verified('telegram', {
      status: response.status,
      identity: username ? { label: `@${username}`, id: safeText(payload?.result?.id) } : null,
    });
  },

  async openclaw() {
    const client = require('./openclawResponsesClient');
    const res = await client.testOpenClawGateway();
    return fromLegacyResult('openclaw', res, {
      identity: res?.ok ? { label: 'OpenClaw gateway reachable', id: '' } : null,
    });
  },

  // ── Providers that had no check at all until now ────────────────────────
  // These are key-only services with no client library of their own. Each uses
  // the cheapest authenticated read the provider offers, so a check costs
  // nothing meaningful. Where the provider can name the account, we ask —
  // that is the whole point of `identity`.

  async anthropic() {
    const { api_key: apiKey } = getProviderValues('anthropic');
    return simpleKeyCheck('anthropic', {
      apiKey,
      url: 'https://api.anthropic.com/v1/models?limit=1',
      headers: { 'x-api-key': safeText(apiKey), 'anthropic-version': '2023-06-01' },
      fix: 'Anthropic keys start with sk-ant-. Create or rotate one in the Anthropic Console.',
    });
  },

  async openai() {
    const { api_key: apiKey } = getProviderValues('openai');
    return simpleKeyCheck('openai', {
      apiKey,
      url: 'https://api.openai.com/v1/models',
      headers: { Authorization: `Bearer ${safeText(apiKey)}` },
      fix: 'OpenAI keys start with sk-. Create or rotate one in the OpenAI dashboard.',
    });
  },

  async gemini() {
    const { api_key: apiKey } = getProviderValues('gemini');
    if (!safeText(apiKey)) {
      return failed('gemini', { code: CODES.MISSING, status: 400, fix: 'Gemini needs an API key from Google AI Studio.' });
    }
    return simpleKeyCheck('gemini', {
      apiKey,
      url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(safeText(apiKey))}&pageSize=1`,
      headers: {},
      fix: 'Gemini keys come from Google AI Studio and are restricted per project.',
    });
  },

  async brave() {
    const { api_key: apiKey } = getProviderValues('brave');
    return simpleKeyCheck('brave', {
      apiKey,
      // Brave has no free ping endpoint, so this spends one search query.
      url: 'https://api.search.brave.com/res/v1/web/search?q=starcaster&count=1',
      headers: { 'X-Subscription-Token': safeText(apiKey), Accept: 'application/json' },
      fix: 'Brave Search keys are per-plan — a key for the wrong plan returns 403 rather than 401.',
    });
  },

  async youtube() {
    const { api_key: apiKey } = getProviderValues('youtube');
    return simpleKeyCheck('youtube', {
      apiKey,
      // videos.list against a fixed public id costs 1 quota unit.
      url: `https://www.googleapis.com/youtube/v3/videos?part=id&id=dQw4w9WgXcQ&key=${encodeURIComponent(safeText(apiKey))}`,
      headers: {},
      fix: 'The YouTube Data API v3 must be enabled for the key’s Google Cloud project, '
        + 'and any HTTP-referrer restriction on the key will reject server-side calls.',
    });
  },

  async resend() {
    const { api_key: apiKey } = getProviderValues('resend');
    const res = await simpleKeyCheck('resend', {
      apiKey,
      url: 'https://api.resend.com/domains',
      headers: { Authorization: `Bearer ${safeText(apiKey)}` },
      fix: 'Resend keys start with re_. Sending also requires a verified domain.',
    });
    return res;
  },

  async supabase() {
    const cfg = getProviderValues('supabase');
    const url = safeText(cfg.url);
    const key = safeText(cfg.service_role_key);
    if (!url || !key) {
      return failed('supabase', {
        code: CODES.MISSING,
        status: 400,
        fix: 'Supabase needs the project URL and the service role key.',
      });
    }
    let response;
    try {
      response = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/`, {
        method: 'GET',
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
    } catch (err) {
      return failed('supabase', { code: CODES.UNREACHABLE, detail: err.message || String(err) });
    }
    if (!response.ok) {
      return failed('supabase', {
        code: codeFromHttpStatus(response.status),
        status: response.status,
        detail: response.statusText,
        fix: 'Check the project URL and that the key is the service role key, not the anon key.',
      });
    }
    let host = url;
    try { host = new URL(url).host; } catch (_) { /* keep the raw string */ }
    return verified('supabase', { status: response.status, identity: { label: host, id: '' } });
  },

  /**
   * Google Drive is the one where identity matters most: the OAuth token and
   * the account that owns the asset folders have been different accounts
   * before, which is invisible until something silently writes to the wrong
   * Drive quota. `about?fields=user` names the account the token acts as.
   */
  async google_drive() {
    const googleDrive = require('./googleDrive');
    if (!googleDrive.isConfigured()) {
      return failed('google_drive', {
        code: CODES.MISSING,
        status: 400,
        fix: 'Google Drive needs an OAuth Client ID, Client Secret, and Refresh Token.',
      });
    }
    let token;
    try {
      token = await googleDrive.getAccessToken();
    } catch (err) {
      return failed('google_drive', {
        code: CODES.REJECTED,
        detail: err && err.message ? err.message : String(err),
        fix: 'The refresh token could not be exchanged for an access token. Refresh tokens are '
          + 'revoked when the Google account password changes or access is withdrawn — re-authorize to get a new one.',
      });
    }
    const accessToken = safeText(typeof token === 'string' ? token : token?.accessToken || token?.access_token);
    if (!accessToken) {
      return failed('google_drive', {
        code: CODES.REJECTED,
        fix: 'No access token came back from the refresh exchange. Re-authorize the Drive connection.',
      });
    }
    let response;
    let payload = null;
    try {
      response = await fetch('https://www.googleapis.com/drive/v3/about?fields=user,storageQuota', {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      payload = await response.json().catch(() => null);
    } catch (err) {
      return failed('google_drive', { code: CODES.UNREACHABLE, detail: err.message || String(err) });
    }
    if (!response.ok) {
      return failed('google_drive', {
        code: codeFromHttpStatus(response.status),
        status: response.status,
        detail: safeText(payload?.error?.message) || response.statusText,
      });
    }
    const email = safeText(payload?.user?.emailAddress);
    return verified('google_drive', {
      status: response.status,
      identity: email ? { label: email, id: safeText(payload?.user?.permissionId) } : null,
      detail: 'Uploads consume this account’s Drive quota.',
    });
  },
};

/** Providers this module can actually verify. */
function verifiableProviders() {
  return Object.keys(VERIFIERS).sort();
}

function isVerifiable(provider) {
  return Object.prototype.hasOwnProperty.call(VERIFIERS, String(provider || '').trim().toLowerCase());
}

/**
 * Run the live check for one provider.
 *
 * Never throws: a verifier that blows up is reported as a failure with the
 * thrown message, because an exception escaping here would take down whatever
 * page asked.
 */
async function verifyProvider(providerInput, options = {}) {
  const provider = String(providerInput || '').trim().toLowerCase();
  if (!provider) {
    return { provider: '', ok: false, code: CODES.MISSING, identity: null, detail: '', message: 'No provider given.', checkedAt: new Date().toISOString() };
  }
  if (!isVerifiable(provider)) {
    return {
      provider,
      ok: false,
      code: NOT_VERIFIABLE,
      status: 0,
      identity: null,
      detail: '',
      // Deliberately not phrased as a credential failure — nothing was tested.
      message: `${provider.toUpperCase()}: StarCaster has no live check for this provider yet, `
        + 'so its credentials cannot be confirmed from here. Presence of the values was checked, not validity.',
      checkedAt: new Date().toISOString(),
    };
  }
  try {
    return await VERIFIERS[provider](options);
  } catch (err) {
    return failed(provider, {
      code: CODES.UNREACHABLE,
      detail: err && err.message ? err.message : String(err),
    });
  }
}

module.exports = {
  NOT_VERIFIABLE,
  VERIFIERS,
  verifiableProviders,
  isVerifiable,
  verifyProvider,
};
