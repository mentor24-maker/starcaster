const fs = require('fs');
const path = require('path');

const MIRROR_FILE = path.join(__dirname, '..', 'data', 'acquire_jobs.json');

function ensureMirrorFile() {
  const dir = path.dirname(MIRROR_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(MIRROR_FILE)) {
    fs.writeFileSync(MIRROR_FILE, JSON.stringify({ jobs: [] }, null, 2));
  }
}

function readMirror() {
  ensureMirrorFile();
  try {
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

function writeMirror(store) {
  ensureMirrorFile();
  const tmp = `${MIRROR_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, MIRROR_FILE);
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

function upsertMirroredAcquireJob(action, request, responseBody) {
  const result = responseBody?.result || responseBody || {};
  const jobId = normalizeJobId(action, request, result);
  if (!jobId) return;

  const store = readMirror();
  const nowIso = new Date().toISOString();
  const idx = store.jobs.findIndex((j) => String(j.id) === jobId);
  const current = idx >= 0 ? store.jobs[idx] : {};

  const next = {
    id: jobId,
    stage: stageFromResult(result, current.stage),
    workspace_id: String(request?.workspace_id || current.workspace_id || ''),
    type: String(request?.type || current.type || ''),
    url: sourceUrlFromRequest(action, request, current.url),
    created_at: current.created_at || nowIso,
    updated_at: nowIso
  };

  if (idx >= 0) {
    store.jobs[idx] = next;
  } else {
    store.jobs.unshift(next);
  }

  store.jobs.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  writeMirror(store);
}

function listMirroredAcquireJobs(limit = 200) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 1000));
  const store = readMirror();
  const jobs = Array.isArray(store.jobs) ? store.jobs.slice(0, safeLimit) : [];
  return jobs;
}

function deleteMirroredAcquireJob(jobId) {
  const id = String(jobId || '').trim();
  if (!id) return { ok: false, status: 400, error: 'job_id is required' };
  const store = readMirror();
  const before = store.jobs.length;
  store.jobs = store.jobs.filter((j) => String(j.id) !== id);
  if (store.jobs.length === before) {
    return { ok: false, status: 404, error: 'Job not found' };
  }
  writeMirror(store);
  return { ok: true, status: 200, data: { deleted: true, job_id: id } };
}

module.exports = {
  upsertMirroredAcquireJob,
  listMirroredAcquireJobs,
  deleteMirroredAcquireJob
};
