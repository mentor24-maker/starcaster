'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Reel Spinner 3a (SC-831) — the rules that line up an iPhone take with its
 * Zoom recording.
 *
 * NO REAL PAIR EXISTS YET. Checked on the Mini, 2026-11-17, across all 33
 * recordings in the Studio: the iPhone takes (2026-06-21, 08-01, 10-25 morning)
 * never overlap a Zoom call in time. So the fixtures are REAL recordings
 * against copies of themselves, shifted and mixed with noise here:
 *
 *   zoom-call.json       600-780 s of Zoom call 77602703-5c1f-4389-915a-d5181ec76d63
 *                        (2026-10-15), the same call the cut-marks fixture uses
 *   iphone-talking.json  all 148 s of IMG_1962, an iPhone clip of talking
 *
 * Each is the loudness curve `loudnessCurve` makes from the analysis WAV (one
 * level per 10 ms, stored as tenths of a dB), and each `*-silencedetect.txt` is
 * ffmpeg's silence report at the cut-marks level for the same stretch. The
 * noise is mixed in POWER, frame by frame — what adding an independent noise
 * track to the audio does to a 10 ms level, on average.
 */

const al = require('../../workers/studio/alignment.js');
const { parseSilencedetect } = require('../../workers/studio/cutMarks.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'studio-alignment');

function readCurve(name) {
  const raw = JSON.parse(fs.readFileSync(path.join(FIXTURE, `${name}.json`), 'utf8'));
  assert.equal(raw.frameS, al.FRAME_S, 'the fixture is at the module\'s frame rate');
  return al.curveFromDb(raw.db10.map((v) => v / 10));
}
function readSilences(name) {
  return parseSilencedetect(fs.readFileSync(path.join(FIXTURE, `${name}-silencedetect.txt`), 'utf8'));
}

const zoom = readCurve('zoom-call');
const zoomSilences = readSilences('zoom-call');
const iphone = readCurve('iphone-talking');

/** A seeded random number generator, so the noise is the same every run. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A copy of `curve` that starts `startS` into it and runs `lengthS`, its clock
 * running `1 + rate` as fast (so it drifts `rate · t` seconds by time t), with
 * room noise at `noiseDb` mixed in. Frames between two of the original's are
 * interpolated in power.
 */
function copyOf(curve, { startS, lengthS, rate = 0, noiseDb = null, seed = 1 }) {
  const random = rng(seed);
  const n = Math.round(lengthS / al.FRAME_S);
  const power = new Float64Array(n);
  const noise = noiseDb == null ? 0 : 10 ** (noiseDb / 10);
  for (let f = 0; f < n; f += 1) {
    const src = (startS + f * al.FRAME_S * (1 + rate)) / al.FRAME_S;
    const i = Math.floor(src);
    const frac = src - i;
    const p0 = curve.power[Math.min(i, curve.power.length - 1)];
    const p1 = curve.power[Math.min(i + 1, curve.power.length - 1)];
    // 160 samples of noise: its level wobbles about ±11% frame to frame.
    const wobble = 1 + 0.11 * (random() + random() + random() - 1.5) * 2;
    power[f] = p0 + (p1 - p0) * frac + noise * wobble;
  }
  return al.curveFromDb(Array.from(power, (p) => 10 * Math.log10(p)));
}

/**
 * Talking that is not the call: syllable-length bursts (120-320 ms at -18 to
 * -32 dB) between gaps of 60-600 ms at -62 dB, from a seeded generator. It
 * stands in for the minutes a phone records before the call starts or after
 * it ends. The iPhone fixture is only 148 s, too short to fill those minutes.
 */
function otherTalking(lengthS, seed) {
  const random = rng(seed);
  const n = Math.round(lengthS / al.FRAME_S);
  const db = new Array(n);
  let f = 0;
  while (f < n) {
    const burst = 12 + Math.floor(random() * 20);
    const level = -18 - random() * 14;
    for (let k = 0; k < burst && f < n; k += 1, f += 1) db[f] = level + (random() - 0.5) * 6;
    const gap = 6 + Math.floor(random() * (random() < 0.15 ? 54 : 20));
    for (let k = 0; k < gap && f < n; k += 1, f += 1) db[f] = -62 + (random() - 0.5) * 4;
  }
  return al.curveFromDb(db);
}

/** Curves one after another, as one recording. */
function joined(...curves) {
  return al.curveFromDb(curves.flatMap((c) => Array.from(c.db)));
}

// ── candidates ──────────────────────────────────────────────────────────────

test('candidates: an iPhone take inside a Zoom call is one, whichever way round', () => {
  // A Zoom call 10:00-11:00 whose file was stamped 11:05 (Zoom writes the time
  // it finished writing), and an iPhone take 10:40-10:50.
  const call = { id: 'z', lane: 'zoom', recordedAt: '2026-11-20T11:05:00Z', durationS: 3600 };
  const take = { id: 'i', lane: 'iphone', recordedAt: '2026-11-20T10:40:00Z', durationS: 600 };
  assert.equal(al.candidateReason(call, take).ok, true);
  assert.equal(al.candidateReason(take, call).ok, true);
  const list = al.pairCandidates([call, take, { id: 'p', lane: 'plate', recordedAt: '2026-11-20T10:40:00Z', durationS: 600 }]);
  assert.deepEqual(list.map((c) => [c.a.id, c.b.id]), [['z', 'i']]);
});

test('candidates: Zoom\'s stamp is when it finished writing, so a take in the last minutes still counts', () => {
  // Call 10:00-11:00, file stamped 11:06 (6 minutes to write, inside the
  // measured lag). Read as if the stamp were the start, a take at 10:00-10:08
  // would sit before the call; read as the end, it is wholly inside.
  const call = { id: 'z', lane: 'zoom', recordedAt: '2026-11-20T11:06:00Z', durationS: 3600 };
  const early = { id: 'i', lane: 'iphone', recordedAt: '2026-11-20T10:00:00Z', durationS: 480 };
  const r = al.candidateReason(call, early);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.share >= 0.99, `the whole take can sit inside the call: ${r.share}`);
});

