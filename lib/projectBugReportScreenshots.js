'use strict';

/**
 * Bug Report 2/5 — screenshots attached to a bug report.
 *
 * Shape of the thing, and why:
 *
 *  - ONE FILE PER REQUEST, as JSON + base64, through the house asset path
 *    (lib/assetStorage → Vercel Blob or Google Drive, then an `assets` row
 *    scoped to the project). The task preferred "upload with submit in one
 *    multipart request if the serverless body limit allows" — it does not:
 *    Vercel serverless functions cap a request body at 4.5 MB, and even this
 *    server's own JSON parser stops at 10 MB (routes/http.js MAX_BODY_BYTES),
 *    so five 8 MB files can never share a request. Per-file it is, and the
 *    submit endpoint attaches by asset id afterwards.
 *
 *    The honest consequence: the 8 MB per-file cap below is the validation
 *    rule, but transport is stricter — base64 inflates by 4/3, so this
 *    server's parser admits roughly 7 MB and a Vercel deployment roughly
 *    3 MB per file. Anything larger dies in the body parser before it gets
 *    here, and the route turns that into the same plain-language 413. The
 *    picker (task 4/5) should downscale big captures client-side.
 *
 *  - IMAGES ONLY, DECIDED BY MAGIC BYTES. The file's first bytes say what it
 *    is; the name and the declared mime type are claims. An .exe renamed
 *    .png is refused here, and the stored file is renamed to the sniffed
 *    extension so the name can never disagree with the contents.
 *
 *  - ORPHANS HAVE A DOCUMENTED CLEANUP RULE. A screenshot is uploaded BEFORE
 *    the report is submitted, so an abandoned form leaves an asset behind.
 *    Uploads land with category `bug-report-pending`; a successful submit
 *    flips them to `bug-report`. Anything still pending after a day and not
 *    referenced by any report is an orphan:
 *
 *      DELETE FROM assets a
 *       WHERE a.category = 'bug-report-pending'
 *         AND a.created_at < now() - interval '1 day'
 *         AND NOT EXISTS (
 *           SELECT 1 FROM project_bug_reports r
 *            WHERE r.screenshot_asset_ids @> to_jsonb(ARRAY[a.id]));
 *
 *    The reference check is what makes the rule safe even if the category
 *    flip after submit ever fails: a referenced asset is never an orphan.
 *    (The stored file behind the row is removed by the same sweep that
 *    handles deleted assets today — this rule only names WHICH rows.)
 */

const { uploadAssetFile, isConfigured: isAssetStorageConfigured } = require('./assetStorage');
const { createAsset, getAssetById, updateAsset, rowToAsset } = require('./assetsStore');
const { readImageDimensionsFromBuffer } = require('./assetImageDimensions');
const { MAX_SCREENSHOTS_PER_REPORT } = require('./projectBugReportsStore');

const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
/** Base64 length that decodes to MAX_SCREENSHOT_BYTES — checked BEFORE decoding
 *  so an oversize upload never allocates 12 MB just to be refused. */
const MAX_SCREENSHOT_BASE64_CHARS = Math.ceil(MAX_SCREENSHOT_BYTES / 3) * 4;

const PENDING_CATEGORY = 'bug-report-pending';
const ATTACHED_CATEGORY = 'bug-report';

const IMAGE_KINDS = {
  png:  { mimeType: 'image/png',  ext: 'png'  },
  jpeg: { mimeType: 'image/jpeg', ext: 'jpg'  },
  webp: { mimeType: 'image/webp', ext: 'webp' },
  gif:  { mimeType: 'image/gif',  ext: 'gif'  },
};

/** What the bytes say the file is — '' when it is none of the accepted kinds. */
function sniffImageType(buffer) {
  if (!buffer || buffer.length < 12) return '';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  const head6 = buffer.toString('ascii', 0, 6);
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'gif';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return '';
}

function stripDataUrlPrefix(fileBase64) {
  const text = String(fileBase64 || '').trim();
  const match = text.match(/^data:[^;,]+;base64,(.+)$/is);
  return (match ? match[1] : text).replace(/\s+/g, '');
}

function describeMegabytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A stored name the visitor cannot use to lie about the contents. */
function storedFileName(fileName, ext) {
  const base = String(fileName || '')
    .split(/[\\/]/).pop()
    .replace(/\.[^.]*$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${base || 'screenshot'}.${ext}`;
}

/**
 * Decode and vet one upload. Pure: no I/O, so the three refusals the task
 * names (too big, wrong kind, renamed executable) are testable without a
 * storage backend.
 */
function validateScreenshot({ fileName, fileBase64 } = {}) {
  const base64 = stripDataUrlPrefix(fileBase64);
  if (!base64) return { ok: false, status: 400, error: 'A screenshot file is required.', code: 'VALIDATION_ERROR' };
  if (base64.length > MAX_SCREENSHOT_BASE64_CHARS) {
    return {
      ok: false,
      status: 413,
      error: `Screenshots must be ${describeMegabytes(MAX_SCREENSHOT_BYTES)} or smaller — this one is about ${describeMegabytes(base64.length * 0.75)}.`,
      code: 'PAYLOAD_TOO_LARGE',
    };
  }
  if (!/^[A-Za-z0-9+/]+=*$/.test(base64)) {
    return { ok: false, status: 400, error: 'That screenshot could not be read — please pick the file again.', code: 'VALIDATION_ERROR' };
  }
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > MAX_SCREENSHOT_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `Screenshots must be ${describeMegabytes(MAX_SCREENSHOT_BYTES)} or smaller — this one is ${describeMegabytes(buffer.length)}.`,
      code: 'PAYLOAD_TOO_LARGE',
    };
  }
  const kind = sniffImageType(buffer);
  if (!kind) {
    return {
      ok: false,
      status: 400,
      error: "That file is not an image we can accept (PNG, JPEG, WebP or GIF). The file's contents decide, not its name.",
      code: 'UNSUPPORTED_FILE_TYPE',
    };
  }
  const { mimeType, ext } = IMAGE_KINDS[kind];
  return {
    ok: true,
    data: {
      base64,
      buffer,
      kind,
      mimeType,
      fileName: storedFileName(fileName, ext),
      sizeBytes: buffer.length,
    },
  };
}

/**
 * Vet, upload, and record one screenshot as a PENDING bug-report asset owned
 * by the project in `scope`. Returns the asset id the submit endpoint accepts
 * in screenshotAssetIds, plus the viewable URL.
 */
async function storeBugReportScreenshot(input, scope) {
  if (!isAssetStorageConfigured()) {
    return {
      ok: false,
      status: 503,
      error: 'Screenshot uploads are not set up on this site yet. Send the report without one.',
      code: 'ASSET_STORAGE_NOT_CONFIGURED',
    };
  }
  const vetted = validateScreenshot(input);
  if (!vetted.ok) return vetted;
  const { base64, buffer, mimeType, fileName, sizeBytes } = vetted.data;

  const upload = await uploadAssetFile({
    assetType: 'image',
    category: PENDING_CATEGORY,
    fileName,
    mimeType,
    fileBase64: base64,
    makePublic: true,
  });
  if (!upload.ok || !upload.data?.location) {
    // Provider detail stays server-side: this is a public endpoint.
    return { ok: false, status: 502, error: 'Could not store that screenshot. Please try again.', code: 'SCREENSHOT_STORE_FAILED' };
  }

  const dimensions = readImageDimensionsFromBuffer(buffer) || null;
  const created = await createAsset({
    assetName: fileName,
    assetType: 'image',
    category: PENDING_CATEGORY,
    location: upload.data.location,
    size: sizeBytes,
    imageWidth: dimensions?.width || 0,
    imageHeight: dimensions?.height || 0,
    tags: ['bug-report'],
  }, scope);
  if (!created.ok) {
    return { ok: false, status: created.status || 500, error: 'Could not record that screenshot. Please try again.', code: 'SCREENSHOT_RECORD_FAILED' };
  }
  const asset = rowToAsset(Array.isArray(created.data) ? created.data[0] : created.data);
  return {
    ok: true,
    status: 201,
    data: {
      assetId: asset.id,
      url: asset.location,
      width: asset.imageWidth,
      height: asset.imageHeight,
      sizeBytes,
    },
  };
}

function normalizeAssetIds(input) {
  const list = Array.isArray(input) ? input : [];
  const ids = [];
  for (const value of list) {
    const id = Number(value);
    if (Number.isInteger(id) && id > 0 && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Read-only check that every id is a bug-report screenshot THIS project
 * uploaded. A scoped lookup is what keeps another tenant's asset id — or any
 * random asset id — from being pinned to a report: it simply does not exist
 * from inside this scope.
 */
async function verifyBugReportScreenshots(assetIdsInput, scope) {
  const assetIds = normalizeAssetIds(assetIdsInput);
  if (assetIds.length > MAX_SCREENSHOTS_PER_REPORT) {
    return {
      ok: false,
      status: 400,
      error: `Up to ${MAX_SCREENSHOTS_PER_REPORT} screenshots per report — you attached ${assetIds.length}.`,
      code: 'TOO_MANY_SCREENSHOTS',
    };
  }
  const assets = [];
  for (const id of assetIds) {
    const found = await getAssetById(id, scope);
    if (!found.ok) {
      return { ok: false, status: 400, error: `Screenshot ${id} is not an upload we recognise — please attach it again.`, code: 'SCREENSHOT_NOT_FOUND' };
    }
    const asset = rowToAsset(found.data);
    if (asset.category !== PENDING_CATEGORY && asset.category !== ATTACHED_CATEGORY) {
      return { ok: false, status: 400, error: `Screenshot ${id} is not a bug-report upload.`, code: 'SCREENSHOT_NOT_FOUND' };
    }
    assets.push({ id: asset.id, url: asset.location });
  }
  return { ok: true, status: 200, data: { assetIds, assets } };
}

/**
 * After the report row exists: flip its screenshots from pending to attached
 * so the orphan sweep leaves them alone. Best-effort on purpose — the report
 * is already saved and references them, and the sweep's NOT EXISTS clause
 * protects referenced rows regardless. Reports what it could not flip.
 */
async function markScreenshotsAttached(assetIdsInput, scope) {
  const assetIds = normalizeAssetIds(assetIdsInput);
  const failed = [];
  for (const id of assetIds) {
    const res = await updateAsset(id, { category: ATTACHED_CATEGORY }, scope);
    if (!res.ok) failed.push(id);
  }
  return { ok: failed.length === 0, attached: assetIds.length - failed.length, failed };
}

module.exports = {
  MAX_SCREENSHOT_BYTES,
  MAX_SCREENSHOT_BASE64_CHARS,
  PENDING_CATEGORY,
  ATTACHED_CATEGORY,
  sniffImageType,
  validateScreenshot,
  storeBugReportScreenshot,
  verifyBugReportScreenshots,
  markScreenshotsAttached,
};
