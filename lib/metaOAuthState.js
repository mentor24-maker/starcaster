'use strict';

const crypto = require('crypto');

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

  return { ok: true, data: { projectId, userId, exp } };
}

function buildOAuthState({ projectId, userId, ttlMs = 15 * 60 * 1000 } = {}) {
  const pid = safeText(projectId);
  const uid = safeText(userId);
  if (!pid || !uid) return { ok: false, error: 'projectId and userId are required' };
  return {
    ok: true,
    data: signOAuthState({
      projectId: pid,
      userId: uid,
      exp: Date.now() + Math.max(60_000, Number(ttlMs) || 0),
      n: crypto.randomBytes(8).toString('hex'),
    }),
  };
}

module.exports = {
  signOAuthState,
  verifyOAuthState,
  buildOAuthState,
};
