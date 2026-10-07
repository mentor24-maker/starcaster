'use strict';

/**
 * The transcribe PASS — what turns a ready recording into words.
 *
 * Studio Phase 2 · 3 of 6 (86bcdejzm). The proxy pass (proxyPass.js) leaves a
 * 16 kHz mono WAV beside every source that has sound, and enqueues a
 * `transcribe` job for each one that is not a plate. This pass claims that
 * job, runs whisper.cpp's `whisper-cli` on the WAV, turns its JSON into the
 * `{ text, segments, words }` shape lib/videoTranscriptsStore.js keeps, writes
 * it, reads it back, and completes.
 *
 * THE WHISPER SETTINGS ARE NOT A CHOICE MADE HERE. 2 of 6 measured them on
 * IMG_1962 (docs/STUDIO.md, "Speech-to-text"): `large-v3-turbo`, and always
 * `-nfa --dtw large.v3.turbo`, because without the alignment flags whisper's
 * per-word times are spread evenly across each segment rather than tied to the
 * audio (the first word landed at 0.00 s when speech began at 5.6 s). With
 * them, each token carries `t_dtw` — one time, in hundredths of a second.
 *
 * THE LEASE IS SIZED TO THE TRANSCRIPTION, ONCE, BEFORE IT STARTS — the same
 * reasoning as proxyPass.js `leaseForEncode`. whisper runs under spawnSync, so
 * while it runs this process cannot renew its lease; with the default
 * five-minute lease, any second worker on the same queue file would reap the
 * job and start a second whisper on the same WAV. The timeout and the lease
 * are both derived from the measured real-time factor below.
 *
 * WHAT IS CHARGED TO THE FILE, AND WHAT IS NOT — the line probePass.js and
 * proxyPass.js draw. whisper-cli missing, the model file missing, or the
 * catalog unreachable is a fact about the machine: the job is put back without
 * spending an attempt and NO transcript row is written. whisper failing on
 * this WAV (a non-zero exit, a timeout, JSON it cannot have meant) is about the
 * file: a `failed` transcript row carries the reason, so the Footage screen can
 * say why there is no transcript (DOCTRINE 5.31), and the job fails through
 * the queue's retry rules.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { derivedPathsFor, resolveDerivedDir, ACTIONS, SKIP_REASONS } = require('./proxy.js');
const { REQUIRED_MODELS, modelPath } = require('../../lib/nodeProvision.js');
const videoSourcesStore = require('../../lib/videoSourcesStore.js');
const videoTranscriptsStore = require('../../lib/videoTranscriptsStore.js');

const STAGE_TRANSCRIBE = 'transcribe';
const SUBJECT_VIDEO_SOURCE = 'video_source';

const TRANSCRIPT_DONE = 'done';
const TRANSCRIPT_FAILED = 'failed';
const TRANSCRIPT_NO_AUDIO = 'no_audio';

/** Not the file's fault: hold the job for the same 15 minutes the other passes use. */
const RELEASE_HOLD_MS = 15 * 60 * 1000;

/**
 * How long whisper may take, from the recording's length.
 *
 * Measured on the Mini (docs/STUDIO.md, 2026-10-05): a real-time factor of
 * 0.07 with the alignment flags — 148.5 s of speech in 9.9 s — plus about
 * 3 s to load the 1.6 GB model, which is the whole cost of a short clip.
 * The allowance is 0.5 s per second of audio, about SEVEN times the measured
 * factor, so a Mini that is also encoding, or a model load from a cold disk,
 * is not mistaken for a wedged whisper; and a floor of ten minutes, so a
 * short clip never gets a timeout tighter than a slow model load.
 * An hour of footage: 10 min + 30 min = 40 min allowed, against ~4 min measured.
 *
 * THE HEARTBEAT. The daemon beats between jobs, and `studio-worker`'s quiet
 * window is six hourly intervals (lib/nodeHeartbeat.js) — 6 h. A job blocks
 * beats for as long as whisper runs: at the measured 0.07 that takes
 * 6 h / 0.07 ≈ 85 h of audio, and even run to the full allowance it takes
 * (6 h − 10 min) / 0.5 ≈ 11.7 h. Neither is a recording anyone makes, so this
 * pass cannot be what trips the alarm.
 */
const WHISPER_TIMEOUT_FLOOR_MS = 10 * 60 * 1000;
const WHISPER_TIMEOUT_PER_SECOND_MS = 500;

