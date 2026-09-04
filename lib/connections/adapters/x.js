'use strict';

/**
 * X, behind the contract. Connections 7 of 7 (86bbpz1hu).
 *
 * ── This is not a port ─────────────────────────────────────────────────────
 *
 * Instagram (slice 5) was the same Meta grant read from another angle, so it
 * imported nearly all its plumbing. X shares nothing with what is already here.
 * `lib/xClient.js` signs with OAuth 1.0a — an app-wide token pair belonging to
 * ONE account, Dane's — and that scheme has no concept of signing in as
 * somebody else. There is no per-user path to reach from it. So this file adds
 * the second, parallel scheme X offers: OAuth 2.0 Authorization Code with PKCE,
 * which issues a bearer token per user.
 *
 * Both live side by side, permanently and on purpose. Dane's own posting keeps
 * running on OAuth 1.0a from the environment; a client's connection posts with
 * an OAuth 2.0 bearer token. `lib/connections/resolveCredentials.js` decides
 * which, and marks the answer `auth_mode` so `xClient` can never guess.
 *
 * ── Why the two schemes must never be MIXED ────────────────────────────────
 *
 * This is the sharp edge of the slice, and it is worth stating plainly because
 * the failure is silent. An OAuth 1.0a signature is built from four values:
 * the app's key and secret, and the account's token and token secret. A stored
 * connection carries one secret. Before this slice the resolver refused X
 * outright rather than take a client's access token and complete the pair from
 * Alphire's environment — a signature belonging to nobody, which X answers with
 * a 401 naming neither account.
 *
 * OAuth 2.0 removes the problem rather than solving it: the credential is ONE
 * bearer token, so there is no second half to borrow. The refusal is therefore
 * lifted for X — but the resolver also DELETES `access_token_secret` from the
 * values it hands back on the connection path, so the old scheme cannot be
 * assembled by accident out of a client's token and our leftover secret. See
 * `clearOnConnection` there.
 *
 * ── PKCE without anywhere to keep the verifier ─────────────────────────────
 *
 * PKCE means inventing a random `code_verifier`, sending only its SHA-256
 * (`code_challenge`) to X, and producing the verifier again at the token
 * exchange. The two moments are a browser round trip apart, and on Vercel they
 * are two different lambda invocations — no shared memory, and
 * `project_connections` has no column to park one in.
 *
 * So the verifier is DERIVED rather than stored:
 *
 *     verifier = HMAC-SHA256(state signing secret, "x-pkce-verifier:v1:" + nonce)
 *
 * The nonce is the random value the signed OAuth state already carries, and the
 * state's own HMAC is what makes it tamper-proof. That gives every property the
 * acceptance criteria ask for, and one more:
 *
 *   per attempt   the nonce is 16 fresh random bytes each time
 *   never reused  a nonce is used once, and the state expires in 15 minutes
 *   never logged  the verifier is never serialised, never stored, and never
 *                 leaves this process — only its SHA-256 goes to X
 *
 * The alternative — encrypting the verifier INTO the state — would have put it,
 * in ciphertext, in a URL that travels through the client's browser and X's
 * servers. Deriving it means the secret half never travels at all.
 */

const crypto = require('crypto');
const { getProviderValues } = require('../../apiSettings');
const { buildOAuthState, stateSigningSecret } = require('../../metaOAuthState');
const contract = require('../contract');

const PROVIDER = 'x';

/** Where the browser is sent to approve, and where the tokens are minted. */
const AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const REVOKE_URL = 'https://api.x.com/2/oauth2/revoke';
const ME_URL = 'https://api.x.com/2/users/me';

/**
 * Registered with X, and it must match byte for byte or X refuses the whole
 * sign-in before the client sees anything of ours. It hangs off the PINNED
 * origin (contract.oauthCallbackOrigin) rather than the request, because
 * VERCEL_URL is a different hostname on every preview deployment.
 */
const CALLBACK_PATH = '/api/promote/social/x/oauth/callback';

