'use strict';

/**
 * The cut-marks PASS — what finds the "um"s, repeats, false starts and long
 * pauses in a recording that has been transcribed.
 *
 * Reel Spinner 1c (86bcwaw8c). The transcribe pass (transcribePass.js) writes
 * the CLEAN transcript and, when it is `done`, enqueues a `cut_marks` job for
 * the same source. This pass claims that job and, on the same analysis WAV:
 *
 *   1. runs whisper a second time with cutMarks.js `verbatimWhisperArgs` — the
 *      transcript that keeps the "uh"s the clean one tidied away;
 *   2. runs ffmpeg's silencedetect at cutMarks.js `silencedetectFilter`;
 *   3. reads the clean words back from video_transcripts;
 *   4. hands all three to `findCutMarks` (1b's rules — nothing is decided here);
 *   5. writes the result with lib/videoCutMarksStore.js (1a), READS IT BACK and
 *      compares before completing (CLAUDE.md landmines 12/13).
 *
 * A cut mark is a decision, never an edit: no video file is touched.
 *
 * WHAT IS CHARGED TO THE FILE, AND WHAT IS NOT — the same line transcribePass
 * draws. whisper, ffmpeg or the model missing, or the catalog unreachable, is a
 * fact about the machine: the job is released for 15 minutes with no attempt
 * spent and NO cut-marks row is written. whisper or ffmpeg failing on this WAV
 * is about the file: a `failed` row carries the reason (DOCTRINE 5.31), and the
 * job fails through the queue's retry rules. The one exception is
 * saveRetry.js, shared with transcribePass (task 86bcwzu4b): a save failing
 * for the same source four times in a row while other saves succeed is
 * charged to that source, and the found cuts are kept beside the WAV between
 * tries so a retry does not run the verbatim whisper again.
 *
 * THE LEASE IS SIZED ONCE, BEFORE EITHER TOOL STARTS. Both run under
 * spawnSync, so this process cannot renew its lease while they run. The
 * verbatim whisper is measured at the same speed as transcription (real-time
 * factor ~0.07, about 4 min per hour of audio), so it reuses
 * `whisperTimeoutMs`; silencedetect only decodes a WAV and gets its own,
 * smaller allowance. The lease covers both plus the catalog writes.
 *
 * DISK. The only file this pass writes is whisper's JSON, in a temporary
 * folder that runWhisper removes on every path out — a few megabytes for an
 * hour of speech, against a floor (STUDIO_DISK_FLOOR_BYTES) measured in tens
 * of gigabytes. silencedetect writes nothing (`-f null -`).
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  runWhisper,
  audioFor,
  audioSeconds,
  whisperSettings,
  whisperTimeoutMs,
  TRANSCRIPT_DONE,
  RELEASE_HOLD_MS,
} = require('./transcribePass.js');
const { runFfmpeg, FAILURES } = require('./proxy.js');
const saveRetry = require('./saveRetry.js');
const {
  findCutMarks,
  parseSilencedetect,
  verbatimWhisperArgs,
  silencedetectFilter,
  RULES_VERSION,
} = require('./cutMarks.js');
const videoSourcesStore = require('../../lib/videoSourcesStore.js');
const videoTranscriptsStore = require('../../lib/videoTranscriptsStore.js');
const videoCutMarksStore = require('../../lib/videoCutMarksStore.js');

const STAGE_CUT_MARKS = 'cut_marks';
const SUBJECT_VIDEO_SOURCE = 'video_source';

const CUTS_DONE = 'done';
const CUTS_FAILED = 'failed';

/**
 * silencedetect decodes a 16 kHz mono WAV and does nothing else: far faster
 * than real time. Five minutes, plus 0.1 s per second of audio — six minutes
 * extra for an hour — so a busy Mini is never mistaken for a wedged ffmpeg.
 */
const SILENCE_TIMEOUT_FLOOR_MS = 5 * 60 * 1000;
const SILENCE_TIMEOUT_PER_SECOND_MS = 100;

/** The lease covers both tools' whole timeouts, plus the catalog writes on either side. */
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
    getTranscriptBySource: videoTranscriptsStore.getTranscriptBySource,
    upsertCutMarks: videoCutMarksStore.upsertCutMarks,
    getCutMarksBySource: videoCutMarksStore.getCutMarksBySource,
  };
}

/** How long silencedetect may take on this many seconds of audio. */
function silenceTimeoutMs(durationS) {
  const seconds = Number(durationS);
  const known = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  return SILENCE_TIMEOUT_FLOOR_MS + Math.ceil(known * SILENCE_TIMEOUT_PER_SECOND_MS);
}

