'use strict';

const { inferAspectFromDimensions, normalizeAspect } = require('./assetAspect');
const { readImageDimensionsFromBuffer } = require('./assetImageDimensions');
const { generateThumbnailJpeg, DEFAULT_MAX_EDGE } = require('./assetThumbnail');
const { uploadAssetFile } = require('./assetStorage');
const { createAsset, updateAsset, rowToAsset } = require('./assetsStore');

function cleanAssetName(name, fallback = 'image') {
  const base = String(name || fallback)
    .trim()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  return base || fallback;
}

function resolveDimensions(uploadData, buffer) {
  const fromUpload = {
    width: Math.max(0, Number(uploadData?.imageWidth || 0) || 0),
    height: Math.max(0, Number(uploadData?.imageHeight || 0) || 0),
  };
  if (fromUpload.width > 0 && fromUpload.height > 0) {
    return fromUpload;
  }
  return readImageDimensionsFromBuffer(buffer);
}

/**
 * Upload one image, assign aspect from full-size dimensions, generate and attach thumbnail.
 */
async function importImageAssetWithThumbnail(input, scope = null) {
  const fileName = String(input.fileName || '').trim();
  const mimeType = String(input.mimeType || 'image/jpeg').trim();
  const fileBase64 = String(input.fileBase64 || '').trim();
  const category = String(input.category || '').trim();
  const assetName = String(input.assetName || fileName || '').trim() || fileName;
  const tags = Array.isArray(input.tags) ? input.tags : [];
  const maxEdge = Math.max(64, Number(input.maxEdge || DEFAULT_MAX_EDGE) || DEFAULT_MAX_EDGE);
  const skipThumbnail = Boolean(input.skipThumbnail);

  if (!fileName || !fileBase64) {
    return { ok: false, status: 400, error: 'fileName and fileBase64 are required' };
  }

  let buffer;
  try {
    buffer = Buffer.from(fileBase64, 'base64');
  } catch {
    return { ok: false, status: 400, error: 'fileBase64 is not valid base64 content' };
  }

  if (!buffer.length) {
    return { ok: false, status: 400, error: 'Uploaded file is empty' };
  }

  const upload = await uploadAssetFile({
    assetType: 'Image',
    category,
    fileName,
    mimeType,
    fileBase64,
    makePublic: true,
  });
  if (!upload.ok) {
    return { ok: false, status: upload.status || 500, error: upload.error || 'Image upload failed' };
  }

  const { width: imageWidth, height: imageHeight } = resolveDimensions(upload.data, buffer);
  const aspectOverride = normalizeAspect(input.aspect);
  const aspect = aspectOverride || inferAspectFromDimensions(imageWidth, imageHeight);

  const save = await createAsset(
    {
      assetName,
      assetType: 'Image',
      category,
      location: String(upload.data.location || '').trim(),
      tags,
      size: Math.max(0, Number(upload.data.sizeBytes || buffer.length) || 0),
      imageWidth: imageWidth || null,
      imageHeight: imageHeight || null,
      aspect,
    },
    scope
  );
  if (!save.ok) {
    return { ok: false, status: save.status || 500, error: save.error || 'Failed to save asset record' };
  }

  const createdRow = Array.isArray(save.data) ? save.data[0] : save.data;
  const assetId = Number(createdRow?.id || 0) || 0;
  if (!assetId) {
    return { ok: false, status: 500, error: 'Asset record was not returned after create' };
  }

  let thumbnailGenerated = false;
  let thumbnailError = '';

  if (!skipThumbnail) {
    const thumb = await generateThumbnailJpeg(buffer, { maxEdge, mimeType });
    if (!thumb.ok) {
      thumbnailError = thumb.error || 'Thumbnail generation failed';
    } else {
      const thumbUpload = await uploadAssetFile({
        assetType: 'Image',
        category: 'Asset Thumbnail',
        fileName: `${cleanAssetName(assetName, `asset_${assetId}`)}_thumb.jpg`,
        mimeType: 'image/jpeg',
        fileBase64: thumb.data.buffer.toString('base64'),
        makePublic: true,
      });

      if (!thumbUpload.ok) {
        thumbnailError = thumbUpload.error || 'Thumbnail upload failed';
      } else {
        const thumbLocation = String(thumbUpload.data.location || '').trim();
        if (!thumbLocation) {
          thumbnailError = 'Thumbnail upload did not return a location';
        } else {
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
            thumbnailError = updated.error || 'Failed to save thumbnail metadata';
          } else {
            thumbnailGenerated = true;
            const updatedRow = Array.isArray(updated.data) ? updated.data[0] : updated.data;
            return {
              ok: true,
              status: 201,
              data: {
                asset: rowToAsset(updatedRow || createdRow),
                aspect,
                thumbnailGenerated,
                thumbnailError: thumbnailError || undefined,
              },
            };
          }
        }
      }
    }
  }

  return {
    ok: true,
    status: 201,
    data: {
      asset: rowToAsset(createdRow),
      aspect,
      thumbnailGenerated,
      thumbnailError: thumbnailError || undefined,
    },
  };
}

module.exports = {
  importImageAssetWithThumbnail,
};
