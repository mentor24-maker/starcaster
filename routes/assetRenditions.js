'use strict';

/**
 * The scaled-copies sweep, driven from the Images page.
 *
 * Two endpoints on purpose. Generating copies takes several seconds per image —
 * the 165-image backfill ran for about a quarter of an hour — and a serverless
 * function is killed long before that. So the browser asks what is outstanding,
 * then works through it a few at a time, and the progress bar is real rather
 * than a spinner hiding a request that is about to be cut off.
 *
 *   GET  /api/assets/renditions/status    what still needs copies, and how heavy
 *   POST /api/assets/renditions/generate  build copies for a handful of ids
 *
 * Everything is scoped to the caller's active project.
 */

const { sendOk, sendErr, parseJsonBody } = require('./http');
const { sbQuery, tableConfig } = require('../lib/supabase');
const { rowToAsset, updateAsset } = require('../lib/assetsStore');
const { fetchAssetImageBuffer } = require('../lib/assetImageBytes');
const { isOversizedImage, buildRenditionPatchForAsset } = require('../lib/assetRenditions');
const { isConfigured: isBlobConfigured } = require('../lib/blobStorage');
const { checkEndpointLimit } = require('../lib/rateLimiter');

/**
 * How many images one POST will process. Each is a download, four or five
 * resizes, and as many uploads.
 *
 * Measured: a batch of four originals averaging 750 KB took 15 seconds, against
 * the 300-second function limit in vercel.json — so the ceiling is not what
 * sets this number. Four does, because it is how often the progress bar moves
 * and how much work is lost if one request fails. Raise it and the sweep looks
 * frozen for longer; lower it and the per-request overhead starts to dominate.
 */
const MAX_BATCH = 4;

// Named columns, never `select=*`: a few rows in this table hold multi-MB
// base64 payloads in `location`, and selecting everything times out.
const SCAN_COLUMNS =
  'id,asset_name,asset_type,category,location,size,image_width,image_height,aspect,renditions';

function projectIdFrom(req) {
  return String(req?.projectContext?.project?.id || '').trim();
}

async function loadProjectImages(projectId) {
  return sbQuery({
    table: tableConfig().assets,
    query:
      `select=${SCAN_COLUMNS}&asset_type=eq.Image` +
      `&project_id=eq.${encodeURIComponent(projectId)}&limit=5000`,
  });
}

function pendingFrom(assets) {
  return assets.filter((asset) => !(asset.renditions || []).length && isOversizedImage(asset));
}

async function handleStatus(req, res) {
  const projectId = projectIdFrom(req);
  if (!projectId) return sendErr(res, 400, 'No active project', { code: 'PROJECT_REQUIRED' }), true;

  const result = await loadProjectImages(projectId);
  if (!result.ok) {
    // The migration not having run is the one failure worth naming exactly —
    // "column does not exist" from PostgREST tells the operator nothing.
    const missingColumn = /renditions/i.test(String(result.error || '')) && /column|schema/i.test(String(result.error || ''));
    return sendErr(
      res,
      result.status || 500,
      missingColumn
        ? 'The image copies feature is not set up on this database yet — docs/SQL/assets_renditions.sql has not been run.'
        : result.error || 'Could not read the image library',
      { code: missingColumn ? 'RENDITIONS_NOT_INSTALLED' : 'ASSETS_READ_FAILED' }
    ), true;
  }

  const assets = (Array.isArray(result.data) ? result.data : []).map(rowToAsset).filter(Boolean);
  const pending = pendingFrom(assets);
  const withCopies = assets.filter((asset) => (asset.renditions || []).length);

  return sendOk(res, 200, {
    storageReady: isBlobConfigured(),
    totalImages: assets.length,
    pendingCount: pending.length,
    pendingBytes: pending.reduce((sum, asset) => sum + (Number(asset.size) || 0), 0),
    doneCount: withCopies.length,
    batchSize: MAX_BATCH,
    // Smallest first: the quickest images finish early, so the progress bar
    // moves straight away instead of stalling on a 2.5 MB original.
    pendingIds: pending
      .slice()
      .sort((a, b) => (Number(a.size) || 0) - (Number(b.size) || 0))
      .map((asset) => asset.id),
  }), true;
}

