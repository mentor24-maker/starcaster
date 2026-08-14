#!/usr/bin/env node
'use strict';

/**
 * Generate scaled-down copies of every oversized image in the gallery.
 *
 * For each image whose long edge is 1200px or more (or, when the dimensions
 * were never recorded, whose file is over 400 KB) this downloads the original,
 * builds the 300 / 600 / 1200 / full ladder plus a 1200-wide JPEG for social
 * media, uploads them, and records them on the asset row.
 *
 * The original file and row are never touched. Re-running is safe: rendition
 * paths are deterministic, so a second run overwrites rather than duplicates,
 * and images that already have renditions are skipped unless --force.
 *
 * Usage:
 *   node scripts/generate_asset_renditions.js                 # dry run, shows what would happen
 *   node scripts/generate_asset_renditions.js --limit=5 --apply
 *   node scripts/generate_asset_renditions.js --apply         # the whole backlog
 */

const path = require('path');

// .env.local is where this project's credentials actually live; plain .env does
// not exist here. The thumbnail script loads only `.env` and has therefore been
// unable to reach the database at all — don't repeat that.
//
// .env.local also flips between a LOCAL Supabase and the cloud one, and the
// local database holds almost none of the real gallery. Getting that backwards
// means a run that reports success against the wrong data, so the database
// being targeted is printed on every run and --env-file= switches it.
const envFileArg = process.argv.slice(2).find((arg) => arg.startsWith('--env-file='));
try {
  const dotenv = require('dotenv');
  if (envFileArg) {
    dotenv.config({ path: path.resolve(process.cwd(), envFileArg.slice('--env-file='.length)) });
  }
  dotenv.config({ path: path.join(__dirname, '..', '.env.local') });
  dotenv.config({ path: path.join(__dirname, '..', '.env') });
} catch (_) {}

function describeTarget() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  if (!url) return 'no SUPABASE_URL set';
  const isLocal = /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(url);
  return `${url} ${isLocal ? '(LOCAL database)' : '(CLOUD — this is the live gallery)'}`;
}

const { rowToAsset, updateAsset } = require('../lib/assetsStore');
const { isConfigured: isBlobConfigured } = require('../lib/blobStorage');
const { sbQuery, tableConfig } = require('../lib/supabase');
const { fetchAssetImageBuffer } = require('../lib/assetImageBytes');
const {
  isOversizedImage,
  buildRenditionPatchForAsset,
  OVERSIZED_MIN_EDGE,
  OVERSIZED_MIN_BYTES,
} = require('../lib/assetRenditions');

function usage() {
  console.log([
    'Usage: node scripts/generate_asset_renditions.js [options]',
    '',
    'Options:',
    '  --apply            Generate, upload, and save. Default is a dry run.',
    '  --force            Rebuild images that already have renditions.',
    '  --limit=N          Process at most N images.',
    '  --min-edge=N       Long-edge threshold in pixels. Default: ' + OVERSIZED_MIN_EDGE + '.',
    '  --min-kb=N         Size threshold for images with no recorded dimensions. Default: ' +
      Math.round(OVERSIZED_MIN_BYTES / 1024) + '.',
    '  --id=N             Just this one asset id (repeatable, or comma-separated).',
    '  --env-file=PATH    Credentials to use, e.g. .env.local.cloud-backup for the live gallery.',
    '  --help             Show this help.',
  ].join('\n'));
}

function numberArg(args, name, fallback) {
  const entry = args.find((arg) => arg.startsWith(`${name}=`));
  if (!entry) return fallback;
  const value = Number(entry.split('=').slice(1).join('='));
  return Number.isFinite(value) ? value : fallback;
}

function idArgs(args) {
  const ids = new Set();
  for (const arg of args) {
    if (!arg.startsWith('--id=')) continue;
    for (const part of arg.slice('--id='.length).split(',')) {
      const value = Number(part.trim());
      if (Number.isFinite(value) && value > 0) ids.add(value);
    }
  }
  return ids;
}

function mb(bytes) {
  return `${(Number(bytes || 0) / 1048576).toFixed(1)} MB`;
}

function kb(bytes) {
  return `${Math.round(Number(bytes || 0) / 1024)} KB`;
}

/**
 * Fail loudly and early if the migration has not run. Without this the first
 * --apply writes look like they succeed and quietly change nothing.
 */
async function ensureRenditionColumns() {
  const res = await sbQuery({
    table: tableConfig().assets,
    query: 'select=renditions,renditions_generated_at&limit=1',
  });
  if (res.ok) return { ok: true };
  return {
    ok: false,
    error: `${res.error || 'the renditions columns are missing'} — run docs/SQL/assets_renditions.sql first.`,
  };
}

/**
 * Load the image rows, naming the columns instead of `select=*`.
 *
 * Not a micro-optimisation — a plain `select=*` on this table times out. Three
 * rows (ids 206-208) are failed video generations whose `location` holds the
 * raw ~9.7 MB base64 API response instead of a URL, so asking for every column
 * drags ~30 MB through PostgREST and blows the 10-second limit. Naming columns
 * skips those rows' payload entirely. (`lib/assetsStore.listAssets` still does
 * `select=*` and still times out — that is a separate bug worth fixing, since
 * the Assets page and the asset picker both call it.)
 */