/** How long to hold a cut_marks job: the verbatim whisper, then silencedetect, then the writes. */
function leaseForCutMarks(durationS) {
  return whisperTimeoutMs(durationS) + silenceTimeoutMs(durationS) + LEASE_MARGIN_MS;
}

/**
 * ffmpeg's silencedetect on the WAV. Its findings are on stderr at the default
 * log level, so this must NOT pass `-loglevel error` the way the encodes do.
 */
function silencedetectArgs(wav) {
  return ['-hide_banner', '-nostdin', '-nostats', '-i', wav, '-af', silencedetectFilter(), '-f', 'null', '-'];
}

/**
 * Put a cut-marks job on the queue for one source. Keyed by the source id, so
 * the queue's unique index on live (stage, subject) jobs is the dedupe: a
 * transcribe pass that runs twice, or the backfill beside it, gets the same
 * job back.
 */
function enqueueCutMarks(queue, { sourceId, wavPath = '' }) {
  const id = text(sourceId);
  if (!id) throw new Error('enqueueCutMarks needs a source id');
  return queue.enqueue({
    stage: STAGE_CUT_MARKS,
    subjectKind: SUBJECT_VIDEO_SOURCE,
    subjectId: id,
    payload: { sourceId: id, wavPath: text(wavPath) },
  });
}

/** Same marks, same order? Compared on what a person would act on. */
function sameMarks(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((m, i) => m.kind === b[i].kind
    && Math.abs(Number(m.start) - Number(b[i].start)) < 0.001
    && Math.abs(Number(m.end) - Number(b[i].end)) < 0.001);
}

/**
 * Find the cuts for one claimed job. The caller owns the claim; this never
 * claims. Every return says what happened to the CUT MARKS (`outcome`) and
 * what the queue was told (`jobAction`).
 */
