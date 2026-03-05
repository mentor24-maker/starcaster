'use strict';

function getToken() {
  return String(process.env.BLOB_READ_WRITE_TOKEN || '').trim();
}

function isConfigured() {
  return Boolean(getToken());
}

function safeSegment(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function buildPath({ assetType, category, fileName }) {
  const root = safeSegment(process.env.BLOB_ASSETS_ROOT || 'APP/Assets') || 'APP_Assets';
  const type = safeSegment(assetType || 'Uncategorized') || 'Uncategorized';
  const cat = safeSegment(category || '');
  const name = safeSegment(fileName || `upload_${Date.now()}`) || `upload_${Date.now()}`;
  const parts = [root, type];
  if (cat) parts.push(cat);
  parts.push(`${Date.now()}_${name}`);
  return parts.join('/');
}

async function putBlob({ pathname, body, contentType, access = 'public' }) {
  let put;
  try {
    ({ put } = require('@vercel/blob'));
  } catch (_) {
    return {
      ok: false,
      status: 500,
      error: 'Vercel Blob SDK is not installed. Run: npm install @vercel/blob',
    };
  }

  try {
    const result = await put(pathname, body, {
      access,
      contentType: String(contentType || 'application/octet-stream'),
      token: getToken(),
      addRandomSuffix: false,
      cacheControlMaxAge: 31536000,
    });
    return { ok: true, status: 201, data: result };
  } catch (err) {
    return { ok: false, status: 502, error: `Vercel Blob upload failed: ${err.message}` };
  }
}

async function uploadAssetToBlob({ assetType, category, fileName, mimeType, fileBase64 }) {
  if (!isConfigured()) {
    return { ok: false, status: 400, error: 'BLOB_READ_WRITE_TOKEN is not configured' };
  }
  const base64 = String(fileBase64 || '').trim();
  if (!base64) return { ok: false, status: 400, error: 'fileBase64 is required' };

  let buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch (_) {
    return { ok: false, status: 400, error: 'fileBase64 is not valid base64 content' };
  }

  const pathname = buildPath({ assetType, category, fileName });
  const putRes = await putBlob({
    pathname,
    body: buffer,
    contentType: mimeType,
    access: 'public',
  });
  if (!putRes.ok) return putRes;

  return {
    ok: true,
    status: 201,
    data: {
      id: String(putRes.data.pathname || ''),
      name: String(fileName || '').trim() || pathname.split('/').pop(),
      mimeType: String(mimeType || 'application/octet-stream'),
      location: String(putRes.data.url || '').trim(),
      sizeBytes: buffer.length,
      imageWidth: null,
      imageHeight: null,
      folderId: '',
      assetType: String(assetType || '').trim(),
      provider: 'vercel_blob',
      pathname: String(putRes.data.pathname || ''),
      downloadUrl: String(putRes.data.downloadUrl || ''),
    },
  };
}

async function uploadBufferToBlob({ assetType, category, fileName, mimeType, fileBuffer }) {
  if (!isConfigured()) {
    return { ok: false, status: 400, error: 'BLOB_READ_WRITE_TOKEN is not configured' };
  }
  if (!Buffer.isBuffer(fileBuffer) || !fileBuffer.length) {
    return { ok: false, status: 400, error: 'fileBuffer is required' };
  }
  const pathname = buildPath({ assetType, category, fileName });
  const putRes = await putBlob({
    pathname,
    body: fileBuffer,
    contentType: mimeType,
    access: 'public',
  });
  if (!putRes.ok) return putRes;
  return {
    ok: true,
    status: 201,
    data: {
      location: String(putRes.data.url || '').trim(),
      pathname: String(putRes.data.pathname || ''),
      downloadUrl: String(putRes.data.downloadUrl || ''),
      sizeBytes: fileBuffer.length,
      provider: 'vercel_blob',
    },
  };
}

module.exports = {
  isConfigured,
  uploadAssetToBlob,
  uploadBufferToBlob,
};