/**
 * What we ask the client to grant.
 *
 * `offline.access` is the load-bearing one and the reason it is not optional:
 * without it X issues NO refresh token, and an X access token lasts about two
 * hours. A connection made without it works beautifully for one afternoon and
 * is then dead with nothing able to renew it — which is the failure slice 6's
 * whole refresh path exists to prevent, arriving through the scope list.
 *
 * `media.write` is what lets the existing image upload run on a user token
 * rather than on Dane's app-wide OAuth 1.0a pair. `users.read` is what makes
 * the handle readable, which is the only name a client sees on the card.
 */
const DEFAULT_SCOPES = [
  'tweet.read',
  'tweet.write',
  'users.read',
  'media.write',
  'offline.access',
];

/**
 * How long before a stored expiry the sweep should act. Not used here — slice 6
 * owns it — but recorded because X is the platform that makes it matter: two
 * hours is shorter than the gap between many publish jobs.
 */
const TYPICAL_TOKEN_LIFETIME_SECONDS = 7200;

function safeText(value) {
  return String(value === 0 || value ? value : '').trim();
}

function callbackUrl() {
  return contract.oauthCallbackUrl(CALLBACK_PATH);
}

/** A handle a client recognises. X's own API returns it without the `@`. */
function handle(username) {
  const name = safeText(username).replace(/^@+/, '');
  return name ? `@${name}` : '';
}

/**
 * The X app's OAuth 2.0 identity — DIFFERENT values from the OAuth 1.0a
 * API Key/Secret in the same settings block, and confusing the two is the most
 * likely way to spend an afternoon here. The 1.0a pair signs requests; these two
 * identify the app at the token endpoint. X's developer portal issues them on
 * separate screens and they are not interchangeable.
 */
function getXAppCredentials() {
  const saved = getProviderValues(PROVIDER) || {};
  return {
    clientId: safeText(saved.client_id),
    clientSecret: safeText(saved.client_secret),
  };
}

function isXAppConfigured(creds = getXAppCredentials()) {
  return Boolean(creds.clientId && creds.clientSecret);
}

/**
 * The sentence an operator can act on when the app is not set up. Named as its
 * own function because both `authorizeUrl` and `exchange` need it and a second
 * wording would send whoever hit it to a different screen.
 */
function appNotConfigured() {
  return contract.fail(
    400,
    'X is not set up for per-client sign-in yet. It needs an OAuth 2.0 Client ID and Client Secret '
    + '(Settings > APIs > X, or X_CLIENT_ID / X_CLIENT_SECRET). These are NOT the API Key and API '
    + 'Secret already saved there — those are the older OAuth 1.0a pair used for Starcaster\'s own '
    + 'posting. Create them at developer.x.com under your app > User authentication settings, with '
    + 'Type set to Web App and the callback URL set to ' + callbackUrl() + '.',
    { code: 'APP_NOT_CONFIGURED' }
  );
}

// ---------------------------------------------------------------------------
// PKCE
//
// Pure functions, exported so a test can assert the derivation round-trips
// rather than assert that the flow "looks right". The whole scheme rests on
// `pkceVerifier(n)` producing the same string in the callback that it produced
// when the browser left; nothing else in the flow can check that for us.
// ---------------------------------------------------------------------------

/**
 * The verifier for one sign-in attempt, derived from that attempt's nonce.
 *
 * Deterministic given (nonce, secret) — that is the point, and it is also the
 * limit: anything that can read the state signing secret can reproduce a
 * verifier. That is the same secret that authenticates the state itself, so it
 * is not a new exposure; it is the reason this is safe to do at all.
 *
 * 43 characters of base64url, which is inside RFC 7636's 43–128 range.
 */
function pkceVerifier(nonce) {
  const n = safeText(nonce);
  if (!n) return '';
  return crypto
    .createHmac('sha256', stateSigningSecret())
    .update(`x-pkce-verifier:v1:${n}`)
    .digest('base64url');
}

