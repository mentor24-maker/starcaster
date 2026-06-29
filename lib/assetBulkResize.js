'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SIPS_PATH = '/usr/bin/sips';

let sharpModule = null;
let sharpLoadAttempted = false;

function loadSharp() {
  if (sharpLoadAttempted) return sharpModule;
  sharpLoadAttempted = true;
  try { sharpModule = require('sharp'); } catch { sharpModule = null; }
  return sharpModule;
}

function extensionFromMime(mimeType) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('gif')) return '.gif';
  return '.jpg';
}

async function resizeWithSharp(buffer, { width, height, fit }) {
  const sharp = loadSharp();
  if (!sharp) return { ok: false, error: 'sharp not available' };
  try {
    const result = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize({
        width: width || undefined,
        height: height || undefined,
        fit: fit || 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return {
      ok: true,
      data: {
        buffer: result.data,
        width: result.info.width,
        height: result.info.height,
        mimeType: 'image/jpeg',
      },
    };
  } catch (err) {
    return { ok: false, error: err.message || 'sharp resize failed' };
  }
}

function resizeWithSips(buffer, { width, height, mimeType }) {
  if (process.platform !== 'darwin' || !fs.existsSync(SIPS_PATH)) {
    return { ok: false, error: 'Resize requires sharp or macOS sips' };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-resize-'));
  try {
    const srcPath = path.join(dir, `src${extensionFromMime(mimeType)}`);
    const dstPath = path.join(dir, 'out.jpg');
    fs.writeFileSync(srcPath, buffer);
    const args = ['-s', 'format', 'jpeg', '-s', 'formatOptions', '88'];
    if (width && height) {
      args.push('-z', String(height), String(width));
    } else if (width) {
      args.push('--resampleWidth', String(width));
    } else {
      args.push('--resampleHeight', String(height));
    }
    args.push(srcPath, '--out', dstPath);
    const res = spawnSync(SIPS_PATH, args, { encoding: 'utf8' });
    if (res.status !== 0) {
      return { ok: false, error: (res.stderr || res.stdout || 'sips failed').trim() };
    }
    const outBuffer = fs.readFileSync(dstPath);
    const dimRes = spawnSync(SIPS_PATH, ['-g', 'pixelWidth', '-g', 'pixelHeight', dstPath], { encoding: 'utf8' });
    const out = `${dimRes.stdout}\n${dimRes.stderr}`;
    const w = Number(out.match(/pixelWidth:\s*(\d+)/)?.[1] || 0) || 0;
    const h = Number(out.match(/pixelHeight:\s*(\d+)/)?.[1] || 0) || 0;
    return { ok: true, data: { buffer: outBuffer, width: w, height: h, mimeType: 'image/jpeg' } };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function resizeImageBuffer(buffer, { width, height, fit = 'inside', mimeType = 'image/jpeg' }) {
  const result = await resizeWithSharp(buffer, { width, height, fit });
  if (result.ok) return result;
  if (fit !== 'inside') {
    return { ok: false, error: `Cover/fill resize requires the sharp module (${result.error})` };
  }
  return resizeWithSips(buffer, { width, height, mimeType });
}

async function resizeOneAsset(id, { width, height, fit }, scope) {
  const { getAssetById, rowToAsset, createAsset } = require('./assetsStore');
  const { fetchAssetImageBuffer } = require('./assetImageBytes');
  const { generateThumbnailJpeg } = require('./assetThumbnail');
  const { uploadAssetFile } = require('./assetStorage');
  const { inferAspectFromDimensions } = require('./assetAspect');

  const existing = await getAssetById(id, scope);
  if (!existing.ok) return { id, ok: false, error: existing.error || 'Asset not found' };
  const row = existing.data;
  if (String(row.asset_type || '').trim() !== 'Image') {
    return { id, ok: false, error: 'Not an image asset' };
  }

  const asset = rowToAsset(row);
  const media = await fetchAssetImageBuffer(asset);
  if (!media.ok) return { id, ok: false, error: media.error || 'Could not load image' };

  const resized = await resizeImageBuffer(media.data.buffer, {
    width,
    height,
    fit,
    mimeType: media.data.contentType || 'image/jpeg',
  });
  if (!resized.ok) return { id, ok: false, error: resized.error };

  const origName = String(asset.assetName || `asset_${id}`);
  const extMatch = origName.match(/(\.[^.]+)$/);
  const ext = extMatch ? extMatch[1] : '';
  const nameBase = ext ? origName.slice(0, -ext.length) : origName;
  const newAssetName = `${nameBase}_${resized.data.width}x${resized.data.height}${ext}`;

  const safeBase = nameBase
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100) || `asset_${id}`;
  const fileName = `${safeBase}_${resized.data.width}x${resized.data.height}.jpg`;
  const fileBase64 = resized.data.buffer.toString('base64');

  const upload = await uploadAssetFile({
    assetType: 'Image',
    category: String(asset.category || '').trim(),
    fileName,
    mimeType: 'image/jpeg',
    fileBase64,
    makePublic: true,
  });
  if (!upload.ok) return { id, ok: false, error: upload.error || 'Upload failed' };

  const aspect = inferAspectFromDimensions(resized.data.width, resized.data.height);
  const newAsset = {
    assetName: newAssetName,
    assetType: 'Image',
    category: String(asset.category || '').trim(),
    tags: Array.isArray(asset.tags) ? asset.tags : [],
    topic: String(asset.topic || '').trim(),
    caption: String(asset.caption || '').trim(),
    comments: String(asset.comments || '').trim(),
    location: String(upload.data.location || '').trim(),
    size: Math.max(0, Number(upload.data.sizeBytes || resized.data.buffer.length) || 0),
    imageWidth: resized.data.width || null,
    imageHeight: resized.data.height || null,
    aspect,
  };

  const thumb = await generateThumbnailJpeg(resized.data.buffer, { mimeType: 'image/jpeg' });
  if (thumb.ok) {
    const thumbUpload = await uploadAssetFile({
      assetType: 'Image',
      category: 'Asset Thumbnail',
      fileName: `${safeBase}_${resized.data.width}x${resized.data.height}_thumb.jpg`,
      mimeType: 'image/jpeg',
      fileBase64: thumb.data.buffer.toString('base64'),
      makePublic: true,
    });
    if (thumbUpload.ok) {
      newAsset.thumbnailLocation = String(thumbUpload.data.location || '').trim();
      newAsset.thumbnailWidth = thumb.data.width || null;
      newAsset.thumbnailHeight = thumb.data.height || null;
      newAsset.thumbnailSize = thumb.data.buffer.length;
      newAsset.thumbnailGeneratedAt = new Date().toISOString();
    }
  }

  const save = await createAsset(newAsset, scope);
  if (!save.ok) return { id, ok: false, error: save.error || 'Failed to create asset' };

  const createdRow = Array.isArray(save.data) ? save.data[0] : save.data;
  return { id, ok: true, asset: rowToAsset(createdRow) };
}

async function bulkResizeImages(assetIds, { width, height, fit = 'inside' }, scope = null) {
  const results = [];
  for (const id of assetIds) {
    results.push(await resizeOneAsset(Number(id), { width, height, fit }, scope));
  }
  return results;
}

module.exports = { bulkResizeImages };
