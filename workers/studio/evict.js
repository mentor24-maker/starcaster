'use strict';

/**
 * Cache eviction — what stops the Mini's disk filling with originals nobody
 * needs any more (task 86bcwqp2y).
 *
 * Ingest (4/8) downloads every uploaded clip into `~/Studio/cache` and nothing
 * ever deleted it. Only the probe and proxy passes read the original; once a
 * source is `ready`, everything downstream reads the derived copies (the proxy,
 * the WAV, the contact sheet) in `~/Studio/derived`. So the cache grew by every
 * upload until free space fell below the ingest floor (50 GB) and every new
 * upload sat at "downloading" — which is what happened on 2026-11-02, with the
 * Mini at 28 GB free and 9.6 GB of finished originals in the cache.
 *
 * The original is still in Drive, so the cached copy is a convenience, not the
 * record. Deleting it is safe as long as anything that later needs it can get
 * it back: the probe and proxy passes ask ingest to re-download a missing
 * original (`enqueueRefetch`) rather than failing the source.
 *
 * WHEN AN ORIGINAL IS KEPT, and why each rule exists:
 *
 *   the source is not `ready`    — probe or proxy still needs the bytes.
 *   the proxy IS the original     — a small, ordinary clip (or one with no
 *                                   picture) is used directly as its own proxy
 *                                   (proxy.js SKIP_REASONS). Deleting it would
 *                                   delete the copy the rest of the Studio reads.
 *   the proxy is not on disk      — "the derived proxy stays" is the condition
 *                                   that makes eviction safe; without it there
 *                                   would be nothing local left at all.
 *   the path is outside the cache — this deletes cache files and nothing else.
 *                                   A row pointed somewhere by hand is not ours.
 *   it is not in Drive            — no Drive file id means nothing to fetch it
 *                                   back from, so this copy may be the only one.
 *
 * `local_path` stays on the row. The Footage screen takes a recording's name
 * from it (lib/studioFootage.js), and it is where a re-download lands again.
 * Whether the bytes are there is answered by the disk, which is the only place
 * the answer is true; a column saying "evicted" would be a second copy of that
 * fact that could disagree with it, and a migration the Mini's live worker
 * would need before it could write a single row.
 */

const fs = require('node:fs');
const path = require('node:path');

const videoSourcesStore = require('../../lib/videoSourcesStore.js');
const { STAGE_INGEST, SUBJECT_DRIVE_FILE } = require('./drive.js');

const STATE_READY = 'ready';

/** Stages that read the ORIGINAL. A source with one of these live is never evicted. */
const STAGES_NEEDING_ORIGINAL = ['probe', 'proxy'];
const LIVE_JOB_STATES = new Set(['pending', 'running']);

/** How many sources the sweep reads in one go — the backfill scripts' ceiling. */
const SWEEP_SOURCE_LIMIT = 1000;

function text(value) {
  return String(value == null ? '' : value).trim();
}

function resolveCacheDir(options, env) {
  // Required lazily: ingest.js requires probePass.js, which requires this file.
  return require('./ingest.js').resolveCacheDir(options, env);
}

