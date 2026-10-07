#!/usr/bin/env node
'use strict';

/**
 * npm run studio:backfill-transcripts [-- --apply]
 *
 * Studio Phase 2 · 3 of 6 (86bcdejzm). The proxy pass queues a transcription
 * for every recording that reaches `ready` from now on. A recording that
 * reached `ready` BEFORE that existed — IMG_1962, the first one — was never
 * handed on, and nothing would ever go back for it. This does, once.
 *
 * It lists every source in the Studio project that is `ready`, is not a
 * plate, has no transcript row, and has no transcribe job already waiting on
 * this machine's queue, and puts a transcribe job on the queue for each.
 *
 * DRY RUN BY DEFAULT. Without `--apply` it reads the catalog and the queue and
 * says what it WOULD enqueue, writing nothing. With `--apply` it enqueues —
 * into the LOCAL queue only (~/Studio/queue.sqlite, or STUDIO_QUEUE_FILE), so
 * it must run on the Mini, where the daemon reads that queue. It never writes
 * to the catalog: the transcribe pass does that when it runs the job.
 *
 * Run twice, the second run enqueues nothing: the first run's jobs are on the
 * queue (and later, their transcripts are in the catalog), and both are
 * reasons to skip.
 *
 * Exit 0 ran (whatever it found), 1 could not read the catalog or the queue,
 * 2 not configured (no STUDIO_PROJECT_ID / database settings).
 */

const path = require('node:path');

const { openQueue, STATES } = require('../workers/studio/queue.js');
const { resolveQueueFile } = require('../workers/studio/daemon.js');
const { laneFor } = require('../workers/studio/proxyPass.js');
const { enqueueTranscribe, STAGE_TRANSCRIBE } = require('../workers/studio/transcribePass.js');
const { scopeFor } = require('../workers/studio/ingest.js');

/** The most sources one read returns (lib/storeLimit.js's ceiling). */
const SOURCE_LIMIT = 1000;
/** listTranscriptStates takes at most this many ids per request. */
const STATE_CHUNK = 500;

function text(value) {
  return String(value == null ? '' : value).trim();
}

/**
 * Which sources need a transcription queued, and why each other one does not.
 * Pure, so the rule is tested without a database or a queue.
 *
 *   sources      — catalog rows (videoSourcesStore shape)
 *   transcribed  — the set of source ids (lower-cased) that HAVE a transcript row
 *   queued       — the set of source ids with a transcribe job pending, running or blocked
 */
function planBackfill({ sources, transcribed, queued }) {
  const plan = { enqueue: [], skipped: [] };
  for (const row of sources) {
    const id = text(row.id);
    // The catalog keeps no filename; the downloaded file's name is the one a
    // person recognises (IMG_1962.MOV).
    const name = (text(row.localPath) && path.basename(text(row.localPath))) || id;
    const entry = { id, name };
    if (text(row.state) !== 'ready') continue; // not this tool's business until it is ready
    if (laneFor(row) === 'plates') {
      plan.skipped.push({ ...entry, why: 'a plate — plates are not transcribed' });
    } else if (transcribed.has(id.toLowerCase())) {
      plan.skipped.push({ ...entry, why: 'already has a transcript row' });
    } else if (queued.has(id)) {
      plan.skipped.push({ ...entry, why: 'a transcribe job is already on the queue' });
    } else {
      plan.enqueue.push(entry);
    }
  }
  return plan;
}

/** Ids with a transcribe job that is still live or blocked on this queue. */
function queuedSourceIds(queue) {
  const live = new Set([STATES.PENDING, STATES.RUNNING, STATES.BLOCKED]);
  return new Set(queue.listJobs({ stage: STAGE_TRANSCRIBE })
    .filter((job) => live.has(job.state))
    .map((job) => text(job.subjectId)));
}

async function readCatalog(catalog, scope) {
  const listed = await catalog.listSources(SOURCE_LIMIT, scope);
  if (!listed.ok) return { ok: false, error: `the source list could not be read: ${listed.error}` };
  const sources = listed.data;
  const ready = sources.filter((s) => text(s.state) === 'ready').map((s) => text(s.id));
  const transcribed = new Set();
  for (let i = 0; i < ready.length; i += STATE_CHUNK) {
    const states = await catalog.listTranscriptStates(ready.slice(i, i + STATE_CHUNK), scope);
    if (!states.ok) return { ok: false, error: `transcript states could not be read: ${states.error}` };
    for (const key of Object.keys(states.data)) transcribed.add(key);
  }
  return { ok: true, sources, transcribed, truncated: sources.length >= SOURCE_LIMIT };
}

/**
 * The whole run, with its dependencies passed in so the test drives a real
 * queue and a fake catalog. Returns the plan and what was enqueued.
 */
async function runBackfill({ queue, catalog, scope, apply = false }) {
  const read = await readCatalog(catalog, scope);
  if (!read.ok) return { ok: false, error: read.error };
  const plan = planBackfill({ sources: read.sources, transcribed: read.transcribed, queued: queuedSourceIds(queue) });
  const enqueued = [];
  if (apply) {
    for (const entry of plan.enqueue) {
      const { job, created } = enqueueTranscribe(queue, { sourceId: entry.id });
      enqueued.push({ ...entry, jobId: job.id, created });
    }
  }
  return { ok: true, apply, plan, enqueued, truncated: read.truncated };
}

function report(result) {
  const lines = [];
  const { plan } = result;
  const verb = result.apply ? 'Enqueued' : 'Would enqueue';
  lines.push(`${verb} ${plan.enqueue.length} transcription(s):`);
  for (const e of result.apply ? result.enqueued : plan.enqueue) {
    lines.push(`  ${e.name} (${e.id})${e.jobId ? ` — job ${e.jobId}${e.created ? '' : ', already there'}` : ''}`);
  }
  if (!plan.enqueue.length) lines.push('  (none — every ready recording is transcribed, queued, or a plate)');
  if (plan.skipped.length) {
    lines.push(`Skipped ${plan.skipped.length} ready source(s):`);
    for (const s of plan.skipped) lines.push(`  ${s.name} (${s.id}) — ${s.why}`);
  }
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

module.exports = { planBackfill, queuedSourceIds, runBackfill, report, main, SOURCE_LIMIT };
