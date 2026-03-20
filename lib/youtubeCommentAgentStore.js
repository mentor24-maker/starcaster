'use strict';

const { nextId } = require('../routes/http');
const { sbQuery, tableConfig, isConfigured } = require('./supabase');

function table() {
  return tableConfig().engageYoutubeCommentAgents;
}

function safeText(value) {
  return String(value || '').trim();
}

function toInt(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(num) : fallback;
}

function toBool(value, fallback = false) {
  if (value === true || value === false) return value;
  return fallback;
}

function toIsoString(value) {
  const text = safeText(value);
  if (!text) return '';
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function toDbTimestamp(value) {
  return toIsoString(value) || null;
}

function isMissingTableError(result) {
  if (!result || result.ok) return false;
  const text = `${safeText(result.error)} ${JSON.stringify(result.raw || {})}`;
  return /relation .* does not exist/i.test(text) || /could not find the table/i.test(text);
}

function storeFailure(result, fallback) {
  if (!result || result.ok) return null;
  if (isMissingTableError(result)) {
    return new Error(`Supabase table "${table()}" is missing. Run docs/supabase_engage_youtube_comment_agents.sql first.`);
  }
  return new Error(safeText(result.error) || fallback || 'Supabase request failed');
}

function rowToAgent(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: safeText(row.id),
    channel: 'youtube_comments',
    videoUrl: safeText(row.video_url),
    fromDate: safeText(row.from_date),
    toDate: safeText(row.to_date),
    frequency: Math.max(1, toInt(row.frequency, 1)),
    timeframe: safeText(row.timeframe) || 'month',
    maxPosts: Math.max(1, toInt(row.max_posts, 1)),
    videoCommentRatio: safeText(row.video_comment_ratio) || '100/0',
    jitterHours: Math.max(0, toInt(row.jitter_hours, 10)),
    scheduleEnabled: toBool(row.schedule_enabled, false),
    scheduleStatus: safeText(row.schedule_status) || 'disabled',
    scheduleNote: safeText(row.schedule_note),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    nextRunAt: toIsoString(row.next_run_at),
    lastRunAttemptedAt: toIsoString(row.last_run_attempted_at),
    lastPostedAt: toIsoString(row.last_posted_at),
    lastPostedCommentId: safeText(row.last_posted_comment_id),
    lastPostedThreadId: safeText(row.last_posted_thread_id),
    totalPostsCount: Math.max(0, toInt(row.total_posts_count, 0)),
    lastError: safeText(row.last_error),
    lastTestPostedAt: toIsoString(row.last_test_posted_at),
    lastTestCommentId: safeText(row.last_test_comment_id),
    lastTestThreadId: safeText(row.last_test_thread_id),
    lastTestCommentText: safeText(row.last_test_comment_text),
  };
}

