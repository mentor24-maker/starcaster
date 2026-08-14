'use strict';

/**
 * Scaled-down copies ("renditions") of oversized gallery images.
 *
 * WHY THIS EXISTS
 * The library carries ~135 images at 1200px+ on the long edge, 236 MB of the
 * 307 MB total. Every visitor downloaded the full original no matter how small
 * the slot on the page was — a 2.5 MB PNG to fill a 400px-wide column.
 *
 * THE LADDER
 * Each rung is roughly double the one below, because browsers choose by DEVICE
 * pixels, not CSS pixels: a 600px-wide slot on a phone needs the 1200px file to
 * look sharp. Doubling means the retina case falls out for free.
 *
 *   300  — card grids, blog thumbnails, narrow columns
 *   600  — half and third columns (and the 300 slot on a retina screen)
 *   1200 — full content width (and the 600 slot on a retina screen)
 *   full — the original's own width, re-encoded. This rung is the point: without
 *          it a full-bleed slot falls back to the 2.5 MB PNG and we have saved
 *          nothing. Capped at FULL_RUNG_MAX_WIDTH.
 *
 * Nothing is ever enlarged — a rung wider than the original is skipped, and the
 * `full` rung is the original's own width.
 *
 * WEBP, PLUS ONE JPEG
 * The web rungs are WebP (~30% smaller than JPEG at the same quality). The
 * social copy is JPEG on purpose: the social platforms are still inconsistent
 * about accepting WebP on upload, so `role: "social"` is the file to grab and
 * post. 1200 wide is the platform standard — Facebook and LinkedIn want
 * 1200x630, X wants 1200x675, Instagram is 1080 and downsizes cleanly.
 *
 * Exact social CROPS (square, 4:5) are deliberately not here: you cannot get
 * 1200x630 out of a 1536x1024 by scaling, something has to be cut off. Every
 * platform re-crops an upload anyway. `lib/assetBulkResize.js` already has the
 * cropping primitive if that becomes a feature.
 */

const LADDER_WIDTHS = [300, 600, 1200];
const SOCIAL_WIDTH = 1200;
const FULL_RUNG_MAX_WIDTH = 1920;

/** Long edge at or above this counts as "oversized" and is worth renditions. */
const OVERSIZED_MIN_EDGE = 1200;

/** …or this many bytes, which catches the rows whose dimensions were never recorded. */
const OVERSIZED_MIN_BYTES = 400 * 1024;

const WEBP_QUALITY = 80;
const JPEG_QUALITY = 82;

let sharpModule = null;
let sharpLoadAttempted = false;

function loadSharp() {
  if (sharpLoadAttempted) return sharpModule;
  sharpLoadAttempted = true;
  try {
    sharpModule = require('sharp');
  } catch {
    sharpModule = null;
  }
  return sharpModule;
}

/**
 * Should this image be considered? One of three answers, not two.
 *
 *   'yes'     — the recorded numbers say it is oversized.
 *   'no'      — the recorded numbers say it is small enough to leave alone.
 *   'unknown' — the row records nothing usable and only the file can settle it.
 *
 * THE THIRD ANSWER IS THE WHOLE POINT. Images brought in by the site importer
 * are stored with no dimensions AND size 0. Judging those from the database
 * called a 2.7 MB, 1994px-wide PNG "small" and skipped it — which is why the
 * Delray home page still served full-size originals after a completed sweep
 * (2026-08-12). A zero is not a measurement; it means nobody looked.
 */
function classifyImage(asset, options = {}) {
  const minEdge = Number(options.minEdge || OVERSIZED_MIN_EDGE) || OVERSIZED_MIN_EDGE;
  const minBytes = Number(options.minBytes || OVERSIZED_MIN_BYTES) || OVERSIZED_MIN_BYTES;

  if (String(asset.assetType || '').trim() !== 'Image') return 'no';
  if (!String(asset.location || '').trim()) return 'no';

  const width = Number(asset.imageWidth || 0) || 0;
  const height = Number(asset.imageHeight || 0) || 0;
  const bytes = Number(asset.size || 0) || 0;

  if (Math.max(width, height) >= minEdge) return 'yes';
  // A real measurement, and it is small: a 900px image gains nothing from a
  // 1200px rung.
  if (width > 0 || height > 0) return 'no';
  if (bytes >= minBytes) return 'yes';
  // No pixels and no bytes recorded — nothing here has actually been measured.
  if (bytes <= 0) return 'unknown';
  return 'no';
}

