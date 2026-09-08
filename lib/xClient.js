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
    authMode: normalizeAuthMode(cfg.auth_mode || cfg.authMode),
    source,
  };
}

/**
 * WHICH of X's two authentication schemes this credential is.
 * Connections 7 of 7 (86bbpz1hu).
 *
 *   oauth1  the app-wide key/secret + token/token-secret signature. This is
 *           Starcaster's own posting, and it is what every X credential in this
 *           file was until slice 7. It stays the DEFAULT, so any caller that
 *           does not know about auth modes — and there are several — behaves
 *           exactly as it did.
 *   oauth2  a per-client bearer token from a stored connection.
 *
 * It is read from the credential rather than inferred from which fields are
 * populated, because the two are distinguishable only by an ABSENCE
 * (`access_token_secret`), and inferring from an absence means a value that
 * failed to load looks exactly like a client connection. The resolver states it
 * outright and deletes the leftover 1.0a secret on that path, so the two facts
 * agree by construction (lib/connections/resolveCredentials.js).
 */
function normalizeAuthMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return mode === 'oauth2' ? 'oauth2' : 'oauth1';
}

/** Is this credential complete enough to sign with, in its own scheme? */
function hasUsableCredentials(creds) {
  if (!creds) return false;
  if (creds.authMode === 'oauth2') return Boolean(creds.accessToken);
  return Boolean(creds.apiKey && creds.apiSecret && creds.accessToken && creds.accessTokenSecret);
}

/**
 * The sentence for a credential that cannot sign, in the vocabulary of the
 * scheme it was trying to use.
 *
 * Two sentences rather than one, because the old one — "Save API Key, API
 * Secret, Access Token, and Access Token Secret in Settings > APIs" — sends a
 * client whose own X connection has gone stale to a screen they have never
 * seen and cannot reach, to paste four values that are not theirs.
 */
function missingCredentialsError(creds) {
  if (creds?.authMode === 'oauth2') {
    return {
      ok: false,
      status: 400,
      error: 'This project\'s X connection has no usable access token. Reconnect X on the '
        + 'Connections screen.',
    };
  }
  return {
    ok: false,
    status: 400,
    error: 'X credentials are missing. Save API Key, API Secret, Access Token, and Access Token Secret in Settings > APIs.',
  };
}

/**
 * The Authorization header for one request, in whichever scheme applies.
 *
 * The single place the two schemes diverge for an outgoing call. Keeping it to
 * one function is what stops a future endpoint being added with only the 1.0a
 * branch — which would sign a client's bearer token as though it were a 1.0a
 * token, with the app's own secret, and post as nobody.
 */
