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
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.end(JSON.stringify(payload));
  return true;
}

/**
 * Cross-origin requests are only honored for explicitly allowed origins.
 * The app is same-origin (UI and API share a domain), so most requests
 * carry no Origin header and need no CORS headers at all.
 * Allowlist sources: CORS_ALLOWED_ORIGINS (comma-separated), the public
 * app origin env vars, the Vercel deployment URL, and localhost for dev.
 */
function getAllowedOrigins() {
  const origins = new Set();
  const fromEnv = String(process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  for (const origin of fromEnv) origins.add(origin);

  const publicOrigin = String(
    process.env.PUBLIC_APP_ORIGIN
    || process.env.APP_PUBLIC_ORIGIN
    || process.env.PUBLIC_BASE_URL
    || ''
  ).trim().replace(/\/+$/, '');
  if (publicOrigin) origins.add(publicOrigin);

  const vercelUrl = String(process.env.VERCEL_URL || '').trim().replace(/\/+$/, '');
  if (vercelUrl) origins.add(`https://${vercelUrl}`);

  return origins;
}

function isOriginAllowed(origin) {
  if (!origin) return false;
  if (getAllowedOrigins().has(origin.replace(/\/+$/, ''))) return true;
  // Local development servers on any port.
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

function setCors(res, req) {
  const origin = (req && req.headers && req.headers.origin) ? req.headers.origin : '';
  if (!origin || !isOriginAllowed(origin)) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-project-id');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    if (req._parsedJsonBody !== undefined) {
      return resolve(req._parsedJsonBody);
    }

    if (req.body !== undefined) {
      if (typeof req.body === 'object') {
        req._parsedJsonBody = req.body;
        return resolve(req.body);
      }
      try {
        const parsed = JSON.parse(req.body);
        req._parsedJsonBody = parsed;
        return resolve(parsed);
      } catch {
        req._parsedJsonBody = {};
        return resolve({});
      }
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error('Request body too large (max 10MB)'));
      }
    });
    req.on('end', () => {
      if (!body) {
        req._parsedJsonBody = {};
        return resolve({});
      }
      try {
        const parsed = JSON.parse(body);
        req._parsedJsonBody = parsed;
        resolve(parsed);
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

/** Strip trailing slashes so `/api/foo/` matches route handlers for `/api/foo`. */
function normalizeApiPathname(pathname) {
  const raw = String(pathname || '/').trim();
  if (raw.length > 1) return raw.replace(/\/+$/, '');
  return raw || '/';
}

function normalizeHostname(value) {
  const text = String(value || '').split(',')[0].trim();
  if (!text) return '';
  return text.split(':')[0].toLowerCase().replace(/^www\./, '');
}

function isDeploymentHostname(host) {
  if (!host) return true;
  if (/^localhost$|^127\.|^0\.0\.0\.0$/.test(host)) return true;
  return host.endsWith('.vercel.app');
}

/**
 * Resolve the visitor-facing hostname on Vercel.
 * Internal rewrites to /api/[...slug] can leave Host as *.vercel.app while
 * x-forwarded-host still carries the custom domain.
 */
function getClientHost(req) {
  const headers = req.headers || {};
  const forwarded = normalizeHostname(headers['x-forwarded-host']);
  const host = normalizeHostname(headers.host);
  if (forwarded && !isDeploymentHostname(forwarded)) return forwarded;
  if (host && !isDeploymentHostname(host)) return host;
  return forwarded || host;
}

function getPublicSiteDomainFromPath(pathname) {
  const p = normalizeApiPathname(pathname);
  const match = p.match(/^\/(?:api\/)?_site\/([^/]+)/);
  if (!match) return '';
  try {
    return normalizeHostname(decodeURIComponent(match[1]));
  } catch {
    return normalizeHostname(match[1]);
  }
}

function getPublicSiteDomainParam(req) {
  const urlObj = getUrlObj(req);
  let raw = String(
    urlObj.searchParams.get('domain')
    || urlObj.searchParams.get('d')
    || ''
  ).trim();
  if (!raw && req && req.query && typeof req.query === 'object') {
    raw = String(req.query.domain || req.query.d || '').trim();
  }
  if (!raw) {
    const match = String(req?.url || '').match(/[?&](?:domain|d)=([^&]+)/i);
    if (match) {
      try {
        raw = decodeURIComponent(match[1].replace(/\+/g, ' '));
      } catch {
        raw = match[1];
      }
    }
  }
  if (!raw) return '';
  return normalizeHostname(raw);
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
  normalizeApiPathname,
  getClientHost,
  getPublicSiteDomainParam,
  getPublicSiteDomainFromPath,
  normalizeEmail,
  nextId,
  parseCookies,
};
