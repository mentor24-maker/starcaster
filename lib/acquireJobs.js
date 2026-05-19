const { sbQuery } = require('./supabase');
const { listMirroredAcquireJobs } = require('./acquireMirror');

// Thin alias — acquireJobs uses the ops schema to reach OpenClaw's job table
function supabaseRequest({ method = 'GET', schema = 'public', table, query = '' }) {
  return sbQuery({ method, schema, table, query });
}
function firstSourceUrl(payload) {
  const urls = payload && Array.isArray(payload.source_urls) ? payload.source_urls : [];
  if (!urls.length) return '';
  return String(urls[0] || '').trim();
}

async function listAcquireJobs(limit = 200, scope = null) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 1000));
  const mirrored = await listMirroredAcquireJobs(safeLimit, scope);
  const result = await supabaseRequest({
    method: 'GET',
    schema: 'ops',
    table: 'jobs',
    query: `select=id,status,workspace_id,type,payload,created_at,updated_at&order=updated_at.desc&limit=${safeLimit}`
  });

  if (!result.ok) {
    const msg = String(result.error || '').toLowerCase();
    if (msg.includes('invalid schema') || msg.includes('schema must be one of')) {
      return { ok: true, status: 200, data: mirrored };
    }
    return { ok: true, status: 200, data: mirrored };
  }

  const rows = Array.isArray(result.data) ? result.data : [];
  const dbJobs = rows.map((row) => ({
    id: String(row.id || ''),
    stage: String(row.status || ''),
    workspace_id: String(row.workspace_id || ''),
    type: String(row.type || ''),
    url: firstSourceUrl(row.payload || {}),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  }));

  const byId = new Map();
  dbJobs.forEach((job) => {
    if (!job.id) return;
    byId.set(job.id, job);
  });
  mirrored.forEach((job) => {
    if (!job.id) return;
    if (!byId.has(job.id)) byId.set(job.id, job);
  });

  const jobs = Array.from(byId.values())
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
    .slice(0, safeLimit);

  return { ok: true, status: 200, data: jobs };
}

module.exports = {
  listAcquireJobs
};
