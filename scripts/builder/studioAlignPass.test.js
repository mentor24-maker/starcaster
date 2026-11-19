'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Reel Spinner 3b (SC-832) — the line-up pass and its backfill.
 *
 * Real SQLite queue and real files; the catalog is a fake that keeps the
 * store's two promises (one row per pair whichever way round, and a measured
 * pick never overwrites Dane's). ffmpeg is stood in for by sound MADE FROM the
 * real Zoom loudness curve 3a measured (fixtures/studio-alignment/), so the
 * success path runs 3a's rules end to end through the same readers production
 * uses: a frame of the curve becomes 160 samples at exactly that level.
 */

const { openQueue } = require('../../workers/studio/queue.js');
const al = require('../../workers/studio/alignment.js');
const { parseSilencedetect } = require('../../workers/studio/cutMarks.js');
const {
  runAlign, enqueueAlign, partnersFor, readBackProblem, STAGE_ALIGN,
} = require('../../workers/studio/alignPass.js');
const { STAGE_RUNNERS } = require('../../workers/studio/daemon.js');
const { planBackfill, runBackfill, report, tally } = require('../studio_backfill_align.cjs');

const PROJECT = 'proj_studio';
const OWNER = 'align-test';
const FIXTURE = path.join(__dirname, 'fixtures', 'studio-alignment');

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

const ZOOM_DB = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'zoom-call.json'), 'utf8')).db10.map((v) => v / 10);
const ZOOM_SILENCES = fs.readFileSync(path.join(FIXTURE, 'zoom-call-silencedetect.txt'), 'utf8');
const IPHONE_DB = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'iphone-talking.json'), 'utf8')).db10.map((v) => v / 10);

/** Frames `fromS..fromS+lengthS` of a dB curve, with room noise mixed in power. */
function slice(db, { fromS = 0, lengthS, noiseDb = null, seed = 1 }) {
  const random = rng(seed);
  const start = Math.round(fromS / al.FRAME_S);
  const n = Math.round(lengthS / al.FRAME_S);
  const noise = noiseDb == null ? 0 : 10 ** (noiseDb / 10);
  const out = [];
  for (let f = 0; f < n; f += 1) {
    const p = 10 ** (db[Math.min(start + f, db.length - 1)] / 10) + noise * (0.9 + 0.2 * random());
    out.push(10 * Math.log10(p));
  }
  return out;
}

/** 16 kHz s16le bytes whose 10 ms levels are `db` — what ffmpeg's decode would print. */
function pcmFor(db) {
  const per = 160;
  const samples = new Int16Array(db.length * per);
  for (let f = 0; f < db.length; f += 1) {
    const amp = Math.min(32767, Math.round(Math.sqrt(10 ** (db[f] / 10)) * 32768));
    for (let i = 0; i < per; i += 1) samples[f * per + i] = i % 2 ? amp : -amp;
  }
  return Buffer.from(samples.buffer);
}

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-align-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function tmpQueue(t) {
  const queue = openQueue(path.join(tmpDir(t), 'queue.sqlite'));
  t.after(() => queue.close());
  return queue;
}

const T0 = Date.parse('2026-11-20T15:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

/**
 * A Zoom call of 180 s and an iPhone take that starts 20 s into it and runs
 * 140 s, the phone in a noisier room. Zoom stamps its file when it finishes.
 */
function sources() {
  return [
    { id: 'src_zoom', deviceLane: 'zoom', state: 'ready', durationS: 180, recordedAt: iso(T0 + 180 * 1000 + 30 * 1000), localPath: '/c/zoom_call.mp4' },
    { id: 'src_iphone', deviceLane: 'iphone', state: 'ready', durationS: 140, recordedAt: iso(T0 + 20 * 1000), localPath: '/c/IMG_2001.MOV' },
  ];
}

/** The machine: a derived folder with a WAV per source, and an ffmpeg that plays `audio`. */
function machine(t, audio, { missingWav = [] } = {}) {
  const dir = tmpDir(t);
  const derived = path.join(dir, 'derived');
  for (const id of Object.keys(audio)) {
    if (missingWav.includes(id)) continue;
    const out = path.join(derived, 'inbox', id);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'analysis-16k.wav'), Buffer.alloc(64));
  }
  const calls = [];
  const run = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (args.includes('-version')) return { status: 0, stdout: 'ffmpeg version 7', stderr: '' };
    const wav = args[args.indexOf('-i') + 1];
    const id = path.basename(path.dirname(wav));
    const a = audio[id];
    if (args.includes('s16le')) return { status: 0, stdout: pcmFor(a.db), stderr: '' };
    return { status: 0, stdout: '', stderr: a.silences };
  };
  const env = { STUDIO_PROJECT_ID: PROJECT, STUDIO_DERIVED_DIR: derived, STUDIO_FFMPEG: 'ffmpeg' };
  return { env, run, calls };
}

