'use strict';

/**
 * THE LINE-UP — when an iPhone and Zoom recorded the same session, how far
 * apart in time they are, and which one sounds cleaner.
 *
 * Reel Spinner 3a (SC-831). Step 3 as Dane chose it on 2026-11-16 ("Better
 * sound"): keep one recording's picture and use the other's sound. This file
 * only DECIDES. It never lays one video over another (he did not choose the
 * overlay), never switches angles, and writes nothing: no queue, no database.
 * Its answer is shaped for `video_audio_pairs` (lib/videoAudioPairsStore.js,
 * SC-827): `offsetS` is how many seconds after A's first frame B's first frame
 * was recorded (negative when B started first), `driftS` how far that has
 * moved by the end, both measured from A to B.
 *
 * Pure except where ffmpeg is handed in (`readCurve`, `readSilences`,
 * `alignPair` take a `run` with spawnSync's shape). Requiring it does nothing.
 *
 * THREE QUESTIONS, IN ORDER, each able to say no with a reason:
 *
 * 1. CANDIDATES (`pairCandidates`) — an iPhone take and a Zoom recording whose
 *    recording times overlap by at least half of the shorter one. Only a
 *    shortlist: the clocks are what the files say, and the sound decides.
 *
 * 2. THE OFFSET (`measureOffset`) — a loudness curve of each analysis track
 *    (one level per 10 ms) and a search for where a 30-second stretch of the
 *    shorter recording best matches the longer one. Checked near the START and
 *    again near the END. If the two answers differ by more than 0.1 s the
 *    clocks drift, and a drifting pair would slide out of lip sync over the
 *    edit — so it is reported and NOT paired.
 *
 * 3. THE CLEANER SOUND (`compareCleanliness`) — speech loudness against the
 *    quiet between words, using the silences ffmpeg already finds for cut
 *    marks (workers/studio/cutMarks.js). Both tracks are measured over the SAME
 *    moments: a moment is quiet if EITHER file's silence report says so. A
 *    noisy room never falls below the silence level (cutMarks.js measured one
 *    that never got below -40 dB), so its own report finds no quiet at all; the
 *    clean file's silences are the same moments in the noisy one, and that is
 *    exactly where its noise shows.
 *
 * When unsure, it does not pair. A wrong offset puts the sound off the lips
 * for the whole edit; a refused pair costs a manual line-up.
 */

const { silencedetectFilter, parseSilencedetect } = require('./cutMarks.js');
const { LANES } = require('./probe.js');

/** Bump when any rule below changes. */
const RULES_VERSION = '1';

/** One loudness level per this many seconds. 10 ms: 160 samples at 16 kHz. */
const FRAME_S = 0.01;

/** The analysis track proxy.js writes: 16 kHz mono 16-bit. */
const SAMPLE_RATE = 16000;

/** A frame quieter than this is this. Digital silence would be -Infinity. */
const FLOOR_DB = -80;

/** The stretch of the shorter recording that is searched for in the longer. */
const WINDOW_S = 30;

/** How many stretches to try from each end before giving up on that end. */
const MAX_TRIES = 6;

/**
 * A match is a correlation peak at least this high (Pearson, -1..1) AND this
 * far above the best answer anywhere else more than PEAK_EXCLUDE_S away.
 * Measured on the fixtures (scripts/builder/studioAlignment.test.js), 30 s
 * stretches: a real Zoom call against a copy of itself with room noise at
 * -45 dB peaks at 0.91-0.92, at -30 dB (a loud room) 0.77-0.79, the runner-up
 * 0.21-0.25 either way; the same call against an unrelated iPhone clip peaks
 * at 0.25-0.34 with a runner-up 0.003-0.08 below it. Through real ffmpeg on
 * real audio (the same call, 10 minutes, against an ffmpeg copy with pink
 * noise mixed in) a copy peaked 0.92-0.93 and the iPhone clip 0.36-0.41,
 * runner-up 0.07-0.11 below. No real iPhone + Zoom
 * pair existed to measure on (2026-11-17): the two microphones hear the room
 * differently, so expect real peaks lower than a copy's, and revisit these
 * once one does.
 */
const MIN_PEAK = 0.6;
const MIN_PROMINENCE = 0.2;
const PEAK_EXCLUDE_S = 1.0;

