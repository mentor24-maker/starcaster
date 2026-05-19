'use strict';

const fs = require('fs');
const path = require('path');
const { sbQuery, isConfigured: isSupabaseConfigured, tableConfig } = require('./supabase');
const { scopedListQuery, scopedIdQuery } = require('./projectScope');
const { attachScopeFields, matchesScopedRecord, normalizeScope } = require('./projectScopeFile');
const { writeJsonAtomic, ensureJsonFile } = require('./localDataFs');

const MIRROR_FILE = path.join(__dirname, '..', 'data', 'acquire_jobs.json');
const SUPPORT_CACHE = { value: null };

function mirrorTable() {
  return tableConfig().acquireJobMirror;
}

function isMissingTableError(errorInput) {
  const text = String(errorInput || '').toLowerCase();
  return text.includes('does not exist') || text.includes('relation') || text.includes('schema cache');
}

async function supportsSupabaseMirror() {
  if (!isSupabaseConfigured()) return false;
  if (SUPPORT_CACHE.value !== null) return SUPPORT_CACHE.value;
  const table = mirrorTable();
  const probe = await sbQuery({ table, query: 'select=id&limit=1' });
  SUPPORT_CACHE.value = probe.ok || !isMissingTableError(probe.error);
  return SUPPORT_CACHE.value;
}

function normalizeJobId(action, request, result) {
  if (result?.job?.id) return String(result.job.id);
  if (result?.job_id) return String(result.job_id);
  if (request?.job_id) return String(request.job_id);
  return '';
}

function sourceUrlFromRequest(action, request, existingUrl) {
  if (action !== 'create_job') return existingUrl || '';
  const urls = request?.payload && Array.isArray(request.payload.source_urls)
    ? request.payload.source_urls
    : [];
  return String(urls[0] || existingUrl || '').trim();
}

function stageFromResult(result, fallback) {
  const status = String(
    result?.status ||
    result?.job?.status ||
    result?.job_status ||
    fallback ||
    ''
  ).trim();
  return status || fallback || '';
}

function jobFromRow(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: String(row.id || ''),
    stage: String(row.stage || ''),
    workspace_id: String(row.workspace_id || ''),
    type: String(row.type || ''),
    url: String(row.url || ''),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    project_id: String(row.project_id || ''),
    projectId: String(row.project_id || ''),
    owner_user_id: String(row.owner_user_id || ''),
    ownerUserId: String(row.owner_user_id || ''),
  };
}

function readFileStore() {
  try {
    ensureJsonFile(MIRROR_FILE, { jobs: [] });
    if (!fs.existsSync(MIRROR_FILE)) return { jobs: [] };
    const raw = fs.readFileSync(MIRROR_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.jobs)) {
      return { jobs: [] };
    }
    return parsed;
  } catch {
    return { jobs: [] };
  }
}

function writeFileStore(store) {
  writeJsonAtomic(MIRROR_FILE, store);
}

async function listFromFile(scope, limit) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 1000));
  const store = readFileStore();
  return (Array.isArray(store.jobs) ? store.jobs : [])
    .filter((job) => matchesScopedRecord(job, scope))
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
    .slice(0, safeLimit)
    .map((job) => ({
      id: String(job.id || ''),
      stage: String(job.stage || ''),
      workspace_id: String(job.workspace_id || ''),
      type: String(job.type || ''),
      url: String(job.url || ''),
      created_at: job.created_at || null,
      updated_at: job.updated_at || null,
    }));
}

