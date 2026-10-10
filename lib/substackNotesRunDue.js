'use strict';

/**
 * Substack Notes 5/7 (task 86bcet77n) — the scheduled pass. Vercel Cron calls
 * GET /api/engage/substack-notes/run-due every thirty minutes; this walks
 * every account whose switch "Draft Notes from my topics on their own" is on,
 * and drafts Notes from its topics into whatever approval slots nothing else
 * is using.
 *
 * WHAT IT NEVER DOES: approve or post. Each draft is made exactly as Dane
 * would make it by hand — "Use this topic" (createItem, source `topic`), then
 * "Write a draft" (writeDraftForItem, so the same voice and the same rule
 * checks). The rules for how many and which topics are
 * lib/substackNotesSchedule.js; this file only reads, asks it, and writes.
 *
 * A draft that could not be written (the AI failed, or what it wrote broke a
 * rule) leaves no idea behind: the topic idea the pass made is deleted again,
 * so a broken AI does not fill Dane's Ideas tab with a fresh row every half
 * hour. The failure is in the pass's report and the log.
 *
 * Cross-project on purpose, and cron-only for that reason (the route checks
 * `req.cronPublish`). The ONE cross-project read is the discovery below —
 * which accounts have the switch on. Everything after it goes through the
 * store with that project's own scope, so tenancy is enforced exactly as it
 * is for a person on the screen.
 *
 * Every read failure is reported per account, never skipped quietly: "nothing
 * was due" and "could not look" must not print the same summary
 * (feedback: sweeps must report what they could not check).
 */

const { sbQuery, tableConfig } = require('./supabase');
const store = require('./substackNotesStore');
const schedule = require('./substackNotesSchedule');
const { getProjectTimezoneForUser } = require('./projectsStore');

/**
 * Drafts written in one pass, across every account. Each is an AI call (a few
 * seconds) and the function has five minutes; anything left over is still due
 * on the next pass.
 */
const MAX_DRAFTS_PER_PASS = 10;

/** Items read per account to judge the plan. Waiting and recent ones are what matter. */
const ITEMS_READ = 1000;

function text(value, max = 500) {
  return String(value === 0 || value ? value : '').trim().slice(0, max);
}

/** Every (project, account) whose switch is on, and an owner to act as. */
async function discoverAccounts() {
  const table = tableConfig().substackNotesSettings;
  const res = await sbQuery({
    method: 'GET',
    table,
    query: 'auto_topic_drafts=eq.true&select=project_id,owner_user_id,account_key&limit=5000',
  });
  if (!res.ok) {
    const missing = /auto_topic_drafts/.test(String(res.error || ''));
    return {
      ...res,
      error: missing
        ? `the switch column is not in this database yet — run ${store.AUTO_TOPIC_DRAFTS_SQL} (${res.error})`
        : res.error,
    };
  }
  const seen = new Map();
  for (const row of Array.isArray(res.data) ? res.data : []) {
    const projectId = text(row.project_id, 120);
    if (!projectId) continue;
    const accountKey = text(row.account_key, 80) || store.DEFAULT_ACCOUNT;
    const key = `${projectId}\u0000${accountKey}`;
    if (!seen.has(key)) seen.set(key, { projectId, accountKey, userId: text(row.owner_user_id, 120) });
  }
  return { ok: true, status: 200, data: [...seen.values()] };
}

/** The account's time zone: its own, else the project's, else UTC. */
async function accountZone(settings, scope, projectTimeZone) {
  let zone = settings.timeZone;
  if (!schedule.isValidTimeZone(zone) && typeof projectTimeZone === 'function') {
    zone = text(await projectTimeZone(scope.projectId, scope.userId), 120);
  }
  return schedule.isValidTimeZone(zone) ? zone : 'UTC';
}

/** Read what the plan needs for one account. */
async function readAccount(scope, accountKey) {
  const [settings, items] = await Promise.all([
    store.getSettings(scope, { accountKey }),
    store.listItems(ITEMS_READ, scope, { accountKey }),
  ]);
  if (!settings.ok) return { ok: false, error: `could not read the settings: ${settings.error || 'unknown error'}` };
  if (!items.ok) return { ok: false, error: `could not read the ideas and Notes: ${items.error || 'unknown error'}` };
  return { ok: true, settings: settings.data, items: items.data };
}

