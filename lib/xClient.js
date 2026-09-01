'use strict';

const crypto = require('crypto');
const { environmentValues, resolveCredentials } = require('./connections/resolveCredentials');
const { CODES, describeCredentialFailure } = require('./credentialErrors');

const CREATE_POST_URL = 'https://api.x.com/2/tweets';
const MEDIA_UPLOAD_URL = 'https://upload.twitter.com/1.1/media/upload.json';
const V11_VERIFY_URL = 'https://api.twitter.com/1.1/account/verify_credentials.json';

function percentEncode(value) {
  return encodeURIComponent(String(value == null ? '' : value))
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function nonce() {
  return crypto.randomBytes(16).toString('hex');
}

function signingKey(consumerSecret, tokenSecret) {
  return `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
}

function baseString(method, url, params) {
  const sorted = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${percentEncode(k)}=${percentEncode(v)}`)
    .join('&');
  return [String(method || 'GET').toUpperCase(), percentEncode(url), percentEncode(sorted)].join('&');
}

function buildOAuthHeader(params) {
  const header = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
    .join(', ');
  return `OAuth ${header}`;
}

/**
 * The four values X signs with, out of whatever key/value bag it is handed.
 *
 * It reads BOTH spellings on purpose, and that is the whole of round 3's fix.
 * A provider bag arrives snake_case (`access_token`); an already-shaped
 * credential arrives camelCase (`accessToken`). routes/engage.js resolves ONCE
 * and then hands the shaped object back in for three separate calls, so this
 * function is routinely asked to shape its own output. Reading snake_case only
 * meant that second pass returned five empty strings, and every X post failed
 * with "credentials are missing" while the credentials were set and complete —
 * on the environment path, which is Dane's own posting (round 2 of 86bbpz1ed).
 *
 * So shaping is idempotent: `shape(shape(x))` equals `shape(x)`, for every
 * input. A test asserts that property directly rather than asserting the one
 * call site that happened to hit it, because the next caller to shape twice
 * will not know it was ever a hazard.
 */
function shapeXCredentials(cfg = {}, source = 'environment') {
  return {
    apiKey: String(cfg.api_key || cfg.apiKey || '').trim(),
    apiSecret: String(cfg.api_secret || cfg.apiSecret || '').trim(),
    accessToken: String(cfg.access_token || cfg.accessToken || '').trim(),
    accessTokenSecret: String(cfg.access_token_secret || cfg.accessTokenSecret || '').trim(),
    accountName: String(cfg.account_name || cfg.accountName || '').trim(),
    source,
  };
}

/**
 * The platform-wide keys — Starcaster's own X app and Dane's own account.
 *
 * Still synchronous, still exactly what it returned before Connections 3 of 7:
 * the Settings screens and credential probes that call it have no project and
 * do not want one. What changed is that it no longer reaches into lib/apiSettings
 * itself — every credential in this file now comes through
 * lib/connections/resolveCredentials.js, so there is one file to read to find
 * out where a token came from.
 */
function getXCredentials(options = {}) {
  return shapeXCredentials(environmentValues('x', { envOnly: options.envOnly === true }));
}

/**
 * This project's own X connection if it has a live one, otherwise the
 * platform-wide keys. Connections 3 of 7 (86bbpz1ed).
 *
 * Called without a `projectId` it is `getXCredentials` with an await in front
 * of it, which is what keeps every existing caller behaving exactly as it did.
 * It THROWS only via the resolver's refusal path — a lookup that could not
 * answer, which must not be quietly downgraded to "post as us".
 */
async function resolveXCredentials(options = {}) {
  const res = await resolveCredentials('x', options.projectId, {
    envOnly: options.envOnly === true,
    userId: options.userId,
  });
  if (!res.ok) return { ok: false, status: res.status, error: res.error, code: res.code };
  return { ok: true, status: 200, creds: shapeXCredentials(res.data.values, res.data.source), resolved: res.data };
}

/**
 * What the three async entry points below actually post with.
 *
 * `options.credentials` wins if a caller resolved once and is making several
 * calls with the same grant (routes/engage.js uploads media and then posts).
 * Otherwise a `projectId` means resolve, and no `projectId` means the
 * environment — the same object `getXCredentials` has always returned.
 *
 * The object that arrives on `options.credentials` is ALREADY SHAPED — the one
 * caller in the tree hands back exactly what `resolveXCredentials` gave it —
 * so this re-shapes a shaped object every time it fires. That is safe only
 * because `shapeXCredentials` is idempotent; see the note on it, and do not
 * narrow it back to one key spelling.
 */
