'use strict';

const crypto = require('crypto');

/**
 * Which platform's sign-in this is. Connections 5 of 7 (86bbpz1gk).
 *
 * Meta accepts a redirect_uri only if it is registered with the app, and one is
 * — the Facebook callback. Instagram is not a second sign-in but the SAME Meta
 * grant asked for different scopes, so it comes back through that same URL, and
 * the callback then has no way to tell the two apart. The state is the only
 * thing that survives the round trip and is signed, so it is where the answer
 * belongs; putting it in a query parameter would let a caller redirect the
 * callback at whichever provider it liked.
 */
const DEFAULT_PROVIDER = 'facebook_page';

function safeText(value) {
  return String(value || '').trim();
}

function signingSecret() {
  return safeText(
    process.env.META_OAUTH_STATE_SECRET
    || process.env.FACEBOOK_APP_SECRET
    || process.env.META_APP_SECRET
    || process.env.CHANNELS_ENCRYPTION_KEY
  ) || 'starcaster-meta-oauth-dev';
}

/**
 * The same secret, for a caller that needs to derive something else from the
 * state rather than merely trust it. Connections 7 of 7 (86bbpz1hu).
 *
 * X's sign-in uses PKCE, which means a random verifier created when the browser
 * leaves and needed again when it comes back — and on Vercel those are two
 * different lambda invocations with no memory between them. The X adapter
 * therefore DERIVES its verifier from the state's nonce instead of storing one
 * (lib/connections/adapters/x.js), which works only if it can reach the same
 * secret this file signs with. Exported rather than copied, because a second
 * fallback chain that drifts by one variable would produce a verifier the
 * callback could not reproduce — and the only symptom would be every X
 * connection failing at the token exchange with an error naming none of this.
 */
function stateSigningSecret() {
  return signingSecret();
}

function signOAuthState(payload) {
  const json = JSON.stringify(payload || {});
  const b64 = Buffer.from(json, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', signingSecret()).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

function verifyOAuthState(stateInput) {
  const state = safeText(stateInput);
  const parts = state.split('.');
  if (parts.length !== 2) return { ok: false, error: 'Invalid OAuth state' };

  const [b64, sig] = parts;
  const expected = crypto.createHmac('sha256', signingSecret()).update(b64).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return { ok: false, error: 'Invalid OAuth state signature' };
    }
  } catch {
    return { ok: false, error: 'Invalid OAuth state signature' };
  }

  let payload = null;
  try {
    payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, error: 'Invalid OAuth state payload' };
  }

  const exp = Number(payload?.exp || 0);
  if (!Number.isFinite(exp) || Date.now() > exp) {
    return { ok: false, error: 'OAuth state expired' };
  }

  const projectId = safeText(payload?.projectId);
  const userId = safeText(payload?.userId);
  if (!projectId || !userId) {
    return { ok: false, error: 'OAuth state missing project or user' };
  }

  // A state written before Instagram existed carries no provider, and there is
  // exactly one thing it can have been: the Facebook Page flow, which was the
  // only thing that ever built one. Defaulting rather than refusing matters for
  // real people — a state is live for fifteen minutes, so a client part-way
  // through connecting when the deploy lands would otherwise come back to
  // "invalid OAuth state" for no reason they could act on.
  const provider = safeText(payload?.provider) || DEFAULT_PROVIDER;

  // The nonce comes back out because PKCE derives from it — see
  // `stateSigningSecret` above. It is covered by the signature like everything
  // else here, so a tampered nonce fails before this line.
  return { ok: true, data: { projectId, userId, provider, exp, nonce: safeText(payload?.n) } };
}

/**
 * `nonce` is optional and exists for PKCE. A caller that needs to derive
 * something from the state — X does — supplies the nonce it derived from, so
 * the two cannot disagree; everyone else gets a fresh random one and never
 * thinks about it. It is 16 bytes when we choose it rather than the 8 it used
 * to be, because it is now an input to a key derivation and not only a salt.
 */
function buildOAuthState({ projectId, userId, provider = DEFAULT_PROVIDER, ttlMs = 15 * 60 * 1000, nonce } = {}) {
  const pid = safeText(projectId);
  const uid = safeText(userId);
  if (!pid || !uid) return { ok: false, error: 'projectId and userId are required' };
  return {
    ok: true,
    data: signOAuthState({
      projectId: pid,
      userId: uid,
      provider: safeText(provider) || DEFAULT_PROVIDER,
      exp: Date.now() + Math.max(60_000, Number(ttlMs) || 0),
      n: safeText(nonce) || crypto.randomBytes(16).toString('hex'),
    }),
  };
}

module.exports = {
  DEFAULT_PROVIDER,
  stateSigningSecret,
  signOAuthState,
  verifyOAuthState,
  buildOAuthState,
};