/**
 * One pass. `options`:
 *   now               the clock (ms), for tests
 *   maxDrafts         the per-pass ceiling (default MAX_DRAFTS_PER_PASS)
 *   generate          passed through to writeDraftForItem (tests)
 *   projectTimeZone   (projectId, userId) → zone, when the account sets none
 *
 * Returns `{ ok, status, data: { accounts, drafted, idle, failed, skippedForPassLimit } }`.
 * `ok` is false only when discovery itself failed — then nothing was looked at.
 */
async function runDue(options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const maxDrafts = Number.isInteger(options.maxDrafts) && options.maxDrafts >= 0 ? options.maxDrafts : MAX_DRAFTS_PER_PASS;
  const projectTimeZone = typeof options.projectTimeZone === 'function' ? options.projectTimeZone : getProjectTimezoneForUser;

  const found = await discoverAccounts();
  if (!found.ok) {
    return { ok: false, status: found.status || 500, error: `Could not read which accounts draft from their topics: ${found.error || 'unknown error'}` };
  }

  const report = { accounts: found.data.length, drafted: [], idle: [], failed: [], skippedForPassLimit: [] };
  let budget = maxDrafts;

  for (const { projectId, accountKey, userId } of found.data) {
    const scope = { projectId, userId };
    const where = { projectId, accountKey };

    // eslint-disable-next-line no-await-in-loop
    const read = await readAccount(scope, accountKey);
    if (!read.ok) {
      report.failed.push({ ...where, topic: '', error: read.error });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const zone = await accountZone(read.settings, scope, projectTimeZone);
    const plan = schedule.planTopicDrafts({ settings: read.settings, items: read.items, now, timeZone: zone });
    if (!plan.count) {
      report.idle.push({ ...where, reason: plan.reason, text: plan.text });
      continue;
    }

    for (const topic of plan.topics) {
      if (budget <= 0) {
        report.skippedForPassLimit.push({ ...where, topic });
        continue;
      }
      budget -= 1;
      // eslint-disable-next-line no-await-in-loop
      const made = await store.createItem({ kind: 'note', source: 'topic', ideaText: topic, accountKey }, scope);
      if (!made.ok) {
        report.failed.push({ ...where, topic, error: `the idea was not saved: ${made.error || 'unknown error'}` });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const written = await store.writeDraftForItem(made.data.id, scope, { generate: options.generate });
      if (written.ok) {
        report.drafted.push({ ...where, topic, itemId: written.data.id });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const removed = await store.deleteItem(made.data.id, scope);
      const leftover = removed.ok ? '' : ` (and the empty idea could not be removed: ${removed.error || 'unknown error'})`;
      report.failed.push({ ...where, topic, error: `no draft written: ${written.error || 'unknown error'}${leftover}` });
    }
  }

  return { ok: true, status: 200, data: report };
}

/**
 * The "Next topic draft" line for the Ideas tab: the plan the pass would make
 * right now, so the screen and the timer cannot disagree.
 * Returns `{ ok, data: { due, reason, text, nextAt, topics } }`.
 */
async function describeTopicSchedule(scope, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const accountKey = options.accountKey;
  const read = await readAccount(scope, accountKey);
  if (!read.ok) return { ok: false, status: 500, error: `The next topic draft could not be worked out: ${read.error}` };
  const zone = await accountZone(read.settings, scope, options.projectTimeZone);
  const plan = schedule.planTopicDrafts({ settings: read.settings, items: read.items, now, timeZone: zone });
  return {
    ok: true,
    status: 200,
    data: {
      due: plan.count > 0,
      reason: plan.reason,
      text: plan.text,
      nextAt: plan.nextAt ? new Date(plan.nextAt).toISOString() : null,
      topics: plan.topics,
    },
  };
}

module.exports = { MAX_DRAFTS_PER_PASS, runDue, describeTopicSchedule, discoverAccounts };