/** What X is shown: the SHA-256 of the verifier, base64url, no padding. */
function pkceChallenge(verifier) {
  const v = safeText(verifier);
  if (!v) return '';
  return crypto.createHash('sha256').update(v).digest('base64url');
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/**
 * One JSON request, in the envelope, with X's own words kept.
 *
 * X reports OAuth failures in two different shapes depending on which endpoint
 * refused — `{ error, error_description }` from the token endpoint,
 * `{ title, detail }` or an `errors` array from the v2 API — so the message is
 * assembled from whichever arrived rather than from the one the happy path
 * happened to hit.
 */
async function fetchJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (err) {
    return contract.fail(502, `X could not be reached: ${safeText(err?.message) || err}`);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    return contract.fail(response.status || 502, describeXError(payload, response), {
      data: payload,
    });
  }
  return contract.ok(response.status || 200, payload);
}

/** X's own words for a failure, whichever of its three shapes arrived. */
function describeXError(payload, response) {
  if (Array.isArray(payload?.errors) && payload.errors.length) {
    return payload.errors
      .map((e) => safeText(e?.message) || safeText(e?.detail) || JSON.stringify(e))
      .filter(Boolean)
      .join(' | ');
  }
  const oauth = [safeText(payload?.error), safeText(payload?.error_description)].filter(Boolean).join(': ');
  return oauth
    || safeText(payload?.detail)
    || safeText(payload?.title)
    || safeText(response?.statusText)
    || 'Unknown X API error';
}

/**
 * The token endpoint, called the one way X accepts for a confidential client:
 * the client id and secret as HTTP Basic, the grant as a form body.
 *
 * Sending the client secret in the BODY instead — which several tutorials show,
 * because it is what public clients do — is answered by X with an
 * `unauthorized_client` that names nothing about where the credential should
 * have gone.
 *
 * The client ID goes in BOTH places, which is not a contradiction: X's own
 * published examples for `POST /2/oauth2/token` carry `client_id` as a form
 * field alongside the Basic header, on the authorization_code and refresh_token
 * grants alike. The SECRET stays in the header only. Raised by review round 3
 * of 86bbpz1hu and settled the cheap way: it is required or it is ignored, and
 * adding it costs nothing either way, where omitting it — if X does require it
 * — fails every client sign-in at the exchange and every refresh two hours
 * later. It is UNMEASURED against the live endpoint: every X call in the suite
 * is canned, so no test here can decide it.
 */
async function tokenRequest(form) {
  const creds = getXAppCredentials();
  if (!isXAppConfigured(creds)) return appNotConfigured();

  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`, 'utf8').toString('base64');
  return fetchJson(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ client_id: creds.clientId, ...form }).toString(),
  });
}

/** Who this bearer token belongs to, as X reports it right now. */
async function fetchMe(accessToken) {
  const token = safeText(accessToken);
  if (!token) return contract.fail(400, 'An X access token is required');
  const params = new URLSearchParams({ 'user.fields': 'username,name,profile_image_url' });
  return fetchJson(`${ME_URL}?${params.toString()}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
}

/**
 * When a token X just issued will expire, as an ISO string.
 *
 * X answers with `expires_in` in seconds. Storing an absolute instant rather
 * than a duration is what lets `refreshDue` compare it against the clock later
 * without knowing when it was issued. A missing `expires_in` falls back to X's
 * documented two hours rather than to "never": a token recorded as
 * non-expiring is one nothing will ever renew, and it will simply stop working
 * mid-afternoon.
 */
function expiryFrom(payload, nowMs = Date.now()) {
  const seconds = Number(payload?.expires_in);
  const lifetime = Number.isFinite(seconds) && seconds > 0 ? seconds : TYPICAL_TOKEN_LIFETIME_SECONDS;
  return new Date(nowMs + lifetime * 1000).toISOString();
}

/**
 * One X account, in the contract's vocabulary.
 *
 * `expiresAt` is set on the ACCOUNT, not only inside `raw`. `raw` is dropped on
 * the way into the vault (`contract.storableAccount`), so the copy that used to
 * live there alone reached the store and stopped — `expires_at` was NULL on
 * every X row, and `verifySweep.refreshDue` reads a missing expiry as "nothing
 * to renew". The connection then worked for one afternoon and was dead, with
 * the card still green (86bbpz1hu, review round 1). The account field is the
 * one that survives the trip; `raw` keeps its copy as the provider's own row.
 */
