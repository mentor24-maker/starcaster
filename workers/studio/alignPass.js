'use strict';

/**
 * The line-up PASS — which iPhone take and which Zoom recording were made
 * together, and whose sound the edit should use.
 *
 * Reel Spinner 3b (SC-832). The rules are 3a's (workers/studio/alignment.js,
 * SC-831); nothing is decided here. This pass:
 *
 *   1. claims an `align` job for ONE recording — the proxy pass queues it when
 *      an iPhone or Zoom recording reaches `ready`, and
 *      `npm run studio:backfill-align` queues it for the ones that were ready
 *      before this existed;
 *   2. lists the project's other READY recordings and keeps the ones 3a calls
 *      candidates (`candidateReason`: an iPhone × Zoom pair whose recording
 *      times overlap by at least half of the shorter one);
 *   3. for each candidate, lines the two analysis WAVs up (`alignPair`) and
 *      writes the answer to `video_audio_pairs` (lib/videoAudioPairsStore.js,
 *      SC-827) — a refused pair is written too, as `failed` with its reason,
 *      so Footage can say "these did not match, and why" rather than nothing;
 *   4. reads each row back before completing (CLAUDE.md landmines 12/13).
 *
 * DANE'S CHOICE IS NEVER OVERWRITTEN. The store's upsert updates the measured
 * offset and drift but applies the measured choice of sound only where the row
 * still says `chosen_by = measured` — in the UPDATE itself, so his switch
 * landing mid-pass cannot be lost. The read-back here checks that too: a row
 * that says `dane` must still say `dane` afterwards.
 *
 * Only READY recordings are compared, because a ready one is the only kind
 * whose WAV is sure to exist. When two recordings of one session arrive hours
 * apart, the first one's job finds nothing, and the second one's job (queued
 * when IT reaches ready) finds the first. So every pair is lined up once both
 * halves exist, whichever came in first.
 *
 * WHAT IS CHARGED TO THE FILE, AND WHAT IS NOT — transcribePass's line. ffmpeg
 * missing or the catalog unreachable is about the machine: the job is released
 * for 15 minutes with nothing written. ffmpeg failing to read one file is
 * about that file: alignment.js answers `failed` with the reason, and that is
 * the row.
 */

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const { audioFor, RELEASE_HOLD_MS } = require('./transcribePass.js');
const { silenceTimeoutMs } = require('./cutMarksPass.js');
const { candidateReason, alignPair, toPairRow, RULES_VERSION } = require('./alignment.js');
const { LANES } = require('./probe.js');
const videoSourcesStore = require('../../lib/videoSourcesStore.js');
const videoAudioPairsStore = require('../../lib/videoAudioPairsStore.js');

const STAGE_ALIGN = 'align';
const SUBJECT_VIDEO_SOURCE = 'video_source';

/** The two lanes 3a can pair. Anything else is not looked at. */
const PAIRABLE_LANES = new Set([LANES.IPHONE, LANES.ZOOM]);

/** The most sources one read takes — the backfills' ceiling, for the same reason. */
const SOURCE_LIMIT = 1000;

/** The lease covers every ffmpeg read below plus the catalog writes. */
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
    listSources: videoSourcesStore.listSources,
    upsertAudioPair: videoAudioPairsStore.upsertAudioPair,
    getAudioPair: videoAudioPairsStore.getAudioPair,
  };
}

/** A catalog row in the shape alignment.js reads. */
function forAlignment(source) {
  return {
    id: text(source && source.id),
    lane: text(source && source.deviceLane),
    recordedAt: (source && source.recordedAt) || '',
    durationS: source && source.durationS,
  };
}

function isPairable(source) {
  return PAIRABLE_LANES.has(text(source && source.deviceLane));
}

/**
 * The ready recordings `source` could have been made together with, best
 * overlap first. Pure: the rule is 3a's `candidateReason`, applied to rows.
 */