test('candidates: refused with a reason — no overlap, two iPhones, no time', () => {
  const call = { lane: 'zoom', recordedAt: '2026-11-20T11:00:00Z', durationS: 3600 };
  const later = { lane: 'iphone', recordedAt: '2026-11-20T14:00:00Z', durationS: 600 };
  assert.equal(al.candidateReason(call, later).reason, al.REASONS.TOO_LITTLE_OVERLAP);
  assert.equal(al.candidateReason(later, { ...later }).reason, al.REASONS.NOT_IPHONE_AND_ZOOM);
  assert.equal(al.candidateReason(call, { lane: 'iphone', recordedAt: null, durationS: 10 }).reason, al.REASONS.NO_TIME);
  // Half of the shorter is the line: a 600 s take starting 3 minutes before a
  // call's file was stamped overlaps it by 180 s at most, and is out.
  const late = { lane: 'iphone', recordedAt: '2026-11-20T10:57:00Z', durationS: 600 };
  const r = al.candidateReason(call, late);
  assert.equal(r.reason, al.REASONS.TOO_LITTLE_OVERLAP);
  assert.ok(Math.abs(r.overlapS - 180) < 1e-6, String(r.overlapS));
});

// ── the offset ──────────────────────────────────────────────────────────────

test('offset: a known shift is found to within 0.05 s, through room noise', () => {
  // B is the same call starting 12.345 s after A began, with a noisy room.
  const b = copyOf(zoom, { startS: 12.345, lengthS: 150, noiseDb: -45, seed: 7 });
  const r = al.measureOffset(zoom, b);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(Math.abs(r.offsetS - 12.345) <= 0.05, `found ${r.offsetS}, want 12.345`);
  assert.ok(Math.abs(r.driftS) <= 0.05, `no drift was added: ${r.driftS}`);
  assert.ok(r.confidence >= al.MIN_PEAK);
  assert.deepEqual(r.checks.filter((c) => c.matched).map((c) => c.end), ['start', 'end']);
});

test('offset: measured from A to B — turned round, it is negated', () => {
  const b = copyOf(zoom, { startS: 12.345, lengthS: 150, noiseDb: -45, seed: 7 });
  const r = al.measureOffset(b, zoom);
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.offsetS + 12.345) <= 0.05, `found ${r.offsetS}, want -12.345`);
});

test('offset: added drift is caught and refused, and the drift is reported', () => {
  // A clock 0.25% fast: 0.3 s apart by the end of 120 s.
  const b = copyOf(zoom, { startS: 20, lengthS: 150, rate: 0.0025, noiseDb: -45, seed: 3 });
  const r = al.measureOffset(zoom, b);
  assert.equal(r.ok, false);
  assert.equal(r.reason, al.REASONS.DRIFT);
  assert.ok(Math.abs(r.driftS) > al.MAX_DRIFT_S, `drift ${r.driftS}`);
  assert.ok(Math.abs(r.offsetS - 20) <= 0.05, `the start check still finds the start: ${r.offsetS}`);
});