function patchToRow(patch = {}) {
  const row = {};
  if (Object.prototype.hasOwnProperty.call(patch, 'videoUrl') || Object.prototype.hasOwnProperty.call(patch, 'video_url')) {
    row.video_url = safeText(patch.videoUrl || patch.video_url);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'fromDate') || Object.prototype.hasOwnProperty.call(patch, 'from_date')) {
    row.from_date = safeText(patch.fromDate || patch.from_date);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'toDate') || Object.prototype.hasOwnProperty.call(patch, 'to_date')) {
    row.to_date = safeText(patch.toDate || patch.to_date);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'frequency')) {
    row.frequency = Math.max(1, toInt(patch.frequency, 1));
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'timeframe')) {
    row.timeframe = safeText(patch.timeframe) || 'month';
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'maxPosts') || Object.prototype.hasOwnProperty.call(patch, 'max_posts')) {
    row.max_posts = Math.max(1, toInt(patch.maxPosts || patch.max_posts, 1));
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'videoCommentRatio') || Object.prototype.hasOwnProperty.call(patch, 'video_comment_ratio')) {
    row.video_comment_ratio = safeText(patch.videoCommentRatio || patch.video_comment_ratio) || '100/0';
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'jitterHours') || Object.prototype.hasOwnProperty.call(patch, 'jitter_hours')) {
    row.jitter_hours = Math.max(0, toInt(patch.jitterHours || patch.jitter_hours, 10));
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'scheduleEnabled') || Object.prototype.hasOwnProperty.call(patch, 'schedule_enabled')) {
    row.schedule_enabled = (patch.scheduleEnabled ?? patch.schedule_enabled) === true;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'scheduleStatus') || Object.prototype.hasOwnProperty.call(patch, 'schedule_status')) {
    row.schedule_status = safeText(patch.scheduleStatus || patch.schedule_status) || 'disabled';
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'scheduleNote') || Object.prototype.hasOwnProperty.call(patch, 'schedule_note')) {
    row.schedule_note = safeText(patch.scheduleNote || patch.schedule_note);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'nextRunAt') || Object.prototype.hasOwnProperty.call(patch, 'next_run_at')) {
    row.next_run_at = toDbTimestamp(patch.nextRunAt || patch.next_run_at);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'lastRunAttemptedAt') || Object.prototype.hasOwnProperty.call(patch, 'last_run_attempted_at')) {
    row.last_run_attempted_at = toDbTimestamp(patch.lastRunAttemptedAt || patch.last_run_attempted_at);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'lastPostedAt') || Object.prototype.hasOwnProperty.call(patch, 'last_posted_at')) {
    row.last_posted_at = toDbTimestamp(patch.lastPostedAt || patch.last_posted_at);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'lastPostedCommentId') || Object.prototype.hasOwnProperty.call(patch, 'last_posted_comment_id')) {
    row.last_posted_comment_id = safeText(patch.lastPostedCommentId || patch.last_posted_comment_id);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'lastPostedThreadId') || Object.prototype.hasOwnProperty.call(patch, 'last_posted_thread_id')) {
    row.last_posted_thread_id = safeText(patch.lastPostedThreadId || patch.last_posted_thread_id);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'totalPostsCount') || Object.prototype.hasOwnProperty.call(patch, 'total_posts_count')) {
    row.total_posts_count = Math.max(0, toInt(patch.totalPostsCount || patch.total_posts_count, 0));
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'lastError') || Object.prototype.hasOwnProperty.call(patch, 'last_error')) {
    row.last_error = safeText(patch.lastError || patch.last_error);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'lastTestPostedAt') || Object.prototype.hasOwnProperty.call(patch, 'last_test_posted_at')) {
    row.last_test_posted_at = toDbTimestamp(patch.lastTestPostedAt || patch.last_test_posted_at);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'lastTestCommentId') || Object.prototype.hasOwnProperty.call(patch, 'last_test_comment_id')) {
    row.last_test_comment_id = safeText(patch.lastTestCommentId || patch.last_test_comment_id);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'lastTestThreadId') || Object.prototype.hasOwnProperty.call(patch, 'last_test_thread_id')) {
    row.last_test_thread_id = safeText(patch.lastTestThreadId || patch.last_test_thread_id);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'lastTestCommentText') || Object.prototype.hasOwnProperty.call(patch, 'last_test_comment_text')) {
    row.last_test_comment_text = safeText(patch.lastTestCommentText || patch.last_test_comment_text);
  }
  return row;
}

async function listAgents() {
  if (!isConfigured()) return [];
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query: 'select=*&order=updated_at.desc,created_at.desc&limit=500',
  });
  const err = storeFailure(res, 'Could not load YouTube comment agents');
  if (err) throw err;
  return Array.isArray(res.data) ? res.data.map(rowToAgent).filter(Boolean) : [];
}

async function getAgent(id) {
  const agentId = safeText(id);
  if (!agentId || !isConfigured()) return null;
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query: `id=eq.${encodeURIComponent(agentId)}&select=*&limit=1`,
  });
  const err = storeFailure(res, 'Could not load YouTube comment agent');
  if (err) throw err;
  const row = (Array.isArray(res.data) && res.data[0]) || null;
  return rowToAgent(row);
}

async function createAgent(input) {
  if (!isConfigured()) {
    throw new Error('Supabase is not configured. Configure it in Settings > APIs > Supabase first.');
  }
  const now = new Date().toISOString();
  const row = {
    id: nextId('ytagent'),
    channel: 'youtube_comments',
    created_at: now,
    updated_at: now,
    ...patchToRow(input),
  };
  const res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  const err = storeFailure(res, 'Could not create YouTube comment agent');
  if (err) throw err;
  const created = (Array.isArray(res.data) && res.data[0]) || row;
  return rowToAgent(created);
}

async function updateAgent(id, patch) {
  const agentId = safeText(id);
  if (!agentId) return null;
  if (!isConfigured()) {
    throw new Error('Supabase is not configured. Configure it in Settings > APIs > Supabase first.');
  }
  const row = {
    ...patchToRow(patch),
    updated_at: new Date().toISOString(),
  };
  const res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query: `id=eq.${encodeURIComponent(agentId)}&select=*`,
    headers: { Prefer: 'return=representation' },
    body: row,
  });
  const err = storeFailure(res, 'Could not update YouTube comment agent');
  if (err) throw err;
  const updated = (Array.isArray(res.data) && res.data[0]) || null;
  return rowToAgent(updated);
}

module.exports = {
  listAgents,
  getAgent,
  createAgent,
  updateAgent,
};