async function handleGenerate(req, res) {
  const projectId = projectIdFrom(req);
  if (!projectId) return sendErr(res, 400, 'No active project', { code: 'PROJECT_REQUIRED' }), true;

  if (checkEndpointLimit(req, res, 'assets.renditions')) return true;

  if (!isBlobConfigured()) {
    return sendErr(res, 400, 'File storage is not configured, so copies cannot be saved', {
      code: 'STORAGE_NOT_CONFIGURED',
    }), true;
  }

  const body = await parseJsonBody(req);
  const requestedIds = Array.isArray(body?.ids) ? body.ids : [];
  const ids = [...new Set(requestedIds.map((value) => Number(value) || 0).filter((value) => value > 0))]
    .slice(0, MAX_BATCH);
  if (!ids.length) {
    return sendErr(res, 400, 'Send one or more image ids to process', { code: 'VALIDATION_ERROR' }), true;
  }

  // Re-read inside the project scope rather than trusting the ids on the wire —
  // an id from another tenant must not be processed just because it was asked for.
  const scan = await sbQuery({
    table: tableConfig().assets,
    query:
      `select=${SCAN_COLUMNS}&asset_type=eq.Image` +
      `&project_id=eq.${encodeURIComponent(projectId)}` +
      `&id=in.(${ids.join(',')})&limit=${MAX_BATCH}`,
  });
  if (!scan.ok) {
    return sendErr(res, scan.status || 500, scan.error || 'Could not read those images'), true;
  }

  const assets = (Array.isArray(scan.data) ? scan.data : []).map(rowToAsset).filter(Boolean);
  const results = [];

  for (const asset of assets) {
    const media = await fetchAssetImageBuffer(asset);
    if (!media.ok) {
      results.push({ id: asset.id, ok: false, error: media.error || 'Could not download the image' });
      continue;
    }

    const built = await buildRenditionPatchForAsset(asset, media.data.buffer);
    if (!built.ok) {
      results.push({ id: asset.id, ok: false, error: built.error });
      continue;
    }

    const saved = await updateAsset(asset.id, built.patch, { projectId });
    if (!saved.ok) {
      results.push({ id: asset.id, ok: false, error: saved.error || 'Could not save the copies' });
      continue;
    }

    // An image the library recorded as unmeasured turns out to be small. Its
    // real dimensions are now stored, so it drops out of the pending list
    // instead of being downloaded again on every sweep.
    if (!built.built) {
      results.push({
        id: asset.id,
        ok: true,
        measuredOnly: true,
        name: asset.assetName,
        originalBytes: built.bytes,
        copyBytes: built.bytes,
        widths: [],
      });
      continue;
    }

    results.push({
      id: asset.id,
      ok: true,
      name: asset.assetName,
      originalBytes: built.bytes,
      copyBytes: built.totalBytes,
      widths: built.renditions.map((item) => item.w),
    });
  }

  // Ids that vanished between the scan and now (deleted mid-sweep) are reported
  // rather than dropped, so the browser can stop asking for them.
  const handled = new Set(results.map((item) => item.id));
  for (const id of ids) {
    if (!handled.has(id)) results.push({ id, ok: false, error: 'That image is no longer in this project' });
  }

  return sendOk(res, 200, { results }), true;
}

async function handle(req, res, pathname, method) {
  const normalizedPath = String(pathname || '').replace(/\/+$/, '') || '/';
  const requestMethod = String(method || '').toUpperCase();

  if (normalizedPath === '/api/assets/renditions/status' && requestMethod === 'GET') {
    return handleStatus(req, res);
  }
  if (normalizedPath === '/api/assets/renditions/generate' && requestMethod === 'POST') {
    return handleGenerate(req, res);
  }

  return false;
}

const manifest = {
  id: 'assetRenditions',
  label: 'Asset image copies',
  prefixes: ['/api/assets/renditions'],
};

module.exports = { handle, manifest, MAX_BATCH };
