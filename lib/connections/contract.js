'use strict';

/**
 * The one shape every social platform implements. Connections 2 of 7 (86bbpz1e1).
 *
 * "Add another channel" is meant to be a one-file job: write an adapter that
 * exports these six functions, register it, and the wizard, the resolver and
 * the publisher all work without knowing the platform exists. This file is the
 * definition of "these six functions", and scripts/builder/connectionsAdapterContract.test.js
 * walks every registered adapter against it — so a seventh platform that forgets
 * `revoke` fails a test rather than failing a client at 9pm.
 *
 * The shape is proven twice on purpose (slice 2's whole point):
 *
 *   facebookPage  a redirect provider — a browser round trip, a code exchange,
 *                 several accounts behind one grant. This is the WORKING
 *                 production flow, moved here unchanged. If it breaks, the
 *                 contract is wrong, not the platform.
 *   bluesky       an app-password provider — no browser, no redirect, no
 *                 refresh token. It is the second implementation precisely
 *                 because it does not fit the OAuth-shaped assumption, and an
 *                 interface proven only against the case it was drawn from is
 *                 not proven at all.
 */

/**
 * The six. Every adapter exports all of them, and every one of them returns an
 * envelope — including the ones a given platform cannot do, which say so in
 * `error` rather than being absent (an absent function is a TypeError at the
 * call site; a refusal is a message a screen can render).
 *
 *   authorizeUrl({ projectId, userId })     where to send the browser, or a
 *                                           refusal for a provider that has no
 *                                           browser step
 *   exchange(input)                         turn what came back — a code, or a
 *                                           handle and app password — into
 *                                           accounts with tokens
 *   listAccounts({ accessToken, ... })      which accounts this grant covers
 *   refresh({ accessToken, ... })           make an aging grant good again
 *   verify({ accountId, accessToken, ... }) does this grant still work RIGHT NOW
 *   revoke({ accountId, accessToken, ... }) hand the permission back
 */
const ADAPTER_FUNCTIONS = Object.freeze([
  'authorizeUrl', 'exchange', 'listAccounts', 'refresh', 'verify', 'revoke',
]);

/** What the wizard does with a catalogue entry. `coming_soon` renders greyed, with no button. */
const READINESS_FLAGS = Object.freeze(['ready', 'coming_soon']);

/**
 * How a provider is connected. Not decoration: it is what tells slice 4 whether
 * a Connect button opens a browser window or a small form, and it is the reason
 * `authorizeUrl` is allowed to refuse.
 */
const AUTH_KINDS = Object.freeze(['redirect', 'app_password']);

/**
 * Out of scope for this epic, permanently: both need a registered business
 * identity Alphire does not have. The registry refuses to register them, so a
 * future slice that adds one in good faith fails a test instead of shipping a
 * card that can never work.
 */
const FORBIDDEN_PROVIDERS = Object.freeze(['youtube', 'linkedin']);

/**
 * The admin app's real, permanent home.
 *
 * Every provider rejects a redirect_uri it was not registered with, and
 * lib/appOrigin.js falls back to VERCEL_URL — which is a DIFFERENT hostname on
 * every single preview deployment. Building the OAuth callback from the request
 * would therefore work in production and fail on every preview with a provider
 * error that names nothing useful. So the callback origin is pinned here and
 * `oauthCallbackOrigin()` below will not read VERCEL_URL at all.
 *
 * (The user-facing return URL — where the admin app sends the browser AFTER the
 * callback — is still built from the request, in routes/engage.js. That one is
 * not registered with anybody, and pinning it would bounce a local sign-in to
 * production.)
 */
const PRODUCTION_ORIGIN = 'https://starcaster.pro';

function safeText(value) {
  return String(value === 0 || value ? value : '').trim();
}

function trimTrailingSlashes(url) {
  return safeText(url).replace(/\/+$/, '');
}

/** A success envelope. `data` is always present, even when it is empty. */
function ok(status, data) {
  return { ok: true, status: Number(status) || 200, data: data === undefined ? null : data };
}

/**
 * A failure envelope. `data` is present and null rather than absent, so a
 * caller can read `res.data` without checking `res.ok` first and get null
 * instead of a TypeError.
 */
function fail(status, error, extra = null) {
  const base = {
    ok: false,
    status: Number(status) || 500,
    error: safeText(error) || 'Request failed',
    data: null,
  };
  return extra && typeof extra === 'object' ? { ...base, ...extra, ok: false } : base;
}

/**
 * Coerce anything envelope-ish into the envelope.
 *
 * The libraries the adapters wrap (lib/metaOAuth.js, lib/blueskyClient.js) each
 * return their own near-miss of this shape — `{ ok, status, error }` with no
 * `data`, or `{ ok, endpoint, status, data }`. Normalising at the adapter
 * boundary is the entire reason a caller can loop over providers it has never
 * heard of.
 */