function partnersFor(source, sources) {
  const me = forAlignment(source);
  const out = [];
  for (const other of Array.isArray(sources) ? sources : []) {
    if (!other || text(other.id).toLowerCase() === me.id.toLowerCase()) continue;
    if (text(other.state) !== 'ready' || !isPairable(other)) continue;
    const c = candidateReason(me, forAlignment(other));
    if (c.ok) out.push({ source: other, overlapS: c.overlapS });
  }
  return out.sort((x, y) => y.overlapS - x.overlapS);
}

/** Each ffmpeg read gets silencedetect's allowance: both only decode a 16 kHz WAV. */
function readTimeoutMs(durationS) {
  return silenceTimeoutMs(durationS);
}

/** Two reads (the curve, the silences) of each file in every pair, plus the writes. */
function leaseForAlign(source, partners) {
  let ms = LEASE_MARGIN_MS;
  for (const p of partners) {
    ms += 2 * (readTimeoutMs(source.durationS) + readTimeoutMs(p.source.durationS));
  }
  return ms;
}

/** Is ffmpeg on this machine at all? A missing tool is never charged to a file. */
function ffmpegPresent(run, ffmpeg) {
  const r = run(ffmpeg, ['-hide_banner', '-version'], { encoding: 'utf8', timeout: 30 * 1000 });
  if (r && r.error && r.error.code === 'ENOENT') return { ok: false, detail: r.error.message };
  if (!r || r.error || r.status !== 0) {
    return { ok: false, detail: (r && r.error && r.error.message) || `ffmpeg -version exited ${r && r.status}` };
  }
  return { ok: true };
}

/**
 * Put a line-up on the queue for one recording. Keyed by the source id, so
 * the queue's unique index on live (stage, subject) jobs is the dedupe: a
 * proxy pass that runs twice, or the backfill beside it, gets the same job.
 */
function enqueueAlign(queue, { sourceId }) {
  const id = text(sourceId);
  if (!id) throw new Error('enqueueAlign needs a source id');
  return queue.enqueue({
    stage: STAGE_ALIGN,
    subjectKind: SUBJECT_VIDEO_SOURCE,
    subjectId: id,
    payload: { sourceId: id },
  });
}

/** Same within a millisecond, with null equal only to null. */
function sameNumber(a, b) {
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(Number(a) - Number(b)) < 0.001;
}

/**
 * Did the catalog keep what was written? `wrote` is the row as sent (A→B as
 * the CALLER ordered it), `row` the store's answer (A→B as the table files
 * it), `before` the row as it stood, or null.
 */
function readBackProblem({ wrote, row, before, firstId }) {
  if (!row) return 'nothing came back';
  if (text(row.status) !== wrote.status) return `status read back as "${text(row.status)}", not "${wrote.status}"`;
  const swapped = text(row.sourceAId).toLowerCase() !== text(firstId).toLowerCase();
  const sign = (v) => (v == null || !swapped ? v : -v);
  if (!sameNumber(row.offsetS, sign(wrote.offsetS))) return `offset read back as ${row.offsetS}, not ${sign(wrote.offsetS)}`;
  if (!sameNumber(row.driftS, sign(wrote.driftS))) return `drift read back as ${row.driftS}, not ${sign(wrote.driftS)}`;
  if (before && text(before.chosenBy) === 'dane') {
    if (text(row.chosenBy) !== 'dane' || text(row.audioSourceId) !== text(before.audioSourceId)) {
      return "Dane's choice of sound did not survive the write";
    }
  } else if (wrote.status === 'done' && text(row.chosenBy) === 'measured'
    && text(row.audioSourceId).toLowerCase() !== text(wrote.audioSourceId).toLowerCase()) {
    return `the sound read back as "${text(row.audioSourceId) || 'none'}", not "${text(wrote.audioSourceId) || 'none'}"`;
  }
  return '';
}

/**
 * Line up one claimed job. The caller owns the claim; this never claims.
 * Returns `{ outcome, jobAction, reason, pairs }`, `pairs` one entry per
 * candidate: `{ partnerId, status, error?, offsetS, audioSourceId, chosenBy }`.
 */
