'use strict';

try { require('dotenv').config(); } catch (_) {}

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { listAssets, rowToAsset, updateAsset } = require('../lib/assetsStore');
const { uploadAssetFile, isConfigured: isAssetStorageConfigured } = require('../lib/assetStorage');
const { fetchDriveFileMedia } = require('../lib/googleDrive');
const { sbQuery, tableConfig } = require('../lib/supabase');

const SIPS_PATH = '/usr/bin/sips';

function usage() {
  console.log([
    'Usage: node scripts/generate_asset_thumbnails.js [options]',
    '',
    'Options:',
    '  --apply              Generate, upload, and save thumbnail metadata. Default is dry-run.',
    '  --force              Regenerate thumbnails even when thumbnail metadata already exists.',
    '  --all                Process all image assets. Default only targets large images.',
    '  --limit=N            Process at most N candidates.',
    '  --max-edge=N         Longest thumbnail edge in pixels. Default: 480.',
    '  --min-edge=N         Large-image threshold in pixels. Default: 900.',
    '  --min-size-kb=N      Large-image size threshold. Default: 250.',
    '  --help               Show this help.',
  ].join('\n'));
}

function getArgValue(args, name, fallback) {
  const entry = args.find((arg) => arg.startsWith(`${name}=`));
  if (!entry) return fallback;
  const value = Number(entry.split('=').slice(1).join('='));
  return Number.isFinite(value) ? value : fallback;
}

function cleanName(name, fallback = 'asset') {
  const base = String(name || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  return base || fallback;
}

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

function extensionFromMime(mimeType) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('gif')) return '.gif';
  if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg';
  return '.img';
}

function parseSipsDimension(output, key) {
  const match = String(output || '').match(new RegExp(`${key}:\\s*(\\d+)`));
  return match ? Number(match[1] || 0) || 0 : 0;
}