/** More than this between the start and end offsets, and the clocks drift. */
const MAX_DRIFT_S = 0.1;

/**
 * Zoom's `creation_time` is when it FINISHED writing the file, not when the
 * recording began. Measured on the Mini, 2026-11-17, across all 26 Zoom calls
 * in the Studio: it lands 13 s to 615 s after the meeting's start plus the
 * recording's length (about a tenth of the length, plus a little), and 1137 s
 * on the one call whose recording started well after the meeting did. So a
 * Zoom recording ENDS at or up to ZOOM_WRITE_LAG before its stated time.
 * iPhone's `com.apple.quicktime.creationdate` is the start, as Apple writes it.
 */
const ZOOM_WRITE_LAG_FIXED_S = 120;
const ZOOM_WRITE_LAG_SHARE = 0.12;

/** Candidates overlap by at least this share of the shorter recording. */
const MIN_OVERLAP_SHARE = 0.5;

/** Too little speech or quiet to compare, and the cleaner sound is not called. */
const MIN_SPEECH_S = 5;
const MIN_QUIET_S = 1;

const REASONS = Object.freeze({
  NO_TIME: 'no_recording_time',
  NOT_IPHONE_AND_ZOOM: 'not_an_iphone_and_a_zoom_recording',
  TOO_LITTLE_OVERLAP: 'recording_times_overlap_less_than_half',
  TOO_SHORT: 'too_short_to_check_start_and_end',
  NO_MATCH: 'no_match',
  DRIFT: 'drift',
  NO_AUDIO: 'audio_could_not_be_read',
  NOT_ENOUGH_QUIET: 'not_enough_quiet_between_words',
  NOT_ENOUGH_SPEECH: 'not_enough_speech',
});

// ── 1. candidates ────────────────────────────────────────────────────────────

/** The seconds two intervals share. */
function intersect(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/**
 * The most two recordings can overlap, given what each one's clock says.
 * `{ overlapS, shareOfShorter }`, or `{ reason }` when it cannot be read.
 */
function timeOverlap(a, b) {
  const windowOf = (r) => {
    const t = Date.parse(r && r.recordedAt);
    const d = Number(r && r.durationS);
    if (!Number.isFinite(t) || !(d > 0)) return null;
    const at = t / 1000;
    if (r.lane === LANES.ZOOM) {
      // Ends somewhere in [at - lag, at].
      return { start: at - d, end: at, slack: ZOOM_WRITE_LAG_FIXED_S + ZOOM_WRITE_LAG_SHARE * d, d };
    }
    return { start: at, end: at + d, slack: 0, d };
  };
  const wa = windowOf(a);
  const wb = windowOf(b);
  if (!wa || !wb) return { reason: REASONS.NO_TIME };
  // A may really be up to wa.slack earlier than stated, B up to wb.slack, so
  // A sits r earlier relative to B for any r in [-wb.slack, wa.slack]. The
  // overlap is piecewise linear in r: its best is at an end of that range or
  // where two edges meet.
  const lo = -wb.slack;
  const hi = wa.slack;
  const rs = [lo, hi, wa.start - wb.start, wa.end - wb.end, wa.start - wb.end, wa.end - wb.start];
  let best = 0;
  for (const r of rs) {
    const c = Math.min(hi, Math.max(lo, r));
    best = Math.max(best, intersect(wa.start - c, wa.end - c, wb.start, wb.end));
  }
  return { overlapS: best, shareOfShorter: best / Math.min(wa.d, wb.d) };
}

/**
 * Whether two recordings are worth lining up. `{ ok: true, overlapS, share }`
 * or `{ ok: false, reason }`.
 */
function candidateReason(a, b) {
  const lanes = [a && a.lane, b && b.lane].sort().join('+');
  if (lanes !== [LANES.IPHONE, LANES.ZOOM].sort().join('+')) {
    return { ok: false, reason: REASONS.NOT_IPHONE_AND_ZOOM };
  }
  const o = timeOverlap(a, b);
  if (o.reason) return { ok: false, reason: o.reason };
  if (o.shareOfShorter < MIN_OVERLAP_SHARE) {
    return { ok: false, reason: REASONS.TOO_LITTLE_OVERLAP, overlapS: o.overlapS, share: o.shareOfShorter };
  }
  return { ok: true, overlapS: o.overlapS, share: o.shareOfShorter };
}

/**
 * Every iPhone × Zoom pair among `recordings` (`{ id, lane, recordedAt,
 * durationS }`) worth lining up, best overlap first.
 */
function pairCandidates(recordings) {
  const list = Array.isArray(recordings) ? recordings : [];
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const c = candidateReason(list[i], list[j]);
      if (c.ok) out.push({ a: list[i], b: list[j], overlapS: c.overlapS, share: c.share });
    }
  }
  return out.sort((x, y) => y.overlapS - x.overlapS);
}

