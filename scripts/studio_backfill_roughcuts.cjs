#!/usr/bin/env node
'use strict';

/**
 * npm run studio:backfill-roughcuts [-- --apply]
 *
 * Reel Spinner 4b (SC-834). The moments pass queues a rough-cut job for every
 * recording it scores from now on. Recordings scored BEFORE that were never
 * handed on, and nothing would ever go back for them. This does.
 *
 * It lists every source in the Studio project whose moments are `done` and
 * that still has rough-cut work to do — no edit rows yet, or an edit still in
 * `draft`, `failed` or `rendering` — and has no rough-cut job already live on
 * this machine's queue, and puts one rough-cut job on the queue for each.
 *
 * DRY RUN BY DEFAULT. Each job renders on this disk and uploads to Drive, which
 * spends mentor24's storage (docs/STUDIO.md, "Rough cuts"). Without `--apply`
 * it reads the catalog and the queue and says what it WOULD queue, writing
 * nothing. With `--apply` it queues into the LOCAL queue only, so it must run
 * on the Mini, where the daemon reads it. It never writes to the catalog: the
 * rough-cut pass does that.
 *
 * Run twice, the second run queues nothing: the first run's jobs are live on
 * the queue, and once they finish, every edit is in review.
 *
 * Exit 0 ran (whatever it found), 1 could not read the catalog or the queue,
 * 2 not configured, or cannot tell which machine this is, or no queue file
 * here, 3 another machine owns studio-worker (lib/nodeRoles.js).
 */

const fs = require('node:fs');
const path = require('node:path');

const { checkRole } = require('../lib/nodeRoles.js');

const { openQueue, STATES } = require('../workers/studio/queue.js');
const { resolveQueueFile, ROLE } = require('../workers/studio/daemon.js');
const { enqueueRoughCut, STAGE_ROUGH_CUT } = require('../workers/studio/roughCutPass.js');
const { scopeFor } = require('../workers/studio/ingest.js');
const { refuseHere, SOURCE_LIMIT } = require('./studio_backfill_transcripts.cjs');

const STATE_CHUNK = 500;
/** The most a store list returns in one read (lib/reelSpinnerInput.js MAX_LIST_LIMIT). */
const EDIT_LIMIT = 500;
/** An edit in one of these still has rough-cut work to do. */
const UNFINISHED = ['draft', 'failed', 'rendering'];

function text(value) {
  return String(value == null ? '' : value).trim();
}

/**
 * Which sources need a rough-cut job, and why each other scored one does not.
 * Pure, so the rule is tested without a database or a queue.
 *
 *   sources — catalog rows (videoSourcesStore shape)
 *   scored  — source id (lower-cased) → moments status
 *   edits   — source id (lower-cased) → that source's edits ({ status })
 *   queued  — source id → { state, jobId, lastError } for each rough-cut job
 *             pending, running or BLOCKED on this queue
 *
 * A blocked job is its own list with its reason, never "already waiting": it
 * will not run until somebody acts (landmine 17).
 */
function planBackfill({ sources, scored, edits, queued }) {
  const plan = { enqueue: [], skipped: [], blocked: [] };
  for (const row of sources) {
    const id = text(row.id);
    const key = id.toLowerCase();
    if (scored.get(key) !== 'done') continue; // shorts cannot be chosen before moments are scored
    const name = (text(row.localPath) && path.basename(text(row.localPath))) || id;
    const entry = { id, name };
    const own = edits.get(key) || [];
    const unfinished = own.filter((e) => UNFINISHED.includes(e.status));
    const job = queued.get(id);
    if (own.length && !unfinished.length) {
      plan.skipped.push({ ...entry, why: `all ${own.length} edit(s) are past rendering` });
    } else if (job && job.state === STATES.BLOCKED) {
      plan.blocked.push({ ...entry, jobId: job.jobId, why: text(job.lastError) || 'no reason was recorded' });
    } else if (job) {
      plan.skipped.push({ ...entry, why: 'a rough-cut job is already on the queue' });
    } else {
      plan.enqueue.push({ ...entry, why: own.length ? `${unfinished.length} edit(s) still to render` : 'no edits yet' });
    }
  }
  return plan;
}

/** Source id → its rough-cut job, for each one still live or blocked on this queue. */
function queuedSourceIds(queue) {
  const kept = new Set([STATES.PENDING, STATES.RUNNING, STATES.BLOCKED]);
  const out = new Map();
  for (const job of queue.listJobs({ stage: STAGE_ROUGH_CUT })) {
    if (!kept.has(job.state)) continue;
    const id = text(job.subjectId);
    if (out.has(id) && out.get(id).state !== STATES.BLOCKED) continue;
    out.set(id, { state: job.state, jobId: job.id, lastError: job.lastError });
  }
  return out;
}

