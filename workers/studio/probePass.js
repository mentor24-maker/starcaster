'use strict';

/**
 * The probe PASS — what turns a downloaded file into a described one.
 *
 * `probe.js` (Studio 5/8) answers "what is this file?" for a path and does
 * nothing else. Nothing ever asked it: ingest completed its job at
 * `downloaded` and enqueued nothing after it, so every file the Studio fetched
 * stopped there for good, with no length, no frame rate, no device and the
 * upload date standing in for the recording date.
 *
 * WHY A SEPARATE FILE RATHER THAN A FUNCTION IN probe.js. probe.js promises no
 * side effects and no dependencies beyond ffprobe — its tests run over JSON
 * written out by hand, and it does not drag the Supabase client in behind it.
 * The pass needs the catalog and the queue, so it lives here, and probe.js stays
 * the pure thing its header says it is.
 *
 * WHAT IS CHARGED TO THE FILE, AND WHAT IS NOT. Three different things can stop
 * a probe, and only one of them is about the footage:
 *
 *   the file is unreadable — missing from disk, corrupt, not media. The row goes
 *                            to `failed` and the job fails through the queue's
 *                            own retry rules, keeping a reason a person can
 *                            read on both.
 *   ffprobe is not installed — a fact about the MACHINE. Marking every file
 *                            `failed` for it would build a catalog of "broken"
 *                            footage whose real problem is a missing tool
 *                            (probe.js says the same about its own lanes). The
 *                            job is put back without spending an attempt, and
 *                            the row is left alone.
 *   the catalog is down     — also not the file's fault, same treatment. This
 *                            is the same line ingest draws (`releaseIt`).
 */

const fs = require('node:fs');

const { probeFile, PROBE_FAILURES } = require('./probe.js');
const videoSourcesStore = require('../../lib/videoSourcesStore.js');
const { enqueueProxy } = require('./proxyPass.js');

const STAGE_PROBE = 'probe';
const SUBJECT_VIDEO_SOURCE = 'video_source';

const STATE_PROBED = 'probed';
const STATE_FAILED = 'failed';

/** How long a job waits after a condition that is not the file's fault. The
 *  same 15 minutes ingest's outage hold-off uses. */
const RELEASE_HOLD_MS = 15 * 60 * 1000;

function text(value) {
  return String(value == null ? '' : value).trim();
}

// The scope object is ingest's, not a copy of it: the pass reads and writes the
// rows ingest made, and two definitions of "which project" disagree quietly.
// Required lazily because ingest.js requires this file (to enqueue a probe).
function scopeFor(options, env) {
  return require('./ingest.js').scopeFor(options, env);
}

/** The catalog, behind an interface a test can hand a fake of. */
function realCatalog() {
  return {
    getSourceById: videoSourcesStore.getSourceById,
    updateSource: videoSourcesStore.updateSource,
  };
}

/**
 * Put a probe on the queue for one source.
 *
 * Keyed by the SOURCE id, so the queue's unique index on live
 * (stage, subject) jobs holds the dedupe: an ingest that runs twice while the
 * probe is still waiting gets the existing job back, not a second one. A probe
 * that has already finished does not block a new one — which is right, because
 * the only reason to ask again is that the bytes changed (a Drive replacement
 * puts the row back to `downloaded`).
 *
 * `sourcePath` is where the file sat in DRIVE (`/Studio/Plates/wide.mov`), not
 * on this disk. probe.js reads it for one thing only — whether the file is a
 * plate — and the folder is the only place that answer lives.
 */
function enqueueProbe(queue, { sourceId, localPath = '', sourcePath = '' }) {
  const id = text(sourceId);
  if (!id) throw new Error('enqueueProbe needs a source id');
  return queue.enqueue({
    stage: STAGE_PROBE,
    subjectKind: SUBJECT_VIDEO_SOURCE,
    subjectId: id,
    payload: { sourceId: id, localPath: text(localPath), sourcePath: text(sourcePath) },
  });
}

/**
 * The columns a successful probe writes, built only from what was MEASURED.
 *
 * A value the probe could not read is left out of the patch, never written as
 * null: `updateSource` reads null as "clear this column", so an audio-only file
 * would otherwise erase a width nobody asked it about. And `recordedAt` is only
 * written when the container carries its own date — otherwise the date ingest
 * took from Drive stays, rather than the file becoming undated.
 *
 * WIDTH AND HEIGHT ARE THE DISPLAYED ONES. A portrait iPhone clip is stored
 * 1920×1080 with a quarter-turn flag; the Footage screen shows `width×height`
 * to a person, and "1920×1080" for a clip that plays upright is a wrong answer
 * stated confidently.
 */
