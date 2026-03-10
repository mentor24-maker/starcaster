'use strict';

const { getProviderValues } = require('./apiSettings');

function safeText(value) {
  return String(value || '').trim();
}

function normalizeIdentifier(value) {
  const text = safeText(value);
  if (!text) return '';
  return text.replace(/^@+/, '');
}

function getBlueskyCredentials() {
  const stored = getProviderValues('bluesky') || {};
  const service = safeText(process.env.BLUESKY_SERVICE_URL)
    || safeText(stored.service_url)
    || 'https://bsky.social';
  return {
    identifier: normalizeIdentifier(process.env.BLUESKY_IDENTIFIER) || normalizeIdentifier(stored.identifier),
    appPassword: safeText(process.env.BLUESKY_APP_PASSWORD) || safeText(stored.app_password),
    serviceUrl: service.replace(/\/+$/, ''),
  };
}

function isConfigured(creds = getBlueskyCredentials()) {
  return Boolean(creds.identifier && creds.appPassword);
}

function isHttpUrl(value) {
  const text = safeText(value);
  if (!text) return false;
  try {
    const u = new URL(text);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

async function createSession(creds = getBlueskyCredentials()) {
  if (!isConfigured(creds)) {
    return {
      ok: false,
      status: 400,
      error: 'Bluesky credentials are missing. Save Identifier and App Password in Settings > APIs.',
    };
  }

  const endpoint = `${creds.serviceUrl}/xrpc/com.atproto.server.createSession`;
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: creds.identifier,
        password: creds.appPassword,
      }),
    });
  } catch (err) {
    return {
      ok: false,
      endpoint,
      status: 0,
      error: `Bluesky auth network error: ${safeText(err?.message) || 'request failed'}`,
    };
  }

  const raw = await response.text();
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { raw }; }

  if (!response.ok) {
    let message = safeText(payload?.message || payload?.error || raw) || `Bluesky auth error (${response.status})`;
    if (response.status === 401) {
      message = `${message}. Use full handle/email for Identifier (no @), and a fresh Bluesky app password.`;
    }
    return { ok: false, endpoint, status: response.status, error: message, data: payload };
  }

  const accessJwt = safeText(payload?.accessJwt);
  const did = safeText(payload?.did);
  if (!accessJwt || !did) {
    return { ok: false, endpoint, status: response.status, error: 'Bluesky auth response missing access token/did', data: payload };
  }
  return { ok: true, endpoint, status: response.status, data: payload, accessJwt, did };
}

async function uploadImageBlob(imageUrl, accessJwt, serviceUrl) {
  const cleanUrl = safeText(imageUrl);
  if (!isHttpUrl(cleanUrl)) {
    return { ok: false, status: 400, error: 'Image URL must be a valid http/https URL' };
  }

  let imageRes;
  try {
    imageRes = await fetch(cleanUrl, { signal: AbortSignal.timeout(20000) });
  } catch (err) {
    return { ok: false, status: 0, error: `Could not fetch image URL: ${safeText(err?.message) || 'request failed'}` };
  }
  if (!imageRes.ok) {
    return { ok: false, status: imageRes.status || 502, error: `Image fetch failed (${imageRes.status})` };
  }

  const contentType = safeText(imageRes.headers.get('content-type') || 'application/octet-stream');
  if (!contentType.toLowerCase().startsWith('image/')) {
    return { ok: false, status: 400, error: `Image URL returned non-image content-type: ${contentType}` };
  }

  let bytes;
  try {
    const buf = await imageRes.arrayBuffer();
    bytes = Buffer.from(buf);
  } catch (err) {
    return { ok: false, status: 0, error: `Could not read image bytes: ${safeText(err?.message) || 'read failed'}` };
  }
  if (!bytes || !bytes.length) {
    return { ok: false, status: 400, error: 'Image URL returned empty body' };
  }

  const endpoint = `${serviceUrl}/xrpc/com.atproto.repo.uploadBlob`;
  let uploadRes;
  try {
    uploadRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessJwt}`,
        'Content-Type': contentType,
      },
      body: bytes,
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    return {
      ok: false,
      endpoint,
      status: 0,
      error: `Bluesky image upload network error: ${safeText(err?.message) || 'request failed'}`,
    };
  }

  const raw = await uploadRes.text();
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { raw }; }
  if (!uploadRes.ok) {
    const message = safeText(payload?.message || payload?.error || raw) || `Bluesky image upload error (${uploadRes.status})`;
    return { ok: false, endpoint, status: uploadRes.status, error: message, data: payload };
  }

  const blob = payload?.blob || null;
  if (!blob || typeof blob !== 'object') {
    return { ok: false, endpoint, status: uploadRes.status, error: 'Bluesky image upload response missing blob descriptor', data: payload };
  }
  return { ok: true, endpoint, status: uploadRes.status, blob };
}

async function createPost(textInput, options = {}, creds = getBlueskyCredentials()) {
  const text = safeText(textInput);
  if (!text) return { ok: false, status: 400, error: 'Post text is required' };
  if (text.length > 300) return { ok: false, status: 400, error: 'Bluesky posts must be 300 characters or fewer' };

  const auth = await createSession(creds);
  if (!auth.ok) return auth;

  const imageUrl = safeText(options?.imageUrl);
  const imageAlt = safeText(options?.imageAlt);
  let embed = null;
  if (imageUrl) {
    const uploaded = await uploadImageBlob(imageUrl, auth.accessJwt, creds.serviceUrl);
    if (!uploaded.ok) return uploaded;
    embed = {
      $type: 'app.bsky.embed.images',
      images: [
        {
          alt: imageAlt || 'Campaign image',
          image: uploaded.blob,
        },
      ],
    };
  }

  const endpoint = `${creds.serviceUrl}/xrpc/com.atproto.repo.createRecord`;
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.accessJwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        repo: auth.did,
        collection: 'app.bsky.feed.post',
        record: {
          $type: 'app.bsky.feed.post',
          text,
          createdAt: new Date().toISOString(),
          ...(embed ? { embed } : {}),
        },
      }),
    });
  } catch (err) {
    return {
      ok: false,
      endpoint,
      status: 0,
      error: `Bluesky post network error: ${safeText(err?.message) || 'request failed'}`,
      attempts: [{
        endpoint,
        ok: false,
        status: 0,
        message: safeText(err?.message) || 'request failed',
      }],
    };
  }

  const raw = await response.text();
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { raw }; }
  if (!response.ok) {
    const message = safeText(payload?.message || payload?.error || raw) || `Bluesky post error (${response.status})`;
    return {
      ok: false,
      endpoint,
      status: response.status,
      error: message,
      data: payload,
      attempts: [{
        endpoint,
        ok: false,
        status: response.status,
        message,
        payload,
      }],
    };
  }

  return {
    ok: true,
    endpoint,
    status: response.status,
    data: {
      id: safeText(payload?.uri || payload?.cid),
      uri: safeText(payload?.uri),
      cid: safeText(payload?.cid),
      endpoint,
      response: payload,
      attempts: [{
        endpoint,
        ok: true,
        status: response.status,
      }],
    },
  };
}

module.exports = {
  getBlueskyCredentials,
  isConfigured,
  createSession,
  createPost,
};