/** The lease covers the whole timeout, plus the catalog writes on either side. */
const LEASE_MARGIN_MS = 5 * 60 * 1000;

/** A 16 kHz, mono, 16-bit WAV is 32,000 bytes a second (proxy.js analysisAudioArgs). */
const WAV_BYTES_PER_SECOND = 16000 * 2;

/** whisper's JSON for an hour is a few megabytes; its stderr is chatty. */
const WHISPER_MAX_BUFFER = 64 * 1024 * 1024;

/** The model 2 of 6 installed and measured; the alignment preset must name the same one. */
const DEFAULT_MODEL = REQUIRED_MODELS.find((m) => m.id === 'whisper-large-v3-turbo');
const DEFAULT_DTW_PRESET = 'large.v3.turbo';
const DEFAULT_LANGUAGE = 'en';

function text(value) {
  return String(value == null ? '' : value).trim();
}

function scopeFor(options, env) {
  return require('./ingest.js').scopeFor(options, env);
}

function realCatalog() {
  return {
    getSourceById: videoSourcesStore.getSourceById,
    upsertTranscript: videoTranscriptsStore.upsertTranscript,
    getTranscriptBySource: videoTranscriptsStore.getTranscriptBySource,
  };
}

/** Which whisper to run, which model, which alignment preset, which language. */
function whisperSettings(options = {}, env = process.env) {
  return {
    bin: text(options.whisperBin || env.STUDIO_WHISPER_BIN) || 'whisper-cli',
    model: text(options.whisperModel || env.STUDIO_WHISPER_MODEL) || modelPath(DEFAULT_MODEL),
    dtw: text(options.whisperDtw || env.STUDIO_WHISPER_DTW) || DEFAULT_DTW_PRESET,
    language: text(options.whisperLanguage || env.STUDIO_WHISPER_LANGUAGE) || DEFAULT_LANGUAGE,
  };
}

/** How long whisper may run on this many seconds of audio. */
function whisperTimeoutMs(durationS) {
  const seconds = Number(durationS);
  const known = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  return WHISPER_TIMEOUT_FLOOR_MS + Math.ceil(known * WHISPER_TIMEOUT_PER_SECOND_MS);
}

/** How long to hold a transcribe job for this many seconds of audio. */
function leaseForTranscribe(durationS) {
  return whisperTimeoutMs(durationS) + LEASE_MARGIN_MS;
}

/**
 * The audio's length. The WAV's own size is exact for the format proxy.js
 * writes; the catalog's duration is the fallback when the file cannot be
 * stat'd, and an unknown length still gets the timeout floor.
 */
function audioSeconds(wavPath, rowDurationS, stat = fs.statSync) {
  try {
    const bytes = stat(wavPath).size;
    if (bytes > 44) return (bytes - 44) / WAV_BYTES_PER_SECOND;
  } catch (_) { /* fall through to the catalog's number */ }
  const fromRow = Number(rowDurationS);
  return Number.isFinite(fromRow) && fromRow > 0 ? fromRow : null;
}

function whisperArgs({ model, wav, outBase, dtw, language }) {
  return [
    '-m', model,
    '-f', wav,
    '-l', language,
    // The alignment flags 2 of 6 measured: flash attention off so the DTW
    // alignment can run, which is what puts a real time on each token.
    '-nfa', '--dtw', dtw,
    '-ojf', // full JSON — the token-level times live only in this form
    '-of', outBase,
    '-np', // no progress noise on stderr
  ];
}