// ── loudness ────────────────────────────────────────────────────────────────

/**
 * 16-bit samples → `{ power, db }`, one value per FRAME_S. `power` is mean
 * square amplitude on a 0..1 scale; `db` is 10·log10 of it, floored.
 */
function loudnessCurve(samples, sampleRate = SAMPLE_RATE) {
  const per = Math.round(sampleRate * FRAME_S);
  const n = Math.floor(samples.length / per);
  const power = new Float64Array(n);
  const db = new Float64Array(n);
  for (let f = 0; f < n; f += 1) {
    let sum = 0;
    for (let i = f * per, end = i + per; i < end; i += 1) {
      const s = samples[i] / 32768;
      sum += s * s;
    }
    power[f] = sum / per;
    db[f] = toDb(power[f]);
  }
  return { power, db };
}

function toDb(power) {
  return power > 0 ? Math.max(FLOOR_DB, 10 * Math.log10(power)) : FLOOR_DB;
}

/** A curve back from its dB values, for fixtures stored as dB. */
function curveFromDb(dbValues) {
  const db = Float64Array.from(dbValues, (v) => Math.max(FLOOR_DB, Number(v)));
  const power = db.map((v) => 10 ** (v / 10));
  return { power, db };
}

// ── 2. the offset ───────────────────────────────────────────────────────────

/** In-place iterative radix-2 FFT. `inverse` scales by 1/n. */
function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI / len) * (inverse ? 1 : -1);
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const ar = re[i + k + len / 2];
        const ai = im[i + k + len / 2];
        const tr = ar * cr - ai * ci;
        const ti = ar * ci + ai * cr;
        re[i + k + len / 2] = re[i + k] - tr;
        im[i + k + len / 2] = im[i + k] - ti;
        re[i + k] += tr;
        im[i + k] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i += 1) { re[i] /= n; im[i] /= n; }
}

/** The long curve, transformed once and reused for every stretch searched. */
function prepareLong(x, windowLen) {
  let n = 1;
  while (n < x.length + windowLen) n <<= 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  re.set(x);
  fft(re, im);
  const sum = new Float64Array(x.length + 1);
  const sq = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i += 1) { sum[i + 1] = sum[i] + x[i]; sq[i + 1] = sq[i] + x[i] * x[i]; }
  return { n, re, im, sum, sq, length: x.length };
}

/**
 * Where `probe` best matches inside the long curve: Pearson correlation at
 * every lag the probe fits, by FFT. `{ lag (fractional frames), peak, runnerUp }`
 * or null when nothing can be measured (a flat stretch).
 */
