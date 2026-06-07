
const { sbQuery, tableConfig } = require('../supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow } = require('../projectScope');
const { upsertYoutubeVideoFromDetailRun } = require('./YoutubeVideosStore');

// Resolve the Acquire YouTube details table name (env var > settings > default)
function ytTable() { return tableConfig().acquireYoutubeDetails; }

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
    topic: String(run?.topic || '').trim(),
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
    topic: String(input?.topic || '').trim(),
    tags: String(input?.tags || '').trim(),
    title: String(video.title || input?.title || '').trim(),
    channel_name: String(owner.name || input?.channel_name || '').trim(),
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

async function createYoutubeAcquireRun(input, result, scope = null) {
  const cfg = supabaseConfig();
  const row = await scopedInsertRow(cfg.table, rowFromResult(input, result), scope);
  const res = await supabaseRequest({
    method: 'POST',
    table: cfg.table,
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row]
  });
  if (!res.ok) return res;
  const created = (Array.isArray(res.data) && res.data[0]) || row;
  await upsertYoutubeVideoFromDetailRun(created, scope).catch(() => null);
  return {
    ok: true,
    status: 201,
    data: created
  };
}

async function listYoutubeAcquireRuns(limit = 20, scope = null) {
  const cfg = supabaseConfig();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 200));
  const query = await scopedListQuery(
    cfg.table,
    `select=run_id,video_url,video_id,topic,tags,title,channel_name,transcript_status,transcript_source,transcript_provider,request_json,result_json,created_at,updated_at&order=created_at.desc&limit=${safeLimit}`,
    scope
  );
  const res = await supabaseRequest({
    method: 'GET',
    table: cfg.table,
    query,
  });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 200,
    data: Array.isArray(res.data) ? res.data.map(runSummary) : []
  };
}

async function getYoutubeAcquireRun(runId, scope = null) {
  const cfg = supabaseConfig();
  const id = String(runId || '').trim();
  if (!id) return { ok: false, status: 400, error: 'run_id is required' };
  const query = await scopedIdQuery(cfg.table, `run_id=eq.${encodeURIComponent(id)}&select=*`, scope);
  const res = await supabaseRequest({
    method: 'GET',
    table: cfg.table,
    query,
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

async function updateYoutubeAcquireRun(runId, patch, scope = null) {
  const cfg = supabaseConfig();
  const id = String(runId || '').trim();
  if (!id) return { ok: false, status: 400, error: 'run_id is required' };

  const row = { ...patch, updated_at: new Date().toISOString() };
  const query = await scopedIdQuery(cfg.table, `run_id=eq.${encodeURIComponent(id)}&select=*`, scope);
  return supabaseRequest({
    method: 'PATCH',
    table: cfg.table,
    query,
    headers: { Prefer: 'return=representation' },
    body: row
  }).then((res) => {
    if (!res.ok) return res;
    const updated = (Array.isArray(res.data) && res.data[0]) || null;
    if (!updated) return { ok: false, status: 404, error: 'Run not found' };
    upsertYoutubeVideoFromDetailRun(updated, scope).catch(() => null);
    return { ok: true, status: 200, data: updated };
  });
}

async function deleteYoutubeAcquireRun(runId, scope = null) {
  const cfg = supabaseConfig();
  const id = String(runId || '').trim();
  if (!id) return { ok: false, error: 'run_id is required', status: 400 };
  const query = await scopedIdQuery(cfg.table, `run_id=eq.${encodeURIComponent(id)}`, scope);
  return supabaseRequest({
    method: 'DELETE',
    table: cfg.table,
    query,
    headers: { Prefer: 'return=representation' }
  }).then((res) => {
    if (!res.ok) return res;
    const deleted = Array.isArray(res.data) && res.data.length > 0;
    if (!deleted) return { ok: false, status: 404, error: 'Run not found' };
    return { ok: true, status: 200, data: { deleted: true, run_id: id } };
  });
}

module.exports = {
  createYoutubeAcquireRun,
  listYoutubeAcquireRuns,
  getYoutubeAcquireRun,
  updateYoutubeAcquireRun,
  deleteYoutubeAcquireRun,
  runSummary
};
