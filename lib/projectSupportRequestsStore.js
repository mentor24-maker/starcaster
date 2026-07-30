'use strict';

/**
 * Support requests raised by a tenant admin from their own admin area
 * (the Support page at e.g. brandonmarinoff.com/admin-support).
 *
 * Direction matters: this is the site owner asking Alphire for help, not a
 * visitor contacting the site owner. Visitor enquiries are CRM contacts and
 * notify site_settings.contactAlertEmail; these notify supportAlertEmail.
 *
 * Requires docs/SQL/project_support_requests.sql to be applied.
 */

const { sbQuery, isConfigured: isSupabaseConfigured } = require('./supabase');

const TABLE = 'app_project_support_requests';

/** Accepted priorities, lowest to highest. Mirrored by a CHECK constraint. */
const PRIORITIES = Object.freeze(['low', 'normal', 'high', 'urgent']);
const DEFAULT_PRIORITY = 'normal';

const MAX_TITLE_CHARS = 200;
const MAX_DESCRIPTION_CHARS = 5000;
/** Newest-first cap for the "your recent requests" list. */
const DEFAULT_LIST_LIMIT = 25;
const MAX_LIST_LIMIT = 100;

function newId() {
  return `support_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function requireSupabase() {
  if (!isSupabaseConfigured()) {
    return { ok: false, status: 503, error: 'Support requests require Supabase configuration' };
  }
  return null;
}

function normalizePriority(value) {
  const v = String(value ?? '').trim().toLowerCase();
  return PRIORITIES.includes(v) ? v : DEFAULT_PRIORITY;
}

function clamp(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

/** DB row -> API shape. camelCase out, matching the rest of the API. */
function rowToRequest(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: String(row.id || ''),
    projectId: String(row.project_id || ''),
    adminUserId: row.admin_user_id ? String(row.admin_user_id) : '',
    adminEmail: String(row.admin_email || ''),
    priority: normalizePriority(row.priority),
    title: String(row.title || ''),
    description: String(row.description || ''),
    screenshotUrl: String(row.screenshot_url || ''),
    screenshotName: String(row.screenshot_name || ''),
    status: String(row.status || 'open'),
    createdAt: row.created_at || null,
  };
}

/**
 * Insert one support request.
 *
 * projectId is the caller's own project — routes/index.js pins it from the
 * project-admin session, so a tenant cannot file against someone else's site.
 */
async function createSupportRequest(input, scope = {}) {
  const err = requireSupabase();
  if (err) return err;

  const projectId = String(scope.projectId || '').trim();
  if (!projectId) return { ok: false, status: 400, error: 'projectId is required' };

  const title = clamp(input?.title, MAX_TITLE_CHARS);
  if (!title) return { ok: false, status: 400, error: 'Issue title is required' };

  const row = {
    id: newId(),
    project_id: projectId,
    admin_user_id: String(scope.adminUserId || '').trim() || null,
    admin_email: String(scope.adminEmail || '').trim().toLowerCase(),
    priority: normalizePriority(input?.priority),
    title,
    description: clamp(input?.description, MAX_DESCRIPTION_CHARS),
    screenshot_url: String(input?.screenshotUrl || '').trim(),
    screenshot_name: clamp(input?.screenshotName, 255),
    status: 'open',
  };

  const result = await sbQuery({
    method: 'POST',
    table: TABLE,
    body: row,
    headers: { Prefer: 'return=representation' },
  });
  if (!result.ok) {
    return { ok: false, status: result.status || 500, error: result.error || 'Failed to save the support request' };
  }

  const created = Array.isArray(result.data) ? (result.data[0] || null) : result.data;
  return { ok: true, status: 201, data: rowToRequest(created) || rowToRequest(row) };
}

/** Newest-first list for one project. */
async function listSupportRequests(projectIdInput, options = {}) {
  const err = requireSupabase();
  if (err) return err;

  const projectId = String(projectIdInput || '').trim();
  if (!projectId) return { ok: false, status: 400, error: 'projectId is required' };

  const requested = Number(options.limit);
  const limit = Number.isFinite(requested) && requested > 0
    ? Math.min(Math.floor(requested), MAX_LIST_LIMIT)
    : DEFAULT_LIST_LIMIT;

  const result = await sbQuery({
    method: 'GET',
    table: TABLE,
    query: `select=*&project_id=eq.${encodeURIComponent(projectId)}`
      + `&order=created_at.desc&limit=${limit}`,
  });
  if (!result.ok) {
    return { ok: false, status: result.status || 500, error: result.error || 'Failed to read support requests' };
  }

  const rows = Array.isArray(result.data) ? result.data : [];
  return { ok: true, status: 200, data: rows.map(rowToRequest).filter(Boolean) };
}

module.exports = {
  createSupportRequest,
  listSupportRequests,
  normalizePriority,
  rowToRequest,
  PRIORITIES,
  DEFAULT_PRIORITY,
  MAX_TITLE_CHARS,
  MAX_DESCRIPTION_CHARS,
  MAX_LIST_LIMIT,
};
