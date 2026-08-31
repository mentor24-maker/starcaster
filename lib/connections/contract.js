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
 *   listAccounts(account)                   which accounts this grant covers
 *   refresh(account)                        make an aging grant good again
 *   verify(account)                         does this grant still work RIGHT NOW
 *   revoke(account)                         hand the permission back
 *
 * `account` there is literally an account `exchange` handed back — see
 * ACCOUNT_FIELDS below. The last four take the output of the first two, unedited,
 * which is what lets a caller sweep every connection it has stored without
 * knowing whose it is. Read it with `accountRef`, emit it with `account`.
 */
const ADAPTER_FUNCTIONS = Object.freeze([
  'authorizeUrl', 'exchange', 'listAccounts', 'refresh', 'verify', 'revoke',
]);

/**
 * The one account shape — and, deliberately, the one VOCABULARY.
 *
 * `exchange` and `listAccounts` hand accounts back; `verify`, `refresh` and
 * `revoke` are then called with one. Those were two different vocabularies until
 * round 3 of this slice: the account came out as `{ id, label }` and the five
 * went in reading `{ accountId, accountLabel }`, so an adapter handed back its
 * OWN account refused it — Bluesky with "Bluesky needs a handle and an app
 * password", which reads as a broken connection rather than a mismatch, and
 * Facebook with a 400 on `verify` and `revoke`. Nothing caught it because
 * nothing anywhere fed an adapter's output into its own input.
 *
 * The names here are the ones lib/projectConnectionsStore.js (slice 1, live)
 * already accepts, so an account is storable as it stands rather than being
 * translated by every caller — and a translation each caller writes for itself
 * is how two vocabularies grow back.
 */
const ACCOUNT_FIELDS = Object.freeze([
  'accountId', 'accountLabel', 'accountAvatarUrl', 'accessToken', 'raw',
]);

/**
 * The names an account must NOT come back under. Emitting `id`/`label` is
 * exactly the split above, and it is silent — every function still returns an
 * envelope, just a refusing one. Named here so `accountProblems` can say which
 * word to use instead.
 */
const LEGACY_ACCOUNT_FIELDS = Object.freeze({
  id: 'accountId',
  label: 'accountLabel',
  avatarUrl: 'accountAvatarUrl',
});

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
 * Read an account reference out of whatever a caller handed over.
 *
 * The ONE place any adapter reads these names. Tolerant on the way in — an
 * older row, a hand-typed `{ identifier }`, a provider's own `id` — and strict
 * on the way out, because "tolerant everywhere" is how two vocabularies grew in
 * the first place: five functions each did their own `input.a || input.b` and
 * no two lists agreed.
 */
function accountRef(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    accountId: safeText(source.accountId ?? source.id),
    accountLabel: safeText(source.accountLabel ?? source.label),
    accountAvatarUrl: safeText(source.accountAvatarUrl ?? source.avatarUrl),
    accessToken: safeText(source.accessToken),
    raw: source.raw && typeof source.raw === 'object' ? source.raw : null,
  };
}

/**
 * One account, in the one vocabulary. Every adapter's `exchange` and
 * `listAccounts` build their accounts through here rather than writing the
 * object out by hand, so a new platform inherits the names instead of choosing
 * them.
 *
 * `raw` is the provider's own row, kept because routes/engage.js and
 * projectSocialCredentialsStore speak Meta's Page shape and must keep doing so.
 */
function account(input = {}) {
  const ref = accountRef(input);
  return {
    accountId: ref.accountId,
    accountLabel: ref.accountLabel,
    accountAvatarUrl: ref.accountAvatarUrl,
    accessToken: ref.accessToken,
    raw: ref.raw,
  };
}

/**
 * Everything wrong with an account an adapter produced, as sentences. Empty
 * array means it round-trips.
 *
 * The legacy-name check is the load-bearing one. `{ id, label }` is not merely
 * untidy — it is refused by the same adapter's own `verify`, in an envelope
 * that reads like a broken connection, and slice 6's health sweep would paint
 * every healthy account amber on the strength of it.
 */
function accountProblems(value, label = 'account') {
  if (!value || typeof value !== 'object') {
    return [`${label}: expected an account object, got ${value === null ? 'null' : typeof value}`];
  }
  const problems = [];
  for (const [legacy, canonical] of Object.entries(LEGACY_ACCOUNT_FIELDS)) {
    if (legacy in value) {
      problems.push(
        `${label}: carries \`${legacy}\` — an account is handed straight back to \`verify\`, `
        + `\`refresh\` and \`revoke\`, which read \`${canonical}\`. Use \`${canonical}\`.`
      );
    }
  }
  if (!safeText(value.accountId)) {
    problems.push(`${label}: missing \`accountId\` — it is half the key the connection is stored under`);
  }
  if (!safeText(value.accountLabel)) {
    problems.push(`${label}: missing \`accountLabel\` — it is the only name a client sees on the card`);
  }
  if (!safeText(value.accessToken)) {
    problems.push(`${label}: missing \`accessToken\` — the durable credential, not a short-lived session token`);
  }
  return problems;
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

  // Report the variable that ACTUALLY answered, not the first name on the list.
  // The whole point of `source` is that "the redirect is wrong" and "the redirect
  // is right but points at another deployment" look identical in a provider's
  // error message — so a name pointing at a variable nobody set sends the next
  // person to edit the wrong setting at exactly the moment they are stuck.
  for (const name of ['PUBLIC_APP_ORIGIN', 'APP_PUBLIC_ORIGIN', 'PUBLIC_BASE_URL']) {
    const configured = trimTrailingSlashes(process.env[name]);
    if (configured) return { origin: configured, source: name };
  }

  return { origin: PRODUCTION_ORIGIN, source: 'pinned' };
}

/** The full callback URL for a provider's redirect flow, from the pinned origin. */
function oauthCallbackUrl(path) {
  const suffix = safeText(path).startsWith('/') ? safeText(path) : `/${safeText(path)}`;
  return `${oauthCallbackOrigin().origin}${suffix}`;
}

module.exports = {
  ADAPTER_FUNCTIONS,
  ACCOUNT_FIELDS,
  LEGACY_ACCOUNT_FIELDS,
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
  account,
  accountRef,
  accountProblems,
  adapterProblems,
  oauthCallbackOrigin,
  oauthCallbackUrl,
};
