#!/usr/bin/env node
'use strict';

/**
 * npm run studio:backfill-cuts [-- --apply]
 *
 * Reel Spinner 1c (86bcwaw8c). The transcribe pass queues a cut-marks job for
 * every transcript it finishes from now on. The ~28 recordings transcribed
 * BEFORE that were never handed on, and nothing would ever go back for them.
 * This does, once.
 *
 * It lists every source in the Studio project whose transcript is `done`, that
 * has no cut-marks row, and that has no cut_marks job already waiting on this
 * machine's queue, and puts a cut_marks job on the queue for each.
 *
 * DRY RUN BY DEFAULT. Without `--apply` it reads the catalog and the queue and
 * says what it WOULD enqueue, writing nothing. With `--apply` it enqueues into
 * the LOCAL queue only, so it must run on the Mini, where the daemon reads it.
 * It never writes to the catalog: the cut-marks pass does that.
 *
 * Run twice, the second run enqueues nothing: the first run's jobs are on the
 * queue (and later, their rows are in the catalog), and both are reasons to skip.
 *
 * It refuses anywhere but the Studio worker's machine, and when the queue file
 * is not already there — the same refusal, from the same function, as
 * studio_backfill_transcripts.cjs, for the same reason.
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
const { enqueueCutMarks, STAGE_CUT_MARKS } = require('../workers/studio/cutMarksPass.js');
const { scopeFor } = require('../workers/studio/ingest.js');
const { refuseHere, SOURCE_LIMIT } = require('./studio_backfill_transcripts.cjs');

/** listTranscriptStates and listCutMarkStates take at most this many ids per request. */
const STATE_CHUNK = 500;

function text(value) {
  return String(value == null ? '' : value).trim();
}

/**
 * Which sources need their cuts found, and why each other transcribed one does
 * not. Pure, so the rule is tested without a database or a queue.
 *
 *   sources     — catalog rows (videoSourcesStore shape)
 *   transcripts — source id (lower-cased) → transcript state
 *   marked      — source id (lower-cased) → cut-marks state, for those that have a row
 *   queued      — the set of source ids with a cut_marks job pending, running or blocked
 */
function planBackfill({ sources, transcripts, marked, queued }) {
  const plan = { enqueue: [], skipped: [] };
  for (const row of sources) {
    const id = text(row.id);
    const name = (text(row.localPath) && path.basename(text(row.localPath))) || id;
    const entry = { id, name };
    if (transcripts.get(id.toLowerCase()) !== 'done') continue; // only a finished transcript has words to compare
    if (marked.has(id.toLowerCase())) {
      plan.skipped.push({ ...entry, why: `already has a cut-marks row (${marked.get(id.toLowerCase())})` });
    } else if (queued.has(id)) {
      plan.skipped.push({ ...entry, why: 'a cut_marks job is already on the queue' });
    } else {
      plan.enqueue.push(entry);
    }
  }
  return plan;
}

/** Ids with a cut_marks job that is still live or blocked on this queue. */
function queuedSourceIds(queue) {
  const live = new Set([STATES.PENDING, STATES.RUNNING, STATES.BLOCKED]);
  return new Set(queue.listJobs({ stage: STAGE_CUT_MARKS })
    .filter((job) => live.has(job.state))
    .map((job) => text(job.subjectId)));
}

async function statesOf(list, ids, scope, what) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += STATE_CHUNK) {
    const res = await list(ids.slice(i, i + STATE_CHUNK), scope);
    if (!res.ok) return { ok: false, error: `${what} could not be read: ${res.error}` };
    for (const [key, value] of Object.entries(res.data)) out.set(key, text(value && value.state));
  }
  return { ok: true, states: out };
}

async function readCatalog(catalog, scope) {
  const listed = await catalog.listSources(SOURCE_LIMIT, scope);
  if (!listed.ok) return { ok: false, error: `the source list could not be read: ${listed.error}` };
  const sources = listed.data;
  const ids = sources.map((s) => text(s.id)).filter(Boolean);
  const transcripts = await statesOf(catalog.listTranscriptStates, ids, scope, 'transcript states');
  if (!transcripts.ok) return transcripts;
  const done = ids.filter((id) => transcripts.states.get(id.toLowerCase()) === 'done');
  const marked = await statesOf(catalog.listCutMarkStates, done, scope, 'cut-marks states');
  if (!marked.ok) return marked;
  return {
    ok: true,
    sources,
    transcripts: transcripts.states,
    marked: marked.states,
    truncated: sources.length >= SOURCE_LIMIT,
  };
}

/** Totals across the whole project: what `studio:backfill-cuts` reports at the top. */
function tally({ transcripts, marked }) {
  const counts = { transcribed: 0, done: 0, failed: 0, missing: 0 };
  for (const [id, state] of transcripts) {
    if (state !== 'done') continue;
    counts.transcribed += 1;
    const cut = marked.get(id);
    if (cut === 'done') counts.done += 1;
    else if (cut === 'failed') counts.failed += 1;
    else counts.missing += 1;
  }
  return counts;
}

/**
 * The whole run, with its dependencies passed in so the test drives a real
 * queue and a fake catalog. Returns the plan, the tally and what was enqueued.
 */
async function runBackfill({ queue, catalog, scope, apply = false }) {
  const read = await readCatalog(catalog, scope);
  if (!read.ok) return { ok: false, error: read.error };
  const plan = planBackfill({ ...read, queued: queuedSourceIds(queue) });
  const enqueued = [];
  if (apply) {
    for (const entry of plan.enqueue) {
      const { job, created } = enqueueCutMarks(queue, { sourceId: entry.id });
      enqueued.push({ ...entry, jobId: job.id, created });
    }
  }
  return { ok: true, apply, plan, enqueued, counts: tally(read), truncated: read.truncated };
}

function report(result) {
  const lines = [];
  const { plan, counts } = result;
  lines.push(`cut marks: ${counts.done} done · ${counts.failed} failed · ${counts.missing} still to do `
    + `(of ${counts.transcribed} finished transcript(s))`);
  const verb = result.apply ? 'Enqueued' : 'Would enqueue';
  lines.push(`${verb} ${plan.enqueue.length} cut-marks job(s):`);
  for (const e of result.apply ? result.enqueued : plan.enqueue) {
    lines.push(`  ${e.name} (${e.id})${e.jobId ? ` — job ${e.jobId}${e.created ? '' : ', already there'}` : ''}`);
  }
  if (!plan.enqueue.length) lines.push('  (none — every finished transcript has cut marks or a job waiting)');
  const waiting = plan.skipped.filter((s) => /on the queue/.test(s.why));
  if (waiting.length) lines.push(`${waiting.length} already waiting on the queue.`);
  if (result.truncated) {
    lines.push(`CANNOT TELL about the rest: the catalog returned its ceiling of ${SOURCE_LIMIT} sources, `
      + 'so older ones were not looked at. Raise the limit or page the read before trusting "none".');
  }
  if (!result.apply && plan.enqueue.length) lines.push('Dry run — nothing was written. Add --apply to enqueue.');
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
    const catalog = {
      listSources: require('../lib/videoSourcesStore.js').listSources,
      listTranscriptStates: require('../lib/videoTranscriptsStore.js').listTranscriptStates,
      listCutMarkStates: require('../lib/videoCutMarksStore.js').listCutMarkStates,
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
