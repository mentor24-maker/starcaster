'use strict';

const fs = require('fs');
const path = require('path');

const STORE_FILE = path.join(__dirname, '..', '..', 'data', 'reddit_harvest_runs.json');
const MAX_RUNS = 200;

function ensureStore() {
  const dir = path.dirname(STORE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify({ runs: [] }, null, 2), { mode: 0o600 });
    fs.chmodSync(STORE_FILE, 0o600);
  }
}

function readStore() {
  try {
    ensureStore();
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { runs: [] };
    if (!Array.isArray(parsed.runs)) parsed.runs = [];
    return parsed;
  } catch {
    return { runs: [] };
  }
}

function writeStore(store) {
  ensureStore();
  const tmp = `${STORE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, STORE_FILE);
  fs.chmodSync(STORE_FILE, 0o600);
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function summarize(run) {
  return {
    run_id: String(run?.run_id || ''),
    created_at: String(run?.created_at || ''),
    mode: String(run?.mode || ''),
    target: String(run?.target || ''),
    subreddit: String(run?.subreddit || ''),
    post_id: String(run?.post_id || ''),
    sort: String(run?.sort || ''),
    source_mode: String(run?.source_mode || ''),
    keyword: String(run?.keyword || ''),
    start_time: String(run?.start_time || ''),
    end_time: String(run?.end_time || ''),
    include_replies: Boolean(run?.include_replies),
    max_posts: Number(run?.max_posts || 0) || 0,
    max_comments: Number(run?.max_comments || 0) || 0,
    total_posts: Number(run?.stats?.total_posts || 0) || 0,
    total_comments: Number(run?.stats?.total_comments || 0) || 0,
    errors: Number(run?.stats?.errors || 0) || 0,
  };
}

function createRedditHarvestRun(input, result) {
  const run = {
    run_id: makeId('rrun'),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    mode: String(input?.mode || result?.mode || ''),
    target: String(input?.target || '').trim(),
    subreddit: String(result?.subreddit || input?.subreddit || '').trim(),
    post_id: String(result?.post?.id || input?.post_id || '').trim(),
    sort: String(input?.sort || '').trim(),
    source_mode: String(input?.source_mode || input?.sourceMode || '').trim(),
    keyword: String(input?.keyword || '').trim(),
    start_time: String(input?.start_time || input?.startTime || '').trim(),
    end_time: String(input?.end_time || input?.endTime || '').trim(),
    include_replies: Boolean(input?.include_replies),
    max_posts: Number(input?.max_posts || 0) || 0,
    max_comments: Number(input?.max_comments || 0) || 0,
    request_json: input || {},
    result_json: result || {},
    stats: {
      total_posts: Number(result?.posts?.length || (result?.post ? 1 : 0)) || 0,
      total_comments: Number(result?.comments?.length || 0) || 0,
      errors: Number(result?.errors?.length || 0) || 0,
    },
  };

  const store = readStore();
  store.runs.unshift(run);
  if (store.runs.length > MAX_RUNS) store.runs = store.runs.slice(0, MAX_RUNS);
  writeStore(store);
  return { ok: true, status: 201, data: run };
}

function listRedditHarvestRuns(limit = 20) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 200));
  const rows = readStore().runs.slice(0, safeLimit).map(summarize);
  return { ok: true, status: 200, data: rows };
}

function getRedditHarvestRun(runId) {
  const id = String(runId || '').trim();
  if (!id) return { ok: false, status: 400, error: 'run_id is required' };
  const row = readStore().runs.find((run) => String(run?.run_id || '') === id);
  if (!row) return { ok: false, status: 404, error: 'Run not found' };
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

function deleteRedditHarvestRun(runId) {
  const id = String(runId || '').trim();
  if (!id) return { ok: false, status: 400, error: 'run_id is required' };
  const store = readStore();
  const idx = store.runs.findIndex((run) => String(run?.run_id || '') === id);
  if (idx < 0) return { ok: false, status: 404, error: 'Run not found' };
  store.runs.splice(idx, 1);
  writeStore(store);
  return { ok: true, status: 200, data: { deleted: true, run_id: id } };
}

module.exports = {
  createRedditHarvestRun,
  listRedditHarvestRuns,
  getRedditHarvestRun,
  deleteRedditHarvestRun,
  summarize,
};
