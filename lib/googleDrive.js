'use strict';

const { getProviderValues } = require('./apiSettings');

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

function config() {
  const values = getProviderValues('google_drive');
  const envClientId = String(process.env.GOOGLE_DRIVE_CLIENT_ID || '').trim();
  const envClientSecret = String(process.env.GOOGLE_DRIVE_CLIENT_SECRET || '').trim();
  const envRefreshToken = String(process.env.GOOGLE_DRIVE_REFRESH_TOKEN || '').trim();
  const storedClientId = String(values.client_id || '').trim();
  const storedClientSecret = String(values.client_secret || '').trim();
  const storedRefreshToken = String(values.refresh_token || '').trim();
  return {
    clientId: envClientId || storedClientId,
    clientSecret: envClientSecret || storedClientSecret,
    refreshToken: envRefreshToken || storedRefreshToken,
    rootFolderName: String(values.root_folder_name || 'APP').trim() || 'APP',
    assetsFolderName: String(values.assets_folder_name || 'Assets').trim() || 'Assets',
    clientIdSource: envClientId ? 'env' : (storedClientId ? 'settings' : 'none'),
    clientSecretSource: envClientSecret ? 'env' : (storedClientSecret ? 'settings' : 'none'),
    refreshTokenSource: envRefreshToken ? 'env' : (storedRefreshToken ? 'settings' : 'none'),
  };
}

function isConfigured() {
  const cfg = config();
  return Boolean(cfg.clientId && cfg.clientSecret && cfg.refreshToken);
}

function escapeDriveQueryLiteral(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function getAccessToken() {
  const cfg = config();
  if (!cfg.clientId || !cfg.clientSecret || !cfg.refreshToken) {
    return {
      ok: false,
      status: 400,
      error: 'Google Drive credentials are not configured in Settings > APIs or environment variables.',
    };
  }

  const body = new URLSearchParams();
  body.set('client_id', cfg.clientId);
  body.set('client_secret', cfg.clientSecret);
  body.set('refresh_token', cfg.refreshToken);
  body.set('grant_type', 'refresh_token');

  let res;
  try {
    res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (err) {
    return { ok: false, status: 502, error: `Could not reach Google OAuth: ${err.message}` };
  }

  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload.access_token) {
    return {
      ok: false,
      status: res.status || 500,
      error: payload.error_description || payload.error || 'Failed to obtain Google Drive access token',
    };
  }

  return { ok: true, status: 200, data: { accessToken: String(payload.access_token) } };
}

async function fetchDriveFileMedia(fileId) {
  const id = String(fileId || '').trim();
  if (!id) return { ok: false, status: 400, error: 'fileId is required' };

  const tokenRes = await getAccessToken();
  if (!tokenRes.ok) return tokenRes;

  let res;
  try {
    res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tokenRes.data.accessToken}`,
      },
    });
  } catch (err) {
    return { ok: false, status: 502, error: `Could not fetch Google Drive media: ${err.message}` };
  }

  const contentType = String(res.headers.get('content-type') || 'application/octet-stream');
  const contentLength = Number(res.headers.get('content-length') || 0) || 0;

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text }; }
    return {
      ok: false,
      status: res.status || 500,
      error: payload?.error?.message || payload?.message || `Google Drive media fetch failed (${res.status})`,
    };
  }

  const buf = Buffer.from(await res.arrayBuffer());
  return {
    ok: true,
    status: 200,
    data: {
      contentType,
      contentLength: contentLength || buf.length,
      buffer: buf,
    },
  };
}

async function driveRequest({ token, method = 'GET', path = '', query = '', body = null, headers = {} }) {
  const url = `${DRIVE_API_BASE}${path}${query ? `?${query}` : ''}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...headers,
      },
      body,
    });
  } catch (err) {
    return { ok: false, status: 502, error: `Could not reach Google Drive API: ${err.message}` };
  }

  const text = await res.text();
  let payload = {};
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = { message: text }; }
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: payload?.error?.message || payload?.message || `Google Drive API error (${res.status})`,
    };
  }

  return { ok: true, status: res.status, data: payload };
}