function toAccount(user, tokens, nowMs = Date.now()) {
  const id = safeText(user?.id);
  const expiresAt = expiryFrom(tokens, nowMs);
  return contract.account({
    accountId: id,
    accountLabel: handle(user?.username) || safeText(user?.name) || id,
    accountAvatarUrl: safeText(user?.profile_image_url),
    accessToken: safeText(tokens?.access_token),
    refreshToken: safeText(tokens?.refresh_token),
    expiresAt,
    raw: {
      user_id: id,
      username: safeText(user?.username),
      name: safeText(user?.name),
      scope: safeText(tokens?.scope),
      expires_at: expiresAt,
    },
  });
}

// ---------------------------------------------------------------------------
// The six.
// ---------------------------------------------------------------------------

/**
 * Where to send the browser.
 *
 * The nonce is generated HERE and handed to `buildOAuthState`, rather than
 * letting the state module invent its own, because the challenge sent to X has
 * to be derived from the very nonce the returning state will carry. Two
 * independently-generated nonces would produce a challenge and a verifier that
 * do not match, and X's refusal at the token exchange (`invalid_grant`) names
 * none of that.
 */
function authorizeUrl({ projectId, userId } = {}) {
  const creds = getXAppCredentials();
  if (!isXAppConfigured(creds)) return appNotConfigured();

  const nonce = crypto.randomBytes(16).toString('hex');
  const stateRes = buildOAuthState({ projectId, userId, provider: PROVIDER, nonce });
  if (!stateRes.ok) return contract.normalize(stateRes, 400);

  const challenge = pkceChallenge(pkceVerifier(nonce));
  if (!challenge) {
    return contract.fail(500, 'Could not build the PKCE challenge for this X sign-in');
  }

  const redirectUri = callbackUrl();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    scope: DEFAULT_SCOPES.join(' '),
    state: stateRes.data,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  return contract.ok(200, {
    url: `${AUTHORIZE_URL}?${params.toString()}`,
    redirectUri,
    scopes: DEFAULT_SCOPES.join(' '),
  });
}

/**
 * The code X handed back, turned into one account with a live token.
 *
 * `state` is REQUIRED here and that is unusual — the other adapters take only a
 * code. It is not being re-verified for authenticity (the callback has already
 * done that, and refuses before reaching this); it is the carrier of the nonce
 * the verifier is derived from. Taking the nonce directly instead would let a
 * caller supply one, which is the same as letting it choose the verifier.
 *
 * One account, always: an X grant covers exactly the account that approved it.
 * It is still returned as a one-element list because `storeAccounts` and the
 * sweep both work in lists, and a platform-shaped exception here would be a
 * special case in every caller.
 */
async function exchange({ code, redirectUri, state, nonce, nowMs } = {}) {
  const trimmedCode = safeText(code);
  if (!trimmedCode) return contract.fail(400, 'An OAuth code is required to finish connecting X');

  // The callback passes the nonce it has already verified; `state` is accepted
  // as well so this can be driven from a test or a hand-run script without
  // reaching into the state module. Neither is trusted for anything but the
  // nonce — the projectId and userId a connection is stored under come from the
  // callback's own verified state, never from here.
  let attemptNonce = safeText(nonce);
  if (!attemptNonce && safeText(state)) {
    const { verifyOAuthState } = require('../../metaOAuthState');
    const verified = verifyOAuthState(safeText(state));
    if (!verified.ok) return contract.fail(400, verified.error || 'Invalid OAuth state');
    attemptNonce = safeText(verified.data?.nonce);
  }
  if (!attemptNonce) {
    return contract.fail(
      400,
      'This X sign-in cannot be completed: the signed state it started with is missing, so the '
      + 'PKCE verifier it was begun with cannot be reproduced. Start connecting X again.'
    );
  }

  const verifier = pkceVerifier(attemptNonce);
  const tokenRes = await tokenRequest({
    grant_type: 'authorization_code',
    code: trimmedCode,
    redirect_uri: safeText(redirectUri) || callbackUrl(),
    code_verifier: verifier,
  });
  if (!tokenRes.ok) return tokenRes;

  const tokens = tokenRes.data || {};
  const accessToken = safeText(tokens.access_token);
  if (!accessToken) {
    return contract.fail(502, 'X accepted the sign-in but returned no access token');
  }

  /**
   * A grant with no refresh token is REFUSED, not stored.
   *
   * It happens when `offline.access` was not among the granted scopes — X
   * silently drops a scope it will not issue rather than failing the
   * authorisation. Storing it would produce a card that reads connected, posts
   * perfectly for about two hours, and then fails forever with nothing able to
   * renew it. Refusing here costs the client one more click; accepting it costs
   * them a silent outage that looks like Starcaster losing their account.
   */
  const refreshToken = safeText(tokens.refresh_token);
  if (!refreshToken) {
    return contract.fail(
      400,
      'X did not grant permission to keep this connection alive, so it was not saved. An X access '
      + 'token expires after about two hours, and without that permission there is nothing that '
      + 'could renew it. Connect X again and leave every permission ticked on the approval screen.',
      { code: 'NO_REFRESH_TOKEN' }
    );
  }

  const meRes = await fetchMe(accessToken);
  if (!meRes.ok) return meRes;
  const user = meRes.data?.data || null;
  if (!safeText(user?.id)) {
    return contract.fail(502, 'X accepted the sign-in but would not say which account it belongs to');
  }

  const at = Number.isFinite(nowMs) ? nowMs : Date.now();
  return contract.ok(200, {
    accounts: [toAccount(user, tokens, at)],
    expiresAt: expiryFrom(tokens, at),
    scope: safeText(tokens.scope),
  });
}