test('offset: unrelated audio is refused with "no match"', () => {
  const r = al.measureOffset(zoom, iphone);
  assert.equal(r.ok, false, JSON.stringify(r.checks));
  assert.equal(r.reason, al.REASONS.NO_MATCH);
  assert.equal(r.confidence, 0);
  for (const c of r.checks) assert.equal(c.matched, false, `check at ${c.atS}: peak ${c.peak}, runner-up ${c.runnerUp}`);
});

test('offset: too short to check both start and end is refused, not guessed', () => {
  const b = copyOf(zoom, { startS: 5, lengthS: 45 });
  const r = al.measureOffset(zoom, b);
  assert.equal(r.reason, al.REASONS.TOO_SHORT);
});

test('offset: a phone started well before the Zoom recording is still paired', () => {
  // "Zoom" is the call, then 150 s more of other talking (330 s). The phone
  // recorded 200 s of other talking BEFORE Zoom started, then the call's
  // first 100 s with a noisy room (300 s, so the phone is the shorter). Its
  // own first three minutes have nothing in Zoom to match.
  const zoomFile = joined(zoom, otherTalking(150, 11));
  const phone = copyOf(joined(otherTalking(200, 12), zoom), { startS: 0, lengthS: 300, noiseDb: -45, seed: 5 });
  const r = al.measureOffset(zoomFile, phone);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(Math.abs(r.offsetS - -200) <= 0.05, `the phone started 200 s first: found ${r.offsetS}`);
  assert.ok(Math.abs(r.driftS) <= 0.05, `no drift was added: ${r.driftS}`);
  const matched = r.checks.filter((c) => c.matched);
  assert.deepEqual(matched.map((c) => c.end), ['anchor', 'start', 'end']);
  assert.ok(matched[1].atS >= 200, `the start check sits inside the overlap: ${matched[1].atS}`);
  // Turned round, the same pair.
  const back = al.measureOffset(phone, zoomFile);
  assert.equal(back.ok, true, JSON.stringify(back));
  assert.ok(Math.abs(back.offsetS - 200) <= 0.05, String(back.offsetS));
});

test('offset: a phone left running after the Zoom recording ended is still paired', () => {
  // "Zoom" is 150 s of other talking, then the call (330 s). The phone started
  // 60 s into the call (210 s into Zoom) and ran 180 s past Zoom's end.
  const zoomFile = joined(otherTalking(150, 21), zoom);
  const phone = copyOf(joined(copyOf(zoom, { startS: 60, lengthS: 120 }), otherTalking(180, 22)), { startS: 0, lengthS: 300, noiseDb: -45, seed: 6 });
  const r = al.measureOffset(zoomFile, phone);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(Math.abs(r.offsetS - 210) <= 0.05, `found ${r.offsetS}, want 210`);
  const end = r.checks.find((c) => c.matched && c.end === 'end');
  assert.ok(end.atS <= 90, `the end check is the end of the overlap, not of the phone: ${end.atS}`);
});

test('offset: a start that matches and an end that does not is said so, not "unrelated"', () => {
  // The phone's first 30 s are the call; after that it is other talking, all
  // through the 150 s the start implies it shares with Zoom. Nothing at the
  // end of the overlap matches, and that is not unrelated audio.
  const phone = joined(copyOf(zoom, { startS: 30, lengthS: 30 }), otherTalking(150, 31));
  const r = al.measureOffset(zoom, phone);
  assert.equal(r.ok, false);
  assert.equal(r.reason, al.REASONS.END_NO_MATCH, JSON.stringify(r.checks));
  assert.notEqual(r.reason, al.REASONS.NO_MATCH);
  assert.ok(Math.abs(r.offsetS - 30) <= 0.05, `the start it did find is kept: ${r.offsetS}`);
});

test('offset: an overlap too short to check both ends is refused as that', () => {
  // Phone: 150 s of other talking then the call's first 40 s. They share 40 s,
  // less than the two 30 s stretches the start and end checks need.
  const phone = joined(otherTalking(150, 41), copyOf(zoom, { startS: 0, lengthS: 40 }));
  const r = al.measureOffset(joined(zoom, otherTalking(150, 42)), phone);
  assert.equal(r.ok, false);
  assert.equal(r.reason, al.REASONS.OVERLAP_TOO_SHORT, JSON.stringify(r.checks));
});

// ── the cleaner sound ───────────────────────────────────────────────────────