function readImageDimensions(filePath) {
  const res = spawnSync(SIPS_PATH, ['-g', 'pixelWidth', '-g', 'pixelHeight', filePath], { encoding: 'utf8' });
  if (res.status !== 0) return { width: 0, height: 0 };
  const output = `${res.stdout || ''}\n${res.stderr || ''}`;
  return {
    width: parseSipsDimension(output, 'pixelWidth'),
    height: parseSipsDimension(output, 'pixelHeight'),
  };
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function inferDimensions(asset) {
  const text = `${asset.assetName || ''} ${asset.location || ''}`;
  const match = text.match(/(?:^|[^0-9])([1-9][0-9]{1,4})\s*x\s*([1-9][0-9]{1,4})(?:[^0-9]|$)/i);
  if (!match) {
    return {
      width: Number(asset.imageWidth || 0) || 0,
      height: Number(asset.imageHeight || 0) || 0,
    };
  }
  return {
    width: Number(match[1] || 0) || 0,
    height: Number(match[2] || 0) || 0,
  };
}

async function fetchAssetBuffer(asset) {
  const location = String(asset.location || '').trim();
  const driveId = extractDriveId(location);
  if (driveId) {
    const media = await fetchDriveFileMedia(driveId);
    if (!media.ok) return media;
    return {
      ok: true,
      status: 200,
      data: {
        buffer: media.data.buffer,
        contentType: media.data.contentType || 'application/octet-stream',
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
      contentType: String(res.headers.get('content-type') || 'application/octet-stream'),
    },
  };
}

function isLargeImage(asset, { minEdge, minSizeBytes }) {
  const { width, height } = inferDimensions(asset);
  const size = Number(asset.size || 0) || 0;
  return Math.max(width, height) >= minEdge || size >= minSizeBytes || (!width && !height && !size);
}

function describeCandidate(asset, { minEdge, minSizeBytes, includeAll, force }) {
  if (String(asset.assetType || '').trim() !== 'Image') return '';
  if (!String(asset.location || '').trim()) return '';
  if (!force && String(asset.thumbnailLocation || '').trim()) return '';
  if (includeAll || isLargeImage(asset, { minEdge, minSizeBytes })) return 'candidate';
  return '';
}

function generateThumbnail({ inputPath, outputPath, maxEdge }) {
  const res = spawnSync(SIPS_PATH, [
    '-s', 'format', 'jpeg',
    '-s', 'formatOptions', '82',
    '-Z', String(maxEdge),
    inputPath,
    '--out', outputPath,
  ], { encoding: 'utf8' });

  if (res.status !== 0) {
    return {
      ok: false,
      error: `${res.stderr || res.stdout || 'sips failed'}`.trim(),
    };
  }
  return { ok: true };
}

async function processAsset(asset, options) {
  const id = Number(asset.id || 0) || 0;
  if (!id) return { ok: false, error: 'Asset id is missing' };

  const media = await fetchAssetBuffer(asset);
  if (!media.ok) return { ok: false, error: media.error || 'Could not fetch asset media' };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'starcaster-thumb-'));
  try {
    const sourcePath = path.join(dir, `source${extensionFromMime(media.data.contentType)}`);
    const outputPath = path.join(dir, 'thumbnail.jpg');
    fs.writeFileSync(sourcePath, media.data.buffer);

    const generated = generateThumbnail({
      inputPath: sourcePath,
      outputPath,
      maxEdge: options.maxEdge,
    });
    if (!generated.ok) return { ok: false, error: generated.error };

    const dimensions = readImageDimensions(outputPath);
    const outputBuffer = fs.readFileSync(outputPath);
    const upload = await uploadAssetFile({
      assetType: 'Image',
      category: 'Asset Thumbnail',
      fileName: `${cleanName(asset.assetName, `asset_${id}`)}_thumb.jpg`,
      mimeType: 'image/jpeg',
      fileBase64: outputBuffer.toString('base64'),
    });
    if (!upload.ok) return { ok: false, error: upload.error || 'Thumbnail upload failed' };

    const location = String(upload.data.location || '').trim();
    if (!location) return { ok: false, error: 'Thumbnail upload did not return a location' };

    const updated = await updateAsset(id, {
      thumbnailLocation: location,
      thumbnailWidth: dimensions.width,
      thumbnailHeight: dimensions.height,
      thumbnailSize: outputBuffer.length,
      thumbnailGeneratedAt: new Date().toISOString(),
    });
    if (!updated.ok) return { ok: false, error: updated.error || 'Asset update failed' };

    return {
      ok: true,
      data: {
        location,
        width: dimensions.width,
        height: dimensions.height,
        size: outputBuffer.length,
      },
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function ensureThumbnailColumns() {
  const res = await sbQuery({
    table: tableConfig().assets,
    query: 'select=thumbnail_location,thumbnail_width,thumbnail_height,thumbnail_size,thumbnail_generated_at&limit=1',
  });
  if (res.ok) return { ok: true };
  return {
    ok: false,
    error: `${res.error || 'thumbnail metadata columns are missing'} Run docs/SQL/assets_thumbnail_metadata.sql before --apply.`,
  };
}

async function run() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    usage();
    return;
  }

  const apply = args.includes('--apply');
  const force = args.includes('--force');
  const includeAll = args.includes('--all');
  const limit = Math.max(1, getArgValue(args, '--limit', 5000));
  const maxEdge = Math.max(120, getArgValue(args, '--max-edge', 480));
  const minEdge = Math.max(maxEdge + 1, getArgValue(args, '--min-edge', 900));
  const minSizeBytes = Math.max(1, getArgValue(args, '--min-size-kb', 250)) * 1024;

  if (!fs.existsSync(SIPS_PATH)) {
    console.error(`[thumbs] ${SIPS_PATH} is not available. This script is intended for local macOS runs.`);
    process.exitCode = 1;
    return;
  }

  if (apply && !isAssetStorageConfigured()) {
    console.error('[thumbs] Asset storage is not configured. Check ASSET_STORAGE_PROVIDER plus Drive or Blob credentials.');
    process.exitCode = 1;
    return;
  }

  if (apply) {
    const schema = await ensureThumbnailColumns();
    if (!schema.ok) {
      console.error(`[thumbs] ${schema.error}`);
      process.exitCode = 1;
      return;
    }
  }

  const assetsRes = await listAssets();
  if (!assetsRes.ok) {
    console.error('[thumbs] Could not load assets:', assetsRes.status, assetsRes.error);
    process.exitCode = 1;
    return;
  }

  const assets = (Array.isArray(assetsRes.data) ? assetsRes.data : [])
    .map(rowToAsset)
    .filter(Boolean);

  const candidates = assets
    .filter((asset) => describeCandidate(asset, { minEdge, minSizeBytes, includeAll, force }))
    .slice(0, limit);

  console.log(`[thumbs] mode=${apply ? 'APPLY' : 'DRY_RUN'} total=${assets.length} candidates=${candidates.length} maxEdge=${maxEdge}`);
  if (!apply) {
    candidates.forEach((asset) => {
      const { width, height } = inferDimensions(asset);
      const sizeKb = Math.round((Number(asset.size || 0) || 0) / 1024);
      console.log(`[thumbs] DRY id=${asset.id} ${asset.assetName} (${width}x${height}, ${sizeKb} KB)`);
    });
    console.log('[thumbs] Dry-run only. Run npm run assets:thumbnails:apply to generate thumbnails.');
    return;
  }

  let generated = 0;
  let failed = 0;
  for (const asset of candidates) {
    const id = Number(asset.id || 0) || 0;
    const result = await processAsset(asset, { maxEdge });
    if (!result.ok) {
      failed += 1;
      console.error(`[thumbs] FAIL id=${id} ${asset.assetName}: ${result.error}`);
      continue;
    }
    generated += 1;
    console.log(`[thumbs] OK id=${id} ${asset.assetName} -> ${result.data.width}x${result.data.height}`);
  }

  console.log(`[thumbs] complete generated=${generated} failed=${failed}`);
  if (failed) process.exitCode = 2;
}

run().catch((err) => {
  console.error('[thumbs] fatal:', err?.message || err);
  process.exitCode = 1;
});
