'use strict';

/**
 * Retention for `observe_usage_logs` request rows (ClickUp 86bcy80hd).
 *
 * routes/index.js writes one `vercel` / `api_request` row for every API
 * request, and nothing ever removed them: 652,161 rows on 2026-11-04, 128 MB,
 * the largest live table in the database and the one with the most disk reads
 * since the statistics were last reset — on Supabase's smallest compute size,
 * where disk reads spend a small daily budget and an exhausted budget stalls
 * every client site at once (docs/runbook-supabase-capacity.md).
 *
 * The rule: request rows older than KEEP_DAYS are deleted. NOTHING ELSE in
 * the table is touched. The same table holds the AI-spend meter rows
 * (`llm_tokens`, lib/aiUsage.js) that Settings › AI Quota and the spending
 * alarm price, and those are kept forever. That guarantee lives in ONE
 * place — `requestRowFilter` — and every read and every delete here is built
 * from it, so there is no second filter that could drift.
 *
 * Deletes go in small batches with a time budget, because the cleanup must
 * not itself spend the disk budget it exists to protect: the first runs work
 * through a backlog of ~550k rows over a couple of days, an hour at a time.
 */

const KEEP_DAYS = 30;
const BATCH_SIZE = 1000;
const MAX_BATCHES = 10;
const TIME_BUDGET_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const TABLE_DEFAULT = 'observe_usage_logs';

/**
 * The only rows this module may ever read or delete. Both columns are pinned:
 * `usage_type` keeps the AI-spend rows out, `provider` keeps out any future
 * writer that reuses the `api_request` name for something worth keeping.
 */
function requestRowFilter(cutoffIso) {
  return 'usage_type=eq.api_request'
    + '&provider=eq.vercel'
    + `&created_at=lt.${encodeURIComponent(cutoffIso)}`;
}

function cutoffFor(now, keepDays = KEEP_DAYS) {
  return new Date(now - keepDays * DAY_MS).toISOString();
}

/**
 * Delete request rows older than `keepDays`, oldest first, in batches.
 *
 * Each batch reads the ids of the oldest `batchSize` matching rows, then
 * deletes the matching rows up to the highest of those ids — so a delete is
 * bounded by what was just read, never an open-ended "everything older".
 *
 * Stops at the first failure and says so: a run that could not finish is
 * reported as `complete: false` with the error, never as a clean pass.
 *
 * @returns {Promise<{ok: boolean, error?: string, data: {cutoff: string,
 *   deleted: number, batches: number, complete: boolean, stoppedBecause: string}}>}
 */
async function pruneRequestLogs({
  query = null,
  table = null,
  now = Date.now(),
  clock = () => Date.now(),
  keepDays = KEEP_DAYS,
  batchSize = BATCH_SIZE,
  maxBatches = MAX_BATCHES,
  timeBudgetMs = TIME_BUDGET_MS,
} = {}) {
  const sb = query || require('./supabase').sbQuery;
  const tableName = table || (require('./supabase').tableConfig().observeUsageLogs || TABLE_DEFAULT);
  const cutoff = cutoffFor(now, keepDays);
  const filter = requestRowFilter(cutoff);
  const started = clock();
  const data = { cutoff, deleted: 0, batches: 0, complete: false, stoppedBecause: '' };

  while (true) {
    if (data.batches >= maxBatches) { data.stoppedBecause = 'batch-limit'; break; }
    if (clock() - started >= timeBudgetMs) { data.stoppedBecause = 'time-budget'; break; }

    const read = await sb({
      method: 'GET',
      table: tableName,
      query: `select=id&${filter}&order=id.asc&limit=${batchSize}`,
    });
    if (!read.ok) {
      return { ok: false, error: `Could not read old request rows: ${read.error || read.status}`, data: { ...data, stoppedBecause: 'read-failed' } };
    }
    const ids = (Array.isArray(read.data) ? read.data : [])
      .map((row) => Number(row && row.id))
      .filter(Number.isFinite);
    if (!ids.length) { data.complete = true; data.stoppedBecause = 'nothing-left'; break; }

    const maxId = Math.max(...ids);
    const del = await sb({
      method: 'DELETE',
      table: tableName,
      query: `${filter}&id=lte.${maxId}&select=id`,
      headers: { Prefer: 'return=representation' },
    });
    if (!del.ok) {
      return { ok: false, error: `Could not delete old request rows: ${del.error || del.status}`, data: { ...data, stoppedBecause: 'delete-failed' } };
    }
    data.deleted += Array.isArray(del.data) ? del.data.length : 0;
    data.batches += 1;

    if (ids.length < batchSize) { data.complete = true; data.stoppedBecause = 'nothing-left'; break; }
  }

  return { ok: true, data };
}

module.exports = {
  pruneRequestLogs,
  requestRowFilter,
  cutoffFor,
  KEEP_DAYS,
  BATCH_SIZE,
  MAX_BATCHES,
};