async function credentialsFor(options = {}) {
  if (options.credentials && typeof options.credentials === 'object') {
    return { ok: true, creds: shapeXCredentials(options.credentials, options.credentials.source || 'caller') };
  }
  if (!String(options.projectId || '').trim() || options.envOnly === true) {
    return { ok: true, creds: getXCredentials({ envOnly: options.envOnly === true }) };
  }
  return resolveXCredentials(options);
}

function isConfigured(credsInput) {
  const creds = credsInput || getXCredentials();
  return Boolean(creds.apiKey && creds.apiSecret && creds.accessToken && creds.accessTokenSecret);
}

function buildMultipartMediaBody(mediaBuffer, mimeType) {
  const boundary = `----StarCasterMime${crypto.randomBytes(16).toString('hex')}`;
  const crlf = '\r\n';
  const disposition = `Content-Disposition: form-data; name="media"; filename="upload"${crlf}Content-Type: ${mimeType}${crlf}${crlf}`;
  const prelude = Buffer.from(`--${boundary}${crlf}${disposition}`, 'utf8');
  const closing = Buffer.from(`${crlf}--${boundary}--${crlf}`, 'utf8');
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    buffer: Buffer.concat([prelude, mediaBuffer, closing]),
  };
}

async function uploadMediaSimple(mediaBuffer, mimeTypeInput, options = {}) {
  const resolved = await credentialsFor(options);
  if (!resolved.ok) return resolved;
  const creds = resolved.creds;
  if (!creds.apiKey || !creds.apiSecret || !creds.accessToken || !creds.accessTokenSecret) {
    return { ok: false, status: 400, error: 'X credentials are missing. Save API Key, API Secret, Access Token, and Access Token Secret in Settings > APIs.' };
  }
  if (!Buffer.isBuffer(mediaBuffer) || !mediaBuffer.length) {
    return { ok: false, status: 400, error: 'Media body is empty' };
  }

  const mime = String(mimeTypeInput || 'application/octet-stream').split(';')[0].trim() || 'application/octet-stream';
  const { contentType, buffer } = buildMultipartMediaBody(mediaBuffer, mime);

  const oauth = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: nonce(),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  };

  const signature = crypto
    .createHmac('sha1', signingKey(creds.apiSecret, creds.accessTokenSecret))
    .update(baseString('POST', MEDIA_UPLOAD_URL, oauth))
    .digest('base64');

  const authHeader = buildOAuthHeader({ ...oauth, oauth_signature: signature });

  let response;
  try {
    response = await fetch(MEDIA_UPLOAD_URL, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': contentType,
        Accept: 'application/json',
      },
      body: buffer,
    });
  } catch (err) {
    return { ok: false, status: 502, error: `X media upload failed: ${err.message || err}` };
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const detail = formatXApiError(payload, response);
    return { ok: false, status: response.status, error: `X media API error: ${detail}`, data: payload };
  }

  const mediaId = String(payload?.media_id_string || payload?.media_id || '').trim();
  if (!mediaId) {
    return { ok: false, status: 502, error: 'X media upload returned no media id', data: payload };
  }

  return {
    ok: true,
    status: response.status,
    mediaId,
    data: payload,
  };
}

