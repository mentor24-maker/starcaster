'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { sbQuery, tableConfig, isConfigured: isSupabaseConfigured } = require('./supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow } = require('./projectScope');
const { matchesScopedRecord, attachScopeFields, normalizeScope } = require('./projectScopeFile');

const PREFERRED_STORE_FILE = path.join(__dirname, '..', 'data', 'direct_acquire_runs.json');
const FALLBACK_STORE_FILE = path.join(os.tmpdir(), 'starcaster', 'direct_acquire_runs.json');
const SUPPORT_CACHE = new Map();
let resolvedStoreFile = '';

function table() {
  return tableConfig().directAcquireRuns;
}

function canWriteToDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function getStoreFile() {
  if (resolvedStoreFile) return resolvedStoreFile;
  const configured = String(process.env.DIRECT_ACQUIRE_STORE_FILE || '').trim();
  if (configured) {
    const configuredDir = path.dirname(configured);
    if (canWriteToDir(configuredDir)) {
      resolvedStoreFile = configured;
      return resolvedStoreFile;
    }
  }
  const preferredDir = path.dirname(PREFERRED_STORE_FILE);
  if (canWriteToDir(preferredDir)) {
    resolvedStoreFile = PREFERRED_STORE_FILE;
    return resolvedStoreFile;
  }
  const fallbackDir = path.dirname(FALLBACK_STORE_FILE);
  canWriteToDir(fallbackDir);
  resolvedStoreFile = FALLBACK_STORE_FILE;
  return resolvedStoreFile;
}

function ensureFileStore() {
  const storeFile = getStoreFile();
  const dir = path.dirname(storeFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(storeFile)) {
    fs.writeFileSync(storeFile, JSON.stringify({ runs: [] }, null, 2));
  }
}

function readFileStore() {
  ensureFileStore();
  try {
    const raw = fs.readFileSync(getStoreFile(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.runs)) return { runs: [] };
    return parsed;
  } catch {
    return { runs: [] };
  }
}