function bestMatch(long, probe) {
  const w = probe.length;
  if (w < 2 || long.length < w) return null;
  let mean = 0;
  for (const v of probe) mean += v;
  mean /= w;
  const p = new Float64Array(w);
  let norm = 0;
  for (let i = 0; i < w; i += 1) { p[i] = probe[i] - mean; norm += p[i] * p[i]; }
  norm = Math.sqrt(norm);
  if (!(norm > 1e-9)) return null;

  const re = new Float64Array(long.n);
  const im = new Float64Array(long.n);
  re.set(p);
  fft(re, im);
  // X · conj(P)
  for (let i = 0; i < long.n; i += 1) {
    const xr = long.re[i];
    const xi = long.im[i];
    const pr = re[i];
    const pi = -im[i];
    re[i] = xr * pr - xi * pi;
    im[i] = xr * pi + xi * pr;
  }
  fft(re, im, true);

  const lags = long.length - w + 1;
  const ncc = new Float64Array(lags);
  for (let k = 0; k < lags; k += 1) {
    const s = long.sum[k + w] - long.sum[k];
    const q = long.sq[k + w] - long.sq[k];
    const varSum = q - (s * s) / w;
    ncc[k] = varSum > 1e-9 ? re[k] / (norm * Math.sqrt(varSum)) : 0;
  }
  let at = 0;
  for (let k = 1; k < lags; k += 1) if (ncc[k] > ncc[at]) at = k;
  const exclude = Math.round(PEAK_EXCLUDE_S / FRAME_S);
  let runnerUp = -1;
  for (let k = 0; k < lags; k += 1) if (Math.abs(k - at) > exclude && ncc[k] > runnerUp) runnerUp = ncc[k];
  // Between frames: the top of the parabola through the peak and its neighbours.
  let frac = 0;
  if (at > 0 && at < lags - 1) {
    const y0 = ncc[at - 1];
    const y1 = ncc[at];
    const y2 = ncc[at + 1];
    const den = y0 - 2 * y1 + y2;
    if (den < 0) frac = Math.max(-0.5, Math.min(0.5, 0.5 * (y0 - y2) / den));
  }
  return { lag: at + frac, peak: ncc[at], runnerUp: Math.max(runnerUp, 0) };
}