function probePatch(result) {
  const media = result.media || {};
  const patch = { state: STATE_PROBED, deviceLane: result.lane };
  const put = (key, value) => {
    if (value !== null && value !== undefined && value !== '') patch[key] = value;
  };
  put('durationS', media.durationSec);
  put('fps', media.fps);
  put('width', media.displayWidth);
  put('height', media.displayHeight);
  put('codec', media.videoCodec || media.audioCodec);
  put('recordedAt', media.recordedAt);
  return patch;
}

/**
 * Probe ONE claimed job. The caller owns the claim; this never claims.
 *
 * Like ingest, every return says what happened to the FILE (`outcome`) and what
 * the queue was told (`jobAction`), because the two can disagree and a reader
 * has to be able to see it.
 */
async function probeJob({
  queue,
  job,
  owner,
  catalog = realCatalog(),
  options = {},
  env = process.env,
  probe = probeFile,
  exists = fs.existsSync,
}) {
  const payload = job && job.payload && typeof job.payload === 'object' ? job.payload : {};
  const sourceId = text(payload.sourceId) || text(job && job.subjectId);
  const base = { jobId: job.id, sourceId };
  const scope = scopeFor(options, env);

  const blockIt = (reason) => {
    queue.block({
      stage: STAGE_PROBE,
      subjectKind: SUBJECT_VIDEO_SOURCE,
      subjectId: sourceId || text(job.subjectId),
      reason,
      payload: job.payload || null,
      jobId: job.id,
    });
    return { ...base, outcome: 'blocked', jobAction: 'blocked', reason };
  };
  const releaseIt = (reason) => {
    const released = typeof queue.release === 'function'
      ? queue.release(job.id, owner, { reason, runAfterMs: RELEASE_HOLD_MS })
      : false;
    // A job put back by nothing at all is a job lost; failing it at least
    // keeps it on the queue's retry clock.
    if (!released) queue.fail(job.id, owner, reason);
    return { ...base, outcome: 'outage', jobAction: released ? 'released' : 'failed', reason };
  };
  /**
   * The file is the problem. The ROW says so, so the Footage screen shows the
   * file as failed instead of as forever "downloaded", and the JOB fails with
   * the same reason, so the queue's retry rules decide whether to try again.
   * The job's last_error is where the reason is kept: video_sources has no
   * column for one, and adding one is a migration this slice does not need.
   */
  const failIt = async (reason) => {
    const marked = await catalog.updateSource(sourceId, { state: STATE_FAILED }, scope);
    queue.fail(job.id, owner, reason);
    return {
      ...base,
      outcome: 'failed',
      jobAction: 'failed',
      reason,
      rowMarked: Boolean(marked && marked.ok),
      ...(marked && marked.ok ? {} : { rowError: (marked && marked.error) || 'no answer from the catalog' }),
    };
  };

  if (!sourceId) {
    return blockIt('this probe job names no source, so there is nothing to probe. '
      + 'Fix: this should not be reachable from ingest — report it, then delete the job.');
  }
  if (!scope) {
    return blockIt('STUDIO_PROJECT_ID is not set, so the source row cannot be read or written in its project '
      + '(CLAUDE.md landmine 12). Fix: set STUDIO_PROJECT_ID to the project that owns the Studio.');
  }

  const row = await catalog.getSourceById(sourceId, scope);
  if (!row.ok) {
    if (row.status === 404) {
      return blockIt(`source ${sourceId} is not in the catalog any more, so its probe has nothing to write to. `
        + 'Fix: if the row was deleted on purpose, delete this blocked job.');
    }
    return releaseIt(`the catalog could not be asked for source ${sourceId}: ${row.error}`);
  }

  // The ROW's path wins over the payload's: a Drive replacement re-points
  // local_path at the new bytes, and probing the old path would describe a
  // file that is no longer the source.
  const localPath = text(row.data.localPath) || text(payload.localPath);
  if (!localPath) {
    return failIt(`source ${sourceId} has no downloaded file recorded against it (local_path is blank), `
      + 'so there was nothing on this machine to probe. Fix: re-ingest the file from Drive.');
  }
  if (!exists(localPath)) {
    return failIt(`the downloaded file for source ${sourceId} is not on disk at ${localPath} — it was moved `
      + 'or deleted after ingest. Fix: re-ingest the file from Drive.');
  }

  const result = probe(localPath, { sourcePath: text(payload.sourcePath) || undefined });
  if (!result.ok) {
    if (result.reason === PROBE_FAILURES.MISSING) {
      return releaseIt(`${result.message} — nothing was probed and source ${sourceId} was left as it was`);
    }
    return failIt(`ffprobe could not read the file for source ${sourceId} (${localPath}): ${result.message}`);
  }

  const patch = probePatch(result);
  const updated = await catalog.updateSource(sourceId, patch, scope);
  if (!updated.ok) {
    if (updated.status === 400) {
      // The store refused the values themselves. Retrying sends the same
      // values, so this is a bug to read, not a wait.
      return blockIt(`the probe results for source ${sourceId} were refused by the catalog: ${updated.error}`);
    }
    return releaseIt(`the probe results for source ${sourceId} could not be written: ${updated.error}`);
  }

  // Read the row back. The write answering 200 is not the evidence; the row is
  // (landmine 12/13 — writes in this codebase have succeeded while storing
  // nothing at all).
  const readBack = await catalog.getSourceById(sourceId, scope);
  if (!readBack.ok) {
    return releaseIt(`source ${sourceId} was written but could not be read back to check it: ${readBack.error}`);
  }
  if (text(readBack.data.state) !== STATE_PROBED
    || (patch.durationS !== undefined && readBack.data.durationS !== patch.durationS)) {
    return blockIt(`source ${sourceId} was written as probed but reads back as state "${text(readBack.data.state)}" `
      + `with duration ${readBack.data.durationS}, so the catalog did not keep what the probe found. `
      + `Fix: inspect row ${sourceId} by hand, then delete this blocked job.`);
  }

  // Hand the source on BEFORE completing, the order ingest uses for the same
  // reason: a crash between the two re-runs this probe (which re-asks, and the
  // queue dedupes), whereas the other order could finish the probe and lose
  // the proxy for good — the "stops at probed forever" this exists to end.
  enqueueProxy(queue, { sourceId, localPath });

  queue.complete(job.id, owner);
  return {
    ...base,
    outcome: 'probed',
    jobAction: 'completed',
    lane: result.lane,
    deviceModel: result.deviceModel || null,
    durationS: readBack.data.durationS,
    fps: readBack.data.fps,
    recordedAt: readBack.data.recordedAt,
    reason: `${result.lane}${result.deviceModel ? ` (${result.deviceModel})` : ''}, `
      + `${readBack.data.durationS == null ? 'no duration' : `${readBack.data.durationS}s`}`
      + `${readBack.data.fps ? ` at ${readBack.data.fps} fps` : ''}`,
  };
}

