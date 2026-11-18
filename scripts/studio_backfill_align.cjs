#!/usr/bin/env node
'use strict';

/**
 * npm run studio:backfill-align [-- --apply]
 *
 * Reel Spinner 3b (SC-832). The proxy pass queues a line-up for every iPhone
 * or Zoom recording that reaches `ready` from now on. The ones that were ready
 * BEFORE that were never handed on, and nothing would ever go back for them.
 * This does, once.
 *
 * It finds every pair of ready recordings 3a calls candidates (an iPhone take
 * and a Zoom recording whose times overlap — workers/studio/alignment.js
 * `candidateReason`), drops the pairs that already have a video_audio_pairs
 * row, and queues ONE align job per recording still needed: a job lines its
 * recording up with every candidate partner, so one side of each pair is
 * enough.
 *
 * DRY RUN BY DEFAULT. Without `--apply` it reads the catalog and the queue and
 * says what it WOULD enqueue, writing nothing. With `--apply` it enqueues into
 * the LOCAL queue only, so it must run on the Mini, where the daemon reads it.
 * It never writes to the catalog: the line-up pass does that.
 *
 * It always prints how many pairs exist, which is the number SC-832 asks for.
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
const { enqueueAlign, partnersFor, isPairable, STAGE_ALIGN, SOURCE_LIMIT } = require('../workers/studio/alignPass.js');
const { scopeFor } = require('../workers/studio/ingest.js');
const { refuseHere } = require('./studio_backfill_transcripts.cjs');

const PAIR_LIMIT = 5000;

function text(value) {
  return String(value == null ? '' : value).trim();
}

function pairKey(x, y) {
  const a = text(x).toLowerCase();
  const b = text(y).toLowerCase();
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function nameOf(row) {
  return (text(row.localPath) && path.basename(text(row.localPath))) || text(row.id);
}

/**
 * Which recordings need lining up. Pure, so the rule is tested without a
 * database or a queue.
 *
 *   sources — catalog rows (videoSourcesStore shape)
 *   pairs   — video_audio_pairs rows (videoAudioPairsStore shape)
 *   queued  — the set of source ids with an align job pending, running or blocked
 *
 * Returns `{ candidates, enqueue, skipped }`: every candidate pair with
 * whether it has a row, the recordings to queue, and why the rest were not.
 */
function planBackfill({ sources, pairs, queued }) {
  const rows = new Map();
  for (const p of pairs) rows.set(pairKey(p.sourceAId, p.sourceBId), p);
  const ready = sources.filter((s) => text(s.state) === 'ready' && isPairable(s));
  const byId = new Map(ready.map((s) => [text(s.id).toLowerCase(), s]));

  const candidates = new Map();
  for (const s of ready) {
    for (const { source: other } of partnersFor(s, ready)) {
      const key = pairKey(s.id, other.id);
      if (candidates.has(key)) continue;
      const row = rows.get(key) || null;
      candidates.set(key, { a: s, b: other, row });
    }
  }

  const plan = { candidates: [...candidates.values()], enqueue: [], skipped: [] };
  const chosen = new Set();
  for (const c of plan.candidates) {
    if (c.row) continue;
    const ids = [text(c.a.id), text(c.b.id)];
    if (ids.some((id) => chosen.has(id.toLowerCase()))) continue; // its job lines up every partner
    const waiting = ids.find((id) => queued.has(id));
    if (waiting) {
      plan.skipped.push({ id: waiting, name: nameOf(byId.get(waiting.toLowerCase()) || { id: waiting }),
        why: 'an align job is already on the queue' });
      chosen.add(waiting.toLowerCase());
      continue;
    }
    const pick = c.a;
    chosen.add(text(pick.id).toLowerCase());
    plan.enqueue.push({ id: text(pick.id), name: nameOf(pick), partner: nameOf(c.b) });
  }
  return plan;
}

/** Totals: what `studio:backfill-align` reports at the top. */
function tally(plan) {
  const counts = { candidates: plan.candidates.length, done: 0, failed: 0, missing: 0, chosenByDane: 0 };
  for (const c of plan.candidates) {
    if (!c.row) counts.missing += 1;
    else if (text(c.row.status) === 'done') counts.done += 1;
    else counts.failed += 1;
    if (c.row && text(c.row.chosenBy) === 'dane') counts.chosenByDane += 1;
  }
  return counts;
}

/** Ids with an align job that is still live or blocked on this queue. */
function queuedSourceIds(queue) {
  const live = new Set([STATES.PENDING, STATES.RUNNING, STATES.BLOCKED]);
  return new Set(queue.listJobs({ stage: STAGE_ALIGN })
    .filter((job) => live.has(job.state))
    .map((job) => text(job.subjectId)));
}

async function runBackfill({ queue, catalog, scope, apply = false }) {
  const listed = await catalog.listSources(SOURCE_LIMIT, scope);
  if (!listed.ok) return { ok: false, error: `the source list could not be read: ${listed.error}` };
  const pairs = await catalog.listAudioPairs(PAIR_LIMIT, scope);
  if (!pairs.ok) return { ok: false, error: `the existing pairs could not be read: ${pairs.error}` };
  const plan = planBackfill({ sources: listed.data, pairs: pairs.data, queued: queuedSourceIds(queue) });
  const enqueued = [];
  if (apply) {
    for (const entry of plan.enqueue) {
      const { job, created } = enqueueAlign(queue, { sourceId: entry.id });
      enqueued.push({ ...entry, jobId: job.id, created });
    }
  }
  const ready = listed.data.filter((s) => text(s.state) === 'ready' && isPairable(s));
  return {
    ok: true,
    apply,
    plan,
    enqueued,
    counts: tally(plan),
    rowsInTable: pairs.data.length,
    readyPairable: ready.length,
    truncated: listed.data.length >= SOURCE_LIMIT || pairs.data.length >= PAIR_LIMIT,
  };
}

function report(result) {
  const lines = [];
  const { plan, counts } = result;
  lines.push(`${result.readyPairable} ready iPhone/Zoom recording(s); ${counts.candidates} pair(s) recorded at overlapping times.`);
  lines.push(`pairs: ${counts.done} lined up · ${counts.failed} refused with a reason · ${counts.missing} not looked at yet`
    + ` · ${counts.chosenByDane} with Dane's choice of sound (${result.rowsInTable} row(s) in video_audio_pairs)`);
  const verb = result.apply ? 'Enqueued' : 'Would enqueue';
  lines.push(`${verb} ${plan.enqueue.length} align job(s):`);
  for (const e of result.apply ? result.enqueued : plan.enqueue) {
    lines.push(`  ${e.name} (${e.id}), with ${e.partner}${e.jobId ? ` — job ${e.jobId}${e.created ? '' : ', already there'}` : ''}`);
  }
  if (!plan.enqueue.length) lines.push('  (none — every candidate pair has a row or a job waiting)');
  if (plan.skipped.length) lines.push(`${plan.skipped.length} already waiting on the queue.`);
  if (!counts.candidates) {
    lines.push('No iPhone take and Zoom recording overlap in time, so there is nothing to pair: record one session on both at once.');
  }
  if (result.truncated) {
    lines.push(`CANNOT TELL about the rest: a read returned its ceiling (${SOURCE_LIMIT} sources or ${PAIR_LIMIT} pairs), `
      + 'so some were not looked at. Raise the limit or page the read before trusting these numbers.');
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
      listAudioPairs: require('../lib/videoAudioPairsStore.js').listAudioPairs,
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

module.exports = { planBackfill, tally, queuedSourceIds, runBackfill, report, main, pairKey };