function writeFileStore(store) {
  ensureFileStore();
  const storeFile = getStoreFile();
  const tmp = `${storeFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, storeFile);
}

function isMissingTableError(errorInput) {
  const text = String(errorInput || '').toLowerCase();
  return text.includes('does not exist') || text.includes('relation') || text.includes('schema cache');
}

async function supportsSupabaseRuns() {
  if (!isSupabaseConfigured()) return false;
  const tableName = table();
  if (!tableName) return false;
  if (SUPPORT_CACHE.has(tableName)) return SUPPORT_CACHE.get(tableName);
  const probe = await sbQuery({ table: tableName, query: 'select=run_id&limit=1' });
  const supported = probe.ok || !isMissingTableError(probe.error);
  SUPPORT_CACHE.set(tableName, supported);
  return supported;
}

function summarizeRun(run) {
  if (!run || typeof run !== 'object') return null;
  return {
    run_id: String(run.run_id || run.runId || ''),
    source_url: String(run.source_url || run.sourceUrl || ''),
    pages_succeeded: Number(run.pages_succeeded || run.pagesSucceeded || 0) || 0,
    pages_failed: Number(run.pages_failed || run.pagesFailed || 0) || 0,
    started_at: String(run.started_at || run.startedAt || ''),
    finished_at: String(run.finished_at || run.finishedAt || ''),
    project_id: String(run.project_id || run.projectId || ''),
    owner_user_id: String(run.owner_user_id || run.ownerUserId || ''),
    detected_model_id: String(run.detected_model_id || run.detectedModelId || '') || null,
  };
}

function normalizeSourceUrlKey(url) {
  return String(url || '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');
}

async function saveDirectAcquireRun(run, scope = null) {
  if (!run || typeof run !== 'object') return;
  const summary = summarizeRun(run);
  if (!summary.run_id) return;

  if (await supportsSupabaseRuns()) {
    // Delete any existing runs for this source URL (keep only the latest).
    if (summary.source_url) {
      const delQuery = await scopedListQuery(
        table(),
        `source_url=eq.${encodeURIComponent(summary.source_url)}`,
        scope
      );
      await sbQuery({ method: 'DELETE', table: table(), query: delQuery, headers: { Prefer: 'return=minimal' } })
        .catch(() => {});
    }
    const row = await scopedInsertRow(table(), {
      run_id: summary.run_id,
      source_url: summary.source_url,
      pages_succeeded: summary.pages_succeeded,
      pages_failed: summary.pages_failed,
      started_at: summary.started_at || null,
      finished_at: summary.finished_at || null,
      detected_model_id: summary.detected_model_id || null,
      run_json: run,
    }, scope);
    await sbQuery({
      method: 'POST',
      table: table(),
      query: 'on_conflict=run_id',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: row,
    });
    return;
  }

  const store = readFileStore();
  const scopedRun = attachScopeFields({ ...run }, scope);
  const newKey = normalizeSourceUrlKey(summary.source_url);
  // Remove existing runs for the same source URL and any duplicate run_id.
  store.runs = store.runs.filter((item) => {
    if (String(item.run_id) === summary.run_id) return false;
    if (matchesScopedRecord(item, scope) && normalizeSourceUrlKey(String(item.source_url || '')) === newKey) return false;
    return true;
  });
  store.runs.unshift(scopedRun);
  store.runs = store.runs.slice(0, 100);
  writeFileStore(store);
}

async function listDirectAcquireRuns(limit = 20, scope = null) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));

  if (await supportsSupabaseRuns()) {
    const query = await scopedListQuery(
      table(),
      `select=run_id,source_url,pages_succeeded,pages_failed,started_at,finished_at,detected_model_id,project_id,owner_user_id,created_at&order=created_at.desc&limit=${safeLimit}`,
      scope
    );
    const result = await sbQuery({ table: table(), query });
    if (result.ok) {
      return (Array.isArray(result.data) ? result.data : []).map(summarizeRun).filter(Boolean);
    }
  }

  const store = readFileStore();
  return store.runs
    .filter((run) => matchesScopedRecord(run, scope))
    .slice(0, safeLimit)
    .map(summarizeRun)
    .filter(Boolean);
}

async function getDirectAcquireRun(runId, scope = null) {
  const id = String(runId || '').trim();
  if (!id) return null;

  if (await supportsSupabaseRuns()) {
    const query = await scopedIdQuery(table(), `select=*&run_id=eq.${encodeURIComponent(id)}&limit=1`, scope);
    const result = await sbQuery({ table: table(), query });
    if (result.ok) {
      const row = Array.isArray(result.data) ? result.data[0] : result.data;
      if (!row) return null;
      const payload = row.run_json && typeof row.run_json === 'object' ? row.run_json : row;
      return attachScopeFields({ ...payload, run_id: row.run_id || id }, {
        projectId: row.project_id,
        userId: row.owner_user_id,
      });
    }
  }

  const store = readFileStore();
  const run = store.runs.find((item) => String(item.run_id) === id);
  if (!run || !matchesScopedRecord(run, scope)) return null;
  return run;
}

async function getLatestDirectAcquireRun(scope = null) {
  const runs = await listDirectAcquireRuns(1, scope);
  if (!runs.length) return null;
  return getDirectAcquireRun(runs[0].run_id, scope);
}

async function deleteDirectAcquireRun(runId, scope = null) {
  const id = String(runId || '').trim();
  if (!id) return;

  if (await supportsSupabaseRuns()) {
    const query = await scopedIdQuery(table(), `run_id=eq.${encodeURIComponent(id)}`, scope);
    await sbQuery({ method: 'DELETE', table: table(), query, headers: { Prefer: 'return=minimal' } });
    return;
  }

  const store = readFileStore();
  store.runs = store.runs.filter(
    (item) => !(String(item.run_id) === id && matchesScopedRecord(item, scope))
  );
  writeFileStore(store);
}

async function purgeOldAcquireRuns(scope = null) {
  const runs = await listDirectAcquireRuns(100, scope);
  if (runs.length <= 1) return 0;
  const toDelete = runs.slice(1); // runs[0] is most recent
  await Promise.allSettled(toDelete.map((r) => deleteDirectAcquireRun(r.run_id, scope)));
  return toDelete.length;
}

async function patchDirectAcquireRunPages(runId, { deleteUrls = [], editPage = null } = {}, scope = null) {
  const run = await getDirectAcquireRun(runId, scope);
  if (!run) return { ok: false, status: 404, error: 'Run not found' };

  let pages = Array.isArray(run.pages) ? run.pages.slice() : [];

  if (deleteUrls.length) {
    const deleteSet = new Set(deleteUrls.map((u) => String(u || '').trim()).filter(Boolean));
    pages = pages.filter((p) => !deleteSet.has(String(p.url || '').trim()));
  }

  if (editPage && typeof editPage === 'object') {
    const editUrl = String(editPage.url || '').trim();
    pages = pages.map((p) => {
      if (String(p.url || '').trim() !== editUrl) return p;
      const updated = { ...p };
      if (typeof editPage.title === 'string') updated.title = editPage.title;
      if (Array.isArray(editPage.emails)) updated.emails = editPage.emails;
      return updated;
    });
  }

  const updatedRun = { ...run, pages, pages_succeeded: pages.length };
  await saveDirectAcquireRun(updatedRun, scope);
  return { ok: true, data: updatedRun };
}

module.exports = {
  saveDirectAcquireRun,
  listDirectAcquireRuns,
  getDirectAcquireRun,
  getLatestDirectAcquireRun,
  deleteDirectAcquireRun,
  purgeOldAcquireRuns,
  patchDirectAcquireRunPages,
};
