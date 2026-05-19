'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Local JSON under data/ — dev and long-running Node only.
 * Vercel serverless has a read-only filesystem (EROFS on write).
 */
function isLocalJsonFsWritable() {
  if (String(process.env.VERCEL || '').trim()) return false;
  if (String(process.env.VERCEL_ENV || '').trim()) return false;
  const override = String(process.env.STARCASTER_LOCAL_DATA_WRITABLE || '').trim().toLowerCase();
  if (override === '0' || override === 'false' || override === 'no') return false;
  return true;
}

function isReadOnlyFsError(err) {
  if (!err) return false;
  if (err.code === 'EROFS') return true;
  return /read-only file system/i.test(String(err.message || ''));
}

function writeJsonAtomic(filePath, data, options = {}) {
  if (!isLocalJsonFsWritable()) {
    return { ok: false, skipped: true, reason: 'read-only' };
  }
  const mode = options.mode === undefined ? 0o600 : options.mode;
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode });
    fs.renameSync(tmp, filePath);
    if (mode) fs.chmodSync(filePath, mode);
    return { ok: true };
  } catch (err) {
    if (isReadOnlyFsError(err)) {
      return { ok: false, skipped: true, reason: 'read-only', error: err };
    }
    return { ok: false, error: err };
  }
}

function ensureJsonFile(filePath, seed, options = {}) {
  if (fs.existsSync(filePath)) return { ok: true };
  return writeJsonAtomic(filePath, seed, options);
}

module.exports = {
  isLocalJsonFsWritable,
  isReadOnlyFsError,
  writeJsonAtomic,
  ensureJsonFile,
};
