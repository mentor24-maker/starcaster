'use strict';

/**
 * The input rules the three Reel Spinner stores share — lib/videoMomentsStore.js,
 * lib/videoAudioPairsStore.js and lib/videoEditsStore.js — in one place, for the
 * reason lib/storeInput.js gives: a rule copied into three files gets hardened
 * in one of them.
 */

function safeText(value, max = 2000) {
  return String(value === 0 || value ? value : '').trim().slice(0, max);
}

function safeNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A finite, non-negative number of seconds. Strict: '1.5' and true are junk. */
function isSeconds(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Text or nothing; an object or a boolean is a 400, never '[object Object]'. */
function optionalText(value, field, max) {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, status: 400, error: `${field} must be text` };
  const text = value.trim();
  if (text.length > max) {
    return { ok: false, status: 400, error: `${field} must be ${max} characters or fewer (got ${text.length})` };
  }
  return { ok: true, value: text || null };
}

/** A number (any sign) or nothing. */
function optionalNumber(value, field, { min = -Infinity, max = Infinity } = {}) {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, status: 400, error: `${field} must be a number` };
  }
  if (value < min || value > max) {
    return { ok: false, status: 400, error: `${field} must be between ${min} and ${max} (got ${value})` };
  }
  return { ok: true, value };
}

/** One row from a PostgREST answer that may be an array or a row. */
function firstRow(data) {
  return Array.isArray(data) ? data[0] : data;
}

/** Ask for at most this many rows from a list read; more is refused, never cut. */
const MAX_LIST_LIMIT = 500;

/**
 * The `limit` every list read takes FIRST (CLAUDE.md landmine 12). A scope
 * object in the limit's place is a 400 naming the order, because reading it as
 * "no limit" returns every project's rows.
 */
function limitOrError(limit, fnName) {
  if (limit && typeof limit === 'object') {
    return { ok: false, status: 400, error: `${fnName} takes the limit first: ${fnName}(limit, …, scope)` };
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    return { ok: false, status: 400, error: `limit must be a whole number from 1 to ${MAX_LIST_LIMIT}` };
  }
  return { ok: true, value: limit };
}

module.exports = {
  MAX_LIST_LIMIT,
  safeText,
  safeNumber,
  isSeconds,
  optionalText,
  optionalNumber,
  firstRow,
  limitOrError,
};