test('cleaner: the original beats its noisy copy, over the same moments', () => {
  const b = copyOf(zoom, { startS: 12.345, lengthS: 150, noiseDb: -45, seed: 7 });
  const off = al.measureOffset(zoom, b);
  // The noisy copy's own silence report finds nothing (the room never gets
  // quiet), which is the real-world case: only A's silences mark the quiet.
  const r = al.compareCleanliness(
    { curve: zoom, silences: zoomSilences, durationS: 180 },
    { curve: b, silences: [], durationS: 150 },
    off.offsetS,
  );
  assert.equal(r.winner, 'a', JSON.stringify(r));
  assert.ok(r.a.snrDb > r.b.snrDb);
  assert.ok(r.marginDb > 3, `a clear margin: ${r.marginDb} dB`);
  assert.ok(r.quietS >= 1 && r.speechS >= 5);
});

test('cleaner: whichever side the clean one is on, it wins', () => {
  const b = copyOf(zoom, { startS: 12.345, lengthS: 150, noiseDb: -45, seed: 7 });
  const r = al.compareCleanliness(
    { curve: b, silences: [], durationS: 150 },
    { curve: zoom, silences: zoomSilences, durationS: 180 },
    -12.345,
  );
  assert.equal(r.winner, 'b', JSON.stringify(r));
});

test('cleaner: no quiet between words anywhere is "cannot tell", never a winner', () => {
  const b = copyOf(zoom, { startS: 12.345, lengthS: 150, noiseDb: -45 });
  const r = al.compareCleanliness({ curve: zoom, silences: [], durationS: 180 }, { curve: b, silences: [], durationS: 150 }, 12.345);
  assert.equal(r.winner, null);
  assert.equal(r.reason, al.REASONS.NOT_ENOUGH_QUIET);
});

test('cleaner: a difference under the margin is too close to call, never a coin toss', () => {
  // The same recording on both sides: a tie. Then one a hair noisier.
  const same = { curve: zoom, silences: zoomSilences, durationS: 180 };
  const tie = al.compareCleanliness(same, same, 0);
  assert.equal(tie.winner, null, JSON.stringify(tie));
  assert.equal(tie.reason, al.REASONS.TOO_CLOSE_TO_CALL);
  assert.equal(tie.marginDb, 0);
  const hair = copyOf(zoom, { startS: 0, lengthS: 180, noiseDb: -75, seed: 9 });
  const close = al.compareCleanliness(same, { curve: hair, silences: zoomSilences, durationS: 180 }, 0);
  assert.ok(Math.abs(close.marginDb) < al.MIN_MARGIN_DB, `the fixture really is close: ${close.marginDb}`);
  assert.equal(close.winner, null);
  assert.equal(close.reason, al.REASONS.TOO_CLOSE_TO_CALL);
});

// ── together ────────────────────────────────────────────────────────────────

test('lineUp: shaped for video_audio_pairs — done with the cleaner source\'s id', () => {
  const b = copyOf(zoom, { startS: 12.345, lengthS: 150, noiseDb: -45, seed: 7 });
  const r = al.lineUp(
    { id: 'zoom-1', curve: zoom, silences: zoomSilences, durationS: 180 },
    { id: 'iphone-1', curve: b, silences: [], durationS: 150 },
  );
  assert.equal(r.status, 'done');
  assert.equal(r.audioSourceId, 'zoom-1');
  assert.ok(Math.abs(r.offsetS - 12.345) <= 0.05);
  assert.equal(r.rulesVersion, al.RULES_VERSION);
});

test('lineUp: a refusal is failed with the reason as the error', () => {
  const r = al.lineUp(
    { id: 'a', curve: zoom, silences: zoomSilences, durationS: 180 },
    { id: 'b', curve: iphone, silences: [], durationS: 148 },
  );
  assert.equal(r.status, 'failed');
  assert.equal(r.error, al.REASONS.NO_MATCH);
  assert.equal(r.audioSourceId, undefined);
  assert.equal(r.rulesVersion, al.RULES_VERSION, 'a refusal says which rules refused it');
});

// ── loudness and ffmpeg ─────────────────────────────────────────────────────

test('loudnessCurve: one level per 10 ms, in dB of full scale, floored', () => {
  const s = new Int16Array(16000 * 0.03);
  s.fill(16384, 0, 160); // half scale: -6.02 dB
  // frame 2 stays digital silence
  for (let i = 160; i < 320; i += 1) s[i] = i % 2 ? 3277 : -3277; // 0.1: -20 dB
  const c = al.loudnessCurve(s, 16000);
  assert.equal(c.db.length, 3);
  assert.ok(Math.abs(c.db[0] - -6.02) < 0.01, String(c.db[0]));
  assert.ok(Math.abs(c.db[1] - -20) < 0.01, String(c.db[1]));
  assert.equal(c.db[2], -80);
});