function realPairAudio() {
  return {
    src_zoom: { db: slice(ZOOM_DB, { lengthS: 180 }), silences: ZOOM_SILENCES },
    src_iphone: {
      db: slice(ZOOM_DB, { fromS: 20, lengthS: 140, noiseDb: -40, seed: 7 }),
      // The noisy room never falls quiet enough for its own report.
      silences: '',
    },
  };
}

/** The store's two promises, kept in memory. */
function fakeCatalog(rows = sources(), { overwriteDane = false } = {}) {
  const pairs = new Map();
  let n = 0;
  const order = (x, y) => {
    const a = x.toLowerCase();
    const b = y.toLowerCase();
    return a < b ? { a, b, swapped: false } : { a: b, b: a, swapped: true };
  };
  const flip = (v) => (v == null || v === 0 ? v : -v);
  return {
    pairs,
    writes: 0,
    async getSourceById(id) {
      const row = rows.find((r) => r.id === id);
      return row ? { ok: true, status: 200, data: row } : { ok: false, status: 404, error: 'not found' };
    },
    async listSources() { return { ok: true, status: 200, data: rows }; },
    async getAudioPair(x, y) {
      const { a, b } = order(x, y);
      const row = pairs.get(`${a}|${b}`);
      return { ok: true, status: 200, data: row ? { ...row } : null };
    },
    async upsertAudioPair(x, y, data) {
      this.writes += 1;
      const { a, b, swapped } = order(x, y);
      const key = `${a}|${b}`;
      const row = pairs.get(key) || { id: `pair_${n += 1}`, sourceAId: a, sourceBId: b, chosenBy: 'measured', audioSourceId: null };
      Object.assign(row, {
        status: data.status,
        error: data.error || '',
        offsetS: swapped ? flip(data.offsetS) : data.offsetS,
        driftS: swapped ? flip(data.driftS) : data.driftS,
        confidence: data.confidence,
      });
      if (row.chosenBy === 'measured' || overwriteDane) {
        row.audioSourceId = data.audioSourceId ? data.audioSourceId.toLowerCase() : null;
        row.chosenBy = 'measured';
      }
      pairs.set(key, row);
      return { ok: true, status: 200, data: { ...row } };
    },
    async listAudioPairs() { return { ok: true, status: 200, data: [...pairs.values()] }; },
    choose(x, y, audio) {
      const { a, b } = order(x, y);
      const key = `${a}|${b}`;
      const row = pairs.get(key) || { id: `pair_${n += 1}`, sourceAId: a, sourceBId: b, status: 'done', offsetS: 0, driftS: 0 };
      Object.assign(row, { audioSourceId: audio, chosenBy: 'dane' });
      pairs.set(key, row);
    },
  };
}

async function alignOnce(t, { catalog, audio, missingWav, subject = 'src_zoom' }) {
  const queue = tmpQueue(t);
  const m = machine(t, audio, { missingWav });
  enqueueAlign(queue, { sourceId: subject });
  const result = await runAlign({ queue, owner: OWNER, catalog, env: m.env, run: m.run });
  return { queue, result, m };
}

test('a real pair lines up: the offset is where the phone started, and the cleaner sound is Zoom', async (t) => {
  const catalog = fakeCatalog();
  const { queue, result } = await alignOnce(t, { catalog, audio: realPairAudio() });
  assert.equal(result.done.length, 1, JSON.stringify(result));
  const row = catalog.pairs.get('src_iphone|src_zoom');
  assert.equal(row.status, 'done');
  // A is the iPhone (smaller id): Zoom's first frame was 20 s BEFORE it.
  assert.ok(Math.abs(row.offsetS - -20) < 0.05, `offset ${row.offsetS}`);
  assert.equal(row.audioSourceId, 'src_zoom');
  assert.equal(row.chosenBy, 'measured');
  assert.equal(queue.listJobs({ stage: STAGE_ALIGN })[0].state, 'done');
  assert.match(result.done[0].reason, /1 lined up, 0 refused/);
});