/**
 * Claim and probe up to `max` jobs. The daemon calls it with `max: 1`.
 *
 * A throw inside one job is turned into a failed job with the reason, so it
 * retries on the queue's backoff rather than sitting `running` until its lease
 * expires — the same rule ingest follows.
 */
async function runProbe(options = {}) {
  const {
    queue,
    owner = `probe-${process.pid}`,
    catalog = realCatalog(),
    env = process.env,
    max = 1,
    probe = probeFile,
    exists = fs.existsSync,
  } = options;
  if (!queue) throw new Error('runProbe needs a queue (workers/studio/queue.js)');

  const report = { owner, probed: [], failed: [], blocked: [], released: [] };
  for (let done = 0; done < Math.max(1, Number(max) || 1); done += 1) {
    const job = queue.claim(owner, { stages: [STAGE_PROBE] });
    if (!job) break;
    let result;
    try {
      result = await probeJob({ queue, job, owner, catalog, options, env, probe, exists });
    } catch (err) {
      const reason = `the probe of this source threw an error: ${err.message}`;
      queue.fail(job.id, owner, reason);
      result = { jobId: job.id, sourceId: text(job.subjectId), outcome: 'failed', jobAction: 'failed', reason };
    }
    const bucket = {
      probed: report.probed,
      failed: report.failed,
      blocked: report.blocked,
      outage: report.released,
    }[result.outcome] || report.failed;
    bucket.push(result);
    if (result.outcome === 'outage') break; // the tool or the service will not be back this second
  }
  report.ok = !report.failed.length && !report.blocked.length && !report.released.length;
  return report;
}

module.exports = {
  runProbe,
  probeJob,
  enqueueProbe,
  probePatch,
  STAGE_PROBE,
  SUBJECT_VIDEO_SOURCE,
  STATE_PROBED,
  STATE_FAILED,
};