function isMatch(m) {
  return Boolean(m) && m.peak >= MIN_PEAK && m.peak - m.runnerUp >= MIN_PROMINENCE;
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

/**
 * How far apart two recordings are, from their loudness curves (`{ db }`).
 *
 * The shorter one is searched for in the longer: the first 30 s stretch from
 * its start that matches, and the first from its end. Their two offsets are
 * the start and end checks. Returns
 *   `{ ok: true,  offsetS, driftS, confidence, checks }` — paired
 *   `{ ok: false, reason, offsetS?, driftS?, confidence, checks }` — not, and why
 * with offset and drift measured from A to B either way.
 */
function measureOffset(curveA, curveB) {
  const aLong = curveA.db.length >= curveB.db.length;
  const longC = aLong ? curveA.db : curveB.db;
  const shortC = aLong ? curveB.db : curveA.db;
  const w = Math.round(WINDOW_S / FRAME_S);
  const checks = [];
  if (shortC.length < 2 * w || longC.length < w) {
    return { ok: false, reason: REASONS.TOO_SHORT, confidence: 0, checks };
  }
  const long = prepareLong(longC, w);
  // B after A: a stretch at short-frame i found at long-frame lag means the
  // short recording started (lag - i) frames after the long one.
  const toOffset = (i, lag) => {
    const shortAfterLong = (lag - i) * FRAME_S;
    return aLong ? shortAfterLong : -shortAfterLong;
  };
  const probeAt = (i, end) => {
    const m = bestMatch(long, shortC.subarray(i, i + w));
    const check = {
      end,
      atS: round3(i * FRAME_S),
      peak: m ? round3(m.peak) : null,
      runnerUp: m ? round3(m.runnerUp) : null,
      matched: isMatch(m),
      offsetS: m ? round3(toOffset(i, m.lag)) : null,
    };
    checks.push(check);
    return check.matched ? { i, offset: toOffset(i, m.lag), peak: m.peak, prominence: m.peak - m.runnerUp } : null;
  };

  const last = shortC.length - w;
  let first = null;
  for (let t = 0; t < MAX_TRIES && !first; t += 1) {
    const i = t * w;
    if (i > last) break;
    first = probeAt(i, 'start');
  }
  if (!first) return { ok: false, reason: REASONS.NO_MATCH, confidence: 0, checks };
  let final = null;
  for (let t = 0; t < MAX_TRIES && !final; t += 1) {
    const i = last - t * w;
    if (i < first.i + w) break;
    final = probeAt(i, 'end');
  }
  if (!final) return { ok: false, reason: REASONS.TOO_SHORT, offsetS: round3(first.offset), confidence: 0, checks };

  const driftS = final.offset - first.offset;
  const confidence = round3(Math.min(1, Math.min(first.peak, final.peak)));
  const out = { offsetS: round3(first.offset), driftS: round3(driftS), confidence, checks };
  if (Math.abs(driftS) > MAX_DRIFT_S) return { ok: false, reason: REASONS.DRIFT, ...out };
  return { ok: true, ...out };
}

// ── 3. the cleaner sound ─────────────────────────────────────────────────────

/** Frames of a curve inside any of `silences` (seconds), as a Uint8Array. */
function quietMask(frames, silences, durationS) {
  const mask = new Uint8Array(frames);
  for (const s of Array.isArray(silences) ? silences : []) {
    if (!s || !Number.isFinite(s.start)) continue;
    const end = s.end == null ? (Number.isFinite(durationS) ? durationS : frames * FRAME_S) : s.end;
    const f0 = Math.max(0, Math.ceil(s.start / FRAME_S));
    const f1 = Math.min(frames, Math.floor(end / FRAME_S));
    for (let f = f0; f < f1; f += 1) mask[f] = 1;
  }
  return mask;
}

/**
 * Which of two lined-up recordings sounds cleaner: speech loudness against
 * the quiet between words, both measured over the same moments. Each input is
 * `{ curve, silences, durationS }`; `offsetS` is B after A.
 * Returns `{ a: { speechDb, quietDb, snrDb }, b: {...}, winner: 'a'|'b'|null,
 * marginDb, reason? }`.
 */
function compareCleanliness(a, b, offsetS) {
  const shift = Math.round(offsetS / FRAME_S); // B-frame = A-frame - shift
  const qa = quietMask(a.curve.power.length, a.silences, a.durationS);
  const qb = quietMask(b.curve.power.length, b.silences, b.durationS);
  const sums = { a: { speech: 0, quiet: 0 }, b: { speech: 0, quiet: 0 } };
  let speechN = 0;
  let quietN = 0;
  const from = Math.max(0, shift);
  const to = Math.min(a.curve.power.length, b.curve.power.length + shift);
  for (let fa = from; fa < to; fa += 1) {
    const fb = fa - shift;
    const kind = qa[fa] || qb[fb] ? 'quiet' : 'speech';
    sums.a[kind] += a.curve.power[fa];
    sums.b[kind] += b.curve.power[fb];
    if (kind === 'quiet') quietN += 1; else speechN += 1;
  }
  const side = (s) => {
    const speechDb = speechN ? round3(toDb(s.speech / speechN)) : null;
    const quietDb = quietN ? round3(toDb(s.quiet / quietN)) : null;
    return { speechDb, quietDb, snrDb: speechDb != null && quietDb != null ? round3(speechDb - quietDb) : null };
  };
  const out = { a: side(sums.a), b: side(sums.b), speechS: round3(speechN * FRAME_S), quietS: round3(quietN * FRAME_S) };
  if (quietN * FRAME_S < MIN_QUIET_S) return { ...out, winner: null, marginDb: null, reason: REASONS.NOT_ENOUGH_QUIET };
  if (speechN * FRAME_S < MIN_SPEECH_S) return { ...out, winner: null, marginDb: null, reason: REASONS.NOT_ENOUGH_SPEECH };
  const marginDb = round3(out.a.snrDb - out.b.snrDb);
  return { ...out, winner: out.a.snrDb > out.b.snrDb ? 'a' : 'b', marginDb };
}

// ── together ────────────────────────────────────────────────────────────────

/**
 * The whole line-up of two measured recordings. Each is `{ id, curve,
 * silences, durationS }`. Shaped for video_audio_pairs:
 *   `{ status: 'done', offsetS, driftS, confidence, audioSourceId, cleaner, checks }`
 *   `{ status: 'failed', error, offsetS?, driftS?, confidence, checks }`
 */
function lineUp(a, b) {
  const offset = measureOffset(a.curve, b.curve);
  const base = { rulesVersion: RULES_VERSION, offsetS: offset.offsetS ?? null, driftS: offset.driftS ?? null, confidence: offset.confidence, checks: offset.checks };
  if (!offset.ok) return { status: 'failed', error: offset.reason, ...base };
  const cleaner = compareCleanliness(a, b, offset.offsetS);
  const audioSourceId = cleaner.winner === 'a' ? a.id : cleaner.winner === 'b' ? b.id : null;
  return { status: 'done', ...base, audioSourceId, cleaner };
}

/**
 * The part of a `lineUp` answer `upsertAudioPair` (lib/videoAudioPairsStore.js)
 * keeps. The store refuses any key it does not know, so the checks and the
 * sound numbers stay out; a refusal keeps its offset and drift, which is how a
 * drifting pair says how far it drifted.
 */
function toPairRow(result) {
  const row = {
    status: result.status,
    offsetS: result.offsetS ?? null,
    driftS: result.driftS ?? null,
    confidence: result.confidence ?? null,
  };
  if (result.status === 'failed') row.error = result.error;
  else row.audioSourceId = result.audioSourceId ?? null;
  return row;
}

// ── ffmpeg, handed in ───────────────────────────────────────────────────────

/** ffmpeg arguments: the analysis track as raw 16 kHz mono 16-bit on stdout. */
function decodeArgs(wavPath) {
  return ['-hide_banner', '-nostdin', '-v', 'error', '-i', wavPath, '-map', '0:a:0',
    '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', '-acodec', 'pcm_s16le', 'pipe:1'];
}

/** ffmpeg arguments: the silence report cut marks uses, for the same file. */
function silenceArgs(wavPath) {
  return ['-hide_banner', '-nostdin', '-i', wavPath, '-map', '0:a:0', '-af', silencedetectFilter(), '-f', 'null', '-'];
}

/**
 * The loudness curve of one analysis track. `run(cmd, args, opts)` has
 * spawnSync's shape. `{ ok: true, curve, durationS }` or `{ ok: false, error }`.
 */
function readCurve(wavPath, { run, ffmpeg = 'ffmpeg' } = {}) {
  const r = run(ffmpeg, decodeArgs(wavPath), { maxBuffer: 1024 * 1024 * 1024 });
  if (!r || r.error || r.status !== 0 || !r.stdout) {
    return { ok: false, error: `${REASONS.NO_AUDIO}: ${(r && (r.error && r.error.message)) || String((r && r.stderr) || '').trim().slice(-300) || 'ffmpeg failed'}` };
  }
  const buf = Buffer.isBuffer(r.stdout) ? r.stdout : Buffer.from(r.stdout);
  const samples = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
  return { ok: true, curve: loudnessCurve(samples, SAMPLE_RATE), durationS: samples.length / SAMPLE_RATE };
}

/** The silences in one analysis track. `{ ok: true, silences }` or `{ ok: false, error }`. */
function readSilences(wavPath, { run, ffmpeg = 'ffmpeg' } = {}) {
  const r = run(ffmpeg, silenceArgs(wavPath), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (!r || r.error || r.status !== 0) {
    return { ok: false, error: `${REASONS.NO_AUDIO}: ${(r && r.error && r.error.message) || 'ffmpeg silencedetect failed'}` };
  }
  return { ok: true, silences: parseSilencedetect(String(r.stderr || '')) };
}

/**
 * Read both analysis tracks with ffmpeg and line them up. `a`/`b` are
 * `{ id, wavPath }`. A track that cannot be read is a `failed` answer with the
 * reason, never a guess.
 */
function alignPair(a, b, { run, ffmpeg = 'ffmpeg' } = {}) {
  const sides = [];
  for (const s of [a, b]) {
    const c = readCurve(s.wavPath, { run, ffmpeg });
    if (!c.ok) return { status: 'failed', error: c.error, offsetS: null, driftS: null, confidence: 0, checks: [] };
    const q = readSilences(s.wavPath, { run, ffmpeg });
    if (!q.ok) return { status: 'failed', error: q.error, offsetS: null, driftS: null, confidence: 0, checks: [] };
    sides.push({ id: s.id, curve: c.curve, silences: q.silences, durationS: c.durationS });
  }
  return lineUp(sides[0], sides[1]);
}

module.exports = {
  RULES_VERSION,
  FRAME_S,
  WINDOW_S,
  MIN_PEAK,
  MIN_PROMINENCE,
  MAX_DRIFT_S,
  MIN_OVERLAP_SHARE,
  REASONS,
  timeOverlap,
  candidateReason,
  pairCandidates,
  loudnessCurve,
  curveFromDb,
  measureOffset,
  compareCleanliness,
  lineUp,
  toPairRow,
  decodeArgs,
  silenceArgs,
  readCurve,
  readSilences,
  alignPair,
};
