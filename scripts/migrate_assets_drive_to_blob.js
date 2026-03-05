'use strict';

try { require('dotenv').config(); } catch (_) {}

const { listAssets, rowToAsset, updateAsset } = require('../lib/assetsStore');
const { fetchDriveFileMedia } = require('../lib/googleDrive');
const { isConfigured: isBlobConfigured, uploadBufferToBlob } = require('../lib/blobStorage');

function extractDriveId(url) {
  const text = String(url || '').trim();
  if (!text) return '';
  const byProxy = text.match(/\/api\/assets\/drive-file\/([a-zA-Z0-9_-]{10,})/);
  if (byProxy) return byProxy[1];
  const byPath = text.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (byPath) return byPath[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(text)) return text;
  try {
    const u = new URL(text);
    return u.searchParams.get('id') || '';
  } catch {
    return '';
  }
}

function cleanName(name, fallbackExt = '') {
  const base = String(name || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 160);
  if (!base) return `asset_${Date.now()}${fallbackExt}`;
  return base;
}

function usage() {
  console.log('Usage: node scripts/migrate_assets_drive_to_blob.js [--apply] [--limit=100]');
}

async function run() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    usage();
    return;
  }
  const apply = args.includes('--apply');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = Math.max(1, Number((limitArg || '').split('=')[1] || 5000) || 5000);

  if (!isBlobConfigured()) {
    console.error('[migrate] BLOB_READ_WRITE_TOKEN is not configured.');
    process.exitCode = 1;
    return;
  }

  const assetsRes = await listAssets();
  if (!assetsRes.ok) {
    console.error('[migrate] Could not load assets:', assetsRes.status, assetsRes.error);
    process.exitCode = 1;
    return;
  }

  const assets = (Array.isArray(assetsRes.data) ? assetsRes.data : [])
    .map(rowToAsset)
    .filter(Boolean)
    .slice(0, limit);

  const candidates = assets.filter((asset) => {
    const location = String(asset.location || '').trim();
    if (!location) return false;
    if (location.includes('.public.blob.vercel-storage.com')) return false;
    return Boolean(extractDriveId(location));
  });

  console.log(`[migrate] mode=${apply ? 'APPLY' : 'DRY_RUN'} total=${assets.length} drive_candidates=${candidates.length}`);

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const asset of candidates) {
    const id = Number(asset.id || 0) || 0;
    const driveId = extractDriveId(asset.location);
    if (!id || !driveId) {
      skipped += 1;
      continue;
    }

    const media = await fetchDriveFileMedia(driveId);
    if (!media.ok) {
      failed += 1;
      console.error(`[migrate] FAIL fetch id=${id} driveId=${driveId} err=${media.error}`);
      continue;
    }

    const ext = String(media.data.contentType || '').includes('png') ? '.png'
      : String(media.data.contentType || '').includes('gif') ? '.gif'
      : String(media.data.contentType || '').includes('webp') ? '.webp'
      : String(media.data.contentType || '').includes('svg') ? '.svg'
      : String(media.data.contentType || '').includes('pdf') ? '.pdf'
      : '.jpg';

    const fileName = cleanName(asset.assetName, ext).endsWith(ext)
      ? cleanName(asset.assetName, ext)
      : `${cleanName(asset.assetName, '')}${ext}`;

    if (!apply) {
      migrated += 1;
      console.log(`[migrate] DRY id=${id} ${asset.assetName} -> ${fileName}`);
      continue;
    }

    const upload = await uploadBufferToBlob({
      assetType: asset.assetType || 'Image',
      category: asset.category || '',
      fileName,
      mimeType: media.data.contentType || 'application/octet-stream',
      fileBuffer: media.data.buffer,
    });
    if (!upload.ok) {
      failed += 1;
      console.error(`[migrate] FAIL upload id=${id} err=${upload.error}`);
      continue;
    }

    const patch = {
      location: upload.data.location,
      size: Math.max(0, Number(asset.size || 0) || upload.data.sizeBytes || 0),
    };
    const updated = await updateAsset(id, patch);
    if (!updated.ok) {
      failed += 1;
      console.error(`[migrate] FAIL update id=${id} err=${updated.error}`);
      continue;
    }
    migrated += 1;
    console.log(`[migrate] OK id=${id} -> ${upload.data.location}`);
  }

  console.log(`[migrate] complete migrated=${migrated} skipped=${skipped} failed=${failed}`);
  if (failed) process.exitCode = 2;
}

run().catch((err) => {
  console.error('[migrate] fatal:', err?.message || err);
  process.exitCode = 1;
});

