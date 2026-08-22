'use strict';

/**
 * Bug Report 2/5 — screenshots attached to a bug report.
 *
 * Shape of the thing, and why:
 *
 *  - ONE FILE PER REQUEST, JSON + base64, through the house asset path
 *    (lib/assetStorage → Vercel Blob or Google Drive, then an `assets` row
 *    scoped to the project). Vercel serverless caps a request body at ~4.5 MB
 *    and base64 inflates 4/3, so `MAX_SCREENSHOT_BYTES` (3 MB) is the largest
 *    image that reliably survives transport in production — it is the single
 *    real cap, exported so the picker (task 4/5) enforces the same number
 *    client-side. Five files can never share a request; per-file it is, and
 *    the submit endpoint attaches them by (id, token) afterwards.
 *
 *  - IMAGES ONLY, DECIDED BY MAGIC BYTES. The file's first bytes say what it
 *    is; the name and declared mime type are claims. A renamed .exe is
 *    refused, and the stored file takes the sniffed extension.
 *
 *  - UPLOADS ARE BOUND TO THE UPLOADER BY AN UNGUESSABLE TOKEN. Asset ids are
 *    small sequential integers; without this, a visitor could loop ids and
 *    pin (and read back the public URLs of) screenshots another reporter
 *    uploaded. Each upload returns `{ assetId, token }` where the token is an
 *    HMAC of (assetId, projectId) under a server secret. Submit requires the
 *    matching token per id, an attach is ONE-SHOT (a screenshot already moved
 *    out of the pending category is refused), and every rejection returns the
 *    SAME message — no "exists / not yours" oracle.
 *
 *  - ORPHAN CLEANUP IS A SCHEDULED SWEEP (task 5/5). An abandoned form leaves
 *    a `bug-report-pending` asset (row + blob) behind. Two things collect it:
 *    a blob whose row failed to insert is deleted immediately (below), and
 *    fully-recorded pending rows are collected daily by
 *    `lib/bugReportScreenshotOrphans.js` —
 *
 *      pending rows older than N hours, not referenced by any report's
 *      screenshot_asset_ids → delete the blob, then the row.
 *
 *    That reference check is why `markScreenshotsAttached` being best-effort
 *    is survivable: a screenshot still stuck in the pending category is spared
 *    for as long as a report points at it.
 */

const crypto = require('crypto');
const { uploadAssetFile, deleteUploadedAsset, isConfigured: isAssetStorageConfigured } = require('./assetStorage');
const { createAsset, getAssetById, updateAsset, rowToAsset } = require('./assetsStore');
const { readImageDimensionsFromBuffer } = require('./assetImageDimensions');
const { MAX_SCREENSHOTS_PER_REPORT } = require('./projectBugReportsStore');

// The ONE real cap. Vercel serverless bodies top out ~4.5 MB and base64 adds
// ~33%, so 3 MB decoded (~4 MB on the wire) is the largest that survives
// transport in production. Exported so task 4/5's picker enforces the same.
const MAX_SCREENSHOT_BYTES = 3 * 1024 * 1024;
const MAX_SCREENSHOT_BASE64_CHARS = Math.ceil(MAX_SCREENSHOT_BYTES / 3) * 4;

const PENDING_CATEGORY = 'bug-report-pending';
const ATTACHED_CATEGORY = 'bug-report';

// One message for EVERY attach rejection — no id, no reason. Distinct strings
// ("no such id" vs "not yours" vs "already used") would be an existence/
// ownership oracle a visitor could walk.
const ATTACH_REJECTED = 'One or more screenshots could not be attached. Please remove them and add the screenshots again.';

const IMAGE_KINDS = {
  png:  { mimeType: 'image/png',  ext: 'png'  },
  jpeg: { mimeType: 'image/jpeg', ext: 'jpg'  },
  webp: { mimeType: 'image/webp', ext: 'webp' },
  gif:  { mimeType: 'image/gif',  ext: 'gif'  },
};

function uploadSecret() {
  return String(
    process.env.BUG_REPORT_UPLOAD_SECRET
    || process.env.SUPABASE_SERVICE_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || ''
  ).trim();
}

/** HMAC(assetId, projectId) — the proof a submitter uploaded this screenshot.
 *  '' when no server secret is configured (uploads then refuse, fail-closed). */
function screenshotToken(assetId, projectId) {
  const secret = uploadSecret();
  if (!secret) return '';
  return crypto.createHmac('sha256', secret)
    .update(`bug-report-screenshot:${assetId}:${projectId}`)
    .digest('base64url')
    .slice(0, 32);
}

function tokenMatches(assetId, projectId, given) {
  const expected = screenshotToken(assetId, projectId);
  const supplied = String(given || '');
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** What the bytes say the file is — '' when none of the accepted kinds. */
function sniffImageType(buffer) {
  if (!buffer || buffer.length < 12) return '';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  const head6 = buffer.toString('ascii', 0, 6);
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'gif';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return '';
}

/** Strip a data: URL prefix WITH any extra params (data:image/png;name=x;base64,). */
function stripDataUrlPrefix(fileBase64) {
  const text = String(fileBase64 || '').trim();
  const match = text.match(/^data:[^,]*;base64,(.+)$/is);
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
 * Decode and vet one upload. Pure: no I/O, so the refusals (too big, wrong
 * kind, renamed executable) are testable without a storage backend.
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
    data: { base64, buffer, kind, mimeType, fileName: storedFileName(fileName, ext), sizeBytes: buffer.length },
  };
}

