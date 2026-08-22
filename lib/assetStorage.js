'use strict';

const { uploadAssetToDrive, isConfigured: isDriveConfigured } = require('./googleDrive');
const { uploadAssetToBlob, deleteBlob, isConfigured: isBlobConfigured } = require('./blobStorage');

function configuredProvider() {
  const raw = String(process.env.ASSET_STORAGE_PROVIDER || '').trim().toLowerCase();
  if (raw === 'vercel_blob' || raw === 'blob') return 'vercel_blob';
  if (raw === 'google_drive' || raw === 'drive') return 'google_drive';
  return 'google_drive';
}

function getProvider() {
  const preferred = configuredProvider();
  if (preferred === 'vercel_blob' && isBlobConfigured()) return 'vercel_blob';
  if (preferred === 'google_drive' && isDriveConfigured()) return 'google_drive';
  if (isBlobConfigured()) return 'vercel_blob';
  if (isDriveConfigured()) return 'google_drive';
  return preferred;
}

function isConfigured() {
  return isBlobConfigured() || isDriveConfigured();
}

async function uploadAssetFile(input) {
  const provider = getProvider();
  if (provider === 'vercel_blob') {
    const blobRes = await uploadAssetToBlob(input);
    if (blobRes.ok) return blobRes;
    if (isDriveConfigured()) {
      const driveRes = await uploadAssetToDrive(input);
      if (driveRes.ok) return driveRes;
      return {
        ok: false,
        status: driveRes.status || blobRes.status || 500,
        error: `${blobRes.error}; Drive fallback failed: ${driveRes.error}`,
      };
    }
    return blobRes;
  }
  return uploadAssetToDrive(input);
}

/**
 * Best-effort removal of a file THIS process just uploaded, for the
 * upload-succeeded-then-insert-failed path — otherwise a public blob is left
 * with no row to ever find it. Blob is deletable by URL; Drive deletion is
 * not wired here, so the caller must log the location when this reports it
 * could not delete. Never throws.
 */
async function deleteUploadedAsset(location) {
  const url = String(location || '').trim();
  if (!url) return { ok: false, status: 400, error: 'no location' };
  if (isBlobConfigured() && /\.blob\.vercel-storage\.com\//.test(url)) {
    try { return await deleteBlob(url); } catch (err) { return { ok: false, status: 502, error: err.message }; }
  }
  return { ok: false, status: 501, error: 'no deleter for this storage provider — caller must log the orphan' };
}

module.exports = {
  deleteUploadedAsset,
  getProvider,
  isConfigured,
  uploadAssetFile,
};