function authHeaderFor(creds, method, url) {
  if (creds.authMode === 'oauth2') return `Bearer ${creds.accessToken}`;

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
    .update(baseString(method, url, oauth))
    .digest('base64');
  return buildOAuthHeader({ ...oauth, oauth_signature: signature });
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
  return hasUsableCredentials(shapeXCredentials(creds, creds.source || 'environment'));
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
  if (!hasUsableCredentials(creds)) return missingCredentialsError(creds);
  if (!Buffer.isBuffer(mediaBuffer) || !mediaBuffer.length) {
    return { ok: false, status: 400, error: 'Media body is empty' };
  }

  const mime = String(mimeTypeInput || 'application/octet-stream').split(';')[0].trim() || 'application/octet-stream';
  const { contentType, buffer } = buildMultipartMediaBody(mediaBuffer, mime);

  /**
   * ⚠ IMAGE POSTING IS UNPROVEN ON BOTH PATHS, AND THIS ENDPOINT IS THE REASON.
   *
   * This used to carry a comment saying a client's bearer token "uploads
   * through the same endpoint, authorised by the `media.write` scope the
   * adapter asks for". That was an assumption, not a measurement, and checking
   * X's own documentation says it is very likely wrong (86bbpz1hu, review
   * round 1 — the reviewer flagged it and could not settle it either):
   *
   *   - `MEDIA_UPLOAD_URL` above is `upload.twitter.com/1.1/media/upload.json`.
   *     X announced the v1.1 media upload endpoints as deprecated from
   *     2025-03-31 for self-serve tiers (Free, Basic, Pro), directing developers
   *     to `POST /2/media/upload`.
   *   - `media.write` is a v2 scope. It is what the v2 endpoint reads under
   *     OAuth 2.0; it does not authorise anything at the v1.1 endpoint, which is
   *     the OAuth 1.0a one.
   *
   * So a client's bearer token being accepted here is unlikely, and Dane's own
   * OAuth 1.0a upload may also be running against a retired endpoint. Neither is
   * a fact yet: nothing in this suite reaches X — every call is canned — and
   * settling it needs one live upload on each scheme, which needs a live
   * credential and the tier question this ticket has open.
   *
   * TEXT posting is unaffected: it goes to api.x.com/2/tweets, which is v2 on
   * both schemes. This comment is only about media.
   *
   * The code is left as it stands on purpose. Rewriting it to v2 is a real
   * behaviour change to Dane's live posting, on a path no test here can see,
   * and it is a different protocol (initialize/append/finalize) rather than a
   * changed URL — that is its own ticket with its own live check, not a quiet
   * edit inside a slice about per-user sign-in.
   */
  const authHeader = authHeaderFor(creds, 'POST', MEDIA_UPLOAD_URL);

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
  if (!hasUsableCredentials(creds)) return missingCredentialsError(creds);

  const trimmedText = String(text || '').trim();
  if (!trimmedText) {
    return { ok: false, status: 400, error: 'Post text is required' };
  }

  const mediaIds = Array.isArray(options.mediaIds)
    ? options.mediaIds.map((id) => String(id || '').trim()).filter(Boolean).slice(0, 4)
    : [];

  const authHeader = authHeaderFor(creds, 'POST', CREATE_POST_URL);

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

/**
 * Ask X who this credential is, in whichever scheme it belongs to.
 *
 * Was `checkAuthOAuth1` and signed 1.0a unconditionally. It takes the mode from
 * the credential now, because a client's bearer token run through the 1.0a
 * signer produces a signature built from Starcaster's app secret and the
 * client's token — which fails with a 401 that reads exactly like a bad
 * credential, and would have sent whoever chased it to regenerate keys that
 * were never wrong.
 */
async function checkAuthAsCredential(creds, verifyUrl) {
  const mode = creds.authMode === 'oauth2' ? 'oauth2' : 'oauth1';
  const authHeader = authHeaderFor(creds, 'GET', verifyUrl);
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
    attempts.push({ endpoint: verifyUrl, mode, ok: false, status: 502, message: err.message || String(err) });
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
    mode,
    ok: response.ok,
    status: response.status,
    message: response.ok ? 'OK' : detail,
  });

  if (!response.ok) {
    const label = mode === 'oauth2' ? 'OAuth 2.0' : 'OAuth 1.0a';
    return { ok: false, status: response.status, error: `X auth failed (${label}): ${detail}`, attempts };
  }

  return {
    ok: true,
    status: response.status,
    data: { user: payload?.data || null, attempts, authMode: mode },
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
  if (!hasUsableCredentials(creds)) {
    if (creds.authMode === 'oauth2') {
      return {
        ok: false,
        status: 400,
        code: CODES.MISSING,
        error: describeCredentialFailure({
          provider: 'x',
          code: CODES.MISSING,
          fix: "This project's own X connection has no usable access token. Reconnect X on the "
            + 'Connections screen — the platform-wide keys in Settings > APIs are a different '
            + 'credential and changing them will not fix this one.',
        }),
      };
    }
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
  const checked = await checkAuthAsCredential(creds, verifyUrl);
  if (checked.ok) return checked;

  const attempts = Array.isArray(checked.attempts) ? checked.attempts : [];
  const status = checked.status || 401;
  const detail = String(checked.error || '').replace(/^X auth failed \(OAuth (?:1\.0a|2\.0)\):\s*/, '').trim();

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
  /**
   * 403 is "authenticated, but not allowed to post" — and WHOSE permission is
   * short depends entirely on which credential was used, so this branch cannot
   * share one sentence.
   *
   * It used to. The oauth2 branch below was added to stop a client's connection
   * being described in terms of Alphire's own OAuth 1.0a key pair, but it sits
   * under this one, so an under-scoped client grant — the single most likely
   * 403 on a per-user connection — read straight past it and told whoever was
   * looking at the client's card to go and regenerate Starcaster's Access Token
   * and Secret at developer.x.com. That is somebody else's credential, and
   * changing it would not have helped (86bbpz1hu, review round 1).
   */
  if (status === 403) {
    return {
      ok: false,
      status,
      code: CODES.INSUFFICIENT_SCOPE,
      error: describeCredentialFailure({
        provider: 'x',
        code: CODES.INSUFFICIENT_SCOPE,
        detail,
        fix: creds.authMode === 'oauth2'
          ? 'This project\'s own X connection signed in, but was not granted permission to post. '
            + 'Reconnect X on the Connections screen and leave every permission ticked on X\'s '
            + 'approval screen — the platform-wide keys in Settings > APIs are a different '
            + 'credential and changing them will not fix this one.'
          : 'The token authenticated but is not allowed to post. Set App permissions to '
            + '"Read and Write" at developer.x.com, then regenerate the Access Token and Secret — '
            + 'a token issued before the permission change keeps the old, narrower permission.',
      }),
      attempts,
    };
  }

  /**
   * The v1.1 probe below SIGNS with OAuth 1.0a, so it is meaningless for a
   * bearer credential — and worse than meaningless: it would sign with the
   * app's own secret and report whatever that says about Starcaster's account
   * as though it were a fact about the client's. A bearer token that X rejected
   * gets X's own words and the one instruction that helps.
   */
  if (creds.authMode === 'oauth2') {
    return {
      ok: false,
      status,
      code: CODES.REJECTED,
      error: describeCredentialFailure({
        provider: 'x',
        code: CODES.REJECTED,
        detail,
        fix: 'X refused this project\'s own connection. The client may have removed Starcaster '
          + 'under x.com > Settings > Security and account access > Apps and sessions. Reconnect '
          + 'X on the Connections screen.',
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
  shapeXCredentials,
  hasUsableCredentials,
  authHeaderFor,
  createPost,
  uploadMediaSimple,
  checkAuth,
};