/** A whisper special token — `[_BEG_]`, `[_TT_150]` — carries no speech. */
function isSpecialToken(tokenText) {
  return /^\[_/.test(text(tokenText));
}

function seconds(ms) {
  return Math.round(Number(ms)) / 1000;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * whisper-cli's `-ojf` JSON → `{ language, text, segments, words }`.
 *
 * Two facts from 2 of 6's measurement shape the words:
 *   - The alignment gives ONE time per token (`t_dtw`, hundredths of a second),
 *     not a start and end. A word's end is the next word's start; the last word
 *     of a segment ends where the segment does.
 *   - A word can arrive as several tokens. A token that does not begin with a
 *     space continues the previous word.
 * A token with no alignment time (`t_dtw` of -1 on a real token) falls back to
 * whisper's own segment-relative offset, and times are kept in order — a
 * word never starts before the one before it.
 *
 * Returns `{ ok: false, error }` when the JSON is not the shape whisper writes,
 * which is a fault in THIS run, never an empty transcript.
 */
function parseWhisperJson(raw) {
  let doc;
  try {
    doc = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (err) {
    return { ok: false, error: `whisper wrote JSON that does not parse: ${err.message}` };
  }
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.transcription)) {
    return { ok: false, error: 'whisper wrote JSON with no "transcription" list, so there is nothing to read' };
  }

  const segments = [];
  const words = [];
  let lastStart = 0;
  for (const seg of doc.transcription) {
    const offsets = seg && seg.offsets ? seg.offsets : {};
    const segStart = Math.max(0, seconds(offsets.from) || 0);
    const segEnd = Math.max(segStart, seconds(offsets.to) || segStart);
    const segText = text(seg && seg.text);
    if (segText) segments.push({ start: segStart, end: segEnd, text: segText });

    const segWords = [];
    for (const token of Array.isArray(seg && seg.tokens) ? seg.tokens : []) {
      const raw = typeof token.text === 'string' ? token.text : '';
      if (!raw || isSpecialToken(raw)) continue;
      const dtw = Number(token.t_dtw);
      const tokenOffsets = token.offsets || {};
      let start = Number.isFinite(dtw) && dtw >= 0 ? dtw / 100 : seconds(tokenOffsets.from);
      if (!Number.isFinite(start) || start < 0) start = segStart;
      const p = Number(token.p);
      const prob = Number.isFinite(p) && p >= 0 && p <= 1 ? p : null;
      const startsWord = /^\s/.test(raw) || !segWords.length;
      if (startsWord) {
        start = Math.max(start, lastStart);
        lastStart = start;
        segWords.push({ start: round2(start), end: 0, word: raw.trim(), p: prob });
      } else {
        const current = segWords[segWords.length - 1];
        current.word += raw.trim();
        if (prob !== null) current.p = current.p === null ? prob : Math.min(current.p, prob);
      }
    }
    for (let i = 0; i < segWords.length; i += 1) {
      const next = segWords[i + 1];
      const end = next ? next.start : Math.max(segEnd, segWords[i].start);
      segWords[i].end = round2(Math.max(end, segWords[i].start));
    }
    for (const w of segWords) if (w.word) words.push(w);
  }

  const language = text(doc.result && doc.result.language)
    || text(doc.params && doc.params.language)
    || null;
  return {
    ok: true,
    language,
    text: segments.map((s) => s.text).join(' ').trim(),
    segments,
    words,
  };
}

/**
 * Run whisper once. Every answer names what happened — `missing` (the machine
 * has no whisper), `timeout`, `failed`, or `ok` with the parsed transcript.
 */
function runWhisper({ settings, wav, timeoutMs, run = spawnSync, tmpRoot = os.tmpdir() }) {
  const workDir = fs.mkdtempSync(path.join(tmpRoot, 'studio-whisper-'));
  const outBase = path.join(workDir, 'transcript');
  try {
    const res = run(settings.bin, whisperArgs({ ...settings, wav, outBase }), {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: WHISPER_MAX_BUFFER,
    });
    if (res.error && res.error.code === 'ENOENT') {
      return { kind: 'missing', detail: `${settings.bin} is not installed or not on PATH` };
    }
    if (res.error && (res.error.code === 'ETIMEDOUT' || res.signal === 'SIGTERM')) {
      return { kind: 'timeout', detail: `whisper did not finish within ${Math.round(timeoutMs / 1000)}s` };
    }
    if (res.error) return { kind: 'failed', detail: String(res.error.message || res.error) };
    if (Number(res.status) !== 0) {
      const tail = String(res.stderr || '').trim().split('\n').slice(-3).join(' | ');
      return { kind: 'failed', detail: `whisper exited ${res.status}${tail ? `: ${tail}` : ''}` };
    }
    let raw;
    try {
      raw = fs.readFileSync(`${outBase}.json`, 'utf8');
    } catch (err) {
      return { kind: 'failed', detail: `whisper exited 0 but wrote no JSON (${err.code || err.message})` };
    }
    const parsed = parseWhisperJson(raw);
    if (!parsed.ok) return { kind: 'failed', detail: parsed.error };
    return { kind: 'ok', transcript: parsed };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/**
 * The analysis WAV for a source, and what proxy.js's manifest says about it.
 * `noAudio: true` only when the manifest SAYS the file has no sound — a WAV
 * that is merely missing is a different fact, and is not reported as silence.
 */
function audioFor({ sourceId, payload, options, env, exists, readFile }) {
  const derivedDir = resolveDerivedDir(options, env);
  const paths = derivedPathsFor({ derivedDir, key: sourceId, lane: 'inbox' });
  const wav = text(payload.wavPath) || paths.audio;
  let manifest = null;
  try {
    manifest = JSON.parse(readFile(paths.manifest, 'utf8'));
  } catch (_) { /* no manifest — the WAV's presence is all there is to go on */ }
  const audio = manifest && manifest.outputs ? manifest.outputs.audio : null;
  const noAudio = Boolean(audio && audio.action === ACTIONS.SKIPPED && audio.reason === SKIP_REASONS.NO_AUDIO);
  return { wav, noAudio, wavExists: exists(wav) };
}

/**
 * Put a transcription on the queue for one source. Keyed by the source id, so
 * the queue's unique index on live (stage, subject) jobs is the dedupe: a proxy
 * pass that runs twice, or a backfill run beside it, gets the same job back.
 */
function enqueueTranscribe(queue, { sourceId, wavPath = '' }) {
  const id = text(sourceId);
  if (!id) throw new Error('enqueueTranscribe needs a source id');
  return queue.enqueue({
    stage: STAGE_TRANSCRIBE,
    subjectKind: SUBJECT_VIDEO_SOURCE,
    subjectId: id,
    payload: { sourceId: id, wavPath: text(wavPath) },
  });
}

/**
 * Transcribe one claimed job. The caller owns the claim; this never claims.
 * Every return says what happened to the TRANSCRIPT (`outcome`) and what the
 * queue was told (`jobAction`).
 */
async function transcribeJob({
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
      stage: STAGE_TRANSCRIBE,
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

  /** Write a transcript row, read it back, and complete — or say why not. */
  const settle = async (data, outcome, reason) => {
    const saved = await catalog.upsertTranscript(sourceId, data, scope);
    if (!saved.ok) {
      if (saved.status === 400 || saved.status === 404) {
        return blockIt(`the ${data.state} transcript for source ${sourceId} was refused by the catalog: ${saved.error}`);
      }
      return releaseIt(`the ${data.state} transcript for source ${sourceId} could not be written: ${saved.error}`);
    }
    // Read it back (landmine 12/13): the write answering 200 is not the evidence.
    const readBack = await catalog.getTranscriptBySource(sourceId, scope);
    if (!readBack.ok) {
      return releaseIt(`the transcript for source ${sourceId} was written but could not be read back: ${readBack.error}`);
    }
    const row = readBack.data;
    if (!row || text(row.state) !== data.state || text(row.text) !== text(data.text)) {
      return blockIt(`the transcript for source ${sourceId} was written as "${data.state}" but reads back as `
        + `"${text(row && row.state) || 'nothing'}", so the catalog did not keep it. `
        + `Fix: inspect video_transcripts for source ${sourceId} by hand, then delete this blocked job.`);
    }
    if (data.state === TRANSCRIPT_FAILED) {
      queue.fail(job.id, owner, reason);
      return { ...base, outcome: 'failed', jobAction: 'failed', reason };
    }
    const completed = queue.complete(job.id, owner);
    return { ...base, outcome, jobAction: completed ? 'completed' : 'none', reason };
  };

  if (!sourceId) {
    return blockIt('this transcribe job names no source, so there is nothing to transcribe. '
      + 'Fix: this should not be reachable from the proxy pass — report it, then delete the job.');
  }
  if (!scope) {
    return blockIt('STUDIO_PROJECT_ID is not set, so the transcript cannot be written in its project '
      + '(CLAUDE.md landmine 12). Fix: set STUDIO_PROJECT_ID to the project that owns the Studio.');
  }

  const row = await catalog.getSourceById(sourceId, scope);
  if (!row.ok) {
    if (row.status === 404) {
      return blockIt(`source ${sourceId} is not in the catalog any more, so its transcript has nothing to belong to. `
        + 'Fix: if the row was deleted on purpose, delete this blocked job.');
    }
    return releaseIt(`the catalog could not be asked for source ${sourceId}: ${row.error}`);
  }

  const audio = audioFor({ sourceId, payload, options, env, exists, readFile });
  if (audio.noAudio) {
    return settle({ state: TRANSCRIPT_NO_AUDIO, reason: 'this recording has no sound track, so there is nothing to transcribe' },
      'no_audio', 'no sound track — recorded as no_audio');
  }

  const settings = whisperSettings(options, env);
  // The machine's faults come before the file's: a missing model must never
  // be written up as a recording that "failed to transcribe".
  if (!exists(settings.model)) {
    return releaseIt(`the speech-to-text model is not on this machine at ${settings.model}, so nothing was transcribed `
      + `and source ${sourceId} was left as it was. Fix: npm run provision:node:apply (Studio 2 of 6 installs it).`);
  }
  if (!audio.wavExists) {
    const reason = `the sound file made for transcription is not on disk at ${audio.wav}, so there was nothing to `
      + 'transcribe. Fix: re-run the proxy step for this source, which remakes the WAV.';
    return settle({ state: TRANSCRIPT_FAILED, reason }, 'failed', reason);
  }

  // Stretch the lease BEFORE whisper starts, while this process can still talk.
  const durationS = audioSeconds(audio.wav, row.data.durationS, stat);
  const timeoutMs = whisperTimeoutMs(durationS);
  if (!queue.heartbeat(job.id, owner, { leaseMs: leaseForTranscribe(durationS) })) {
    // Not ours any more — reaped and handed on while we read the row. Running
    // whisper now would be the duplicate this lease exists to prevent.
    return { ...base, outcome: 'lost', jobAction: 'none',
      reason: `the lease on job ${job.id} was no longer this worker's, so the transcript was left to whoever holds it` };
  }

  const result = runWhisper({ settings, wav: audio.wav, timeoutMs, run, tmpRoot: options.tmpRoot });
  if (result.kind === 'missing') {
    return releaseIt(`whisper is not installed or not on PATH on this machine (${result.detail}) — nothing was `
      + `transcribed and source ${sourceId} was left as it was. Fix: npm run provision:node:apply.`);
  }
  if (result.kind !== 'ok') {
    const reason = `whisper could not transcribe source ${sourceId} (${audio.wav}): ${result.detail}`;
    return settle({ state: TRANSCRIPT_FAILED, reason, model: path.basename(settings.model, '.bin') }, 'failed', reason);
  }

  const t = result.transcript;
  return settle({
    state: TRANSCRIPT_DONE,
    language: t.language,
    model: path.basename(settings.model, '.bin'),
    durationS: durationS == null ? null : Math.round(durationS * 100) / 100,
    text: t.text,
    segments: t.segments,
    words: t.words,
  }, 'done', `${t.words.length} word(s) in ${t.segments.length} segment(s)`);
}

/**
 * Claim and transcribe up to `max` jobs. The daemon calls it with `max: 1` —
 * whisper on an hour of footage is minutes of work, and the daemon must get
 * back to the other stages.
 */
async function runTranscribe(options = {}) {
  const {
    queue,
    owner = `transcribe-${process.pid}`,
    catalog = realCatalog(),
    env = process.env,
    max = 1,
    run = spawnSync,
    exists = fs.existsSync,
    readFile = fs.readFileSync,
    stat = fs.statSync,
  } = options;
  if (!queue) throw new Error('runTranscribe needs a queue (workers/studio/queue.js)');

  const report = { owner, done: [], noAudio: [], failed: [], blocked: [], released: [], lost: [] };
  for (let n = 0; n < Math.max(1, Number(max) || 1); n += 1) {
    const job = queue.claim(owner, { stages: [STAGE_TRANSCRIBE] });
    if (!job) break;
    let result;
    try {
      result = await transcribeJob({ queue, job, owner, catalog, options, env, run, exists, readFile, stat });
    } catch (err) {
      const reason = `transcribing this source threw an error: ${err.message}`;
      queue.fail(job.id, owner, reason);
      result = { jobId: job.id, sourceId: text(job.subjectId), outcome: 'failed', jobAction: 'failed', reason };
    }
    const bucket = {
      done: report.done,
      no_audio: report.noAudio,
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
  runTranscribe,
  transcribeJob,
  enqueueTranscribe,
  parseWhisperJson,
  whisperArgs,
  whisperSettings,
  whisperTimeoutMs,
  leaseForTranscribe,
  audioSeconds,
  STAGE_TRANSCRIBE,
  TRANSCRIPT_NO_AUDIO,
};
