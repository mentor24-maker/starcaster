'use strict';

const { inferAspectFromDimensions } = require('./assetAspect');
const { generateThumbnailJpeg, DEFAULT_MAX_EDGE } = require('./assetThumbnail');
const { uploadAssetFile, isConfigured: isAssetStorageConfigured } = require('./assetStorage');
const { listAssets, createAsset, updateAsset, rowToAsset } = require('./assetsStore');
const {
  isConfigured: isGoogleDriveConfigured,
  extractDriveFileIdFromUrl,
  extractDriveFolderIdFromUrl,
  getFolderMetadataById,
  listImageFilesInFolder,
  fetchDriveFileMedia,
  makeFilePublic,
  getAccessToken,
} = require('./googleDrive');

const MAX_FOLDER_IMPORT_FILES = 100;
const MAX_DRIVE_IMPORT_FILE_BYTES = 20 * 1024 * 1024;

function cleanAssetName(name, fallback = 'image') {
  const base = String(name || fallback)
    .trim()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  return base || fallback;
}

function buildKnownDriveFileIds(assets) {
  const ids = new Set();
  for (const asset of assets) {
    const mainId = extractDriveFileIdFromUrl(asset?.location);
    if (mainId) ids.add(mainId);
    const thumbId = extractDriveFileIdFromUrl(asset?.thumbnailLocation || asset?.thumbnailUrl);
    if (thumbId) ids.add(thumbId);
  }
  return ids;
}

async function attachThumbnailForDriveAsset({
  assetId,
  assetName,
  driveFileId,
  mimeType,
  scope,
}) {
  const media = await fetchDriveFileMedia(driveFileId);
  if (!media.ok) {
    return { ok: false, error: media.error || 'Could not download image from Drive' };
  }

  const buffer = media.data.buffer;
  if (!buffer?.length) {
    return { ok: false, error: 'Downloaded image is empty' };
  }

  const thumb = await generateThumbnailJpeg(buffer, {
    maxEdge: DEFAULT_MAX_EDGE,
    mimeType: mimeType || media.data.contentType,
  });
  if (!thumb.ok) {
    return { ok: false, error: thumb.error || 'Thumbnail generation failed' };
  }

  const thumbUpload = await uploadAssetFile({
    assetType: 'Image',
    category: 'Asset Thumbnail',
    fileName: `${cleanAssetName(assetName, `asset_${assetId}`)}_thumb.jpg`,
    mimeType: 'image/jpeg',
    fileBase64: thumb.data.buffer.toString('base64'),
    makePublic: true,
  });

  if (!thumbUpload.ok) {
    return { ok: false, error: thumbUpload.error || 'Thumbnail upload failed' };
  }

  const thumbLocation = String(thumbUpload.data.location || '').trim();
  if (!thumbLocation) {
    return { ok: false, error: 'Thumbnail upload did not return a location' };
  }

  const updated = await updateAsset(
    assetId,
    {
      thumbnailLocation: thumbLocation,
      thumbnailWidth: thumb.data.width || null,
      thumbnailHeight: thumb.data.height || null,
      thumbnailSize: thumb.data.buffer.length,
      thumbnailGeneratedAt: new Date().toISOString(),
    },
    scope
  );

  if (!updated.ok) {
    return { ok: false, error: updated.error || 'Failed to save thumbnail metadata' };
  }

  const updatedRow = Array.isArray(updated.data) ? updated.data[0] : updated.data;
  return { ok: true, asset: rowToAsset(updatedRow), thumbnailGenerated: true };
}

async function importDriveImageFile(file, options = {}) {
  const scope = options.scope || null;
  const category = String(options.category || '').trim();
  const tags = Array.isArray(options.tags) ? options.tags : [];
  const knownDriveIds = options.knownDriveIds instanceof Set ? options.knownDriveIds : new Set();
  const makePublic = options.makePublic !== false;

  const driveFileId = String(file?.id || '').trim();
  const fileName = String(file?.name || '').trim() || 'image';
  const mimeType = String(file?.mimeType || 'image/jpeg').trim();
  const sizeBytes = Math.max(0, Number(file?.sizeBytes || 0) || 0);
  const imageWidth = Math.max(0, Number(file?.imageWidth || 0) || 0);
  const imageHeight = Math.max(0, Number(file?.imageHeight || 0) || 0);
  const location = String(file?.location || '').trim()
    || `https://drive.google.com/file/d/${driveFileId}/view`;

  if (!driveFileId) {
    return { ok: false, fileName, error: 'Drive file id is missing' };
  }

  if (knownDriveIds.has(driveFileId)) {
    return { ok: true, fileName, skipped: true, reason: 'already_imported' };
  }

  if (sizeBytes > MAX_DRIVE_IMPORT_FILE_BYTES) {
    return {
      ok: false,
      fileName,
      error: `File exceeds import size limit (${Math.round(MAX_DRIVE_IMPORT_FILE_BYTES / (1024 * 1024))}MB)`,
    };
  }

  if (makePublic) {
    const tokenRes = await getAccessToken();
    if (tokenRes.ok) {
      await makeFilePublic(tokenRes.data.accessToken, driveFileId);
    }
  }

  const aspect = inferAspectFromDimensions(imageWidth, imageHeight);

  const save = await createAsset(
    {
      assetName: fileName,
      assetType: 'Image',
      category,
      location,
      tags,
      size: sizeBytes,
      imageWidth: imageWidth || null,
      imageHeight: imageHeight || null,
      aspect,
    },
    scope
  );

  if (!save.ok) {
    return { ok: false, fileName, error: save.error || 'Failed to save asset record' };
  }

  const createdRow = Array.isArray(save.data) ? save.data[0] : save.data;
  const assetId = Number(createdRow?.id || 0) || 0;
  if (!assetId) {
    return { ok: false, fileName, error: 'Asset record was not returned after create' };
  }

  knownDriveIds.add(driveFileId);

  const thumbRes = await attachThumbnailForDriveAsset({
    assetId,
    assetName: fileName,
    driveFileId,
    mimeType,
    scope,
  });

  if (thumbRes.ok && thumbRes.asset) {
    return {
      ok: true,
      fileName,
      asset: thumbRes.asset,
      aspect,
      thumbnailGenerated: true,
    };
  }

  return {
    ok: true,
    fileName,
    asset: rowToAsset(createdRow),
    aspect,
    thumbnailGenerated: false,
    thumbnailError: thumbRes.error || 'Thumbnail step failed',
  };
}