async function loadImageAssets() {
  const base =
    'id,asset_name,asset_type,category,location,size,image_width,image_height,aspect,' +
    'thumbnail_location,thumbnail_width,thumbnail_height,project_id';

  let res = await sbQuery({
    table: tableConfig().assets,
    query: `select=${base},renditions,renditions_generated_at&asset_type=eq.Image&limit=5000`,
  });
  if (res.ok) return res;

  // The migration may not have run yet; a dry run should still be able to
  // report what it would do.
  const fallback = await sbQuery({
    table: tableConfig().assets,
    query: `select=${base}&asset_type=eq.Image&limit=5000`,
  });
  if (fallback.ok) {
    console.warn('[renditions] note: the renditions columns are not in this database yet (dry run only).');
  }
  return fallback;
}

async function run() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    usage();
    return;
  }

  const apply = args.includes('--apply');
  const force = args.includes('--force');
  const limit = Math.max(1, numberArg(args, '--limit', 10000));
  const minEdge = Math.max(1, numberArg(args, '--min-edge', OVERSIZED_MIN_EDGE));
  const minBytes = Math.max(1, numberArg(args, '--min-kb', OVERSIZED_MIN_BYTES / 1024)) * 1024;
  const onlyIds = idArgs(args);

  console.log(`[renditions] database: ${describeTarget()}`);

  if (!isBlobConfigured()) {
    console.error('[renditions] BLOB_READ_WRITE_TOKEN is not set. Check .env.local.');
    process.exitCode = 1;
    return;
  }

  if (apply) {
    const schema = await ensureRenditionColumns();
    if (!schema.ok) {
      console.error(`[renditions] ${schema.error}`);
      process.exitCode = 1;
      return;
    }
  }

  const assetsRes = await loadImageAssets();
  if (!assetsRes.ok) {
    console.error('[renditions] Could not load assets:', assetsRes.status, assetsRes.error);
    process.exitCode = 1;
    return;
  }

  const assets = (Array.isArray(assetsRes.data) ? assetsRes.data : []).map(rowToAsset).filter(Boolean);
  const candidates = assets
    .filter((asset) => (onlyIds.size ? onlyIds.has(asset.id) : isOversizedImage(asset, { minEdge, minBytes })))
    .filter((asset) => force || !(asset.renditions || []).length)
    .slice(0, limit);

  const originalBytes = candidates.reduce((sum, a) => sum + (Number(a.size) || 0), 0);
  console.log(
    `[renditions] mode=${apply ? 'APPLY' : 'DRY RUN'} images=${assets.length} ` +
      `to process=${candidates.length} originals=${mb(originalBytes)}`
  );

  if (!apply) {
    for (const asset of candidates) {
      const dims = asset.imageWidth && asset.imageHeight ? `${asset.imageWidth}x${asset.imageHeight}` : 'size unknown';
      console.log(`[renditions] would build id=${asset.id} ${asset.assetName} (${dims}, ${kb(asset.size)})`);
    }
    console.log('[renditions] Nothing was changed. Add --apply to generate them.');
    return;
  }

  let built = 0;
  let measured = 0;
  let failed = 0;
  let newBytes = 0;

  for (const asset of candidates) {
    const media = await fetchAssetImageBuffer(asset);
    if (!media.ok) {
      failed += 1;
      console.error(`[renditions] FAIL id=${asset.id} ${asset.assetName}: ${media.error || 'could not download'}`);
      continue;
    }

    const result = await buildRenditionPatchForAsset(asset, media.data.buffer, { minEdge, minBytes });
    if (!result.ok) {
      failed += 1;
      console.error(`[renditions] FAIL id=${asset.id} ${asset.assetName}: ${result.error}`);
      continue;
    }

    const saved = await updateAsset(asset.id, result.patch);
    if (!saved.ok) {
      failed += 1;
      console.error(`[renditions] FAIL id=${asset.id} ${asset.assetName}: save failed — ${saved.error}`);
      continue;
    }

    // Downloaded, measured, and genuinely small. The recorded dimensions mean
    // it will not be downloaded again.
    if (!result.built) {
      measured += 1;
      console.log(
        `[renditions] small id=${asset.id} ${asset.assetName} — ${result.width}x${result.height}, ` +
          `${kb(result.bytes)}; no copies needed`
      );
      continue;
    }

    built += 1;
    newBytes += result.totalBytes;
    const sizes = result.renditions.map((r) => `${r.w}${r.format === 'jpeg' ? 'j' : ''}`).join('/');
    console.log(
      `[renditions] OK id=${asset.id} ${asset.assetName} -> ${sizes} ` +
        `(${kb(result.bytes)} original, ${kb(result.totalBytes)} of copies)`
    );
  }

  console.log(
    `[renditions] done built=${built} already-small=${measured} failed=${failed} new storage=${mb(newBytes)}`
  );
  if (failed) process.exitCode = 2;
}

run().catch((err) => {
  console.error('[renditions] fatal:', err?.message || err);
  process.exitCode = 1;
});