async function alignJob({
  queue,
  job,
  owner,
  catalog = realCatalog(),
  options = {},
  env = process.env,
  run = spawnSync,
  exists = fs.existsSync,
  readFile = fs.readFileSync,
}) {
  const payload = job && job.payload && typeof job.payload === 'object' ? job.payload : {};
  const sourceId = text(payload.sourceId) || text(job && job.subjectId);
  const base = { jobId: job.id, sourceId, pairs: [] };
  const scope = scopeFor(options, env);

  const blockIt = (reason) => {
    queue.block({
      stage: STAGE_ALIGN,
      subjectKind: SUBJECT_VIDEO_SOURCE,
      subjectId: sourceId || text(job.subjectId),
      reason,
      payload: job.payload || null,
      jobId: job.id,
    });
    return { ...base, outcome: 'blocked', jobAction: 'blocked', reason };
  };
  const releaseIt = (reason, pairs = []) => {
    const released = typeof queue.release === 'function'
      ? queue.release(job.id, owner, { reason, runAfterMs: RELEASE_HOLD_MS })
      : false;
    if (!released) queue.fail(job.id, owner, reason);
    return { ...base, pairs, outcome: 'outage', jobAction: released ? 'released' : 'failed', reason };
  };
  const completeIt = (outcome, reason, pairs = []) => {
    const completed = queue.complete(job.id, owner);
    return { ...base, pairs, outcome, jobAction: completed ? 'completed' : 'none', reason };
  };

  if (!sourceId) {
    return blockIt('this align job names no source, so there is nothing to line up. '
      + 'Fix: this should not be reachable from the proxy pass — report it, then delete the job.');
  }
  if (!scope) {
    return blockIt('STUDIO_PROJECT_ID is not set, so the pairs cannot be written in their project '
      + '(CLAUDE.md landmine 12). Fix: set STUDIO_PROJECT_ID to the project that owns the Studio.');
  }

  const row = await catalog.getSourceById(sourceId, scope);
  if (!row.ok) {
    if (row.status === 404) {
      return blockIt(`source ${sourceId} is not in the catalog any more, so it has nothing to be paired with. `
        + 'Fix: if the row was deleted on purpose, delete this blocked job.');
    }
    return releaseIt(`the catalog could not be asked for source ${sourceId}: ${row.error}`);
  }
  const source = row.data;
  if (!isPairable(source)) {
    return completeIt('done', `source ${sourceId} is a "${text(source.deviceLane) || 'unknown'}" recording; `
      + 'only an iPhone take and a Zoom recording are lined up');
  }

  const listed = await catalog.listSources(SOURCE_LIMIT, scope);
  if (!listed.ok) return releaseIt(`the other recordings could not be listed: ${listed.error}`);
  const partners = partnersFor(source, listed.data);
  if (!partners.length) {
    return completeIt('done', 'no ready recording from the other device overlaps it in time, so there is nothing to line up');
  }

  const ffmpeg = text(options.ffmpegBin || env.STUDIO_FFMPEG) || 'ffmpeg';
  const present = ffmpegPresent(run, ffmpeg);
  if (!present.ok) {
    return releaseIt(`ffmpeg is not installed or not on PATH on this machine (${present.detail}) — nothing was `
      + `lined up and source ${sourceId} was left as it was. Fix: npm run provision:node:apply.`);
  }

  // Stretch the lease BEFORE ffmpeg starts, while this process can still talk.
  if (!queue.heartbeat(job.id, owner, { leaseMs: leaseForAlign(source, partners) })) {
    return { ...base, outcome: 'lost', jobAction: 'none',
      reason: `the lease on job ${job.id} was no longer this worker's, so the line-up was left to whoever holds it` };
  }

  const wavOf = (id) => audioFor({ sourceId: id, payload: {}, options, env, exists, readFile });
  const mine = wavOf(source.id);
  const pairs = [];
  for (const partner of partners) {
    const other = partner.source;
    const theirs = wavOf(other.id);
    let result;
    if (!mine.wavExists || !theirs.wavExists) {
      const missing = !mine.wavExists ? mine.wav : theirs.wav;
      result = {
        status: 'failed',
        rulesVersion: RULES_VERSION,
        error: `audio_could_not_be_read: the sound file made for transcription is not on disk at ${missing}. `
          + 'Fix: re-run the proxy step for that recording, which remakes the WAV, then line it up again.',
        offsetS: null,
        driftS: null,
        confidence: 0,
      };
    } else {
      const timed = (cmd, args, opts) => run(cmd, args, {
        ...opts,
        timeout: readTimeoutMs(Math.max(Number(source.durationS) || 0, Number(other.durationS) || 0)),
      });
      result = alignPair({ id: source.id, wavPath: mine.wav }, { id: other.id, wavPath: theirs.wav },
        { run: timed, ffmpeg });
    }
    const wrote = toPairRow(result);

    const before = await catalog.getAudioPair(source.id, other.id, scope);
    if (!before.ok) return releaseIt(`the pair of ${source.id} and ${other.id} could not be read: ${before.error}`, pairs);
    const saved = await catalog.upsertAudioPair(source.id, other.id, wrote, scope);
    if (!saved.ok) {
      if (saved.status === 400 || saved.status === 404) {
        return blockIt(`the line-up of ${source.id} with ${other.id} was refused by the catalog: ${saved.error}`);
      }
      return releaseIt(`the line-up of ${source.id} with ${other.id} could not be written: ${saved.error}`, pairs);
    }
    // Read it back (landmine 12/13): the write answering 200 is not the evidence.
    const after = await catalog.getAudioPair(source.id, other.id, scope);
    if (!after.ok) return releaseIt(`the pair of ${source.id} and ${other.id} was written but could not be read back: ${after.error}`, pairs);
    const problem = readBackProblem({ wrote, row: after.data, before: before.data, firstId: source.id });
    if (problem) {
      return blockIt(`the pair of ${source.id} and ${other.id} was written but ${problem}, so the catalog did not keep `
        + `the line-up. Fix: inspect video_audio_pairs for these two by hand, then delete this blocked job.`);
    }
    pairs.push({
      partnerId: other.id,
      status: after.data.status,
      error: after.data.error || '',
      offsetS: after.data.offsetS,
      audioSourceId: after.data.audioSourceId,
      chosenBy: after.data.chosenBy,
    });
  }

  const paired = pairs.filter((p) => p.status === 'done').length;
  const refused = pairs.length - paired;
  return completeIt('done', `${pairs.length} candidate(s): ${paired} lined up, ${refused} refused with a reason`, pairs);
}

