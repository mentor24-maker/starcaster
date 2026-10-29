'use strict';

/**
 * X (Twitter) acquire runs — the Acquire screen's X history.
 * Table: x_acquire_runs (docs/SQL/acquire_x_reddit_runs_setup.sql).
 *
 * This used to write data/x_acquire_runs.json, which Vercel skips without an
 * error, so no run made on the live site was ever kept (task 86bcug169).
 */

const { tableConfig } = require('../supabase');
const { acquireRunsTable, makeId } = require('./acquireRunsTable');

const LIST_COLUMNS = [
  'run_id', 'created_at', 'query', 'hashtags', 'language', 'start_time', 'end_time',
  'max_tweets', 'max_replies_per_tweet', 'include_replies', 'stats',
].join(',');

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

const runs = acquireRunsTable({
  table: () => tableConfig().xAcquireRuns,
  label: 'X',
  listColumns: LIST_COLUMNS,
  summarize: summarizeRun,
});

function createXAcquireRun(input, result, scope = null) {
  const now = new Date().toISOString();
  return runs.create({
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
}

function listXAcquireRuns(limit = 20, scope = null) {
  return runs.list(limit, scope);
}

function getXAcquireRun(runId, scope = null) {
  return runs.get(runId, scope);
}

function deleteXAcquireRun(runId, scope = null) {
  return runs.remove(runId, scope);
}

module.exports = {
  createXAcquireRun,
  listXAcquireRuns,
  getXAcquireRun,
  deleteXAcquireRun,
  summarizeRun,
};
