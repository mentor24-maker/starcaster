'use strict';

const crypto = require('crypto');
const { getProviderValues } = require('./apiSettings');

const CREATE_POST_URL = 'https://api.x.com/2/tweets';
const MEDIA_UPLOAD_URL = 'https://upload.twitter.com/1.1/media/upload.json';

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

function getXCredentials() {
  const cfg = getProviderValues('x');
  return {
    apiKey: String(cfg.api_key || '').trim(),
    apiSecret: String(cfg.api_secret || '').trim(),
    accessToken: String(cfg.access_token || '').trim(),
    accessTokenSecret: String(cfg.access_token_secret || '').trim(),
    accountName: String(cfg.account_name || '').trim(),
  };
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

async function uploadMediaSimple(mediaBuffer, mimeTypeInput) {
  const creds = getXCredentials();
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
  const creds = getXCredentials();
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

async function checkAuthBearer(creds, verifyUrl) {
  const attempts = [];
  let response;
  try {
    response = await fetch(verifyUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        Accept: 'application/json',
      },
    });
  } catch (err) {
    attempts.push({ endpoint: verifyUrl, mode: 'oauth2_bearer', ok: false, status: 502, message: err.message || String(err) });
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
    mode: 'oauth2_bearer',
    ok: response.ok,
    status: response.status,
    message: response.ok ? 'OK' : detail,
  });

  if (!response.ok) {
    return { ok: false, status: response.status, error: `X auth failed (OAuth 2.0 bearer): ${detail}`, attempts };
  }

  return {
    ok: true,
    status: response.status,
    data: { user: payload?.data || null, attempts, authMode: 'oauth2_bearer' },
  };
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

const OAUTH1_USER_HINT =
  'StarCaster uses OAuth 1.0a user context (four fields from the same X app). '
  + 'In developer.x.com open your app → User authentication settings → generate Access Token and Access Token Secret '
  + '(Read and Write). Do not put an app-only Bearer token in Access Token.';

async function checkAuth() {
  const creds = getXCredentials();
  if (!creds.apiKey || !creds.apiSecret || !creds.accessToken || !creds.accessTokenSecret) {
    return {
      ok: false,
      status: 400,
      error: `X credentials are incomplete. ${OAUTH1_USER_HINT}`,
    };
  }

  const verifyUrl = 'https://api.x.com/2/users/me';
  const oauth1 = await checkAuthOAuth1(creds, verifyUrl);
  if (oauth1.ok) return oauth1;

  const primary = String(oauth1.error || 'X auth failed').trim();
  return {
    ok: false,
    status: oauth1.status || 401,
    error: `${primary} ${OAUTH1_USER_HINT}`,
    attempts: Array.isArray(oauth1.attempts) ? oauth1.attempts : [],
  };
}

module.exports = {
  getXCredentials,
  isConfigured,
  createPost,
  uploadMediaSimple,
  checkAuth,
};