async function findFolderByName(token, parentId, folderName) {
  const q = [
    `mimeType='application/vnd.google-apps.folder'`,
    `trashed=false`,
    `'${escapeDriveQueryLiteral(parentId)}' in parents`,
    `name='${escapeDriveQueryLiteral(folderName)}'`,
  ].join(' and ');

  const query = new URLSearchParams({
    q,
    fields: 'files(id,name)',
    spaces: 'drive',
    pageSize: '1',
  }).toString();

  const result = await driveRequest({
    token,
    path: '/files',
    query,
  });
  if (!result.ok) return result;

  const found = Array.isArray(result.data.files) ? result.data.files[0] : null;
  return { ok: true, status: 200, data: found || null };
}

async function createFolder(token, parentId, folderName) {
  const payload = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [parentId],
  };
  return driveRequest({
    token,
    method: 'POST',
    path: '/files',
    query: new URLSearchParams({ fields: 'id,name' }).toString(),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function ensureFolderPath(token, folderNames) {
  let parentId = 'root';
  for (const rawName of folderNames) {
    const folderName = String(rawName || '').trim();
    if (!folderName) continue;

    const lookup = await findFolderByName(token, parentId, folderName);
    if (!lookup.ok) return lookup;

    if (lookup.data) {
      parentId = lookup.data.id;
      continue;
    }

    const created = await createFolder(token, parentId, folderName);
    if (!created.ok) return created;
    parentId = created.data.id;
  }

  return { ok: true, status: 200, data: { folderId: parentId } };
}

async function uploadFile({ token, folderId, fileName, mimeType, fileBuffer }) {
  const boundary = `alphire_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const metadata = {
    name: fileName,
    mimeType,
    parents: [folderId],
  };

  const p1 = Buffer.from(
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`,
    'utf8'
  );
  const p2 = Buffer.from(`\r\n--${boundary}--`, 'utf8');
  const body = Buffer.concat([p1, fileBuffer, p2]);

  let res;
  try {
    res = await fetch(
      `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink,mimeType,size,imageMediaMetadata(width,height)`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      }
    );
  } catch (err) {
    return { ok: false, status: 502, error: `Google Drive upload failed: ${err.message}` };
  }

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: payload?.error?.message || 'Google Drive upload failed',
    };
  }
  return { ok: true, status: res.status, data: payload };
}

async function getFileMetadata(token, fileId) {
  return driveRequest({
    token,
    method: 'GET',
    path: `/files/${encodeURIComponent(fileId)}`,
    query: new URLSearchParams({
      fields: 'id,name,mimeType,size,webViewLink,webContentLink,imageMediaMetadata(width,height)',
    }).toString(),
  });
}

function extractDriveFileIdFromUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  // Common share URL patterns:
  // - https://drive.google.com/file/d/<id>/view
  // - https://drive.google.com/open?id=<id>
  // - https://drive.google.com/uc?id=<id>
  // - https://docs.google.com/.../d/<id>/...
  const byPath = raw.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (byPath) return byPath[1];

  try {
    const u = new URL(raw);
    const byParam = u.searchParams.get('id');
    if (byParam) return byParam;
  } catch {
    // ignore invalid URL parse
  }

  // Fallback for plain ids accidentally stored in location
  if (/^[a-zA-Z0-9_-]{10,}$/.test(raw)) return raw;
  return null;
}

async function makeFilePublic(token, fileId) {
  return driveRequest({
    token,
    method: 'POST',
    path: `/files/${encodeURIComponent(fileId)}/permissions`,
    query: new URLSearchParams({ fields: 'id' }).toString(),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone', allowFileDiscovery: false }),
  });
}

function normalizeAssetType(value) {
  const raw = String(value || '').trim();
  const key = raw.toLowerCase().replace(/\s+/g, ' ');
  const canonical = new Map([
    ['image', 'Image'],
    ['video', 'Video'],
    ['music', 'Audio'],
    ['audio', 'Audio'],
    ['lead magnet', 'Lead Magnet'],
    ['lead_magnet', 'Lead Magnet'],
    ['copy', 'Lead Magnet'],
    ['multimedia', 'Video'],
  ]).get(key) || raw;
  const valid = new Set(['Image', 'Video', 'Audio', 'Lead Magnet']);
  return valid.has(canonical) ? canonical : null;
}

