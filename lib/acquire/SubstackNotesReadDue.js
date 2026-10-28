'use strict';

/**
 * The scheduled Notes read — Outreach wizard 14/19 (task 86bcrmbqu). Vercel
 * Cron calls GET /api/acquire/substack-miner/read-notes-due every two hours;
 * this walks every project that has approved Substack writers and runs the
 * same read a person runs from the Candidates screen
 * (./SubstackNotesReadRun.js), one project after another.
 *
 * Until this existed the read ran only when an agent session typed
 * `npm run substack-miner:read-notes`, so 17 approved writers had 0 Notes read.
 *
 * WHAT IT DOES NOT CHANGE. The read's own rules stand: a writer read in the
 * last 7 days is skipped, the Miner's polite pause sits between requests, and
 * nothing is read outside the Substack account's active hours — a project
 * outside them is reported as "not now", not as a failure. So a two-hour
 * cadence means each approved writer is read about once a week, and a newly
 * approved writer is read within two hours of approval.
 *
 * Cross-project on purpose, and cron-only for that reason (the route checks
 * `req.cronPublish`). The ONE cross-project read is the discovery below —
 * which projects have approved writers. Everything after it goes through the
 * stores with that project's own scope.
 *
 * ONE CLOCK FOR THE WHOLE PASS. Vercel stops the function at 300 seconds, so
 * every project shares a single time budget: a project not reached is named
 * in the report as not reached, and its writers are still due next time.
 */

const { sbQuery, tableConfig } = require('../supabase');
const { runSubstackNotesRead } = require('./SubstackNotesReadRun');

/** The whole pass's clock: well inside Vercel's 300s. */
const PASS_BUDGET_MS = 240000;
/** Below this much time left, a project is not started (one read takes a few seconds). */
const MIN_PROJECT_BUDGET_MS = 15000;

function text(value, max = 500) {
  return String(value === 0 || value ? value : '').trim().slice(0, max);
}

/** Every project with at least one approved writer, and an owner to act as. */
async function discoverProjects(deps = {}) {
  const query = deps.sbQuery || sbQuery;
  const res = await query({
    method: 'GET',
    table: tableConfig().substackCandidates,
    query: 'status=eq.approved&select=project_id,owner_user_id&limit=5000',
  });
  if (!res.ok) return res;
  const seen = new Map();
  for (const row of Array.isArray(res.data) ? res.data : []) {
    const projectId = text(row.project_id, 120);
    if (!projectId || seen.has(projectId)) continue;
    seen.set(projectId, { projectId, userId: text(row.owner_user_id, 120) });
  }
  return { ok: true, status: 200, data: [...seen.values()] };
}

/**
 * One pass. `deps`:
 *   discover          () → { ok, data: [{ projectId, userId }] } (tests)
 *   read              (input, scope, readDeps) → runSubstackNotesRead's answer (tests)
 *   projectTimeZone   (projectId, userId) → zone
 *   now               the clock (ms)
 *   budgetMs          the pass's clock (default PASS_BUDGET_MS)
 *
 * Returns `{ ok, status, data: { projects, read, notNow, failed, notReached } }`.
 * `ok` is false only when discovery itself failed — then nothing was looked at.
 */
async function runNotesReadDue(deps = {}) {
  const discover = deps.discover || (() => discoverProjects(deps));
  const read = deps.read || runSubstackNotesRead;
  const now = deps.now || Date.now;
  const budgetMs = deps.budgetMs || PASS_BUDGET_MS;
  const projectTimeZone = deps.projectTimeZone || require('../projectsStore').getProjectTimezoneForUser;

  const found = await discover();
  if (!found.ok) {
    return { ok: false, status: found.status || 500, error: `Could not read which projects have approved Substack writers: ${found.error || 'unknown error'}` };
  }

  const report = { projects: found.data.length, read: [], notNow: [], failed: [], notReached: [] };
  const startedAt = now();
  for (const { projectId, userId } of found.data) {
    const left = budgetMs - (now() - startedAt);
    if (left < MIN_PROJECT_BUDGET_MS) {
      report.notReached.push({ projectId, reason: 'not read — the pass ran out of time; its writers are still due next pass' });
      continue;
    }
    const scope = { projectId, userId };
    // eslint-disable-next-line no-await-in-loop
    const res = await read({}, scope, {
      timeBudgetMs: left,
      projectTimeZone: async () => text(await projectTimeZone(projectId, userId), 120),
    });
    if (res.ok) {
      const s = res.data;
      report.read.push({
        projectId,
        approved: s.approved,
        read: s.read.length,
        notes: s.read.reduce((n, r) => n + (r.notes || 0), 0),
        skipped: s.skipped.length,
        failed: s.failed,
        notReached: s.notReached.length,
      });
    } else if (res.status === 409) {
      report.notNow.push({ projectId, reason: res.error });
    } else {
      report.failed.push({ projectId, error: res.error || 'unknown error' });
    }
  }
  return { ok: true, status: 200, data: report };
}

/** The log lines for one pass: one summary, then each failure by name. */
function formatReadDueLog(report) {
  const notes = report.read.reduce((n, r) => n + r.notes, 0);
  const writersFailed = report.read.reduce((n, r) => n + r.failed.length, 0);
  const lines = [`[substack-miner] read-notes-due projects=${report.projects} read=${report.read.length} not_now=${report.notNow.length} `
    + `failed=${report.failed.length} not_reached=${report.notReached.length} notes=${notes} writers_not_read=${writersFailed}`];
  for (const r of report.read) {
    for (const f of r.failed) lines.push(`[substack-miner] read-notes-due WRITER NOT READ project=${r.projectId} writer=${f.handle}: ${f.reason}`);
  }
  for (const f of report.failed) lines.push(`[substack-miner] read-notes-due FAILED project=${f.projectId}: ${f.error}`);
  for (const f of report.notReached) lines.push(`[substack-miner] read-notes-due NOT REACHED project=${f.projectId}`);
  return lines;
}

module.exports = { runNotesReadDue, discoverProjects, formatReadDueLog, PASS_BUDGET_MS };