test('alignPair: reads both tracks through the ffmpeg it is handed', () => {
  const pcm = (curve) => {
    // Rebuild 16-bit audio whose 10 ms levels are the curve's.
    const out = new Int16Array(curve.power.length * 160);
    for (let f = 0; f < curve.power.length; f += 1) {
      const amp = Math.round(Math.sqrt(curve.power[f]) * 32768);
      for (let i = 0; i < 160; i += 1) out[f * 160 + i] = i % 2 ? amp : -amp;
    }
    return Buffer.from(out.buffer);
  };
  const b = copyOf(zoom, { startS: 12.345, lengthS: 150, noiseDb: -45, seed: 7 });
  const files = { 'a.wav': { pcm: pcm(zoom), silence: fs.readFileSync(path.join(FIXTURE, 'zoom-call-silencedetect.txt'), 'utf8') }, 'b.wav': { pcm: pcm(b), silence: '' } };
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, args.includes('-af') ? 'silence' : 'decode']);
    const file = files[args[args.indexOf('-i') + 1]];
    return args.includes('-af') ? { status: 0, stderr: file.silence } : { status: 0, stdout: file.pcm };
  };
  const r = al.alignPair({ id: 'A', wavPath: 'a.wav' }, { id: 'B', wavPath: 'b.wav' }, { run });
  assert.equal(r.status, 'done', JSON.stringify(r));
  assert.ok(Math.abs(r.offsetS - 12.345) <= 0.05, String(r.offsetS));
  assert.equal(r.audioSourceId, 'A');
  assert.equal(calls.length, 4);
  assert.ok(al.silenceArgs('x.wav').join(' ').includes('silencedetect=noise=-35dB:d=1'), 'the cut-marks silence level');
});

test('alignPair: ffmpeg failing is failed with the reason, never a guess', () => {
  const run = () => ({ status: 1, stderr: 'No such file or directory' });
  const r = al.alignPair({ id: 'A', wavPath: 'gone.wav' }, { id: 'B', wavPath: 'b.wav' }, { run });
  assert.equal(r.status, 'failed');
  assert.match(r.error, /audio_could_not_be_read: No such file/);
  assert.equal(r.rulesVersion, al.RULES_VERSION);
});

test('alignPair: ffmpeg exiting cleanly with no audio is audio that could not be read', () => {
  const run = (cmd, args) => (args.includes('-af') ? { status: 0, stderr: '' } : { status: 0, stdout: Buffer.alloc(0) });
  const r = al.alignPair({ id: 'A', wavPath: 'empty.wav' }, { id: 'B', wavPath: 'b.wav' }, { run });
  assert.equal(r.status, 'failed');
  assert.match(r.error, /^audio_could_not_be_read/, r.error);
  assert.notEqual(r.error, al.REASONS.TOO_SHORT);
});

test('requiring the module runs nothing', () => {
  const src = fs.readFileSync(require.resolve('../../workers/studio/alignment.js'), 'utf8');
  assert.doesNotMatch(src, /setInterval|spawnSync\(/);
});

test('toPairRow: only what video_audio_pairs keeps, for a pairing and for a refusal', () => {
  const { PAIR_FIELDS } = require('../../lib/videoAudioPairsStore.js');
  const b = copyOf(zoom, { startS: 12.345, lengthS: 150, noiseDb: -45, seed: 7 });
  const done = al.toPairRow(al.lineUp(
    { id: 'zoom-1', curve: zoom, silences: zoomSilences, durationS: 180 },
    { id: 'iphone-1', curve: b, silences: [], durationS: 150 },
  ));
  assert.equal(done.status, 'done');
  assert.equal(done.audioSourceId, 'zoom-1');
  const drifting = al.toPairRow(al.lineUp(
    { id: 'zoom-1', curve: zoom, silences: zoomSilences, durationS: 180 },
    { id: 'iphone-1', curve: copyOf(zoom, { startS: 20, lengthS: 150, rate: 0.0025, noiseDb: -45, seed: 3 }), silences: [], durationS: 150 },
  ));
  assert.equal(drifting.status, 'failed');
  assert.equal(drifting.error, al.REASONS.DRIFT);
  assert.ok(Math.abs(drifting.driftS) > al.MAX_DRIFT_S, 'the drift is kept on a refusal');
  for (const row of [done, drifting]) {
    for (const key of Object.keys(row)) assert.ok(PAIR_FIELDS.includes(key), `${key} is a field the store keeps`);
  }
});