/**
 * Vet, upload, and record one screenshot as a PENDING bug-report asset scoped
 * to `scope.projectId`. Returns the asset id AND its unguessable token — the
 * pair the submit endpoint requires.
 */
async function storeBugReportScreenshot(input, scope) {
  if (!isAssetStorageConfigured() || !uploadSecret()) {
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
    return { ok: false, status: 502, error: 'Could not store that screenshot. Please try again.', code: 'SCREENSHOT_STORE_FAILED' };
  }
  const location = upload.data.location;

  const dimensions = readImageDimensionsFromBuffer(buffer) || null;
  const created = await createAsset({
    assetName: fileName,
    assetType: 'image',
    category: PENDING_CATEGORY,
    location,
    size: sizeBytes,
    imageWidth: dimensions?.width || 0,
    imageHeight: dimensions?.height || 0,
    tags: ['bug-report'],
  }, { projectId: scope?.projectId });

  const row = created.ok ? rowToAsset(Array.isArray(created.data) ? created.data[0] : created.data) : null;
  if (!created.ok || !row || !row.id) {
    // The blob is up but has no row to ever find it — delete it now rather
    // than leave a public orphan, and log the location if we can't.
    const removed = await deleteUploadedAsset(location);
    if (!removed.ok) console.error(`[bug-report screenshot] ORPHAN BLOB not deleted (${removed.error}): ${location}`);
    return { ok: false, status: created.ok ? 502 : (created.status || 500), error: 'Could not record that screenshot. Please try again.', code: 'SCREENSHOT_RECORD_FAILED' };
  }

  return {
    ok: true,
    status: 201,
    data: {
      assetId: row.id,
      token: screenshotToken(row.id, String(scope?.projectId || '')),
      url: row.location,
      width: row.imageWidth,
      height: row.imageHeight,
      sizeBytes,
    },
  };
}

/** Coerce the submit payload to [{ id, token }], deduped by id, refuse >cap. */
function normalizeScreenshotRefs(input) {
  const list = Array.isArray(input) ? input : [];
  const refs = [];
  const seen = new Set();
  for (const item of list) {
    const id = Number(item && typeof item === 'object' ? item.id ?? item.assetId : item);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    refs.push({ id, token: String((item && typeof item === 'object' ? item.token : '') || '') });
  }
  return refs;
}

/**
 * Verify a submit's screenshot references. Every ref must name a PENDING
 * bug-report asset in THIS project AND carry the matching token. Any failure
 * — unknown id, wrong project, already attached, bad token — returns the
 * SAME message (no oracle). Read-only; the attach itself happens after the
 * report row is written.
 */
async function verifyBugReportScreenshots(refsInput, scope) {
  const refs = normalizeScreenshotRefs(refsInput);
  if (refs.length > MAX_SCREENSHOTS_PER_REPORT) {
    return {
      ok: false,
      status: 400,
      error: `Up to ${MAX_SCREENSHOTS_PER_REPORT} screenshots per report — you attached ${refs.length}.`,
      code: 'TOO_MANY_SCREENSHOTS',
    };
  }
  const projectId = String(scope?.projectId || '');
  const reject = () => ({ ok: false, status: 400, error: ATTACH_REJECTED, code: 'SCREENSHOT_REJECTED' });

  const assets = [];
  for (const { id, token } of refs) {
    if (!tokenMatches(id, projectId, token)) return reject();
    const found = await getAssetById(id, { projectId });
    if (!found.ok) return reject();
    const asset = rowToAsset(found.data);
    if (!asset || asset.category !== PENDING_CATEGORY) return reject(); // one-shot: ATTACHED is refused
    assets.push({ id: asset.id, url: asset.location });
  }
  return { ok: true, status: 200, data: { assetIds: assets.map((a) => a.id), assets } };
}

/**
 * After the report row exists: flip its screenshots from pending to attached.
 * Best-effort — the row already references them. Scope is projectId-ONLY: a
 * userId in the scope would make scopedPatchRow stamp owner_user_id on every
 * PATCH, silently rewriting the asset's owner to the submitter (a staff-tier
 * submit did exactly that). Counts from the rows actually matched.
 */
async function markScreenshotsAttached(assetIds, scope) {
  const ids = (Array.isArray(assetIds) ? assetIds : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const failed = [];
  let attached = 0;
  for (const id of ids) {
    const res = await updateAsset(id, { category: ATTACHED_CATEGORY }, { projectId: String(scope?.projectId || '') });
    const matched = res.ok && Array.isArray(res.data) ? res.data.length : (res.ok ? 1 : 0);
    if (res.ok && matched > 0) attached += 1; else failed.push(id);
  }
  return { ok: failed.length === 0, attached, failed };
}

module.exports = {
  MAX_SCREENSHOT_BYTES,
  MAX_SCREENSHOT_BASE64_CHARS,
  PENDING_CATEGORY,
  ATTACHED_CATEGORY,
  ATTACH_REJECTED,
  sniffImageType,
  screenshotToken,
  tokenMatches,
  validateScreenshot,
  normalizeScreenshotRefs,
  storeBugReportScreenshot,
  verifyBugReportScreenshots,
  markScreenshotsAttached,
};