/** True when `file` sits inside `dir` (not equal to it, not beside it). */
function isInside(dir, file) {
  const rel = path.relative(path.resolve(dir), path.resolve(file));
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * May this source's cached original be deleted? Pure: the disk is asked
 * through `exists`, so the rule is tested without one.
 * Returns `{ evict: true }` or `{ evict: false, why }`.
 */
function evictionVerdict(row, { cacheDir, exists = fs.existsSync } = {}) {
  const localPath = text(row && row.localPath);
  const proxyPath = text(row && row.proxyPath);
  if (text(row && row.state) !== STATE_READY) {
    return { evict: false, why: `the source is "${text(row && row.state)}", not ready, so probe or proxy may still need it` };
  }
  if (!localPath) return { evict: false, why: 'no downloaded file is recorded against it' };
  if (!text(row.driveFileId)) {
    return { evict: false, why: 'it has no Drive file id, so this copy could not be fetched back if it were deleted' };
  }
  if (!cacheDir || !isInside(cacheDir, localPath)) {
    return { evict: false, why: `${localPath} is not inside the Studio cache (${cacheDir || 'unset'}), so it is not the cache's to delete` };
  }
  if (!proxyPath) return { evict: false, why: 'it has no proxy recorded, so the original is the only copy on this machine' };
  if (path.resolve(proxyPath) === path.resolve(localPath)) {
    return { evict: false, why: 'the original is used directly as its own proxy, so deleting it would delete the proxy' };
  }
  if (!exists(proxyPath)) {
    return { evict: false, why: `its proxy is not on disk at ${proxyPath}, so the original is the only copy on this machine` };
  }
  if (!exists(localPath)) return { evict: false, why: 'already evicted — the original is not in the cache', already: true };
  return { evict: true };
}

/**
 * Delete one ready source's cached original if the rules allow it.
 * Returns `{ action: 'evicted', path, bytes }`, `{ action: 'kept', why }`, or
 * `{ action: 'error', why }` when the delete itself failed.
 */
function evictOriginal(row, { cacheDir, io = fs } = {}) {
  const verdict = evictionVerdict(row, { cacheDir, exists: io.existsSync });
  if (!verdict.evict) return { action: verdict.already ? 'absent' : 'kept', why: verdict.why };
  const localPath = text(row.localPath);
  let bytes = 0;
  try {
    bytes = io.statSync(localPath).size;
    io.rmSync(localPath, { force: true });
  } catch (err) {
    return { action: 'error', why: `the original at ${localPath} could not be deleted: ${err.message}` };
  }
  // The Drive-id folder is empty now unless a partial download sits in it.
  // Removing it is tidiness, never a failure.
  try { io.rmdirSync(path.dirname(localPath)); } catch { /* not empty, or gone */ }
  return { action: 'evicted', path: localPath, bytes };
}

/**
 * Ask ingest to bring a source's original back from Drive.
 *
 * Keyed by the Drive file id (ingest's own subject), so the queue's unique
 * index on live jobs is the dedupe. `refetch: true` is what makes ingest
 * download a file whose md5 it already has, instead of calling it a duplicate.
 */
function enqueueRefetch(queue, row) {
  const driveFileId = text(row && row.driveFileId);
  if (!driveFileId) throw new Error('enqueueRefetch needs a source with a Drive file id');
  const localPath = text(row.localPath);
  return queue.enqueue({
    stage: STAGE_INGEST,
    subjectKind: SUBJECT_DRIVE_FILE,
    subjectId: driveFileId,
    payload: {
      driveFileId,
      lane: text(row.deviceLane) === 'plate' ? 'plates' : 'inbox',
      name: localPath ? path.basename(localPath) : '',
      refetch: true,
      sourceId: text(row.id),
    },
  });
}

/** Source ids with a probe or proxy job still waiting or running on this queue. */
function sourcesInFlight(queue) {
  const ids = new Set();
  for (const stage of STAGES_NEEDING_ORIGINAL) {
    for (const job of queue.listJobs({ stage })) {
      if (LIVE_JOB_STATES.has(job.state)) ids.add(text(job.subjectId));
    }
  }
  return ids;
}

/**
 * The sweep: every ready source's original goes, not just the ones finished
 * after this shipped. It is what clears the ~30 originals already sitting in
 * the cache, and what catches any the proxy pass could not delete at the time.
 * Cheap — one catalog read and a stat per source — and idempotent: a second run
 * finds everything already absent.
 */
async function sweepReadyOriginals({
  queue,
  catalog = { listSources: videoSourcesStore.listSources },
  options = {},
  env = process.env,
  io = fs,
} = {}) {
  const scope = require('./ingest.js').scopeFor(options, env);
  const cacheDir = resolveCacheDir(options, env);
  const report = { ok: true, cacheDir, evicted: [], kept: [], absent: 0, errors: [], freedBytes: 0 };
  if (!scope) {
    return { ...report, ok: false, error: 'STUDIO_PROJECT_ID is not set, so the catalog cannot be read in its project' };
  }
  const listed = await catalog.listSources(SWEEP_SOURCE_LIMIT, scope);
  if (!listed.ok) return { ...report, ok: false, error: `the source list could not be read: ${listed.error}` };
  const busy = queue ? sourcesInFlight(queue) : new Set();
  for (const row of listed.data) {
    if (text(row.state) !== STATE_READY) continue;
    if (busy.has(text(row.id))) {
      report.kept.push({ id: row.id, why: 'a probe or proxy job is still on the queue for it' });
      continue;
    }
    const result = evictOriginal(row, { cacheDir, io });
    if (result.action === 'evicted') {
      report.evicted.push({ id: row.id, path: result.path, bytes: result.bytes });
      report.freedBytes += result.bytes;
    } else if (result.action === 'absent') {
      report.absent += 1;
    } else if (result.action === 'error') {
      report.errors.push({ id: row.id, why: result.why });
    } else {
      report.kept.push({ id: row.id, why: result.why });
    }
  }
  report.truncated = listed.data.length >= SWEEP_SOURCE_LIMIT;
  report.ok = !report.errors.length;
  return report;
}

module.exports = {
  evictionVerdict,
  evictOriginal,
  enqueueRefetch,
  sweepReadyOriginals,
  sourcesInFlight,
  isInside,
  SWEEP_SOURCE_LIMIT,
};
