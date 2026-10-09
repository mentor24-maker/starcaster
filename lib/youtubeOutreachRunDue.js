'use strict';

/**
 * YouTube outreach 6/7 (task 86bcda6bg) — the scheduled pass. Vercel Cron
 * calls GET /api/youtube-outreach/run-due every ten minutes; this walks every
 * project with an active target, and for each posting account writes a draft
 * for each target that is due, in priority order, within the daily maximum.
 *
 * WHAT IT NEVER DOES: approve or post. Every draft lands on the Approvals tab
 * exactly as if Dane had clicked "Write a draft" (the same
 * writeDraftForTarget, so the same rule checks). The due rules are
 * lib/youtubeOutreachSchedule.js; this file only reads, asks it, and writes.
 *
 * It also marks a target `done` once it is finished (a one-off that has
 * posted, a repeat that has used its count or passed its stop date), so the
 * list says Done rather than Active for a video nothing will happen to again.
 *
 * Cross-project on purpose, and cron-only for that reason (routes check
 * `req.cronPublish`). The ONE cross-project read is the discovery below —
 * which projects have active targets. Everything after it goes through the
 * stores with that project's own scope, so tenancy is enforced exactly as it
 * is for a person on the screen.
 *
 * Every read failure is reported per project, never skipped quietly: "nothing
 * was due" and "could not look" must not print the same summary
 * (feedback: sweeps must report what they could not check).
 */

const { sbQuery, tableConfig } = require('./supabase');
const targetsStore = require('./youtubeOutreachStore');
const commentsStore = require('./youtubeOutreachCommentsStore');
const schedule = require('./youtubeOutreachSchedule');
const { getProjectTimezoneForUser } = require('./projectsStore');

/**
 * Drafts written in one pass, across every project. Each is an AI call plus a
 * YouTube read (a few seconds), and the function has five minutes; anything
 * left over is still due on the next pass, ten minutes later.
 */
const MAX_DRAFTS_PER_PASS = 10;

function text(value, max = 500) {
  return String(value === 0 || value ? value : '').trim().slice(0, max);
}

/** Every (project, account) with at least one active target, and an owner to act as. */
async function discoverAccounts() {
  const table = tableConfig().youtubeOutreachTargets;
  const res = await sbQuery({
    method: 'GET',
    table,
    query: 'status=eq.active&select=project_id,owner_user_id,account_key&limit=5000',
  });
  if (!res.ok) return res;
  const seen = new Map();
  for (const row of Array.isArray(res.data) ? res.data : []) {
    const projectId = text(row.project_id, 120);
    if (!projectId) continue;
    const accountKey = text(row.account_key, 80) || targetsStore.DEFAULT_ACCOUNT;
    const key = `${projectId}\u0000${accountKey}`;
    if (!seen.has(key)) seen.set(key, { projectId, accountKey, userId: text(row.owner_user_id, 120) });
    else if (!seen.get(key).userId) seen.get(key).userId = text(row.owner_user_id, 120);
  }
  return { ok: true, status: 200, data: [...seen.values()] };
}

/**
 * One pass. `options`:
 *   now               the clock (ms), for tests
 *   maxDrafts         the per-pass ceiling (default MAX_DRAFTS_PER_PASS)
 *   generate, readVideo   passed through to writeDraftForTarget (tests)
 *   projectTimeZone   (projectId, userId) → zone, when the account sets none
 *
 * Returns `{ ok, status, data: { accounts, drafted, held, finished, failed, skippedForPassLimit } }`.
 * `ok` is false only when discovery itself failed — then nothing was looked at.
 */
