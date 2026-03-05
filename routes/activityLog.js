'use strict';

/**
 * routes/activityLog.js
 * API endpoints for the Activity Log.
 *
 * #9 — Standardized API Response Envelope: sendOk() / sendErr() throughout.
 *
 * GET  /api/activity-log   → list entries (paginated, filterable)
 * POST /api/activity-log   → write an entry (internal/manual use)
 */

const { sendOk, sendErr, parseJsonBody } = require('./http');
const { logActivity, listActivityLog }   = require('../lib/activityLog');

const PREFIX = '/api/activity-log';

const manifest = {
  id:       'activityLog',
  label:    'Activity Log',
  prefixes: [PREFIX]
};

async function handle(req, res, pathname, method) {
  if (!pathname.startsWith(PREFIX)) return false;

  // GET /api/activity-log
  if (method === 'GET' && pathname === PREFIX) {
    const url        = new URL(req.url, 'http://localhost');
    const limit      = url.searchParams.get('limit');
    const offset     = url.searchParams.get('offset');
    const entityType = url.searchParams.get('entity_type') || undefined;
    const action     = url.searchParams.get('action')      || undefined;

    const result = await listActivityLog({ limit, offset, entityType, action });
    const entries = result.entries || [];
    return sendOk(res, 200, entries, { entries }, { total: result.total || entries.length }), true;
  }

  // POST /api/activity-log
  if (method === 'POST' && pathname === PREFIX) {
    const body = await parseJsonBody(req);
    if (!body.action || !body.summary) {
      return sendErr(res, 400, '"action" and "summary" are required', { code: 'VALIDATION_ERROR' }), true;
    }
    await logActivity({
      action:     body.action,
      actor:      body.actor,
      entityType: body.entityType || body.entity_type,
      entityId:   body.entityId   || body.entity_id,
      summary:    body.summary,
      meta:       body.meta,
    });
    return sendOk(res, 201, { logged: true }, { logged: true }), true;
  }

  return false;
}

module.exports = { handle, manifest };
