
'use strict';

/**
 * lib/youtubeCommentRuns.js
 * Persistence layer for the harvest_youtube_comments table.
 * Mirrors the structure of youtubeHarvestRuns.js.
 */

const { sbQuery, tableConfig } = require('../supabase');

function table() { return tableConfig().harvestYoutubeComments; }
function detailsTable() { return tableConfig().harvestYoutubeDetails; }

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function runSummary(run) {
  return {
    run_id:        run?.run_id        || '',
    video_url:     run?.video_url     || '',
    video_id:      run?.video_id      || '',
    title:         run?.title         || '',
    channel_name:  run?.channel_name  || '',
    comment_count: Number(run?.comment_count || 0),
    created_at:    run?.created_at    || '',
    updated_at:    run?.updated_at    || '',
  };
}

/**
 * Look up video details from harvest_youtube_details table by video_id or video_url
 */
async function lookupVideoDetails(videoId, videoUrl) {
  if (!videoId && !videoUrl) return null;
  
  try {
    const table = detailsTable();
    let query = '';
    
    // Try video_id first (more specific)
    if (videoId) {
      query = `video_id=eq.${encodeURIComponent(videoId)}&select=title,channel_name,video_id,video_url&limit=1`;
    } else if (videoUrl) {
      query = `video_url=eq.${encodeURIComponent(videoUrl)}&select=title,channel_name,video_id,video_url&limit=1`;
    }
    
    if (!query) return null;
    
    const res = await sbQuery({
      method: 'GET',
      table: table,
      query: query,
    });
    
    if (res.ok && Array.isArray(res.data) && res.data.length > 0) {
      return res.data[0];
    }
  } catch (err) {
    // Silently fail - if lookup fails, we'll just use empty values
    console.warn('[YoutubeCommentsStore] Failed to lookup video details:', err.message);
  }
  
  return null;
}

async function rowFromResult(input, result, runId = makeId('ytcmt')) {
  const now = new Date().toISOString();
  const stats = result?.stats || {};
  const videoId = String(result?.video_id || '').trim();
  const videoUrl = String(input?.video_url || result?.video_url || '').trim();
  
  // Look up video details from harvest_youtube_details table
  const videoDetails = await lookupVideoDetails(videoId, videoUrl);
  
  // Use title and channel_name from video details if available, otherwise from result
  const title = videoDetails?.title 
    ? String(videoDetails.title).trim()
    : String(result?.title || '').trim();
  
  const channelName = videoDetails?.channel_name
    ? String(videoDetails.channel_name).trim()
    : String(result?.channel_name || '').trim();
  
  return {
    run_id:        runId,
    video_url:     videoUrl,
    video_id:      videoId || (videoDetails?.video_id ? String(videoDetails.video_id).trim() : ''),
    title:         title,
    channel_name:  channelName,
    comment_count: Number(stats.total_comments || 0),
    request_json:  {
      video_url:       String(input?.video_url || '').trim(),
      max_comments:    Number(input?.max_comments  || 200),
      include_replies: input?.include_replies === true,
      sort_by:         String(input?.sort_by || 'relevance'),
    },
    result_json:   result || {},
    created_at:    now,
    updated_at:    now,
  };
}

async function createCommentRun(input, result) {
  const row = await rowFromResult(input, result);
  const res = await sbQuery({
    method:  'POST',
    table:   table(),
    query:   'select=*',
    headers: { Prefer: 'return=representation' },
    body:    [row],
  });
  if (!res.ok) return res;
  return {
    ok:     true,
    status: 201,
    data:   (Array.isArray(res.data) && res.data[0]) || row,
  };
}

function researchSummary(run) {
  const req = run?.request_json || {};
  const res = run?.result_json || {};
  const stats = res?.stats || {};
  return {
    run_id: run?.run_id || '',
    created_at: run?.created_at || '',
    updated_at: run?.updated_at || '',
    phrase_count: Number(req?.phrase_count || 0) || 0,
    discovered_target_count: Number(req?.discovered_target_count || 0) || 0,
    distilled_target_count: Number(req?.distilled_target_count || 0) || 0,
    resolved_videos: Number(stats?.resolved_videos || 0) || 0,
    harvested_videos: Number(stats?.harvested_videos || 0) || 0,
    total_comments_filtered: Number(stats?.total_comments_filtered || 0) || 0,
    target_preview: Array.isArray(req?.distilled_targets) ? req.distilled_targets.slice(0, 6) : [],
  };
}

