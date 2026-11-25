'use strict';

/**
 * Google Calendar, behind the connections contract. Booking calendar, slice 5
 * of 6 (SC-913).
 *
 * A project connects ITS Google account once, from the Booking Manager. From
 * then on every booking becomes an event on that account's main calendar with
 * a Google Meet link (lib/bookingGoogleSync.js), and the times already busy on
 * that calendar are hidden from visitors.
 *
 * It is an ordinary redirect provider: the browser goes to Google, comes back
 * to CALLBACK_PATH with a code, and the code becomes an hour-long access token
 * plus a lasting refresh token. Both are stored ENCRYPTED in
 * project_connections (lib/projectConnectionsStore.js, the same vault and
 * cipher the Meta and X connections use), and `refresh` below renews the access
 * token before each use (lib/connections/verifySweep.js refreshBeforeUse).
 *
 * THE CALLBACK lives in routes/connections.js, generically: any adapter whose
 * `callbackPath` is `/api/connections/<provider>/callback` is finished there,
 * and routes/index.js exempts exactly those paths from the session check,
 * because what authorises the request is the SIGNED STATE it carries
 * (lib/metaOAuthState.js), never a cookie.
 *
 * Google hands the refresh token over only with `access_type=offline` AND
 * `prompt=consent`; lib/googleCalendar.js asks for both. A sign-in that comes
 * back without one, or with a calendar permission unticked on Google's screen,
 * is refused here with a sentence naming what to do, rather than stored as a
 * connection that dies an hour later.
 */

const contract = require('../contract');
const google = require('../../googleCalendar');
const { buildOAuthState } = require('../../metaOAuthState');

const PROVIDER = 'google_calendar';
const CALLBACK_PATH = '/api/connections/google_calendar/callback';

function safeText(value) {
  return String(value === 0 || value ? value : '').trim();
}

function callbackUrl() {
  return contract.oauthCallbackUrl(CALLBACK_PATH);
}

function toAccount(user, { accessToken, refreshToken, expiresAt }) {
  const id = safeText(user?.sub);
  return contract.account({
    accountId: id,
    accountLabel: safeText(user?.email) || id,
    accountAvatarUrl: safeText(user?.picture),
    accessToken,
    refreshToken,
    expiresAt,
    raw: { sub: id, email: safeText(user?.email) },
  });
}

/** Who this token belongs to, or a failure. */
async function whoIs(accessToken) {
  const res = await google.userInfo(accessToken);
  if (!res.ok) return res;
  if (!safeText(res.data?.sub)) return contract.fail(502, 'Google would not say which account this is');
  return res;
}

// ── The six ─────────────────────────────────────────────────────────────────

function authorizeUrl({ projectId, userId, returnTo = '' } = {}) {
  if (!google.isConfigured()) return google.notConfigured();
  const state = buildOAuthState({ projectId, userId, provider: PROVIDER, returnTo });
  if (!state.ok) return contract.fail(400, state.error || 'Could not start the Google sign-in');
  return google.authorizeUrl({ state: state.data, redirectUri: callbackUrl() });
}