async function upsertMirroredAcquireJob(action, request, responseBody, scope = null) {
  const result = responseBody?.result || responseBody || {};
  const jobId = normalizeJobId(action, request, result);
  if (!jobId) return;

  const { projectId } = normalizeScope(scope);
  const nowIso = new Date().toISOString();
  let next = {
    id: jobId,
    stage: '',
    workspace_id: String(request?.workspace_id || ''),
    type: String(request?.type || ''),
    url: '',
    created_at: nowIso,
    updated_at: nowIso,
  };

  if (projectId && (await supportsSupabaseMirror())) {
    const table = mirrorTable();
    const existingQuery = await scopedIdQuery(
      table,
      `select=*&id=eq.${encodeURIComponent(jobId)}&limit=1`,
      scope
    );
    const existingRes = await sbQuery({ table, query: existingQuery });
    const current = existingRes.ok && Array.isArray(existingRes.data) ? existingRes.data[0] : null;
    next = {
      id: jobId,
      stage: stageFromResult(result, current?.stage),
      workspace_id: String(request?.workspace_id || current?.workspace_id || ''),
      type: String(request?.type || current?.type || ''),
      url: sourceUrlFromRequest(action, request, current?.url),
      created_at: current?.created_at || nowIso,
      updated_at: nowIso,
    };
    const row = {
      id: next.id,
      project_id: projectId,
      owner_user_id: normalizeScope(scope).userId || null,
      stage: next.stage,
      workspace_id: next.workspace_id,
      type: next.type,
      url: next.url,
      created_at: next.created_at,
      updated_at: next.updated_at,
    };
    const insert = await sbQuery({
      method: 'POST',
      table,
      query: 'on_conflict=project_id,id&select=*',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: [row],
    });
    if (insert.ok) return;
    if (!isMissingTableError(insert.error)) return;
  }

  const store = readFileStore();
  const idx = store.jobs.findIndex((j) => {
    if (String(j.id) !== jobId) return false;
    return matchesScopedRecord(j, scope);
  });
  const current = idx >= 0 ? store.jobs[idx] : {};
  const fileJob = attachScopeFields({
    id: jobId,
    stage: stageFromResult(result, current.stage),
    workspace_id: String(request?.workspace_id || current.workspace_id || ''),
    type: String(request?.type || current.type || ''),
    url: sourceUrlFromRequest(action, request, current.url),
    created_at: current.created_at || nowIso,
    updated_at: nowIso,
  }, scope);

  if (idx >= 0) {
    store.jobs[idx] = fileJob;
  } else {
    store.jobs.unshift(fileJob);
  }
  store.jobs.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  writeFileStore(store);
}

async function listMirroredAcquireJobs(limit = 200, scope = null) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 1000));
  const { projectId } = normalizeScope(scope);

  if (projectId && (await supportsSupabaseMirror())) {
    const table = mirrorTable();
    const query = await scopedListQuery(
      table,
      `select=id,stage,workspace_id,type,url,created_at,updated_at&order=updated_at.desc&limit=${safeLimit}`,
      scope
    );
    const result = await sbQuery({ table, query });
    if (result.ok) {
      return (Array.isArray(result.data) ? result.data : [])
        .map(jobFromRow)
        .filter(Boolean)
        .map((job) => ({
          id: job.id,
          stage: job.stage,
          workspace_id: job.workspace_id,
          type: job.type,
          url: job.url,
          created_at: job.created_at,
          updated_at: job.updated_at,
        }));
    }
    if (!isMissingTableError(result.error)) {
      return listFromFile(scope, safeLimit);
    }
  }

  return listFromFile(scope, safeLimit);
}

async function deleteMirroredAcquireJob(jobId, scope = null) {
  const id = String(jobId || '').trim();
  if (!id) return { ok: false, status: 400, error: 'job_id is required' };

  const { projectId } = normalizeScope(scope);

  if (projectId && (await supportsSupabaseMirror())) {
    const table = mirrorTable();
    const query = await scopedIdQuery(table, `id=eq.${encodeURIComponent(id)}&select=id`, scope);
    const result = await sbQuery({
      method: 'DELETE',
      table,
      query,
      headers: { Prefer: 'return=representation' },
    });
    if (result.ok) {
      const deleted = Array.isArray(result.data) ? result.data.length : 1;
      if (deleted) return { ok: true, status: 200, data: { deleted: true, job_id: id } };
    }
    if (!isMissingTableError(result.error)) {
      return { ok: false, status: result.status || 500, error: String(result.error || 'Could not delete job') };
    }
  }

  const store = readFileStore();
  const before = store.jobs.length;
  store.jobs = store.jobs.filter((j) => {
    if (String(j.id) !== id) return true;
    return !matchesScopedRecord(j, scope);
  });
  if (store.jobs.length === before) {
    return { ok: false, status: 404, error: 'Job not found' };
  }
  writeFileStore(store);
  return { ok: true, status: 200, data: { deleted: true, job_id: id } };
}

module.exports = {
  upsertMirroredAcquireJob,
  listMirroredAcquireJobs,
  deleteMirroredAcquireJob,
};
