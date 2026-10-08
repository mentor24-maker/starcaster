'use strict';

/**
 * The proxy PASS — what turns a described file into a ready one.
 *
 * `proxy.js` (Studio 6/8) makes the working copies — a 720p proxy, a 16 kHz
 * WAV for speech recognition, a contact sheet — for a path, and does nothing
 * else. Nothing ever asked it: the probe pass completed at `probed` and
 * enqueued nothing after it, so no file could ever reach `ready`.
 *
 * A SEPARATE FILE, for the same reason probePass.js is one: proxy.js has no
 * catalog and no queue behind it, and its tests rely on that.
 *
 * WHAT `ready` MEANS IN PHASE 1. Every working copy the source can have exists
 * — the proxy (or the original, used directly because it is already small and
 * ordinary: a skipped proxy is not a missing one), the WAV unless the file has
 * no sound, the contact sheet unless it has no picture. The pass writes
 * `ready` directly. Transcription (Phase 2, transcribePass.js) is queued from
 * here but is not part of `ready`: a transcript has its own row and its own
 * state, so `proxied` is still unused. Plates get the same copies — they are
 * kept out of transcription, not out of this.
 *
 * THE LEASE IS SIZED TO THE ENCODE, ONCE, BEFORE IT STARTS. proxy.js runs
 * ffmpeg with spawnSync, so for the length of an encode — tens of minutes for
 * an hour of iPhone footage — this process cannot beat. With the default
 * five-minute lease, any other worker on the same queue file (a hand-run
 * `npm run studio:worker` beside the installed daemon is enough) would reap the
 * job and start the same encode, and proxy.js begins every build by sweeping
 * leftover `.part` files: the second encode would delete the first one's work
 * in progress. So the lease is stretched up front to cover every encode this
 * source can need. The cost is stated rather than hidden: if the worker dies
 * mid-encode, the job waits out that longer lease before it is retried.
 *
 * WHAT IS CHARGED TO THE FILE, AND WHAT IS NOT — the line probePass.js draws.
 * ffmpeg missing, or the catalog unreachable, is a fact about the machine: the
 * job is put back without spending an attempt and the row is left alone. An
 * encode that fails or times out is about this file: the row goes to `failed`
 * and the job fails through the queue's retry rules. A retry reuses every copy
 * that was finished (proxy.js keeps a manifest), so it redoes only what failed.
 */

const fs = require('node:fs');

const { buildDerivatives, encodeTimeoutMs, FAILURES, ACTIONS, SKIP_REASONS } = require('./proxy.js');
const videoSourcesStore = require('../../lib/videoSourcesStore.js');
const videoTranscriptsStore = require('../../lib/videoTranscriptsStore.js');
const { enqueueTranscribe, TRANSCRIPT_NO_AUDIO } = require('./transcribePass.js');

const STAGE_PROXY = 'proxy';
const SUBJECT_VIDEO_SOURCE = 'video_source';

const STATE_READY = 'ready';
const STATE_FAILED = 'failed';

/** Not the file's fault: hold the job for the same 15 minutes probe and ingest use. */
const RELEASE_HOLD_MS = 15 * 60 * 1000;

/**
 * Up to three encodes (proxy, WAV, contact sheet), and the proxy and sheet can
 * each run twice when a hardware decode refuses and falls back to software.
 * The lease covers the worst of that, plus a margin for the catalog writes.
 */
const LEASE_MARGIN_MS = 5 * 60 * 1000;

function text(value) {
  return String(value == null ? '' : value).trim();
}

function scopeFor(options, env) {
  return require('./ingest.js').scopeFor(options, env);
}

function realCatalog() {
  return {
    getSourceById: videoSourcesStore.getSourceById,
    updateSource: videoSourcesStore.updateSource,
    upsertTranscript: videoTranscriptsStore.upsertTranscript,
  };
}

/** How long to hold a proxy job for a source of this length. */
function leaseForEncode(durationS, { decodeMode = 'software' } = {}) {
  const encodes = decodeMode === 'hardware' ? 5 : 3;
  return encodes * encodeTimeoutMs(durationS) + LEASE_MARGIN_MS;
}

/**
 * Which folder under the derived dir a source's copies go in. Plates apart
 * from footage, the way they arrive in Drive, so a person browsing the disk
 * can tell them apart.
 */
function laneFor(row) {
  return text(row && row.deviceLane) === 'plate' ? 'plates' : 'inbox';
}

/**
 * Put a proxy on the queue for one source. Keyed by the source id, so the
 * queue's unique index on live (stage, subject) jobs is the dedupe: a probe
 * that runs twice while this is still waiting gets the same job back.
 */
function enqueueProxy(queue, { sourceId, localPath = '' }) {
  const id = text(sourceId);
  if (!id) throw new Error('enqueueProxy needs a source id');
  return queue.enqueue({
    stage: STAGE_PROXY,
    subjectKind: SUBJECT_VIDEO_SOURCE,
    subjectId: id,
    payload: { sourceId: id, localPath: text(localPath) },
  });
}

