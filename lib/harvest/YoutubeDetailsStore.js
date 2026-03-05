
const { sbQuery, tableConfig } = require('../supabase');

// Resolve the harvest youtube details table name (env var > settings > default)
function ytTable() { return tableConfig().harvestYoutubeDetails; }

// Thin alias so existing supabaseRequest({...}) call sites work unchanged
function supabaseRequest(opts) {
  return sbQuery({ ...opts, headers: opts.headers || {} });
}

// Thin alias so existing supabaseConfig().table call sites work unchanged
function supabaseConfig() { return { table: ytTable() }; }
function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function wasContactCaptured(run) {
  return run?.request_json?.capture_contact === true || run?.result_json?.contact_captured === true;
}

function runSummary(run) {
  const owner = run?.result_json?.channel_owner || {};
  const rawProfileUrl = String(owner.profile_url || '').trim();
  const channelId = String(owner.channel_id || '').trim();
  const ownerName = String(owner.name || run?.channel_name || '').trim();
  const channelUrl = rawProfileUrl
    || (channelId ? `https://www.youtube.com/channel/${encodeURIComponent(channelId)}` : '')
    || (ownerName ? `https://www.youtube.com/results?search_query=${encodeURIComponent(ownerName)}` : '');
  return {
    run_id: run?.run_id || '',
    video_url: run?.video_url || '',
    video_id: run?.video_id || '',
    category: String(run?.category || '').trim(),
    tags: String(run?.tags || '').trim(),
    contact_captured: wasContactCaptured(run),
    title: run?.title || '',
    channel_name: run?.channel_name || '',
    channel_url: channelUrl,
    transcript_status: run?.transcript_status || 'unavailable',
    transcript_source: run?.transcript_source || 'none',
    transcript_provider: run?.transcript_provider || 'youtube-native',
    created_at: run?.created_at || '',
    updated_at: run?.updated_at || ''
  };
}

function rowFromResult(input, result, runId = makeId('ytrun')) {
  const now = new Date().toISOString();
  const video = result?.video || {};
  const owner = result?.channel_owner || {};
  return {
    run_id: runId,
    video_url: String(input?.video_url || video.url || '').trim(),
    video_id: String(video.id || '').trim(),
    category: String(input?.category || '').trim(),
    tags: String(input?.tags || '').trim(),
    title: String(video.title || '').trim(),
    channel_name: String(owner.name || '').trim(),
    transcript_status: String(video.transcript_status || 'unavailable'),
    transcript_source: String(video.transcript_source || 'none'),
    transcript_provider: String(video.transcript_provider || 'youtube-native'),
    request_json: {
      video_url: String(input?.video_url || '').trim(),
      capture_contact: input?.capture_contact === true,
      manual_confirmed: input?.manual_confirmed === true
    },
    result_json: result || {},
    created_at: now,
    updated_at: now
  };
}

async function createYoutubeHarvestRun(input, result) {
  const cfg = supabaseConfig();
  const row = rowFromResult(input, result);
  const res = await supabaseRequest({
    method: 'POST',
    table: cfg.table,
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row]
  });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 201,
    data: (Array.isArray(res.data) && res.data[0]) || row
  };
}

async function listYoutubeHarvestRuns(limit = 20) {
  const cfg = supabaseConfig();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 200));
  const res = await supabaseRequest({
    method: 'GET',
    table: cfg.table,
    query: `select=run_id,video_url,video_id,category,tags,title,channel_name,transcript_status,transcript_source,transcript_provider,request_json,result_json,created_at,updated_at&order=created_at.desc&limit=${safeLimit}`
  });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 200,
    data: Array.isArray(res.data) ? res.data.map(runSummary) : []
  };
}

async function getYoutubeHarvestRun(runId) {
  const cfg = supabaseConfig();
  const id = String(runId || '').trim();
  if (!id) return { ok: false, status: 400, error: 'run_id is required' };
  const res = await supabaseRequest({
    method: 'GET',
    table: cfg.table,
    query: `run_id=eq.${encodeURIComponent(id)}&select=*`
  });
  if (!res.ok) return res;
  const row = (Array.isArray(res.data) && res.data[0]) || null;
  if (!row) return { ok: false, status: 404, error: 'Run not found' };
  return {
    ok: true,
    status: 200,
    data: {
      ...row,
      contact_captured: wasContactCaptured(row),
      request: row.request_json || {},
      result: row.result_json || {}
    }
  };
}

async function updateYoutubeHarvestRun(runId, patch) {
  const cfg = supabaseConfig();
  const id = String(runId || '').trim();
  if (!id) return { ok: false, status: 400, error: 'run_id is required' };

  const row = { ...patch, updated_at: new Date().toISOString() };
  return supabaseRequest({
    method: 'PATCH',
    table: cfg.table,
    query: `run_id=eq.${encodeURIComponent(id)}&select=*`,
    headers: { Prefer: 'return=representation' },
    body: row
  }).then((res) => {
    if (!res.ok) return res;
    const updated = (Array.isArray(res.data) && res.data[0]) || null;
    if (!updated) return { ok: false, status: 404, error: 'Run not found' };
    return { ok: true, status: 200, data: updated };
  });
}

async function deleteYoutubeHarvestRun(runId) {
  const cfg = supabaseConfig();
  const id = String(runId || '').trim();
  if (!id) return { ok: false, error: 'run_id is required', status: 400 };
  return supabaseRequest({
    method: 'DELETE',
    table: cfg.table,
    query: `run_id=eq.${encodeURIComponent(id)}`,
    headers: { Prefer: 'return=representation' }
  }).then((res) => {
    if (!res.ok) return res;
    const deleted = Array.isArray(res.data) && res.data.length > 0;
    if (!deleted) return { ok: false, status: 404, error: 'Run not found' };
    return { ok: true, status: 200, data: { deleted: true, run_id: id } };
  });
}

module.exports = {
  createYoutubeHarvestRun,
  listYoutubeHarvestRuns,
  getYoutubeHarvestRun,
  updateYoutubeHarvestRun,
  deleteYoutubeHarvestRun,
  runSummary
};