async function createPost(text, options = {}) {
  const resolved = await credentialsFor(options);
  if (!resolved.ok) return resolved;
  const creds = resolved.creds;
  if (!creds.apiKey || !creds.apiSecret || !creds.accessToken || !creds.accessTokenSecret) {
    return { ok: false, status: 400, error: 'X credentials are missing. Save API Key, API Secret, Access Token, and Access Token Secret in Settings > APIs.' };
  }

  const trimmedText = String(text || '').trim();
  if (!trimmedText) {
    return { ok: false, status: 400, error: 'Post text is required' };
  }

  const mediaIds = Array.isArray(options.mediaIds)
    ? options.mediaIds.map((id) => String(id || '').trim()).filter(Boolean).slice(0, 4)
    : [];

  const oauth = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: nonce(),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  };

  const signature = crypto
    .createHmac('sha1', signingKey(creds.apiSecret, creds.accessTokenSecret))
    .update(baseString('POST', CREATE_POST_URL, oauth))
    .digest('base64');

  const authHeader = buildOAuthHeader({ ...oauth, oauth_signature: signature });

  const tweetBody = { text: trimmedText };
  if (mediaIds.length) {
    tweetBody.media = { media_ids: mediaIds };
  }

  let response;
  try {
    response = await fetch(CREATE_POST_URL, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(tweetBody),
    });
  } catch (err) {
    return { ok: false, status: 502, error: `X request failed: ${err.message || err}` };
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const detail = Array.isArray(payload?.errors) && payload.errors.length
      ? payload.errors.map((e) => e?.message || e?.detail || JSON.stringify(e)).filter(Boolean).join(' | ')
      : (payload?.detail || payload?.title || response.statusText || 'Unknown X API error');
    return { ok: false, status: response.status, error: `X API error: ${detail}`, data: payload };
  }

  return {
    ok: true,
    status: response.status,
    data: {
      id: String(payload?.data?.id || ''),
      text: String(payload?.data?.text || trimmedText),
      raw: payload,
    },
  };
}

function formatXApiError(payload, response) {
  if (Array.isArray(payload?.errors) && payload.errors.length) {
    return payload.errors.map((e) => e?.message || e?.detail || JSON.stringify(e)).filter(Boolean).join(' | ');
  }
  return String(payload?.detail || payload?.title || response?.statusText || 'Unknown X API error').trim();
}

async function checkAuthOAuth1(creds, verifyUrl) {
  const oauth = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: nonce(),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  };

  const signature = crypto
    .createHmac('sha1', signingKey(creds.apiSecret, creds.accessTokenSecret))
    .update(baseString('GET', verifyUrl, oauth))
    .digest('base64');

  const authHeader = buildOAuthHeader({ ...oauth, oauth_signature: signature });
  const attempts = [];
  let response;
  try {
    response = await fetch(verifyUrl, {
      method: 'GET',
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
      },
    });
  } catch (err) {
    attempts.push({ endpoint: verifyUrl, mode: 'oauth1', ok: false, status: 502, message: err.message || String(err) });
    return { ok: false, status: 502, error: `X auth check failed: ${err.message || err}`, attempts };
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const detail = formatXApiError(payload, response);
  attempts.push({
    endpoint: verifyUrl,
    mode: 'oauth1',
    ok: response.ok,
    status: response.status,
    message: response.ok ? 'OK' : detail,
  });

  if (!response.ok) {
    return { ok: false, status: response.status, error: `X auth failed (OAuth 1.0a): ${detail}`, attempts };
  }

  return {
    ok: true,
    status: response.status,
    data: { user: payload?.data || null, attempts, authMode: 'oauth1' },
  };
}

/**
 * X's v2 API reports every authentication failure as the bare word
 * "Unauthorized", which is why this used to end in a guess. The older v1.1
 * endpoint still returns a numeric code that tells the causes apart, so on
 * failure we ask it once and translate. One extra request, only on a path that
 * has already failed.
 */
const X_ERROR_CAUSES = {
  32: {
    code: CODES.REJECTED,
    fix: 'The signature was rejected, which means the four values do not belong together: '
      + 'the API Key/Secret and the Access Token/Secret must come from the SAME X app. '
      + 'Also check for a trailing space or a truncated paste.',
  },
  89: {
    code: CODES.REJECTED,
    fix: 'The key pair is fine but the access token was invalidated. X does this when the '
      + 'account password changes, when app permissions are edited without regenerating the '
      + 'tokens afterward, when keys are regenerated, or when access is revoked. '
      + 'Regenerate the Access Token and Secret at developer.x.com > your app > Keys and tokens.',
  },
  64: {
    code: CODES.SUSPENDED,
    fix: 'The X developer app itself is suspended. Check developer.x.com for a notice — '
      + 'no credential change will help until that is resolved.',
  },
  99: {
    code: CODES.REJECTED,
    fix: 'X could not authenticate the app: the API Key is not valid for this app.',
  },
  326: {
    code: CODES.SUSPENDED,
    fix: 'The X account is temporarily locked. Log in at x.com, clear the lock, then retry.',
  },
  135: {
    code: CODES.CLOCK_SKEW,
    fix: "The signature timestamp was out of range — this server's clock is more than a few "
      + 'minutes off. No credential change will help; fix the clock.',
  },
};

