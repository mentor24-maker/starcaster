'use strict';

const { uploadAssetToDrive, isConfigured: isDriveConfigured } = require('./googleDrive');
const { uploadAssetToBlob, isConfigured: isBlobConfigured } = require('./blobStorage');

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

module.exports = {
  getProvider,
  isConfigured,
  uploadAssetFile,
};