/**
 * Worth downloading? Both the certainly-oversized and the never-measured.
 * Callers that then read the real pixels should use `shouldBuildForSource`
 * to make the final call.
 */
function isOversizedImage(asset, options = {}) {
  return classifyImage(asset, options) !== 'no';
}

/**
 * The verdict once the real file has been read. Used for the 'unknown' case:
 * having paid for the download, decide from actual pixels and actual bytes.
 */
function shouldBuildForSource({ width, height, bytes }, options = {}) {
  const minEdge = Number(options.minEdge || OVERSIZED_MIN_EDGE) || OVERSIZED_MIN_EDGE;
  const minBytes = Number(options.minBytes || OVERSIZED_MIN_BYTES) || OVERSIZED_MIN_BYTES;
  const longEdge = Math.max(Number(width || 0) || 0, Number(height || 0) || 0);
  if (longEdge >= minEdge) return true;
  return (Number(bytes || 0) || 0) >= minBytes;
}

/**
 * The rungs to build for one source image, smallest first.
 * `sourceWidth` is the original's true pixel width.
 */
function planRenditions(sourceWidth) {
  const source = Math.max(0, Number(sourceWidth || 0) || 0);
  if (source <= 0) return [];

  const fullWidth = Math.min(source, FULL_RUNG_MAX_WIDTH);
  const widths = new Set();

  for (const width of LADDER_WIDTHS) {
    // Never enlarge, and never emit a rung that is the full rung in disguise.
    if (width < fullWidth) widths.add(width);
  }
  widths.add(fullWidth);

  const plan = [...widths]
    .sort((a, b) => a - b)
    .map((width) => ({ width, format: 'webp', role: width === fullWidth ? 'full' : 'web' }));

  plan.push({ width: Math.min(SOCIAL_WIDTH, source), format: 'jpeg', role: 'social' });
  return plan;
}

async function encodeOne(sharp, input, { width, format }) {
  const pipeline = sharp(input, { failOn: 'none' })
    .rotate()
    .resize({ width, fit: 'inside', withoutEnlargement: true });

  const encoded =
    format === 'jpeg'
      // Alpha has to land on something in a JPEG, and the default is black —
      // a logo on a transparent background would come out on a black card.
      ? pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      : pipeline.webp({ quality: WEBP_QUALITY });

  return encoded.toBuffer({ resolveWithObject: true });
}

/**
 * Build every rendition buffer for one image. Pure: no upload, no database.
 * Returns { ok, data: [{ width, height, format, role, buffer }] }.
 */
async function generateRenditionBuffers(buffer, options = {}) {
  const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (!input.length) return { ok: false, error: 'Image buffer is empty' };

  const sharp = loadSharp();
  if (!sharp) {
    return { ok: false, error: 'Rendition generation needs the sharp module (npm install sharp)' };
  }

  let sourceWidth = Number(options.sourceWidth || 0) || 0;
  let sourceHeight = Number(options.sourceHeight || 0) || 0;
  if (!sourceWidth || !sourceHeight) {
    try {
      const meta = await sharp(input, { failOn: 'none' }).metadata();
      // EXIF orientation 5-8 means the file is stored rotated a quarter turn;
      // .rotate() will swap the axes, so the plan has to read them swapped too.
      const swapped = Number(meta.orientation || 0) >= 5;
      sourceWidth = swapped ? Number(meta.height || 0) : Number(meta.width || 0);
      sourceHeight = swapped ? Number(meta.width || 0) : Number(meta.height || 0);
    } catch (err) {
      return { ok: false, error: `Could not read image: ${err.message || err}` };
    }
  }
  if (!sourceWidth) return { ok: false, error: 'Could not determine image width' };

  const plan = planRenditions(sourceWidth);
  if (!plan.length) return { ok: false, error: 'Nothing to generate for this image' };

  const results = [];
  for (const rung of plan) {
    try {
      const encoded = await encodeOne(sharp, input, rung);
      results.push({
        width: Number(encoded.info.width || 0) || 0,
        height: Number(encoded.info.height || 0) || 0,
        format: rung.format,
        role: rung.role,
        buffer: encoded.data,
      });
    } catch (err) {
      return { ok: false, error: `Resize to ${rung.width}px failed: ${err.message || err}` };
    }
  }

  return { ok: true, data: results, sourceWidth, sourceHeight };
}