async function uploadAssetToDrive({ assetType, category, fileName, mimeType, fileBase64, makePublic = true }) {
  const normalizedType = normalizeAssetType(String(assetType || '').trim());
  const normalizedCategory = String(category || '').trim();
  if (!normalizedType) {
    return { ok: false, status: 400, error: 'assetType is invalid' };
  }

  const cleanName = String(fileName || '').trim();
  if (!cleanName) return { ok: false, status: 400, error: 'fileName is required' };
  if (!String(fileBase64 || '').trim()) return { ok: false, status: 400, error: 'fileBase64 is required' };

  const tokenRes = await getAccessToken();
  if (!tokenRes.ok) return tokenRes;

  const cfg = config();
  const folderPath = [cfg.rootFolderName, cfg.assetsFolderName, normalizedType];
  if (normalizedType === 'Image' && normalizedCategory) {
    folderPath.push(normalizedCategory);
  }
  const folderRes = await ensureFolderPath(tokenRes.data.accessToken, folderPath);
  if (!folderRes.ok) return folderRes;

  let fileBuffer;
  try {
    fileBuffer = Buffer.from(String(fileBase64 || ''), 'base64');
  } catch {
    return { ok: false, status: 400, error: 'fileBase64 is not valid base64 content' };
  }

  const uploadRes = await uploadFile({
    token: tokenRes.data.accessToken,
    folderId: folderRes.data.folderId,
    fileName: cleanName,
    mimeType: String(mimeType || 'application/octet-stream'),
    fileBuffer,
  });
  if (!uploadRes.ok) return uploadRes;

  let file = uploadRes.data || {};
  if (file?.id) {
    const metadataRes = await getFileMetadata(tokenRes.data.accessToken, file.id);
    if (metadataRes.ok && metadataRes.data) {
      file = { ...file, ...metadataRes.data };
    }
  }

  if (makePublic && uploadRes.data?.id) {
    await makeFilePublic(tokenRes.data.accessToken, uploadRes.data.id);
  }

  const location = file.webViewLink || file.webContentLink || `https://drive.google.com/file/d/${file.id}/view`;
  const sizeBytes = Math.max(0, Number(file.size || 0) || 0);
  const imageWidth = Math.max(0, Number(file?.imageMediaMetadata?.width || 0) || 0);
  const imageHeight = Math.max(0, Number(file?.imageMediaMetadata?.height || 0) || 0);
  return {
    ok: true,
    status: 201,
    data: {
      id: file.id,
      name: file.name || cleanName,
      mimeType: file.mimeType || mimeType,
      webViewLink: file.webViewLink || '',
      webContentLink: file.webContentLink || '',
      location,
      sizeBytes,
      imageWidth: imageWidth || null,
      imageHeight: imageHeight || null,
      folderId: folderRes.data.folderId,
      assetType: normalizedType,
    },
  };
}

async function getDriveFileMetadataById(fileId) {
  const id = String(fileId || '').trim();
  if (!id) return { ok: false, status: 400, error: 'fileId is required' };

  const tokenRes = await getAccessToken();
  if (!tokenRes.ok) return tokenRes;

  const metadataRes = await getFileMetadata(tokenRes.data.accessToken, id);
  if (!metadataRes.ok) return metadataRes;

  const file = metadataRes.data || {};
  const sizeBytes = Math.max(0, Number(file.size || 0) || 0);
  const imageWidth = Math.max(0, Number(file?.imageMediaMetadata?.width || 0) || 0) || null;
  const imageHeight = Math.max(0, Number(file?.imageMediaMetadata?.height || 0) || 0) || null;

  return {
    ok: true,
    status: 200,
    data: {
      id,
      name: String(file.name || ''),
      mimeType: String(file.mimeType || ''),
      sizeBytes,
      imageWidth,
      imageHeight,
      webViewLink: String(file.webViewLink || ''),
      webContentLink: String(file.webContentLink || ''),
    },
  };
}

async function getDriveFileMetadataByUrl(url) {
  const fileId = extractDriveFileIdFromUrl(url);
  if (!fileId) return { ok: false, status: 400, error: 'Could not extract Google Drive file id from URL' };
  return getDriveFileMetadataById(fileId);
}

module.exports = {
  config,
  isConfigured,
  uploadAssetToDrive,
  extractDriveFileIdFromUrl,
  getDriveFileMetadataById,
  getDriveFileMetadataByUrl,
  getAccessToken,
  fetchDriveFileMedia,
};