test("a pass leaves chosen_by = dane untouched: his pick of the noisier phone stays", async (t) => {
  const catalog = fakeCatalog();
  catalog.choose('src_zoom', 'src_iphone', 'src_iphone');
  const { result } = await alignOnce(t, { catalog, audio: realPairAudio() });
  assert.equal(result.done.length, 1, JSON.stringify(result));
  const row = catalog.pairs.get('src_iphone|src_zoom');
  assert.equal(row.chosenBy, 'dane');
  assert.equal(row.audioSourceId, 'src_iphone');
  // The measurement itself was still updated.
  assert.ok(Math.abs(row.offsetS - -20) < 0.05);
});

test("a catalog that overwrote Dane's pick is caught on the read-back and the job is blocked", async (t) => {
  const catalog = fakeCatalog(sources(), { overwriteDane: true });
  catalog.choose('src_zoom', 'src_iphone', 'src_iphone');
  const { queue, result } = await alignOnce(t, { catalog, audio: realPairAudio() });
  assert.equal(result.blocked.length, 1);
  assert.match(result.blocked[0].reason, /Dane's choice of sound did not survive/);
  assert.equal(queue.listJobs({ stage: STAGE_ALIGN })[0].state, 'blocked');
});

test('a refused pair writes the reason: the same times, but the phone heard something else', async (t) => {
  const catalog = fakeCatalog();
  const audio = realPairAudio();
  audio.src_iphone.db = slice(IPHONE_DB, { lengthS: 140 });
  const { result } = await alignOnce(t, { catalog, audio });
  assert.equal(result.done.length, 1, JSON.stringify(result));
  const row = catalog.pairs.get('src_iphone|src_zoom');
  assert.equal(row.status, 'failed');
  assert.equal(row.error, al.REASONS.NO_MATCH);
  assert.equal(row.audioSourceId, null);
  assert.match(result.done[0].reason, /0 lined up, 1 refused/);
});

test("a partner whose WAV is gone is a failed pair that names the missing file, not a skipped one", async (t) => {
  const catalog = fakeCatalog();
  const { result } = await alignOnce(t, { catalog, audio: realPairAudio(), missingWav: ['src_iphone'] });
  assert.equal(result.done.length, 1);
  const row = catalog.pairs.get('src_iphone|src_zoom');
  assert.equal(row.status, 'failed');
  assert.match(row.error, /^audio_could_not_be_read: .*src_iphone.*analysis-16k\.wav/);
});

test('ffmpeg missing is the machine, not the file: released, nothing written', async (t) => {
  const catalog = fakeCatalog();
  const queue = tmpQueue(t);
  const m = machine(t, realPairAudio());
  enqueueAlign(queue, { sourceId: 'src_zoom' });
  const run = () => ({ error: Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' }) });
  const result = await runAlign({ queue, owner: OWNER, catalog, env: m.env, run });
  assert.equal(result.released.length, 1);
  assert.match(result.released[0].reason, /ffmpeg is not installed/);
  assert.equal(catalog.writes, 0);
  assert.equal(queue.listJobs({ stage: STAGE_ALIGN })[0].state, 'pending');
});

test('a plate, or a recording with no partner in time, completes with nothing written and says why', async (t) => {
  const rows = [...sources(), { id: 'src_plate', deviceLane: 'plate', state: 'ready', durationS: 60, recordedAt: iso(T0) }];
  const plate = await alignOnce(t, { catalog: fakeCatalog(rows), audio: realPairAudio(), subject: 'src_plate' });
  assert.match(plate.result.done[0].reason, /only an iPhone take and a Zoom recording/);

  const apart = sources();
  apart[1].recordedAt = iso(T0 + 3 * 3600 * 1000);
  const catalog = fakeCatalog(apart);
  const lone = await alignOnce(t, { catalog, audio: realPairAudio() });
  assert.match(lone.result.done[0].reason, /no ready recording from the other device overlaps/);
  assert.equal(catalog.writes, 0);
});

test('only READY partners are compared — the other half not ready yet is found by ITS job later', () => {
  const rows = sources();
  rows[1].state = 'probed';
  assert.deepEqual(partnersFor(rows[0], rows), []);
  rows[1].state = 'ready';
  assert.deepEqual(partnersFor(rows[0], rows).map((p) => p.source.id), ['src_iphone']);
  assert.deepEqual(partnersFor(rows[1], rows).map((p) => p.source.id), ['src_zoom']);
});

test('enqueueAlign dedupes, and the daemon runs align last but for the rough cut, which reads the line-up', (t) => {
  const queue = tmpQueue(t);
  assert.equal(enqueueAlign(queue, { sourceId: 'src_zoom' }).created, true);
  assert.equal(enqueueAlign(queue, { sourceId: 'src_zoom' }).created, false);
  const stages = Object.keys(STAGE_RUNNERS);
  // The rough cut (Reel Spinner 4b) uses the line-up's chosen sound, so a
  // line-up due in the same tick must run before it, never after.
  assert.deepEqual(stages.slice(-2), [STAGE_ALIGN, 'rough_cut']);
});

test('readBackProblem compares across the store turning the pair round', () => {
  const wrote = { status: 'done', offsetS: 20, driftS: 0.01, audioSourceId: 'src_zoom' };
  const row = { sourceAId: 'src_iphone', sourceBId: 'src_zoom', status: 'done', offsetS: -20, driftS: -0.01, audioSourceId: 'src_zoom', chosenBy: 'measured' };
  assert.equal(readBackProblem({ wrote, row, before: null, firstId: 'src_zoom' }), '');
  assert.match(readBackProblem({ wrote, row: { ...row, offsetS: 20 }, before: null, firstId: 'src_zoom' }), /offset read back/);
});

// ── the backfill ────────────────────────────────────────────────────────────

test('backfill: one job per recording still needed; a pair with a row, or a job waiting, is skipped', () => {
  const rows = sources();
  let plan = planBackfill({ sources: rows, pairs: [], queued: new Set() });
  assert.equal(plan.candidates.length, 1);
  assert.equal(plan.enqueue.length, 1);

  plan = planBackfill({ sources: rows, pairs: [{ sourceAId: 'src_iphone', sourceBId: 'src_zoom', status: 'failed' }], queued: new Set() });
  assert.equal(plan.enqueue.length, 0);
  assert.deepEqual(tally(plan), { candidates: 1, done: 0, failed: 1, missing: 0, chosenByDane: 0 });

  plan = planBackfill({ sources: rows, pairs: [], queued: new Set(['src_iphone']) });
  assert.equal(plan.enqueue.length, 0);
  assert.equal(plan.skipped.length, 1);

  // A second phone take in the same call: one job on the Zoom covers both.
  const three = [...rows, { id: 'src_iphone2', deviceLane: 'iphone', state: 'ready', durationS: 120, recordedAt: iso(T0 + 40 * 1000) }];
  plan = planBackfill({ sources: three, pairs: [], queued: new Set() });
  assert.equal(plan.candidates.length, 2);
  assert.equal(plan.enqueue.length, 1);
});

test('backfill: a dry run writes nothing, --apply queues, and the second run queues nothing', async (t) => {
  const queue = tmpQueue(t);
  const catalog = fakeCatalog();
  const dry = await runBackfill({ queue, catalog, scope: { projectId: PROJECT }, apply: false });
  assert.equal(dry.plan.enqueue.length, 1);
  assert.equal(queue.listJobs({ stage: STAGE_ALIGN }).length, 0);
  assert.match(report(dry), /1 pair\(s\) recorded at overlapping times[\s\S]*Dry run/);

  const applied = await runBackfill({ queue, catalog, scope: { projectId: PROJECT }, apply: true });
  assert.equal(applied.enqueued.length, 1);
  assert.equal(queue.listJobs({ stage: STAGE_ALIGN }).length, 1);
  const again = await runBackfill({ queue, catalog, scope: { projectId: PROJECT }, apply: true });
  assert.equal(again.enqueued.length, 0);
});

test('backfill: no overlapping recordings says so in words', async (t) => {
  const apart = sources();
  apart[1].recordedAt = iso(T0 + 3 * 3600 * 1000);
  const out = await runBackfill({ queue: tmpQueue(t), catalog: fakeCatalog(apart), scope: { projectId: PROJECT } });
  assert.match(report(out), /0 pair\(s\)[\s\S]*record one session on both at once/);
});