/**
 * The folder name renditions of one ORIGINAL FILE live under.
 *
 * Keyed off the file, deliberately not off the asset row id. Two reasons:
 *
 *  1. The local and cloud databases share one Blob store, and their row ids are
 *     unrelated — local asset 5 and live asset 5 are different pictures. Keying
 *     on the id would have let a local test run quietly overwrite a live image's
 *     renditions.
 *  2. The library has genuine duplicates (the same PNG imported twice under two
 *     ids). Keying on the file means they share one set of copies instead of
 *     paying for two.
 */
function renditionKeyForAsset(asset) {
  const location = String((asset && asset.location) || '').trim();
  if (!location) return '';

  let lastSegment = '';
  try {
    lastSegment = decodeURIComponent(new URL(location).pathname.split('/').filter(Boolean).pop() || '');
  } catch {
    lastSegment = location.split('/').filter(Boolean).pop() || '';
  }

  const withoutExtension = lastSegment.replace(/\.[a-z0-9]{2,5}$/i, '');
  const safe = withoutExtension
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);

  // Uploaded files already carry a millisecond timestamp prefix, so the name
  // alone is unique. Anything else (an external URL, an odd name) gets a short
  // digest of the full location so two different files can never collide.
  const digest = require('crypto').createHash('sha1').update(location).digest('hex').slice(0, 10);
  return safe ? `${safe}-${digest}` : digest;
}

/**
 * Storage path for one rendition. Deterministic on purpose: a re-run overwrites
 * the previous file instead of littering the store with orphans, and the path
 * reads plainly in the Blob dashboard.
 */
function renditionStoragePath(key, { width, format, role }) {
  const root = String(process.env.BLOB_ASSETS_ROOT || 'APP/Assets').replace(/^\/+|\/+$/g, '');
  const ext = format === 'jpeg' ? 'jpg' : 'webp';
  const name = role === 'social' ? `social-w${width}.${ext}` : `w${width}.${ext}`;
  return `${root}/Renditions/${key}/${name}`;
}

/**
 * Generate, upload, and return the `renditions` value to store on the asset.
 * Does not write to the database — the caller owns that.
 */
async function buildAssetRenditions(asset, buffer, options = {}) {
  const key = renditionKeyForAsset(asset);
  if (!key) return { ok: false, error: 'Asset has no location to key its renditions on' };

  const { uploadBufferToBlobAtPath, isConfigured: isBlobConfigured } = require('./blobStorage');
  if (!isBlobConfigured()) {
    return {
      ok: false,
      error: 'Renditions need Vercel Blob storage (BLOB_READ_WRITE_TOKEN) for stable, re-runnable paths',
    };
  }

  const generated = await generateRenditionBuffers(buffer, options);
  if (!generated.ok) return generated;

  const renditions = [];
  for (const item of generated.data) {
    const pathname = renditionStoragePath(key, item);
    const upload = await uploadBufferToBlobAtPath({
      pathname,
      mimeType: item.format === 'jpeg' ? 'image/jpeg' : 'image/webp',
      fileBuffer: item.buffer,
    });
    if (!upload.ok) return { ok: false, error: upload.error || `Upload failed for ${pathname}` };

    const entry = {
      w: item.width,
      h: item.height,
      format: item.format,
      bytes: item.buffer.length,
      url: String(upload.data.location || '').trim(),
    };
    if (item.role !== 'web') entry.role = item.role;
    renditions.push(entry);
  }

  return {
    ok: true,
    data: {
      renditions,
      sourceWidth: generated.sourceWidth,
      sourceHeight: generated.sourceHeight,
      totalBytes: renditions.reduce((sum, r) => sum + r.bytes, 0),
    },
  };
}

/**
 * Decide and build for one image whose bytes are already in hand, and return
 * the database patch to apply. Shared by the backfill script, the Images page
 * endpoint, and the on-upload hook, so the "is it big enough?" rule cannot
 * drift between them — it drifted once already and cost a whole site.
 *
 * Three outcomes:
 *   { ok: true, built: true,  patch }  copies made
 *   { ok: true, built: false, patch }  genuinely small; patch records the real
 *                                      dimensions so it is never re-downloaded
 *   { ok: false, error }               could not be processed
 */
