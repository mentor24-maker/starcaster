'use strict';

/**
 * Reddit acquire runs — the Acquire screen's Reddit history.
 * Table: reddit_acquire_runs (docs/SQL/acquire_x_reddit_runs_setup.sql).
 *
 * This used to write data/reddit_acquire_runs.json, which Vercel skips without
 * an error, so no run made on the live site was ever kept (task 86bcug169).
 */

const { tableConfig } = require('../supabase');
const { acquireRunsTable, makeId } = require('./acquireRunsTable');

const LIST_COLUMNS = [
  'run_id', 'created_at', 'mode', 'target', 'subreddit', 'post_id', 'sort', 'source_mode',
  'keyword', 'start_time', 'end_time', 'include_replies', 'max_posts', 'max_comments', 'stats',
].join(',');

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

const runs = acquireRunsTable({
  table: () => tableConfig().redditAcquireRuns,
  label: 'Reddit',
  listColumns: LIST_COLUMNS,
  summarize,
});

function createRedditAcquireRun(input, result, scope = null) {
  const now = new Date().toISOString();
  return runs.create({
    run_id: makeId('rrun'),
    created_at: now,
    updated_at: now,
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
  }, scope);
}

function listRedditAcquireRuns(limit = 20, scope = null) {
  return runs.list(limit, scope);
}

function getRedditAcquireRun(runId, scope = null) {
  return runs.get(runId, scope);
}

function deleteRedditAcquireRun(runId, scope = null) {
  return runs.remove(runId, scope);
}

module.exports = {
  createRedditAcquireRun,
  listRedditAcquireRuns,
  getRedditAcquireRun,
  deleteRedditAcquireRun,
  summarize,
};
