'use strict';

const fs = require('fs');
const path = require('path');
const { attachScopeFields, matchesScopedRecord } = require('../projectScopeFile');
const { writeJsonAtomic, ensureJsonFile } = require('../localDataFs');

const STORE_FILE = path.join(__dirname, '..', '..', 'data', 'x_acquire_runs.json');
const MAX_RUNS = 200;

function ensureStore() {
  ensureJsonFile(STORE_FILE, { runs: [] }, { mode: 0o600 });
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
  writeJsonAtomic(STORE_FILE, store, { mode: 0o600 });
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function summarizeRun(run) {
  return {
    run_id: String(run?.run_id || ''),
    created_at: String(run?.created_at || ''),
    query: String(run?.query || ''),
    hashtags: Array.isArray(run?.hashtags) ? run.hashtags : [],
    language: String(run?.language || ''),
    start_time: String(run?.start_time || ''),
    end_time: String(run?.end_time || ''),
    max_tweets: Number(run?.max_tweets || 0) || 0,
    max_replies_per_tweet: Number(run?.max_replies_per_tweet || 0) || 0,
    include_replies: Boolean(run?.include_replies),
    total_tweets: Number(run?.stats?.total_tweets || 0) || 0,
    total_replies: Number(run?.stats?.total_replies || 0) || 0,
    threads_scanned: Number(run?.stats?.threads_scanned || 0) || 0,
    errors: Number(run?.stats?.errors || 0) || 0,
  };
}

function createXAcquireRun(input, result, scope = null) {
  const now = new Date().toISOString();
  const run = attachScopeFields({
    run_id: makeId('xrun'),
    created_at: now,
    updated_at: now,
    query: String(input?.query || '').trim(),
    hashtags: Array.isArray(input?.hashtags) ? input.hashtags : [],
    language: String(input?.lang || '').trim(),
    start_time: String(input?.start_time || '').trim(),
    end_time: String(input?.end_time || '').trim(),
    max_tweets: Number(input?.max_tweets || 25) || 25,
    max_replies_per_tweet: Number(input?.max_replies_per_tweet || 20) || 20,
    include_replies: Boolean(input?.include_replies),
    request_json: input || {},
    result_json: result || {},
    stats: {
      total_tweets: Number(result?.tweets?.length || 0) || 0,
      total_replies: Number(result?.replies?.length || 0) || 0,
      threads_scanned: Number(result?.meta?.threads_scanned || 0) || 0,
      errors: Number(result?.errors?.length || 0) || 0,
    },
  }, scope);

  const store = readStore();
  store.runs.unshift(run);
  if (store.runs.length > MAX_RUNS) store.runs = store.runs.slice(0, MAX_RUNS);
  writeStore(store);
  return { ok: true, status: 201, data: run };
}

function listXAcquireRuns(limit = 20, scope = null) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 200));
  const runs = readStore().runs
    .filter((run) => matchesScopedRecord(run, scope))
    .slice(0, safeLimit)
    .map(summarizeRun);
  return { ok: true, status: 200, data: runs };
}

function getXAcquireRun(runId, scope = null) {
  const id = String(runId || '').trim();
  if (!id) return { ok: false, status: 400, error: 'run_id is required' };
  const row = readStore().runs.find((run) => {
    if (String(run?.run_id || '') !== id) return false;
    return matchesScopedRecord(run, scope);
  });
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

function deleteXAcquireRun(runId, scope = null) {
  const id = String(runId || '').trim();
  if (!id) return { ok: false, status: 400, error: 'run_id is required' };
  const store = readStore();
  const idx = store.runs.findIndex((run) => {
    if (String(run?.run_id || '') !== id) return false;
    return matchesScopedRecord(run, scope);
  });
  if (idx < 0) return { ok: false, status: 404, error: 'Run not found' };
  store.runs.splice(idx, 1);
  writeStore(store);
  return { ok: true, status: 200, data: { deleted: true, run_id: id } };
}

module.exports = {
  createXAcquireRun,
  listXAcquireRuns,
  getXAcquireRun,
  deleteXAcquireRun,
  summarizeRun,
};

