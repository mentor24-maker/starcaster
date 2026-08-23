'use strict';

const { sbQuery, tableConfig } = require('./supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow } = require('./projectScope');

const MAX_DESCRIPTION_LENGTH = 5000;
const VIEWER_TIERS = ['public', 'client', 'staff'];
/** Screenshots a report may carry (task 2/5). The data rule lives here with
 *  the column; lib/projectBugReportScreenshots.js enforces it at the door. */
const MAX_SCREENSHOTS_PER_REPORT = 5;

function table() {
  return tableConfig().projectBugReports;
}

function safeText(value, max = 2000) {
  return String(value || '').trim().slice(0, max);
}

function normalizeViewerTier(value) {
  const tier = safeText(value, 20).toLowerCase();
  return VIEWER_TIERS.includes(tier) ? tier : 'public';
}

function rowToBugReport(row) {
  if (!row) return null;
  return {
    id: safeText(row.id, 120),
    projectId: safeText(row.project_id, 120),
    description: safeText(row.description, MAX_DESCRIPTION_LENGTH),
    pageUrl: safeText(row.page_url, 2000),
    userAgent: safeText(row.user_agent, 500),
    viewerTier: normalizeViewerTier(row.viewer_tier),
    screenshotAssetIds: Array.isArray(row.screenshot_asset_ids) ? row.screenshot_asset_ids : [],
    status: safeText(row.status, 40) || 'new',
    createdAt: row.created_at || '',
  };
}

function inputToRow(input) {
  return {
    description: safeText(input?.description, MAX_DESCRIPTION_LENGTH),
    page_url: safeText(input?.pageUrl || input?.page_url, 2000),
    user_agent: safeText(input?.userAgent || input?.user_agent, 500),
    viewer_tier: normalizeViewerTier(input?.viewerTier || input?.viewer_tier),
    screenshot_asset_ids: normalizeScreenshotAssetIds(input?.screenshotAssetIds),
    status: 'new',
  };
}

/** Positive integer asset ids, de-duplicated, capped at the per-report limit. */
function normalizeScreenshotAssetIds(value) {
  const ids = [];
  for (const item of Array.isArray(value) ? value : []) {
    const id = Number(item);
    if (Number.isInteger(id) && id > 0 && !ids.includes(id)) ids.push(id);
  }
  return ids.slice(0, MAX_SCREENSHOTS_PER_REPORT);
}

async function createBugReport(input, scope = null) {
  const description = safeText(input?.description, MAX_DESCRIPTION_LENGTH);
  if (!description) return { ok: false, status: 400, error: 'A description is required' };
  if (String(input?.description || '').trim().length > MAX_DESCRIPTION_LENGTH) {
    return { ok: false, status: 400, error: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer` };
  }

  const row = await scopedInsertRow(table(), inputToRow(input), scope);
  const res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 201, data: rowToBugReport(created) };
}

async function getBugReportById(id, scope = null) {
  const reportId = safeText(id, 120);
  if (!reportId) return { ok: false, status: 400, error: 'id is required' };
  const query = await scopedIdQuery(table(), `id=eq.${encodeURIComponent(reportId)}&select=*&limit=1`, scope);
  const res = await sbQuery({ method: 'GET', table: table(), query });
  if (!res.ok) return res;
  const found = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!found) return { ok: false, status: 404, error: 'Bug report not found' };
  return { ok: true, status: 200, data: rowToBugReport(found) };
}

const FORWARD_STATUSES = ['forwarded', 'failed_forward'];

/**
 * Record what happened AFTER the row was written: forwarded to ClickUp, or
 * not. Scoped PATCH, verified from the write's own representation — a 200
 * with no row back means the scope filter excluded it, which is a failure.
 */
async function setBugReportForwardStatus(id, status, scope = null) {
  const reportId = safeText(id, 120);
  if (!reportId) return { ok: false, status: 400, error: 'id is required' };
  const next = safeText(status, 40);
  if (!FORWARD_STATUSES.includes(next)) {
    return { ok: false, status: 400, error: `status must be one of ${FORWARD_STATUSES.join(', ')}` };
  }
  const query = await scopedIdQuery(table(), `id=eq.${encodeURIComponent(reportId)}&select=*`, scope);
  const res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
    body: { status: next },
  });
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return { ok: false, status: 404, error: 'Bug report not found in this project' };
  return { ok: true, status: 200, data: rowToBugReport(updated) };
}

async function listBugReports(limit = 200, scope = null) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 1000));
  const query = await scopedListQuery(
    table(),
    `select=*&order=created_at.desc&limit=${safeLimit}`,
    scope
  );
  const res = await sbQuery({ method: 'GET', table: table(), query });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 200,
    data: Array.isArray(res.data) ? res.data.map(rowToBugReport) : [],
  };
}

module.exports = {
  MAX_DESCRIPTION_LENGTH,
  MAX_SCREENSHOTS_PER_REPORT,
  VIEWER_TIERS,
  createBugReport,
  getBugReportById,
  setBugReportForwardStatus,
  listBugReports,
  rowToBugReport,
};