async function readCatalog(catalog, scope) {
  const listed = await catalog.listSources(SOURCE_LIMIT, scope);
  if (!listed.ok) return { ok: false, error: `the source list could not be read: ${listed.error}` };
  const sources = listed.data;
  const ids = sources.map((s) => text(s.id)).filter(Boolean);
  const scored = new Map();
  for (let i = 0; i < ids.length; i += STATE_CHUNK) {
    const res = await catalog.listMomentStates(ids.slice(i, i + STATE_CHUNK), scope);
    if (!res.ok) return { ok: false, error: `moments states could not be read: ${res.error}` };
    for (const [key, value] of Object.entries(res.data)) scored.set(key, text(value && value.status));
  }
  const all = await catalog.listEditsByStatus(EDIT_LIMIT, catalog.editStatuses, scope);
  if (!all.ok) return { ok: false, error: `the edits could not be read: ${all.error}` };
  const edits = new Map();
  for (const e of all.data) {
    const key = text(e.sourceId).toLowerCase();
    if (!edits.has(key)) edits.set(key, []);
    edits.get(key).push(e);
  }
  return {
    ok: true,
    sources,
    scored,
    edits,
    truncated: sources.length >= SOURCE_LIMIT || all.data.length >= EDIT_LIMIT,
  };
}

/** Totals: how many scored recordings, and how far their edits have got. */
function tally({ scored, edits }) {
  const counts = { scored: 0, noEdits: 0, review: 0, unfinished: 0 };
  for (const [id, status] of scored) {
    if (status !== 'done') continue;
    counts.scored += 1;
    const own = edits.get(id) || [];
    if (!own.length) counts.noEdits += 1;
    for (const e of own) {
      if (UNFINISHED.includes(e.status)) counts.unfinished += 1;
      else counts.review += 1;
    }
  }
  return counts;
}

async function runBackfill({ queue, catalog, scope, apply = false }) {
  const read = await readCatalog(catalog, scope);
  if (!read.ok) return { ok: false, error: read.error };
  const plan = planBackfill({ ...read, queued: queuedSourceIds(queue) });
  const enqueued = [];
  if (apply) {
    for (const entry of plan.enqueue) {
      const { job, created } = enqueueRoughCut(queue, { sourceId: entry.id, why: 'npm run studio:backfill-roughcuts' });
      enqueued.push({ ...entry, jobId: job.id, created });
    }
  }
  return { ok: true, apply, plan, enqueued, counts: tally(read), truncated: read.truncated };
}

function report(result) {
  const lines = [];
  const { plan, counts } = result;
  lines.push(`rough cuts: ${counts.scored} scored recording(s) · ${counts.noEdits} with no edits yet · `
    + `${counts.unfinished} edit(s) still to render · ${counts.review} edit(s) rendered (in review or later)`);
  const verb = result.apply ? 'Queued' : 'Would queue';
  lines.push(`${verb} ${plan.enqueue.length} rough-cut job(s):`);
  for (const e of result.apply ? result.enqueued : plan.enqueue) {
    lines.push(`  ${e.name} (${e.id}) — ${e.why}${e.jobId ? ` — job ${e.jobId}${e.created ? '' : ', already there'}` : ''}`);
  }
  if (!plan.enqueue.length) lines.push('  (none)');
  const waiting = plan.skipped.filter((s) => /on the queue/.test(s.why));
  if (waiting.length) lines.push(`${waiting.length} already waiting on the queue.`);
  if (plan.blocked.length) {
    lines.push(`${plan.blocked.length} BLOCKED — these will not be cut until somebody acts on the reason, then deletes the blocked job:`);
    for (const b of plan.blocked) lines.push(`  ${b.name} (${b.id}) — job ${b.jobId}: ${b.why}`);
  }
  if (!counts.scored) lines.push('No recording has scored moments yet, so there is nothing to cut (npm run studio:backfill-moments scores them).');
  if (result.truncated) {
    lines.push('CANNOT TELL about the rest: the catalog returned its ceiling of sources or edits, '
      + 'so some were not looked at. Raise the limit or page the read before trusting "none".');
  }
  if (!result.apply && plan.enqueue.length) lines.push('Dry run — nothing was written. Add --apply to queue.');
  return lines.join('\n');
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const apply = argv.includes('--apply');
  const scope = scopeFor({}, env);
  if (!scope || !text(env.SUPABASE_URL)) {
    console.error('Not configured: STUDIO_PROJECT_ID and SUPABASE_URL must be set — this runs with the '
      + "Studio worker's own settings (doppler run --scope ~/Studio --project starcaster --config prd).");
    return 2;
  }
  const queueFile = resolveQueueFile({}, env);
  const refused = refuseHere({ role: checkRole(ROLE), queueFile, queueExists: fs.existsSync(queueFile) });
  if (refused) {
    console.error(refused.message);
    return refused.code;
  }
  let queue;
  try {
    queue = openQueue(queueFile);
  } catch (err) {
    console.error(`The queue at ${queueFile} could not be opened: ${err.message}`);
    return 1;
  }
  try {
    const edits = require('../lib/videoEditsStore.js');
    const catalog = {
      listSources: require('../lib/videoSourcesStore.js').listSources,
      listMomentStates: require('../lib/videoMomentsStore.js').listMomentStates,
      listEditsByStatus: edits.listEditsByStatus,
      editStatuses: edits.EDIT_STATUSES,
    };
    const result = await runBackfill({ queue, catalog, scope, apply });
    if (!result.ok) {
      console.error(`Could not tell: ${result.error}`);
      return 1;
    }
    console.log(`Queue: ${path.resolve(queueFile)} · project ${scope.projectId}`);
    console.log(report(result));
    return 0;
  } finally {
    queue.close();
  }
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }, (err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exitCode = 1;
  });
}

module.exports = { planBackfill, queuedSourceIds, runBackfill, tally, report, main };