/** A failure reason proxy.js gives that is about the machine, not the footage. */
function isMachineFault(reason) {
  return reason === FAILURES.FFMPEG_MISSING;
}

function describeFailures(failures) {
  return failures.map((f) => `${f.output}: ${f.detail || f.reason}`).join('; ');
}

/**
 * Make one claimed job's copies. The caller owns the claim; this never claims.
 * Every return says what happened to the FILE (`outcome`) and what the queue
 * was told (`jobAction`).
 */
async function proxyJob({
  queue,
  job,
  owner,
  catalog = realCatalog(),
  options = {},
  env = process.env,
  build = buildDerivatives,
  exists = fs.existsSync,
}) {
  const payload = job && job.payload && typeof job.payload === 'object' ? job.payload : {};
  const sourceId = text(payload.sourceId) || text(job && job.subjectId);
  const base = { jobId: job.id, sourceId };
  const scope = scopeFor(options, env);

  const blockIt = (reason) => {
    queue.block({
      stage: STAGE_PROXY,
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
    if (!released) queue.fail(job.id, owner, reason);
    return { ...base, outcome: 'outage', jobAction: released ? 'released' : 'failed', reason };
  };
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
    return blockIt('this proxy job names no source, so there is nothing to make copies of. '
      + 'Fix: this should not be reachable from the probe pass — report it, then delete the job.');
  }
  if (!scope) {
    return blockIt('STUDIO_PROJECT_ID is not set, so the source row cannot be read or written in its project '
      + '(CLAUDE.md landmine 12). Fix: set STUDIO_PROJECT_ID to the project that owns the Studio.');
  }

  const row = await catalog.getSourceById(sourceId, scope);
  if (!row.ok) {
    if (row.status === 404) {
      return blockIt(`source ${sourceId} is not in the catalog any more, so its copies have nothing to belong to. `
        + 'Fix: if the row was deleted on purpose, delete this blocked job.');
    }
    return releaseIt(`the catalog could not be asked for source ${sourceId}: ${row.error}`);
  }

  // The row's path wins over the payload's, as in the probe pass: a Drive
  // replacement re-points local_path at the new bytes.
  const localPath = text(row.data.localPath) || text(payload.localPath);
  if (!localPath) {
    return failIt(`source ${sourceId} has no downloaded file recorded against it (local_path is blank), `
      + 'so there was nothing on this machine to make copies of. Fix: re-ingest the file from Drive.');
  }
  if (!exists(localPath)) {
    return failIt(`the downloaded file for source ${sourceId} is not on disk at ${localPath} — it was moved `
      + 'or deleted after ingest. Fix: re-ingest the file from Drive.');
  }

  // Stretch the lease BEFORE the encode, while this process can still talk.
  const decodeMode = text(options.decodeMode || env.STUDIO_DECODE_MODE) === 'hardware' ? 'hardware' : 'software';
  const leaseMs = leaseForEncode(row.data.durationS, { decodeMode });
  if (!queue.heartbeat(job.id, owner, { leaseMs })) {
    // Not ours any more — reaped and handed on while we read the row. Doing
    // the encode now would be the duplicate this lease exists to prevent.
    return { ...base, outcome: 'lost', jobAction: 'none',
      reason: `the lease on job ${job.id} was no longer this worker's, so the copies were left to whoever holds it` };
  }

  const result = build({
    sourcePath: localPath,
    key: sourceId,
    lane: laneFor(row.data),
    derivedDir: text(options.derivedDir || env.STUDIO_DERIVED_DIR) || undefined,
    floorKbps: options.floorKbps || env.STUDIO_PROXY_FLOOR_KBPS,
    decodeMode,
  });

  if (!result.ok) {
    const failures = Array.isArray(result.failures) && result.failures.length
      ? result.failures
      : [{ output: 'source', reason: result.reason, detail: result.detail }];
    if (failures.some((f) => isMachineFault(f.reason))) {
      return releaseIt(`ffmpeg is not installed or not on PATH on this machine — no copies were made and `
        + `source ${sourceId} was left as it was (${describeFailures(failures)})`);
    }
    return failIt(`the working copies for source ${sourceId} (${localPath}) could not all be made: `
      + describeFailures(failures));
  }

  const proxyOut = result.outputs && result.outputs.proxy;
  const proxyPath = text(proxyOut && proxyOut.path);
  if (!proxyPath) {
    // proxy.js promises the field is never empty on success (a skipped proxy
    // points at the original). If it ever is, `ready` would be a lie.
    return blockIt(`the copies for source ${sourceId} were reported made but name no proxy file. `
      + 'Fix: read the manifest in the derived folder, then delete this blocked job.');
  }

  const updated = await catalog.updateSource(sourceId, { state: STATE_READY, proxyPath }, scope);
  if (!updated.ok) {
    if (updated.status === 400) {
      return blockIt(`the proxy result for source ${sourceId} was refused by the catalog: ${updated.error}`);
    }
    return releaseIt(`the proxy result for source ${sourceId} could not be written: ${updated.error}`);
  }

  // Read the row back (landmine 12/13): the write answering 200 is not the evidence.
  const readBack = await catalog.getSourceById(sourceId, scope);
  if (!readBack.ok) {
    return releaseIt(`source ${sourceId} was written but could not be read back to check it: ${readBack.error}`);
  }
  if (text(readBack.data.state) !== STATE_READY || text(readBack.data.proxyPath) !== proxyPath) {
    return blockIt(`source ${sourceId} was written as ready but reads back as state "${text(readBack.data.state)}" `
      + `with proxy "${text(readBack.data.proxyPath)}", so the catalog did not keep what was made. `
      + `Fix: inspect row ${sourceId} by hand, then delete this blocked job.`);
  }

  // Hand the source on to transcription BEFORE completing — the order ingest
  // and probe use, for the same reason: a crash between the two re-runs this
  // pass (which reuses every copy, and the queue dedupes the job), whereas the
  // other order could finish here and leave the recording untranscribed for
  // good. Plates are footage of a place, not of anyone speaking, so they stop
  // at ready. A source with no sound gets a `no_audio` row rather than a job,
  // so the Footage screen can say why it has no transcript (DOCTRINE 5.31).
  let transcription = 'not asked for: plates are not transcribed';
  if (laneFor(readBack.data) !== 'plates') {
    const audioOut = (result.outputs && result.outputs.audio) || null;
    if (audioOut && audioOut.action === ACTIONS.SKIPPED && audioOut.reason === SKIP_REASONS.NO_AUDIO) {
      const saved = await catalog.upsertTranscript(sourceId, {
        state: TRANSCRIPT_NO_AUDIO,
        reason: 'this recording has no sound track, so there is nothing to transcribe',
      }, scope);
      if (!saved.ok || !saved.data || saved.data.state !== TRANSCRIPT_NO_AUDIO) {
        const why = saved.ok ? `it came back as "${saved.data && saved.data.state}"` : saved.error;
        if (!saved.ok && (saved.status === 400 || saved.status === 404)) {
          return blockIt(`source ${sourceId} is ready but its "no sound" transcript was refused: ${why}`);
        }
        return releaseIt(`source ${sourceId} is ready but its "no sound" transcript could not be written: ${why}`);
      }
      transcription = 'no sound track — recorded as no_audio';
    } else if (audioOut && text(audioOut.path)) {
      const queued = enqueueTranscribe(queue, { sourceId, wavPath: audioOut.path });
      transcription = queued.created ? 'transcription queued' : 'transcription already queued';
    } else {
      transcription = 'not queued: the copies named no sound file';
    }
  }

  const completed = queue.complete(job.id, owner);
  return {
    ...base,
    outcome: 'ready',
    jobAction: completed ? 'completed' : 'none',
    proxyPath,
    proxyAction: proxyOut.action,
    transcription,
    reason: proxyOut.action === ACTIONS.SKIPPED
      ? `original used directly (${proxyOut.reason}), WAV and contact sheet made`
      : `proxy ${proxyOut.action}, WAV and contact sheet made`,
  };
}

/**
 * Claim and proxy up to `max` jobs. The daemon calls it with `max: 1` — one
 * encode is minutes of work, and the daemon must get back to the other stages.
 */
async function runProxy(options = {}) {
  const {
    queue,
    owner = `proxy-${process.pid}`,
    catalog = realCatalog(),
    env = process.env,
    max = 1,
    build = buildDerivatives,
    exists = fs.existsSync,
  } = options;
  if (!queue) throw new Error('runProxy needs a queue (workers/studio/queue.js)');

  const report = { owner, ready: [], failed: [], blocked: [], released: [], lost: [] };
  for (let done = 0; done < Math.max(1, Number(max) || 1); done += 1) {
    const job = queue.claim(owner, { stages: [STAGE_PROXY] });
    if (!job) break;
    let result;
    try {
      result = await proxyJob({ queue, job, owner, catalog, options, env, build, exists });
    } catch (err) {
      const reason = `making the copies for this source threw an error: ${err.message}`;
      queue.fail(job.id, owner, reason);
      result = { jobId: job.id, sourceId: text(job.subjectId), outcome: 'failed', jobAction: 'failed', reason };
    }
    const bucket = {
      ready: report.ready,
      failed: report.failed,
      blocked: report.blocked,
      outage: report.released,
      lost: report.lost,
    }[result.outcome] || report.failed;
    bucket.push(result);
    if (result.outcome === 'outage') break;
  }
  report.ok = !report.failed.length && !report.blocked.length && !report.released.length;
  return report;
}

module.exports = {
  runProxy,
  proxyJob,
  enqueueProxy,
  leaseForEncode,
  laneFor,
  STAGE_PROXY,
  STATE_READY,
};