async function runDue(options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const maxDrafts = Number.isInteger(options.maxDrafts) && options.maxDrafts >= 0 ? options.maxDrafts : MAX_DRAFTS_PER_PASS;
  const projectTimeZone = typeof options.projectTimeZone === 'function' ? options.projectTimeZone : getProjectTimezoneForUser;

  const found = await discoverAccounts();
  if (!found.ok) {
    return { ok: false, status: found.status || 500, error: `Could not read which projects have outreach targets: ${found.error || 'unknown error'}` };
  }

  const report = { accounts: found.data.length, drafted: [], held: [], finished: [], failed: [], skippedForPassLimit: [] };
  let budget = maxDrafts;

  for (const { projectId, accountKey, userId } of found.data) {
    const scope = { projectId, userId };
    const where = { projectId, accountKey };

    const [targets, settings, comments] = await Promise.all([
      targetsStore.listTargets(500, scope, { accountKey }),
      targetsStore.getSettings(scope, { accountKey }),
      commentsStore.listComments(1000, scope, { accountKey }),
    ]);
    const unread = [['targets', targets], ['settings', settings], ['comments', comments]].find(([, r]) => !r.ok);
    if (unread) {
      report.failed.push({ ...where, targetId: '', error: `could not read the ${unread[0]}: ${unread[1].error || 'unknown error'}` });
      continue;
    }

    let zone = settings.data.timeZone;
    if (!schedule.isValidTimeZone(zone)) zone = text(await projectTimeZone(projectId, userId), 120);
    if (!schedule.isValidTimeZone(zone)) zone = 'UTC';

    const plan = schedule.planAccount({
      targets: targets.data,
      accountComments: comments.data,
      settings: settings.data,
      now,
      timeZone: zone,
    });

    for (const target of targets.data) {
      const verdict = plan.verdicts.get(target.id);
      if (!verdict?.finished || target.status !== 'active') continue;
      const marked = await targetsStore.setTargetStatus(target.id, 'done', scope);
      if (marked.ok) report.finished.push({ ...where, targetId: target.id, text: verdict.text });
      else report.failed.push({ ...where, targetId: target.id, error: `could not mark it done: ${marked.error || 'unknown error'}` });
    }

    for (const { target, text: why } of plan.held) report.held.push({ ...where, targetId: target.id, text: why });

    for (const target of plan.draft) {
      if (budget <= 0) {
        report.skippedForPassLimit.push({ ...where, targetId: target.id });
        continue;
      }
      budget -= 1;
      // eslint-disable-next-line no-await-in-loop
      const written = await commentsStore.writeDraftForTarget(target.id, scope, {
        onlyIfNoneWaiting: true,
        generate: options.generate,
        readVideo: options.readVideo,
      });
      if (written.ok) report.drafted.push({ ...where, targetId: target.id, commentId: written.data.id });
      else report.failed.push({ ...where, targetId: target.id, error: written.error || 'the draft was not written' });
    }
  }

  return { ok: true, status: 200, data: report };
}

/**
 * The "Next draft" line for each target on the screen, keyed by target id.
 * The same plan the pass would make right now, so the screen and the timer
 * cannot disagree. Returns `{ ok, data: { [targetId]: { due, finished, text } } }`.
 */
async function describeSchedule(targets, scope, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const accountKey = options.accountKey;
  const [settings, comments] = await Promise.all([
    targetsStore.getSettings(scope, { accountKey }),
    commentsStore.listComments(1000, scope, { accountKey }),
  ]);
  if (!settings.ok) return settings;
  if (!comments.ok) return comments;
  let zone = settings.data.timeZone;
  if (!schedule.isValidTimeZone(zone) && typeof options.projectTimeZone === 'function') {
    zone = text(await options.projectTimeZone(scope.projectId, scope.userId), 120);
  }
  const plan = schedule.planAccount({ targets, accountComments: comments.data, settings: settings.data, now, timeZone: zone });
  const out = {};
  for (const [id, verdict] of plan.verdicts) out[id] = { due: verdict.due, finished: verdict.finished, text: verdict.text };
  return { ok: true, status: 200, data: out };
}

module.exports = { MAX_DRAFTS_PER_PASS, runDue, describeSchedule, discoverAccounts };