/**
 * Which accounts this grant covers — exactly one, and that is a fact about X
 * rather than a limitation here. Unlike a Meta grant, which can cover several
 * Pages, an X authorisation is one account approving one app.
 *
 * It asks X rather than echoing what it was given, because the point of this
 * function for the sweep is to find out whether the token has started
 * authenticating as somebody ELSE.
 */
async function listAccounts(input = {}) {
  const ref = contract.accountRef(input);
  if (!ref.accessToken) return contract.fail(400, 'An X access token is required to list the account');
  const meRes = await fetchMe(ref.accessToken);
  if (!meRes.ok) return meRes;
  const user = meRes.data?.data || null;
  if (!safeText(user?.id)) return contract.fail(502, 'X would not say which account this token belongs to');
  return contract.ok(200, {
    accounts: [contract.account({
      accountId: safeText(user.id),
      accountLabel: handle(user.username) || safeText(user.name) || safeText(user.id),
      accountAvatarUrl: safeText(user.profile_image_url),
      accessToken: ref.accessToken,
      refreshToken: ref.refreshToken,
      // The token handed in is the token handed back, so its deadline is
      // unchanged. Recomputing one here would invent a fresh two hours for a
      // token that may be minutes from expiring.
      expiresAt: ref.expiresAt,
      raw: { user_id: safeText(user.id), username: safeText(user.username) },
    })],
  });
}

/**
 * Renew an aging grant. On X this is load-bearing, not a formality.
 *
 * Facebook and Instagram answer `refreshed: false` here because a Page token
 * does not expire. X's expires in about two hours, so this is what stands
 * between a client's connection and a silent outage — which is why it refuses
 * loudly when it has nothing to refresh WITH, rather than reporting the
 * platform-has-nothing-to-do answer the other two give.
 *
 * X rotates the refresh token: the response carries a NEW one and the old one
 * stops working. Returning it is not optional — `verifySweep.refreshBeforeUse`
 * stores whatever comes back here, and returning only the access token would
 * leave the old refresh token in place, which renews exactly once more and then
 * never again.
 */
async function refresh(input = {}) {
  const ref = contract.accountRef(input);
  if (!ref.refreshToken) {
    return contract.fail(
      400,
      'This X connection has no refresh token stored, so it cannot be renewed. An X access token '
      + 'lasts about two hours; this connection has to be made again, and the approval screen needs '
      + 'every permission left ticked so X issues one.',
      { code: 'NO_REFRESH_TOKEN' }
    );
  }

  const tokenRes = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: ref.refreshToken,
  });
  if (!tokenRes.ok) return tokenRes;

  const tokens = tokenRes.data || {};
  const accessToken = safeText(tokens.access_token);
  if (!accessToken) return contract.fail(502, 'X reported a successful renewal but returned no access token');

  const at = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  return contract.ok(200, {
    refreshed: true,
    accessToken,
    // X rotates this. Falling back to the one we already held is correct only
    // if X genuinely did not send a new one — which its documentation says it
    // always does, so the fallback is a belt rather than the design.
    refreshToken: safeText(tokens.refresh_token) || ref.refreshToken,
    expiresAt: expiryFrom(tokens, at),
    scope: safeText(tokens.scope),
  });
}