async function buildRenditionPatchForAsset(asset, buffer, options = {}) {
  const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (!input.length) return { ok: false, error: 'Downloaded image is empty' };

  const sharp = loadSharp();
  if (!sharp) return { ok: false, error: 'Rendition generation needs the sharp module' };

  let width = Number(asset.imageWidth || 0) || 0;
  let height = Number(asset.imageHeight || 0) || 0;
  if (!width || !height) {
    try {
      const meta = await sharp(input, { failOn: 'none' }).metadata();
      const swapped = Number(meta.orientation || 0) >= 5;
      width = swapped ? Number(meta.height || 0) : Number(meta.width || 0);
      height = swapped ? Number(meta.width || 0) : Number(meta.height || 0);
    } catch (err) {
      return { ok: false, error: `Could not read image: ${err.message || err}` };
    }
  }

  // Whatever happens next, the row should stop claiming it knows nothing.
  const measurements = {};
  if (!Number(asset.imageWidth || 0) && width) measurements.imageWidth = width;
  if (!Number(asset.imageHeight || 0) && height) measurements.imageHeight = height;
  if (!Number(asset.size || 0) && input.length) measurements.size = input.length;

  if (!shouldBuildForSource({ width, height, bytes: input.length }, options)) {
    // Small after all. Recording the real numbers is the point of this branch:
    // without it the image classifies as 'unknown' forever and is downloaded
    // again on every sweep.
    return { ok: true, built: false, patch: measurements, width, height, bytes: input.length };
  }

  const built = await buildAssetRenditions(asset, input, {
    sourceWidth: width,
    sourceHeight: height,
  });
  if (!built.ok) return { ok: false, error: built.error };

  return {
    ok: true,
    built: true,
    width,
    height,
    bytes: input.length,
    totalBytes: built.data.totalBytes,
    renditions: built.data.renditions,
    patch: {
      ...measurements,
      renditions: built.data.renditions,
      renditionsGeneratedAt: new Date().toISOString(),
    },
  };
}

/**
 * Generate renditions for a freshly saved asset and store them on its row.
 *
 * Never throws and never fails the caller. An upload that succeeded must not be
 * reported as failed because an optimisation did not finish — the picture is
 * safely stored either way, and `scripts/generate_asset_renditions.js` sweeps up
 * anything that was missed. Set ASSET_RENDITIONS_ON_UPLOAD=0 to turn the
 * on-upload pass off entirely and rely on the sweep.
 *
 * Returns { generated, skipped, error, row } — `row` is the updated database
 * row when there is one, so callers can return the fresher record.
 */
async function ensureAssetRenditions(assetRow, buffer, scope = null, options = {}) {
  const disabled = String(process.env.ASSET_RENDITIONS_ON_UPLOAD ?? '1').trim() === '0';
  if (disabled) return { generated: false, skipped: true, error: '', row: null };

  try {
    const { rowToAsset, updateAsset } = require('./assetsStore');
    const asset = assetRow && assetRow.asset_name !== undefined ? rowToAsset(assetRow) : assetRow;
    if (!asset) return { generated: false, skipped: true, error: '', row: null };

    const assetId = Number(asset.id || 0) || 0;
    if (!assetId) return { generated: false, skipped: true, error: '', row: null };
    if (!options.force && !isOversizedImage(asset, options)) {
      return { generated: false, skipped: true, error: '', row: null };
    }

    const result = await buildRenditionPatchForAsset(asset, buffer, options);
    if (!result.ok) return { generated: false, skipped: false, error: result.error, row: null };

    const updated = await updateAsset(assetId, result.patch, scope);
    if (!updated.ok) {
      return { generated: false, skipped: false, error: updated.error || 'Could not save renditions', row: null };
    }

    const row = Array.isArray(updated.data) ? updated.data[0] : updated.data;
    return { generated: result.built, skipped: !result.built, error: '', row: row || null };
  } catch (err) {
    return { generated: false, skipped: false, error: err?.message || 'Rendition generation failed', row: null };
  }
}

module.exports = {
  LADDER_WIDTHS,
  SOCIAL_WIDTH,
  FULL_RUNG_MAX_WIDTH,
  OVERSIZED_MIN_EDGE,
  OVERSIZED_MIN_BYTES,
  classifyImage,
  isOversizedImage,
  shouldBuildForSource,
  planRenditions,
  generateRenditionBuffers,
  renditionKeyForAsset,
  renditionStoragePath,
  buildAssetRenditions,
  buildRenditionPatchForAsset,
  ensureAssetRenditions,
};