async function exchange({ code, redirectUri, nowMs } = {}) {
  const value = safeText(code);
  if (!value) return contract.fail(400, 'Google did not send back a sign-in code');
  if (!google.isConfigured()) return google.notConfigured();
  const tokenRes = await google.exchangeCode({ code: value, redirectUri: safeText(redirectUri) || callbackUrl() });
  if (!tokenRes.ok) return tokenRes;
  const tokens = tokenRes.data || {};
  const accessToken = safeText(tokens.access_token);
  const refreshToken = safeText(tokens.refresh_token);
  if (!accessToken) return contract.fail(502, 'Google accepted the sign-in but sent no access token');
  if (!refreshToken) {
    return contract.fail(
      400,
      'Google did not grant lasting access, so the connection would stop working within the hour. '
        + 'Remove Starcaster at myaccount.google.com/permissions, then connect again.',
      { code: 'NO_REFRESH_TOKEN' }
    );
  }
  // Google lets the person untick each permission. Without both, bookings
  // cannot reach the calendar or busy times cannot be read, and saying so now
  // beats a connection that looks fine and does half its job.
  const missing = google.missingScopes(tokens);
  if (missing.length && safeText(tokens.scope)) {
    return contract.fail(
      400,
      'Google Calendar was connected without every permission it needs (making events, and seeing when you are busy). '
        + 'Connect again and leave both boxes ticked on Google\'s screen.',
      { code: 'MISSING_SCOPES' }
    );
  }
  const me = await whoIs(accessToken);
  if (!me.ok) return me;
  const at = Number.isFinite(nowMs) ? nowMs : Date.now();
  return contract.ok(200, {
    accounts: [toAccount(me.data, { accessToken, refreshToken, expiresAt: google.expiryFrom(tokens, at) })],
  });
}

async function listAccounts(input = {}) {
  const ref = contract.accountRef(input);
  if (!ref.accessToken) return contract.fail(400, 'A Google access token is required to list the account');
  const me = await whoIs(ref.accessToken);
  if (!me.ok) return me;
  return contract.ok(200, {
    accounts: [toAccount(me.data, { accessToken: ref.accessToken, refreshToken: ref.refreshToken, expiresAt: ref.expiresAt })],
  });
}

/** Renew the hour-long access token. Google keeps the same refresh token. */
async function refresh(input = {}) {
  const ref = contract.accountRef(input);
  if (!ref.refreshToken) {
    return contract.fail(400, 'This Google Calendar connection has no lasting permission stored, so it has to be connected again.', {
      code: 'NO_REFRESH_TOKEN',
    });
  }
  const tokenRes = await google.refreshAccessToken(ref.refreshToken);
  if (!tokenRes.ok) return tokenRes;
  const accessToken = safeText(tokenRes.data?.access_token);
  if (!accessToken) return contract.fail(502, 'Google reported a renewal but sent no access token');
  const at = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  return contract.ok(200, {
    refreshed: true,
    accessToken,
    refreshToken: safeText(tokenRes.data?.refresh_token) || ref.refreshToken,
    expiresAt: google.expiryFrom(tokenRes.data, at),
  });
}

async function verify(input = {}) {
  const ref = contract.accountRef(input);
  if (!ref.accessToken) return contract.fail(400, 'Google verify needs the account\'s access token');
  const me = await whoIs(ref.accessToken);
  if (!me.ok) return me;
  return contract.ok(me.status || 200, {
    valid: true,
    accountId: safeText(me.data.sub),
    accountLabel: safeText(me.data.email) || safeText(me.data.sub),
  });
}

/**
 * Withdraw the permission at Google. Revoking the refresh token ends the whole
 * grant. Google answering 400 "invalid_token" means it is already gone, which
 * from where the client stands is a successful revoke.
 */
async function revoke(input = {}) {
  const ref = contract.accountRef(input);
  const token = ref.refreshToken || ref.accessToken;
  if (!token) return contract.fail(400, 'Google revoke needs the account\'s token');
  const res = await google.revokeToken(token);
  if (res.ok || (res.status === 400 && /invalid_token/i.test(safeText(res.error)))) {
    return contract.ok(200, { revokedAtProvider: true });
  }
  return contract.ok(200, {
    revokedAtProvider: false,
    reason: `Google did not confirm the revoke (${res.error}). Starcaster has forgotten the connection; `
      + 'you can also remove Starcaster at myaccount.google.com/permissions.',
  });
}

module.exports = {
  provider: PROVIDER,
  authKind: 'redirect',
  callbackPath: CALLBACK_PATH,
  callbackUrl,
  authorizeUrl,
  exchange,
  listAccounts,
  refresh,
  verify,
  revoke,
};
