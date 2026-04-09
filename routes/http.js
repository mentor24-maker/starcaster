'use strict';

/**
 * routes/http.js
 * Shared HTTP utilities for all route handlers.
 * Both server.js (local) and api/[...slug].js (Vercel) import from here.
 */

const MAX_BODY_BYTES = 10_000_000;

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body !== undefined) {
      if (typeof req.body === 'object') return resolve(req.body);
      try { return resolve(JSON.parse(req.body)); } catch { return resolve({}); }
    }
    
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error('Request body too large (max 10MB)'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function getUrlObj(req) {
  const host = req.headers.host || 'localhost';
  return new URL(req.url, `http://${host}`);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function nextId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseCookies(rawCookie) {
  const text = String(rawCookie || '');
  if (!text.trim()) return {};
  return text.split(';').reduce((acc, part) => {
    const trimmed = String(part || '').trim();
    if (!trimmed) return acc;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) return acc;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!key) return acc;
    try {
      acc[key] = decodeURIComponent(value);
    } catch (_) {
      acc[key] = value;
    }
    return acc;
  }, {});
}

// =============================================================================
// #9 — Standardized API Response Envelope
// Append these helpers to the bottom of routes/http.js, above module.exports.
// Then add sendOk and sendErr to the module.exports object.
// =============================================================================

/**
 * Send a standard success envelope.
 *
 * Shape:
 *   { ok: true, data: <value>, meta: <object>, ...<legacyKeys> }
 *
 * @param {object} res          - Node HTTP response
 * @param {number} status       - HTTP status code (200, 201, etc.)
 * @param {*}      data         - Primary payload (array or object)
 * @param {object} [legacyKeys] - Extra top-level keys for backward compat
 *                                e.g. { contacts: [...] } alongside data: [...]
 * @param {object} [meta]       - Pagination/summary metadata
 *                                e.g. { total: 42, page: 1, limit: 50 }
 */
function sendOk(res, status, data, legacyKeys = {}, meta = {}) {
  const body = {
    ok:   true,
    data,
    ...legacyKeys,               // spread legacy keys so old frontend code still works
  };
  if (Object.keys(meta).length) body.meta = meta;
  return sendJson(res, status, body);
}

/**
 * Send a standard error envelope.
 *
 * Shape:
 *   { ok: false, error: { message, code, details } }
 *
 * @param {object} res       - Node HTTP response
 * @param {number} status    - HTTP status code (400, 404, 500, etc.)
 * @param {string} message   - Human-readable error message
 * @param {object} [opts]
 * @param {string} [opts.code]    - Machine-readable error code (e.g. 'NOT_FOUND')
 * @param {Array}  [opts.details] - Array of detail strings (e.g. validation errors)
 */
function sendErr(res, status, message, { code = null, details = [] } = {}) {
  const error = { message: String(message || 'An error occurred') };
  if (code)           error.code    = code;
  if (details.length) error.details = details;
  return sendJson(res, status, { ok: false, error });
}
module.exports = {
  sendJson,
  sendOk,
  sendErr,
  parseJsonBody,
  setCors,
  getUrlObj,
  normalizeEmail,
  nextId,
  parseCookies,
};