/**
 * Import images from a Google Drive folder URL (direct children only).
 */
async function importDriveFolderImages(input, scope = null) {
  const folderUrl = String(input.folderUrl || input.folder_url || '').trim();
  const category = String(input.category || '').trim();
  const tags = Array.isArray(input.tags) ? input.tags : [];
  const limit = Math.max(1, Math.min(MAX_FOLDER_IMPORT_FILES, Number(input.limit || MAX_FOLDER_IMPORT_FILES) || MAX_FOLDER_IMPORT_FILES));

  if (!isGoogleDriveConfigured()) {
    return {
      ok: false,
      status: 400,
      error: 'Google Drive credentials are not configured in Settings > APIs or environment variables.',
    };
  }

  if (!isAssetStorageConfigured()) {
    return {
      ok: false,
      status: 400,
      error: 'No asset storage backend is configured. Configure Vercel Blob or Google Drive for thumbnails.',
    };
  }

  const folderId = extractDriveFolderIdFromUrl(folderUrl);
  if (!folderId) {
    return {
      ok: false,
      status: 400,
      error: 'Could not extract a folder id from the Google Drive folder URL',
    };
  }

  const folderMeta = await getFolderMetadataById(folderId);
  if (!folderMeta.ok) {
    return { ok: false, status: folderMeta.status || 500, error: folderMeta.error || 'Could not read folder' };
  }

  const listRes = await listImageFilesInFolder(folderId, { limit });
  if (!listRes.ok) {
    return { ok: false, status: listRes.status || 500, error: listRes.error || 'Could not list folder images' };
  }

  const files = Array.isArray(listRes.data.files) ? listRes.data.files : [];
  if (!files.length) {
    return {
      ok: true,
      status: 200,
      data: {
        folderId,
        folderName: folderMeta.data.name || '',
        discovered: 0,
        imported: 0,
        skipped: 0,
        failed: 0,
        results: [],
      },
    };
  }

  const assetsRes = await listAssets(scope);
  if (!assetsRes.ok) {
    return { ok: false, status: assetsRes.status || 500, error: assetsRes.error || 'Could not load existing assets' };
  }

  const knownDriveIds = buildKnownDriveFileIds(
    (Array.isArray(assetsRes.data) ? assetsRes.data : []).map(rowToAsset).filter(Boolean)
  );

  const results = [];
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let thumbnailCount = 0;

  for (const file of files) {
    const outcome = await importDriveImageFile(file, {
      scope,
      category,
      tags,
      knownDriveIds,
    });

    if (outcome.skipped) {
      skipped += 1;
      results.push({
        fileName: outcome.fileName,
        ok: true,
        skipped: true,
        reason: outcome.reason || 'already_imported',
      });
      continue;
    }

    if (!outcome.ok) {
      failed += 1;
      results.push({
        fileName: outcome.fileName,
        ok: false,
        error: outcome.error || 'Import failed',
      });
      continue;
    }

    imported += 1;
    if (outcome.thumbnailGenerated) thumbnailCount += 1;
    results.push({
      fileName: outcome.fileName,
      ok: true,
      asset: outcome.asset,
      aspect: outcome.aspect,
      thumbnailGenerated: Boolean(outcome.thumbnailGenerated),
      thumbnailError: outcome.thumbnailError || '',
    });
  }

  return {
    ok: true,
    status: 200,
    data: {
      folderId,
      folderName: folderMeta.data.name || '',
      discovered: files.length,
      imported,
      skipped,
      failed,
      thumbnailCount,
      results,
    },
  };
}

module.exports = {
  MAX_FOLDER_IMPORT_FILES,
  importDriveFolderImages,
  importDriveImageFile,
};
