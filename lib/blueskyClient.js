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

// Bluesky renders links as plain text unless the post carries "facets" —
// byte-offset ranges that mark which slices of the text are links. Byte
// offsets are UTF-8, NOT character offsets, so we measure with Buffer.
function buildLinkFacets(textInput) {
  const text = String(textInput || '');
  const facets = [];
  const re = /https?:\/\/[^\s<>\])}"']+/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    // Drop trailing punctuation that reads as sentence punctuation, not URL.
    const uri = match[0].replace(/[.,;:!?)\]}>"']+$/, '');
    if (!isHttpUrl(uri)) continue;
    const byteStart = Buffer.byteLength(text.slice(0, match.index), 'utf8');
    const byteEnd = byteStart + Buffer.byteLength(uri, 'utf8');
    facets.push({
      index: { byteStart, byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri }],
    });
  }
  return facets;
}

function firstLinkInText(textInput) {
  const facets = buildLinkFacets(textInput);
  return facets.length ? facets[0].features[0].uri : '';
}

function extractMetaContent(html, property) {
  const safe = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Matches <meta property="og:x" content="..."> in either attribute order.
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${safe}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${safe}["']`, 'i'),
  ];
  for (const pattern of patterns) {
    const m = html.match(pattern);
    if (m && safeText(m[1])) return safeText(m[1]);
  }
  return '';
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'");
}

// Best-effort rich link card (app.bsky.embed.external). Any failure here —
// slow page, missing tags, bad thumb — must NOT block the post; we just
// fall back to the plain-text-plus-facets post. Never throws.
async function buildExternalEmbed(url, accessJwt, serviceUrl) {
  try {
    let res;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StarCasterBot/1.0)' },
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      return null;
    }
    if (!res.ok) return null;
    const contentType = safeText(res.headers.get('content-type'));
    if (contentType && !contentType.toLowerCase().includes('text/html')) return null;
    const html = (await res.text()).slice(0, 200000);

    const titleTag = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
    const title = decodeEntities(
      extractMetaContent(html, 'og:title') || extractMetaContent(html, 'twitter:title') || titleTag
    );
    const description = decodeEntities(
      extractMetaContent(html, 'og:description') || extractMetaContent(html, 'twitter:description')
    );
    if (!title && !description) return null;

    const external = {
      uri: url,
      title: title.slice(0, 300) || url,
      description: description.slice(0, 1000),
    };

    const imageUrl = extractMetaContent(html, 'og:image') || extractMetaContent(html, 'twitter:image');
    if (isHttpUrl(imageUrl)) {
      const thumb = await uploadImageBlob(imageUrl, accessJwt, serviceUrl);
      if (thumb.ok) external.thumb = thumb.blob;
    }

    return { $type: 'app.bsky.embed.external', external };
  } catch {
    return null;
  }
}

async function createPost(textInput, options = {}, creds = getBlueskyCredentials()) {
  const text = safeText(textInput);
  if (!text) return { ok: false, status: 400, error: 'Post text is required' };
  if (text.length > 300) return { ok: false, status: 400, error: 'Bluesky posts must be 300 characters or fewer' };

  const auth = await createSession(creds);
  if (!auth.ok) return auth;

  const facets = buildLinkFacets(text);

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
  } else if (options?.linkCard !== false) {
    // No campaign image: promote the article with a rich link-preview card.
    // A post carries at most one top-level embed, so this only runs when
    // there is no image. Best-effort — stays null if the fetch/parse fails.
    const link = firstLinkInText(text);
    if (link) {
      embed = await buildExternalEmbed(link, auth.accessJwt, creds.serviceUrl);
    }
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
          ...(facets.length ? { facets } : {}),
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
  buildLinkFacets,
  firstLinkInText,
};