function normalize(result, fallbackStatus = 500) {
  if (!result || typeof result !== 'object') {
    return fail(fallbackStatus, 'Adapter returned no result');
  }
  if (result.ok === true) return ok(result.status || 200, result.data === undefined ? null : result.data);
  return fail(
    result.status || fallbackStatus,
    result.error || result.message || 'Request failed',
    result.data === undefined || result.data === null ? null : { data: result.data }
  );
}

/**
 * Why `value` is not an envelope, or null if it is.
 *
 * A sentence rather than a boolean because this is what the conformance test
 * prints when a future adapter fails it, and "expected true, got false" would
 * send the next agent reading this file instead of fixing their adapter.
 */
function envelopeProblem(value) {
  if (!value || typeof value !== 'object') return `expected an object, got ${typeof value}`;
  if (typeof value.ok !== 'boolean') return '`ok` must be a boolean';
  if (!Number.isFinite(value.status)) return '`status` must be a number';
  if (!('data' in value)) return '`data` must be present (null is fine)';
  if (value.ok === false && !safeText(value.error)) {
    return 'a failed envelope must carry a non-empty `error` a screen can show';
  }
  return null;
}

function isEnvelope(value) {
  return envelopeProblem(value) === null;
}

/**
 * A step this platform genuinely does not have.
 *
 * Bluesky has no browser sign-in; a Facebook Page token has nothing to refresh.
 * Both are facts about the platform, not failures, and both must still answer
 * in the envelope so a generic caller does not special-case anybody.
 */
function notSupported(provider, fnName, why) {
  return fail(400, `${provider} does not support ${fnName}: ${safeText(why) || 'not applicable to this platform'}`, {
    code: 'NOT_SUPPORTED',
  });
}

/**
 * Everything wrong with an adapter, as sentences. Empty array means it conforms.
 * Exported so the conformance test can be shown to FAIL — it is handed a
 * deliberately broken adapter and must object.
 */
function adapterProblems(adapter, label = 'adapter') {
  const problems = [];
  if (!adapter || typeof adapter !== 'object') {
    // `typeof null` is 'object', so the type name alone would report the most
    // common mistake here — a registered platform with nothing behind it — as
    // "expected an object, got object".
    const got = adapter === null ? 'null' : typeof adapter;
    return [`${label}: expected an adapter object, got ${got}`];
  }
  for (const fnName of ADAPTER_FUNCTIONS) {
    if (typeof adapter[fnName] !== 'function') {
      problems.push(`${label}: missing \`${fnName}\` — every adapter exports all of ${ADAPTER_FUNCTIONS.join(', ')}`);
    }
  }
  const provider = safeText(adapter.provider);
  if (!provider) problems.push(`${label}: missing \`provider\` (the key it is registered under)`);
  if (!AUTH_KINDS.includes(adapter.authKind)) {
    problems.push(`${label}: \`authKind\` must be one of ${AUTH_KINDS.join(', ')}`);
  }
  return problems;
}

/**
 * The origin every OAuth callback is built from. Never VERCEL_URL — see
 * PRODUCTION_ORIGIN above for what that costs.
 *
 * Returns which source answered, because "the redirect is wrong" and "the
 * redirect is right but points at another deployment" look identical in a
 * provider's error message.
 */
function oauthCallbackOrigin() {
  const pinned = trimTrailingSlashes(process.env.CONNECTIONS_OAUTH_ORIGIN);
  if (pinned) return { origin: pinned, source: 'CONNECTIONS_OAUTH_ORIGIN' };

  const configured = trimTrailingSlashes(
    process.env.PUBLIC_APP_ORIGIN
    || process.env.APP_PUBLIC_ORIGIN
    || process.env.PUBLIC_BASE_URL
  );
  if (configured) return { origin: configured, source: 'PUBLIC_APP_ORIGIN' };

  return { origin: PRODUCTION_ORIGIN, source: 'pinned' };
}

/** The full callback URL for a provider's redirect flow, from the pinned origin. */
function oauthCallbackUrl(path) {
  const suffix = safeText(path).startsWith('/') ? safeText(path) : `/${safeText(path)}`;
  return `${oauthCallbackOrigin().origin}${suffix}`;
}

module.exports = {
  ADAPTER_FUNCTIONS,
  READINESS_FLAGS,
  AUTH_KINDS,
  FORBIDDEN_PROVIDERS,
  PRODUCTION_ORIGIN,
  ok,
  fail,
  normalize,
  isEnvelope,
  envelopeProblem,
  notSupported,
  adapterProblems,
  oauthCallbackOrigin,
  oauthCallbackUrl,
};