/**
 * Does this grant still work RIGHT NOW.
 *
 * The account id is compared rather than merely "did the call succeed", because
 * a token that has started answering as a different account is a live token
 * that would post to the wrong place — the exact failure that looks like
 * success. `verifySweep` does its own comparison too; this returns what it
 * needs to make it.
 */
async function verify(input = {}) {
  const ref = contract.accountRef(input);
  if (!ref.accessToken) return contract.fail(400, 'X verify needs the account\'s access token');
  const meRes = await fetchMe(ref.accessToken);
  if (!meRes.ok) return meRes;
  const user = meRes.data?.data || null;
  const id = safeText(user?.id);
  if (!id) return contract.fail(502, 'X would not say which account this token belongs to');
  return contract.ok(meRes.status || 200, {
    valid: true,
    accountId: id,
    accountLabel: handle(user.username) || safeText(user.name) || id,
  });
}

/**
 * Hand the permission back at X's end, then let the caller forget the row.
 *
 * Best effort and it says which it managed, the same shape the Meta adapters
 * use and for the same reason: X answering "this token is already dead" IS a
 * successful revoke from where the client is standing, and deleting the stored
 * row is the caller's job either way. What it must never do is report a revoke
 * it did not get — a client told their permission was withdrawn when it was not
 * has been told the one thing they cannot check for themselves.
 */
async function revoke(input = {}) {
  const ref = contract.accountRef(input);
  if (!ref.accessToken) return contract.fail(400, 'X revoke needs the account\'s access token');

  const creds = getXAppCredentials();
  if (!isXAppConfigured(creds)) {
    return contract.ok(200, {
      revokedAtProvider: false,
      reason: 'Starcaster has forgotten this connection, but its own X app credentials are not '
        + 'configured here, so the permission could not be withdrawn at X. Remove Starcaster under '
        + 'x.com > Settings > Security and account access > Apps and sessions > Connected apps.',
    });
  }

  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`, 'utf8').toString('base64');
  const res = await fetchJson(REVOKE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    // The REFRESH token is revoked when there is one: revoking the access token
    // alone leaves the refresh token able to mint a new one, which is a
    // permission the client believes they withdrew still being usable.
    // `client_id` in the body as well as the Basic header — X's published
    // example for `POST /2/oauth2/revoke` carries it. Same reasoning as
    // `tokenRequest` above, and equally unmeasured against the live endpoint.
    body: new URLSearchParams(
      ref.refreshToken
        ? { client_id: creds.clientId, token: ref.refreshToken, token_type_hint: 'refresh_token' }
        : { client_id: creds.clientId, token: ref.accessToken, token_type_hint: 'access_token' }
    ).toString(),
  });

  if (!res.ok) {
    return contract.ok(200, {
      revokedAtProvider: false,
      reason: `X did not confirm the revoke (${res.error}). Remove the stored connection anyway, and `
        + 'the client can also remove Starcaster under x.com > Settings > Security and account '
        + 'access > Apps and sessions > Connected apps.',
    });
  }

  return contract.ok(200, {
    revokedAtProvider: true,
    revoked: res.data?.revoked !== false,
  });
}

module.exports = {
  provider: PROVIDER,
  authKind: 'redirect',
  DEFAULT_SCOPES,
  TYPICAL_TOKEN_LIFETIME_SECONDS,
  callbackPath: CALLBACK_PATH,
  callbackUrl,
  getXAppCredentials,
  isXAppConfigured,
  pkceVerifier,
  pkceChallenge,
  expiryFrom,
  authorizeUrl,
  exchange,
  listAccounts,
  refresh,
  verify,
  revoke,
};