/** Claim and line up up to `max` jobs. The daemon calls it with `max: 1`. */
async function runAlign(options = {}) {
  const {
    queue,
    owner = `align-${process.pid}`,
    catalog = realCatalog(),
    env = process.env,
    max = 1,
    run = spawnSync,
    exists = fs.existsSync,
    readFile = fs.readFileSync,
  } = options;
  if (!queue) throw new Error('runAlign needs a queue (workers/studio/queue.js)');

  const report = { owner, done: [], failed: [], blocked: [], released: [], lost: [] };
  for (let n = 0; n < Math.max(1, Number(max) || 1); n += 1) {
    const job = queue.claim(owner, { stages: [STAGE_ALIGN] });
    if (!job) break;
    let result;
    try {
      result = await alignJob({ queue, job, owner, catalog, options, env, run, exists, readFile });
    } catch (err) {
      const reason = `lining up this source threw an error: ${err.message}`;
      queue.fail(job.id, owner, reason);
      result = { jobId: job.id, sourceId: text(job.subjectId), outcome: 'failed', jobAction: 'failed', reason, pairs: [] };
    }
    const bucket = {
      done: report.done,
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
  runAlign,
  alignJob,
  enqueueAlign,
  partnersFor,
  isPairable,
  leaseForAlign,
  readBackProblem,
  STAGE_ALIGN,
  PAIRABLE_LANES,
  SOURCE_LIMIT,
};