function rowFromResearch(input, result, runId = makeId('ytresearch')) {
  const now = new Date().toISOString();
  const requestJson = {
    phrase_count: Number(input?.phrase_count || 0) || 0,
    discovered_target_count: Number(input?.discovered_target_count || 0) || 0,
    distilled_target_count: Number(input?.distilled_target_count || 0) || 0,
    phrases: Array.isArray(input?.phrases) ? input.phrases.slice(0, 200) : [],
    discovered_targets: Array.isArray(input?.discovered_targets) ? input.discovered_targets.slice(0, 500) : [],
    distilled_targets: Array.isArray(input?.distilled_targets) ? input.distilled_targets.slice(0, 500) : [],
    raw_input: input?.raw_input || {},
  };
  const filteredCount = Number(result?.stats?.total_comments_filtered || 0) || 0;
  const title = `Research (${requestJson.phrase_count} phrases, ${requestJson.distilled_target_count} targets)`;
  return {
    run_id: runId,
    video_url: '',
    video_id: '',
    title,
    channel_name: '',
    comment_count: filteredCount,
    request_json: requestJson,
    result_json: result || {},
    created_at: now,
    updated_at: now,
  };
}

async function createResearchRun(input, result) {
  const row = rowFromResearch(input, result);
  const res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 201,
    data: (Array.isArray(res.data) && res.data[0]) || row,
  };
}

async function listResearchRuns(limit = 20) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 200));
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query: `run_id=like.ytresearch_*&select=run_id,title,comment_count,request_json,result_json,created_at,updated_at&order=created_at.desc&limit=${safeLimit}`,
  });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 200,
    data: Array.isArray(res.data) ? res.data.map(researchSummary) : [],
  };
}

async function getResearchRun(runId) {
  const id = String(runId || '').trim();
  if (!id) return { ok: false, status: 400, error: 'run_id is required' };
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query: `run_id=eq.${encodeURIComponent(id)}&select=*`,
  });
  if (!res.ok) return res;
  const row = (Array.isArray(res.data) && res.data[0]) || null;
  if (!row) return { ok: false, status: 404, error: 'Research run not found' };
  return {
    ok: true,
    status: 200,
    data: {
      ...row,
      request: row.request_json || {},
      result: row.result_json || {},
    },
  };
}

async function listCommentRuns(limit = 20) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 200));
  const res = await sbQuery({
    method: 'GET',
    table:  table(),
    query:  `select=run_id,video_url,video_id,title,channel_name,comment_count,created_at,updated_at&order=created_at.desc&limit=${safeLimit}`,
  });
  if (!res.ok) return res;
  return {
    ok:     true,
    status: 200,
    data:   Array.isArray(res.data) ? res.data.map(runSummary) : [],
  };
}

async function getCommentRun(runId) {
  const id = String(runId || '').trim();
  if (!id) return { ok: false, status: 400, error: 'run_id is required' };
  const res = await sbQuery({
    method: 'GET',
    table:  table(),
    query:  `run_id=eq.${encodeURIComponent(id)}&select=*`,
  });
  if (!res.ok) return res;
  const row = (Array.isArray(res.data) && res.data[0]) || null;
  if (!row) return { ok: false, status: 404, error: 'Comment run not found' };
  return {
    ok:     true,
    status: 200,
    data:   { ...row, request: row.request_json || {}, result: row.result_json || {} },
  };
}

async function deleteCommentRun(runId) {
  const id = String(runId || '').trim();
  if (!id) return { ok: false, status: 400, error: 'run_id is required' };
  const res = await sbQuery({
    method:  'DELETE',
    table:   table(),
    query:   `run_id=eq.${encodeURIComponent(id)}`,
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return res;
  const deleted = Array.isArray(res.data) && res.data.length > 0;
  if (!deleted) return { ok: false, status: 404, error: 'Comment run not found' };
  return { ok: true, status: 200, data: { deleted: true, run_id: id } };
}

module.exports = {
  createCommentRun,
  listCommentRuns,
  getCommentRun,
  deleteCommentRun,
  createResearchRun,
  listResearchRuns,
  getResearchRun,
  runSummary,
};