/** Ask v1.1 which cause applies. Returns null if it cannot tell us. */
async function probeXFailureCause(creds) {
  const oauth = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: nonce(),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  };
  const signature = crypto
    .createHmac('sha1', signingKey(creds.apiSecret, creds.accessTokenSecret))
    .update(baseString('GET', V11_VERIFY_URL, oauth))
    .digest('base64');
  const authHeader = buildOAuthHeader({ ...oauth, oauth_signature: signature });

  try {
    const response = await fetch(V11_VERIFY_URL, {
      method: 'GET',
      headers: { Authorization: authHeader, Accept: 'application/json' },
    });
    const payload = await response.json().catch(() => null);
    const first = Array.isArray(payload?.errors) && payload.errors.length ? payload.errors[0] : null;
    const numeric = Number(first?.code || 0) || 0;
    if (!numeric) return null;
    return {
      xErrorCode: numeric,
      xErrorMessage: String(first?.message || '').trim(),
      ...(X_ERROR_CAUSES[numeric] || { code: CODES.REJECTED, fix: '' }),
    };
  } catch (_) {
    return null;
  }
}

async function checkAuth(options = {}) {
  const resolved = await credentialsFor(options);
  if (!resolved.ok) return resolved;
  const creds = resolved.creds;
  if (!creds.apiKey || !creds.apiSecret || !creds.accessToken || !creds.accessTokenSecret) {
    return {
      ok: false,
      status: 400,
      code: CODES.MISSING,
      error: describeCredentialFailure({
        provider: 'x',
        code: CODES.MISSING,
        fix: 'X needs four values from the same app: API Key, API Secret, Access Token, and '
          + 'Access Token Secret. Generate the token pair at developer.x.com > your app > '
          + 'User authentication settings, with Read and Write permission. An app-only Bearer '
          + 'token will not work here.',
      }),
    };
  }

  const verifyUrl = 'https://api.x.com/2/users/me';
  const oauth1 = await checkAuthOAuth1(creds, verifyUrl);
  if (oauth1.ok) return oauth1;

  const attempts = Array.isArray(oauth1.attempts) ? oauth1.attempts : [];
  const status = oauth1.status || 401;
  const detail = String(oauth1.error || '').replace(/^X auth failed \(OAuth 1\.0a\):\s*/, '').trim();

  // 5xx or a transport error is X being unavailable, not a credential problem —
  // don't send the operator to the developer portal for an outage.
  if (status >= 500 || status === 502) {
    return {
      ok: false,
      status,
      code: CODES.UNREACHABLE,
      error: describeCredentialFailure({ provider: 'x', code: CODES.UNREACHABLE, detail }),
      attempts,
    };
  }
  if (status === 429) {
    return {
      ok: false,
      status,
      code: CODES.RATE_LIMITED,
      error: describeCredentialFailure({ provider: 'x', code: CODES.RATE_LIMITED, detail }),
      attempts,
    };
  }
  if (status === 403) {
    return {
      ok: false,
      status,
      code: CODES.INSUFFICIENT_SCOPE,
      error: describeCredentialFailure({
        provider: 'x',
        code: CODES.INSUFFICIENT_SCOPE,
        detail,
        fix: 'The token authenticated but is not allowed to post. Set App permissions to '
          + '"Read and Write" at developer.x.com, then regenerate the Access Token and Secret — '
          + 'a token issued before the permission change keeps the old, narrower permission.',
      }),
      attempts,
    };
  }

  const cause = await probeXFailureCause(creds);
  return {
    ok: false,
    status,
    code: cause?.code || CODES.REJECTED,
    xErrorCode: cause?.xErrorCode || 0,
    error: describeCredentialFailure({
      provider: 'x',
      code: cause?.code || CODES.REJECTED,
      detail: cause?.xErrorMessage ? `${detail} (code ${cause.xErrorCode}: ${cause.xErrorMessage})` : detail,
      fix: cause?.fix || 'Verify all four X values in Settings > APIs against the X developer portal.',
    }),
    attempts,
  };
}

module.exports = {
  getXCredentials,
  resolveXCredentials,
  isConfigured,
  createPost,
  uploadMediaSimple,
  checkAuth,
};
