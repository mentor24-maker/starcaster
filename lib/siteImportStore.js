'use strict';

/**
 * Site Import — job + asset bookkeeping over Supabase.
 *
 * Shared by the operator-run worker (scripts/site_import_worker.mjs) and
 * the staff API (routes/siteImport.js). Rows hold status, coverage, and
 * URLs only; captured HTML, screenshots, and downloaded assets live in
 * Vercel Blob under SiteImport/<jobId>/ (see lib/site-import/ and
 * docs/site-import/01-capture-and-ir.md).
 *
 * Requires docs/SQL/site_import_setup.sql to be applied.
 */

const { sbQuery, isConfigured: isSupabaseConfigured } = require('./supabase');

const JOBS_TABLE = 'app_site_import_jobs';
const ASSETS_TABLE = 'app_site_import_assets';

const JOB_STATUSES = Object.freeze([
  'queued', 'capturing', 'normalizing', 'extracting', 'complete', 'failed',
]);

/** Hard caps (spec §1a). Every one is per-job configurable; a job stopped
 *  by a cap ends 'complete' with the cap recorded in coverage.caps.hit. */
const DEFAULT_CAPS = Object.freeze({
  maxPages: 60,
  maxDepth: 4,
  maxBrowserSeconds: 900,
  maxTotalAssetBytes: 500 * 1024 * 1024,
  maxSingleAssetBytes: 50 * 1024 * 1024,
  pageTimeoutMs: 60 * 1000,
});

function newJobId() {
  return `simp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function newAssetId() {
  return `simpa_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function requireSupabase() {
  if (!isSupabaseConfigured()) {
    return { ok: false, status: 503, error: 'Site Import requires Supabase configuration' };
  }
  return null;
}

/** Merge partial caps over the defaults; anything non-numeric or absurd
 *  falls back rather than erroring — caps guard cost, not correctness. */
function normalizeCaps(raw) {
  const caps = { ...DEFAULT_CAPS };
  if (raw && typeof raw === 'object') {
    for (const key of Object.keys(DEFAULT_CAPS)) {
      const value = Number(raw[key]);
      if (Number.isFinite(value) && value > 0) caps[key] = Math.floor(value);
    }
  }
  return caps;
}

function jsonOrDefault(value, fallback) {
  if (value && typeof value === 'object') return value;
  return fallback;
}

/** DB row -> API/worker shape. camelCase out, like the other stores. */
function rowToJob(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: String(row.id || ''),
    projectId: String(row.project_id || ''),
    ownerUserId: row.owner_user_id ? String(row.owner_user_id) : '',
    sourceUrl: String(row.source_url || ''),
    status: String(row.status || 'queued'),
    claimedAt: row.claimed_at || null,
    claimedBy: row.claimed_by ? String(row.claimed_by) : '',
    attempts: Number(row.attempts || 0),
    clientAuthorization: row.client_authorization ? String(row.client_authorization) : '',
    checkpoints: jsonOrDefault(row.checkpoints, {}),
    coverage: jsonOrDefault(row.coverage, {}),
    cost: jsonOrDefault(row.cost, {}),
    // caps column ships in the worker slice of site_import_setup.sql; a
    // row from before that alter simply gets the defaults.
    caps: normalizeCaps(row.caps),
    error: String(row.error || ''),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null,
  };
}

function rowToAsset(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: String(row.id || ''),
    jobId: String(row.job_id || ''),
    projectId: String(row.project_id || ''),
    originalUrl: String(row.original_url || ''),
    storageUrl: String(row.storage_url || ''),
    contentHash: String(row.content_hash || ''),
    mimeType: String(row.mime_type || ''),
    byteSize: Number(row.byte_size || 0),
    width: row.width == null ? undefined : Number(row.width),
    height: row.height == null ? undefined : Number(row.height),
    altText: String(row.alt_text || ''),
    referencedBy: Array.isArray(row.referenced_by) ? row.referenced_by : [],
    status: String(row.status || 'pending'),
    error: String(row.error || ''),
  };
}