async function cutMarksJob({
  queue,
  job,
  owner,
  catalog = realCatalog(),
  options = {},
  env = process.env,
  run = spawnSync,
  exists = fs.existsSync,
  readFile = fs.readFileSync,
  stat = fs.statSync,
}) {
  const payload = job && job.payload && typeof job.payload === 'object' ? job.payload : {};
  const sourceId = text(payload.sourceId) || text(job && job.subjectId);
  const base = { jobId: job.id, sourceId };
  const scope = scopeFor(options, env);

  const blockIt = (reason) => {
    queue.block({
      stage: STAGE_CUT_MARKS,
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

  let audioWav = '';

  /**
   * A save that did not land: released free, or — saveRetry.js's rule — charged
   * to this source and blocked. `keep` says the tools ran for this data.
   */
  const saveFailed = async (why, data, outcome, reason, keep) => {
    const verdict = saveRetry.noteSaveFailed(queue, { stage: STAGE_CUT_MARKS, sourceId, error: why });
    const kept = keep
      ? saveRetry.keepUnsaved({ wavPath: audioWav, stage: STAGE_CUT_MARKS, sourceId, data, outcome, reason, stat })
      : '';
    const keptNote = kept
      ? ` The cuts found are kept at ${kept}, so the next try saves them without running whisper again.`
      : '';
    if (!verdict.charge) return releaseIt(`${why}. ${saveRetry.describeRelease(verdict)}${keptNote}`);
    const charged = `${why}. ${saveRetry.describeCharge(verdict)}`;
    const existing = await catalog.getCutMarksBySource(sourceId, scope);
    if (existing.ok && text(existing.data && existing.data.state) !== CUTS_DONE) {
      await catalog.upsertCutMarks(sourceId, { state: CUTS_FAILED, reason: charged, rulesVersion: RULES_VERSION }, scope);
    }
    return blockIt(`${charged}${keptNote} Fix: find why this one save is refused (the cause is above), `
      + 'then delete this blocked job and queue the source again.');
  };

  /** Write a cut-marks row, read it back, and complete — or say why not. */
  const settle = async (data, outcome, reason, { keep = false } = {}) => {
    const saved = await catalog.upsertCutMarks(sourceId, data, scope);
    if (!saved.ok) {
      if (saved.status === 400 || saved.status === 404) {
        return blockIt(`the ${data.state} cut marks for source ${sourceId} were refused by the catalog: ${saved.error}`);
      }
      return saveFailed(`the ${data.state} cut marks for source ${sourceId} could not be written: ${saved.error}`,
        data, outcome, reason, keep);
    }
    // Read it back (landmine 12/13): the write answering 200 is not the evidence.
    const readBack = await catalog.getCutMarksBySource(sourceId, scope);
    if (!readBack.ok) {
      return saveFailed(`the cut marks for source ${sourceId} were written but could not be read back: ${readBack.error}`,
        data, outcome, reason, keep);
    }
    const row = readBack.data;
    const marks = Array.isArray(data.marks) ? data.marks : [];
    if (!row || text(row.state) !== data.state || text(row.rulesVersion) !== text(data.rulesVersion)
      || !sameMarks(row.marks, marks)) {
      return blockIt(`the cut marks for source ${sourceId} were written as "${data.state}" with ${marks.length} mark(s) `
        + `but read back as "${text(row && row.state) || 'nothing'}" with `
        + `${row && Array.isArray(row.marks) ? row.marks.length : 0}, so the catalog did not keep them. `
        + `Fix: inspect video_cut_marks for source ${sourceId} by hand, then delete this blocked job.`);
    }
    saveRetry.noteSaveSucceeded(queue, { stage: STAGE_CUT_MARKS, sourceId });
    saveRetry.dropUnsaved({ wavPath: audioWav, stage: STAGE_CUT_MARKS });
    if (data.state === CUTS_FAILED) {
      queue.fail(job.id, owner, reason);
      return { ...base, outcome: 'failed', jobAction: 'failed', reason };
    }
    const completed = queue.complete(job.id, owner);
    return { ...base, outcome, jobAction: completed ? 'completed' : 'none', reason };
  };
  const failIt = (reason, extra = {}, keep = false) => settle({ state: CUTS_FAILED, reason, rulesVersion: RULES_VERSION, ...extra },
    'failed', reason, { keep });

  if (!sourceId) {
    return blockIt('this cut_marks job names no source, so there is nothing to look at. '
      + 'Fix: this should not be reachable from the transcribe pass — report it, then delete the job.');
  }
  if (!scope) {
    return blockIt('STUDIO_PROJECT_ID is not set, so the cut marks cannot be written in their project '
      + '(CLAUDE.md landmine 12). Fix: set STUDIO_PROJECT_ID to the project that owns the Studio.');
  }

  const row = await catalog.getSourceById(sourceId, scope);
  if (!row.ok) {
    if (row.status === 404) {
      return blockIt(`source ${sourceId} is not in the catalog any more, so its cut marks have nothing to belong to. `
        + 'Fix: if the row was deleted on purpose, delete this blocked job.');
    }
    return releaseIt(`the catalog could not be asked for source ${sourceId}: ${row.error}`);
  }

  const clean = await catalog.getTranscriptBySource(sourceId, scope);
  if (!clean.ok) return releaseIt(`the transcript of source ${sourceId} could not be read: ${clean.error}`);
  if (!clean.data || text(clean.data.state) !== TRANSCRIPT_DONE) {
    // Only a done transcript enqueues this job, so this is a transcript that
    // changed after it was queued. Nothing to compare against is not a cut.
    return blockIt(`source ${sourceId} has no finished transcript (it reads "${text(clean.data && clean.data.state) || 'none'}"), `
      + 'so there are no clean words to compare against. Fix: re-run its transcription, then delete this blocked job.');
  }
  const cleanWords = Array.isArray(clean.data.words) ? clean.data.words : [];

  const settings = whisperSettings(options, env);
  // The machine's faults come before the file's.
  if (!exists(settings.model)) {
    return releaseIt(`the speech-to-text model is not on this machine at ${settings.model}, so no cuts were looked for `
      + `and source ${sourceId} was left as it was. Fix: npm run provision:node:apply (Studio 2 of 6 installs it).`);
  }
  const audio = audioFor({ sourceId, payload, options, env, exists, readFile });
  audioWav = audio.wav;
  if (!audio.wavExists) {
    return failIt(`the sound file made for transcription is not on disk at ${audio.wav}, so there was nothing to `
      + 'listen to. Fix: re-run the proxy step for this source, which remakes the WAV.');
  }

  const durationS = audioSeconds(audio.wav, row.data.durationS, stat);
  const durationOut = durationS == null ? null : Math.round(durationS * 100) / 100;
  const model = path.basename(settings.model, '.bin');

  if (!cleanWords.length) {
    // When unsure, keep the speech: with no clean words, every verbatim word
    // would read as an extra, and every pause as empty. Say so on the row.
    return settle({
      state: CUTS_DONE,
      reason: 'the transcript has no words, so there was nothing to compare and nothing is marked',
      rulesVersion: RULES_VERSION,
      model,
      durationS: durationOut,
      marks: [],
    }, 'done', 'no words in the transcript — nothing marked');
  }

  // An earlier try found the cuts and only the save failed: save those,
  // rather than run the verbatim whisper again to find the same ones.
  const kept = saveRetry.takeUnsaved({ wavPath: audio.wav, stage: STAGE_CUT_MARKS, sourceId, stat, readFile });
  if (kept) {
    const result = await settle(kept.data, kept.outcome, kept.reason, { keep: true });
    return { ...result, savedFromEarlierTry: kept.file };
  }

  // Stretch the lease BEFORE either tool starts, while this process can still talk.
  if (!queue.heartbeat(job.id, owner, { leaseMs: leaseForCutMarks(durationS) })) {
    return { ...base, outcome: 'lost', jobAction: 'none',
      reason: `the lease on job ${job.id} was no longer this worker's, so the cut marks were left to whoever holds it` };
  }

  const verbatim = runWhisper({
    settings, wav: audio.wav, timeoutMs: whisperTimeoutMs(durationS), run, tmpRoot: options.tmpRoot,
    argsFor: verbatimWhisperArgs,
  });
  if (verbatim.kind === 'missing') {
    return releaseIt(`whisper is not installed or not on PATH on this machine (${verbatim.detail}) — no cuts were `
      + `looked for and source ${sourceId} was left as it was. Fix: npm run provision:node:apply.`);
  }
  if (verbatim.kind !== 'ok') {
    return failIt(`the word-for-word whisper pass could not run on source ${sourceId} (${audio.wav}): ${verbatim.detail}`, { model }, true);
  }

  const ffmpegBin = text(options.ffmpegBin || env.STUDIO_FFMPEG) || 'ffmpeg';
  const silence = runFfmpeg(silencedetectArgs(audio.wav), { run, bin: ffmpegBin, timeoutMs: silenceTimeoutMs(durationS) });
  if (!silence.ok && silence.reason === FAILURES.FFMPEG_MISSING) {
    return releaseIt(`ffmpeg is not installed or not on PATH on this machine (${silence.detail}) — no cuts were `
      + `looked for and source ${sourceId} was left as it was. Fix: npm run provision:node:apply.`);
  }
  if (!silence.ok) {
    const tail = text(silence.detail).split('\n').slice(-3).join(' | ');
    return failIt(`ffmpeg could not listen for pauses in source ${sourceId} (${audio.wav}): ${tail}`, { model }, true);
  }

  const v = verbatim.transcript;
  const found = findCutMarks({
    cleanWords,
    verbatimWords: v.words,
    silences: parseSilencedetect(silence.stderr),
    durationS,
  });
  const counts = {};
  for (const m of found.marks) counts[m.kind] = (counts[m.kind] || 0) + 1;
  const summary = Object.keys(counts).length
    ? Object.entries(counts).map(([kind, n]) => `${n} ${kind}`).join(', ')
    : 'nothing to cut';
  return settle({
    state: CUTS_DONE,
    rulesVersion: found.rulesVersion,
    model,
    durationS: durationOut,
    verbatimText: v.text,
    verbatimWords: v.words,
    marks: found.marks,
  }, 'done', `${found.marks.length} mark(s) (${summary}), ${found.cutS} s to cut`, { keep: true });
}

/**
 * Claim and look at up to `max` jobs. The daemon calls it with `max: 1` — a
 * second whisper over an hour of footage is minutes of work, and the daemon
 * must get back to the other stages.
 */
async function runCutMarks(options = {}) {
  const {
    queue,
    owner = `cut-marks-${process.pid}`,
    catalog = realCatalog(),
    env = process.env,
    max = 1,
    run = spawnSync,
    exists = fs.existsSync,
    readFile = fs.readFileSync,
    stat = fs.statSync,
  } = options;
  if (!queue) throw new Error('runCutMarks needs a queue (workers/studio/queue.js)');

  const report = { owner, done: [], failed: [], blocked: [], released: [], lost: [] };
  for (let n = 0; n < Math.max(1, Number(max) || 1); n += 1) {
    const job = queue.claim(owner, { stages: [STAGE_CUT_MARKS] });
    if (!job) break;
    let result;
    try {
      result = await cutMarksJob({ queue, job, owner, catalog, options, env, run, exists, readFile, stat });
    } catch (err) {
      const reason = `finding the cuts in this source threw an error: ${err.message}`;
      queue.fail(job.id, owner, reason);
      result = { jobId: job.id, sourceId: text(job.subjectId), outcome: 'failed', jobAction: 'failed', reason };
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
  runCutMarks,
  cutMarksJob,
  enqueueCutMarks,
  silencedetectArgs,
  silenceTimeoutMs,
  leaseForCutMarks,
  STAGE_CUT_MARKS,
};
