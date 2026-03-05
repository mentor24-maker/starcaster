'use strict';

/**
 * lib/activityLog.js
 * Helpers for writing to and reading from the activity_log Supabase table.
 *
 * Usage (fire-and-forget — never awaited in hot paths):
 *   const { logActivity } = require('./activityLog');
 *   logActivity({ action: 'contact.created', entityType: 'contact',
 *                 entityId: id, summary: `Contact ${email} added` });
 *
 * The `log()` call is intentionally non-blocking and swallows errors so a
 * logging failure never breaks the primary operation.
 */

const { sbQuery, isConfigured } = require('./supabase');

const TABLE = 'activity_log';

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Log one activity entry.
 * @param {object} opts
 * @param {string}  opts.action      Dot-namespaced verb, e.g. 'contact.created'
 * @param {string}  [opts.actor]     Who triggered it (default: 'system')
 * @param {string}  [opts.entityType] e.g. 'contact', 'campaign', 'segment'
 * @param {string}  [opts.entityId]  ID of the affected record
 * @param {string}  opts.summary     Human-readable one-liner shown in the UI
 * @param {object}  [opts.meta]      Any additional JSON context
 * @returns {Promise<void>}          Resolves once inserted (errors are swallowed)
 */
async function logActivity({ action, actor = 'system', entityType = null,
                              entityId = null, summary, meta = {} }) {
  if (!isConfigured()) return;          // no Supabase config → skip silently
  if (!action || !summary) return;

  try {
    await sbQuery({
      method: 'POST',
      table: TABLE,
      body: {
        action,
        actor,
        entity_type: entityType,
        entity_id:   entityId ? String(entityId) : null,
        summary,
        meta
      }
    });
  } catch (err) {
    // Logging must never break the calling operation.
    console.warn('[activityLog] write failed:', err.message || err);
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 50;
const MAX_LIMIT     = 200;

/**
 * Fetch a page of activity log entries, newest first.
 * @param {object} [opts]
 * @param {number}  [opts.limit]      Max rows (default 50, cap 200)
 * @param {number}  [opts.offset]     Pagination offset (default 0)
 * @param {string}  [opts.entityType] Filter to one entity type
 * @param {string}  [opts.action]     Filter to one action prefix (e.g. 'contact')
 * @returns {Promise<{ entries: object[], total: number }>}
 */
async function listActivityLog({ limit = DEFAULT_LIMIT, offset = 0,
                                  entityType, action } = {}) {
  if (!isConfigured()) return { entries: [], total: 0 };

  const safeLimit  = Math.min(Math.max(1, Number(limit)  || DEFAULT_LIMIT), MAX_LIMIT);
  const safeOffset = Math.max(0, Number(offset) || 0);

  let query = `select=*&order=created_at.desc&limit=${safeLimit}&offset=${safeOffset}`;
  if (entityType) query += `&entity_type=eq.${encodeURIComponent(entityType)}`;
  if (action)     query += `&action=like.${encodeURIComponent(action + '%')}`;

  try {
    const rows = await sbQuery({ method: 'GET', table: TABLE, query });
    return { entries: Array.isArray(rows) ? rows : [], total: null };
  } catch (err) {
    console.warn('[activityLog] read failed:', err.message || err);
    return { entries: [], total: 0 };
  }
}

module.exports = { logActivity, listActivityLog };