async function createJob({ projectId, ownerUserId, sourceUrl, caps, clientAuthorization }) {
  const guard = requireSupabase();
  if (guard) return guard;
  const row = {
    id: newJobId(),
    project_id: String(projectId || ''),
    owner_user_id: ownerUserId ? String(ownerUserId) : null,
    source_url: String(sourceUrl || ''),
    status: 'queued',
    caps: normalizeCaps(caps),
    client_authorization: clientAuthorization ? String(clientAuthorization) : null,
  };
  if (!row.project_id) return { ok: false, status: 400, error: 'projectId is required' };
  if (!row.source_url) return { ok: false, status: 400, error: 'sourceUrl is required' };
  const res = await sbQuery({
    method: 'POST',
    table: JOBS_TABLE,
    body: [row],
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return res;
  return { ok: true, status: 201, data: rowToJob(res.data && res.data[0]) };
}

async function getJob(id, projectId) {
  const guard = requireSupabase();
  if (guard) return guard;
  let query = `id=eq.${encodeURIComponent(id)}&limit=1`;
  if (projectId) query += `&project_id=eq.${encodeURIComponent(projectId)}`;
  const res = await sbQuery({ table: JOBS_TABLE, query });
  if (!res.ok) return res;
  const job = rowToJob(Array.isArray(res.data) ? res.data[0] : null);
  if (!job) return { ok: false, status: 404, error: 'Job not found' };
  return { ok: true, status: 200, data: job };
}

async function listJobs(projectId, limit = 50) {
  const guard = requireSupabase();
  if (guard) return guard;
  const capped = Math.min(Math.max(1, Number(limit) || 50), 200);
  const res = await sbQuery({
    table: JOBS_TABLE,
    query: `project_id=eq.${encodeURIComponent(projectId)}&order=created_at.desc&limit=${capped}`,
  });
  if (!res.ok) return res;
  return { ok: true, status: 200, data: (res.data || []).map(rowToJob).filter(Boolean) };
}

/**
 * Atomic claim (spec §1a): the `claimed_at=is.null` filter makes the
 * PATCH a compare-and-set — first claimer wins, losers get zero rows
 * back. attempts is read-then-written, which is fine for the intended
 * single local worker; the claim itself stays race-safe regardless.
 */
async function claimJob(id, claimedBy) {
  const guard = requireSupabase();
  if (guard) return guard;
  const current = await getJob(id);
  if (!current.ok) return current;
  const res = await sbQuery({
    method: 'PATCH',
    table: JOBS_TABLE,
    query: `id=eq.${encodeURIComponent(id)}&claimed_at=is.null`,
    body: {
      claimed_at: new Date().toISOString(),
      claimed_by: String(claimedBy || ''),
      attempts: current.data.attempts + 1,
      updated_at: new Date().toISOString(),
    },
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return res;
  const job = rowToJob(Array.isArray(res.data) ? res.data[0] : null);
  if (!job) return { ok: false, status: 409, error: 'Job already claimed' };
  return { ok: true, status: 200, data: job };
}

/** Oldest queued job that we managed to claim, or null when none. */
async function claimNextQueued(claimedBy) {
  const guard = requireSupabase();
  if (guard) return guard;
  const res = await sbQuery({
    table: JOBS_TABLE,
    query: 'status=eq.queued&claimed_at=is.null&order=created_at.asc&limit=5',
  });
  if (!res.ok) return res;
  for (const row of res.data || []) {
    const claimed = await claimJob(row.id, claimedBy);
    if (claimed.ok) return claimed;
    if (claimed.status !== 409) return claimed; // real error, surface it
  }
  return { ok: true, status: 200, data: null };
}

/** Free claims whose jobs went quiet (worker died mid-run): claimed,
 *  unfinished, and untouched for `minutes`. They go back to 'queued'. */
async function reclaimStale(minutes) {
  const guard = requireSupabase();
  if (guard) return guard;
  const cutoff = new Date(Date.now() - Math.max(1, Number(minutes) || 30) * 60000).toISOString();
  const res = await sbQuery({
    method: 'PATCH',
    table: JOBS_TABLE,
    query:
      `claimed_at=not.is.null&finished_at=is.null&updated_at=lt.${encodeURIComponent(cutoff)}`,
    body: { claimed_at: null, claimed_by: null, status: 'queued', updated_at: new Date().toISOString() },
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return res;
  return { ok: true, status: 200, data: (res.data || []).map(rowToJob).filter(Boolean) };
}

async function updateJob(id, patch) {
  const guard = requireSupabase();
  if (guard) return guard;
  const res = await sbQuery({
    method: 'PATCH',
    table: JOBS_TABLE,
    query: `id=eq.${encodeURIComponent(id)}`,
    body: { ...patch, updated_at: new Date().toISOString() },
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return res;
  return { ok: true, status: 200, data: rowToJob(Array.isArray(res.data) ? res.data[0] : null) };
}

/** Bulk-insert pending asset rows (capture stage). */
async function insertAssets(rows) {
  const guard = requireSupabase();
  if (guard) return guard;
  if (!Array.isArray(rows) || !rows.length) return { ok: true, status: 200, data: [] };
  const res = await sbQuery({
    method: 'POST',
    table: ASSETS_TABLE,
    body: rows.map((r) => ({
      id: r.id || newAssetId(),
      job_id: String(r.jobId || ''),
      project_id: String(r.projectId || ''),
      original_url: String(r.originalUrl || ''),
      alt_text: String(r.altText || ''),
      referenced_by: Array.isArray(r.referencedBy) ? r.referencedBy : [],
      status: 'pending',
    })),
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return res;
  return { ok: true, status: 201, data: (res.data || []).map(rowToAsset).filter(Boolean) };
}

async function updateAsset(id, patch) {
  const guard = requireSupabase();
  if (guard) return guard;
  const res = await sbQuery({
    method: 'PATCH',
    table: ASSETS_TABLE,
    query: `id=eq.${encodeURIComponent(id)}`,
    body: patch,
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return res;
  return { ok: true, status: 200, data: rowToAsset(Array.isArray(res.data) ? res.data[0] : null) };
}

// A large crawl downloads more assets than one page can return — the
// delraytennis job alone recorded 2,067 — and a caller that reads only the
// first 2,000 cannot tell a complete list from a truncated one. So the
// window is explicit and callers that need everything can page through it.
const ASSET_PAGE_LIMIT = 2000;

async function listAssets(jobId, options = {}) {
  const guard = requireSupabase();
  if (guard) return guard;
  const limit = Math.min(Math.max(1, Number(options.limit) || ASSET_PAGE_LIMIT), ASSET_PAGE_LIMIT);
  const offset = Math.max(0, Number(options.offset) || 0);
  const res = await sbQuery({
    table: ASSETS_TABLE,
    query: `job_id=eq.${encodeURIComponent(jobId)}&order=created_at.asc&limit=${limit}&offset=${offset}`,
  });
  if (!res.ok) return res;
  return { ok: true, status: 200, data: (res.data || []).map(rowToAsset).filter(Boolean) };
}

module.exports = {
  JOB_STATUSES,
  DEFAULT_CAPS,
  normalizeCaps,
  rowToJob,
  rowToAsset,
  createJob,
  getJob,
  listJobs,
  claimJob,
  claimNextQueued,
  reclaimStale,
  updateJob,
  insertAssets,
  updateAsset,
  listAssets,
  ASSET_PAGE_LIMIT,
};
