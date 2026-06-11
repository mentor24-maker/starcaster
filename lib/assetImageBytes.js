'use strict';

const { fetchDriveFileMedia } = require('./googleDrive');

function extractDriveId(url) {
  const text = String(url || '').trim();
  const byProxy = text.match(/\/api\/assets\/drive-file\/([^/?#]+)/);
  if (byProxy) {
    try {
      return decodeURIComponent(byProxy[1]).trim();
    } catch {
      return String(byProxy[1] || '').trim();
    }
  }
  const byPath = text.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (byPath) return byPath[1];
  try {
    const u = new URL(text);
    return u.searchParams.get('id') || '';
  } catch {
    return '';
  }
}

function isValidHttpUrl(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  try {
    const parsed = new URL(text);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseDataImageUrl(value) {
  const text = String(value || '').trim();
  const match = text.match(/^data:(image\/[^;]+);base64,(.+)$/i);
  if (!match) return null;
  try {
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length) return null;
    return {
      buffer,
      contentType: match[1].toLowerCase(),
    };
  } catch {
    return null;
  }
}

function collectImageSourceUrls(asset) {
  const urls = [];
  const seen = new Set();
  const push = (value) => {
    const text = String(value || '').trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    urls.push(text);
  };

  push(asset?.location);
  push(asset?.thumbnailLocation);
  push(asset?.thumbnailUrl);
  push(asset?.thumbnail_location);
  return urls;
}

async function fetchFromSourceUrl(sourceUrl) {
  const location = String(sourceUrl || '').trim();
  if (!location) {
    return { ok: false, status: 400, error: 'Image source URL is empty' };
  }

  const dataImage = parseDataImageUrl(location);
  if (dataImage) {
    return {
      ok: true,
      status: 200,
      data: {
        buffer: dataImage.buffer,
        contentType: dataImage.contentType,
        sourceUrl: location,
      },
    };
  }

  const driveId = extractDriveId(location);
  if (driveId) {
    const media = await fetchDriveFileMedia(driveId);
    if (!media.ok) return media;
    return {
      ok: true,
      status: 200,
      data: {
        buffer: media.data.buffer,
        contentType: media.data.contentType || 'image/jpeg',
        sourceUrl: location,
      },
    };
  }

  if (!isValidHttpUrl(location)) {
    return { ok: false, status: 400, error: 'Asset location is not a Drive file or HTTP URL' };
  }

  let res;
  try {
    res = await fetch(location, {
      headers: { accept: 'image/*,*/*;q=0.8' },
    });
  } catch (err) {
    return { ok: false, status: 502, error: `Could not fetch asset URL: ${err.message}` };
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status || 500,
      error: `Asset fetch failed (${res.status})`,
    };
  }

  const contentType = String(res.headers.get('content-type') || 'application/octet-stream')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (contentType.startsWith('application/json') || contentType.startsWith('text/html')) {
    return {
      ok: false,
      status: 502,
      error: 'Asset URL did not return image data',
    };
  }

  return {
    ok: true,
    status: 200,
    data: {
      buffer: Buffer.from(await res.arrayBuffer()),
      contentType: contentType || 'application/octet-stream',
      sourceUrl: location,
    },
  };
}

async function fetchAssetImageBuffer(asset) {
  const candidates = collectImageSourceUrls(asset);
  if (!candidates.length) {
    return { ok: false, status: 400, error: 'Asset has no image location' };
  }

  let lastError = { ok: false, status: 404, error: 'Could not load image for editing' };
  for (const sourceUrl of candidates) {
    const result = await fetchFromSourceUrl(sourceUrl);
    if (result.ok) return result;
    lastError = result;
  }

  return lastError;
}

module.exports = {
  fetchAssetImageBuffer,
  collectImageSourceUrls,
  fetchFromSourceUrl,
};
