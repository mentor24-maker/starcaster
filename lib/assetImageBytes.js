'use strict';

const { fetchDriveFileMedia } = require('./googleDrive');

function extractDriveId(url) {
  const text = String(url || '').trim();
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

async function fetchAssetImageBuffer(asset) {
  const location = String(asset?.location || '').trim();
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
      },
    };
  }

  if (!isValidHttpUrl(location)) {
    return { ok: false, status: 400, error: 'Asset location is not a Drive file or HTTP URL' };
  }

  let res;
  try {
    res = await fetch(location);
  } catch (err) {
    return { ok: false, status: 502, error: `Could not fetch asset URL: ${err.message}` };
  }
  if (!res.ok) {
    return { ok: false, status: res.status || 500, error: `Asset fetch failed (${res.status})` };
  }

  return {
    ok: true,
    status: 200,
    data: {
      buffer: Buffer.from(await res.arrayBuffer()),
      contentType: String(res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim(),
    },
  };
}

module.exports = {
  fetchAssetImageBuffer,
};
