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
