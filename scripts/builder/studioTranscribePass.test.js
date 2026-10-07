'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

/**
 * Studio Phase 2 · 3 of 6 (86bcdejzm) — the transcribe pass.
 *
 * Real SQLite queue, real files, and REAL whisper on the success path; the
 * catalog is faked, as in studioProxyPass.test.js. The claim this ticket makes
 * is that real speech ends as real words with real times in the catalog — a
 * stubbed whisper would only prove the stub agreed with the parser.
 */

const { openQueue, DEFAULT_LEASE_MS } = require('../../workers/studio/queue.js');
const { REQUIRED_MODELS, modelPath } = require('../../lib/nodeProvision.js');
const {
  runTranscribe,
  enqueueTranscribe,
  parseWhisperJson,
  whisperTimeoutMs,
  leaseForTranscribe,
  audioSeconds,
  STAGE_TRANSCRIBE,
} = require('../../workers/studio/transcribePass.js');
const { runProxy, enqueueProxy } = require('../../workers/studio/proxyPass.js');
const { STAGE_RUNNERS } = require('../../workers/studio/daemon.js');
const { runBackfill, planBackfill } = require('../studio_backfill_transcripts.cjs');

const PROJECT = 'proj_studio';
const OWNER = 'transcribe-test';

const WHISPER = process.env.STUDIO_WHISPER_BIN || 'whisper-cli';
const MODEL = process.env.STUDIO_WHISPER_MODEL
  || modelPath(REQUIRED_MODELS.find((m) => m.id === 'whisper-large-v3-turbo'));
const FFMPEG = process.env.STUDIO_FFMPEG || 'ffmpeg';

function runs(bin, args) {
  const res = spawnSync(bin, args, { encoding: 'utf8' });
  return !res.error && Number(res.status) === 0;
}
const HAVE_WHISPER = runs(WHISPER, ['--help']) && fs.existsSync(MODEL);
const HAVE_SAY = process.platform === 'darwin' && runs('which', ['say']);
const HAVE_FFMPEG = runs(FFMPEG, ['-version']);
const CAN_SPEAK = HAVE_WHISPER && HAVE_SAY && HAVE_FFMPEG;

// Skips OUT LOUD, the way studioProxyPass.test.js does for ffmpeg: CI has no
// whisper and no 1.6 GB model, and says so with STUDIO_ALLOW_NO_WHISPER=1. A
// machine that sets nothing and lacks them is told the proof is not being taken.
test('whisper, its model, `say` and ffmpeg are present, or the real-speech proof below is not being taken', () => {
  if (process.env.STUDIO_ALLOW_NO_WHISPER === '1') return;
  assert.ok(CAN_SPEAK, `cannot take the real-speech reading here: whisper ${HAVE_WHISPER ? 'ok' : `missing (${WHISPER}, model ${MODEL})`}, `
    + `say ${HAVE_SAY ? 'ok' : 'missing (macOS only)'}, ffmpeg ${HAVE_FFMPEG ? 'ok' : 'missing'}. `
    + 'Run npm run provision:node:apply on the Mini, or set STUDIO_ALLOW_NO_WHISPER=1 to say this machine is not taking it.');
});

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-transcribe-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function tmpQueue(t, options) {
  const queue = openQueue(path.join(tmpDir(t), 'queue.sqlite'), options);
  t.after(() => queue.close());
  return queue;
}

function envFor(dir, extra = {}) {
  return {
    STUDIO_PROJECT_ID: PROJECT,
    STUDIO_DERIVED_DIR: path.join(dir, 'derived'),
    STUDIO_WHISPER_BIN: WHISPER,
    STUDIO_WHISPER_MODEL: MODEL,
    ...extra,
  };
}

/** Where proxy.js puts a source's WAV, made to exist (empty unless given bytes). */
function placeWav(dir, sourceId, bytes = Buffer.alloc(64)) {
  const out = path.join(dir, 'derived', 'inbox', sourceId);
  fs.mkdirSync(out, { recursive: true });
  const wav = path.join(out, 'analysis-16k.wav');
  fs.writeFileSync(wav, bytes);
  return wav;
}

function fakeCatalog(rows) {
  const sources = rows.map((r) => ({ projectId: PROJECT, state: 'ready', ...r }));
  const transcripts = new Map();
  const writes = [];
  return {
    sources,
    transcripts,
    writes,
    getSourceById: async (id) => {
      const found = sources.find((s) => s.id === id);
      return found ? { ok: true, status: 200, data: { ...found } } : { ok: false, status: 404, error: 'Source not found' };
    },
    updateSource: async (id, patch) => {
      const found = sources.find((s) => s.id === id);
      if (!found) return { ok: false, status: 404, error: 'Source not found' };
      Object.assign(found, patch);
      return { ok: true, status: 200, data: { ...found } };
    },
    upsertTranscript: async (sourceId, data) => {
      writes.push({ sourceId, data });
      const row = { sourceId, text: '', segments: [], words: [], ...data };
      transcripts.set(sourceId, row);
      return { ok: true, status: 200, data: { ...row } };
    },
    getTranscriptBySource: async (sourceId) => {
      const row = transcripts.get(sourceId);
      return { ok: true, status: 200, data: row ? { ...row } : null };
    },
    listSources: async () => ({ ok: true, status: 200, data: sources.map((s) => ({ ...s })) }),
    listTranscriptStates: async (ids) => {
      const out = {};
      for (const id of ids) if (transcripts.has(id)) out[id.toLowerCase()] = { state: transcripts.get(id).state };
      return { ok: true, status: 200, data: out };
    },
  };
}

/** A whisper JSON the way whisper-cli -ojf writes one (trimmed to what is read). */
function whisperDoc(segments) {
  return {
    params: { language: 'en' },
    result: { language: 'en' },
    transcription: segments.map(([from, to, segText, tokens]) => ({
      offsets: { from, to },
      text: segText,
      tokens: tokens.map(([tokenText, tDtw, p = 0.9]) => ({
        text: tokenText, t_dtw: tDtw, p, offsets: { from, to: from },
      })),
    })),
  };
}

/** A spawnSync stand-in for whisper: writes the given JSON where -of says. */
function fakeWhisper(doc, onRun = () => {}) {
  return (bin, args) => {
    onRun(bin, args);
    const outBase = args[args.indexOf('-of') + 1];
    fs.writeFileSync(`${outBase}.json`, JSON.stringify(doc));
    return { status: 0, stdout: '', stderr: '' };
  };
}

const SIMPLE_DOC = whisperDoc([[0, 1500, ' Hello there.', [['[_BEG_]', -1], [' Hello', 10], [' there', 60], ['.', 120]]]]);

// ── The real thing ──────────────────────────────────────────────────────────

test('real speech becomes a done transcript whose words are what was said, in order',
  { skip: !CAN_SPEAK && 'whisper, its model, say or ffmpeg is not on this machine (see the test above)' }, async (t) => {
    const dir = tmpDir(t);
    const aiff = path.join(dir, 'spoken.aiff');
    execFileSync('say', ['-o', aiff, 'The quick brown fox jumps over the lazy dog']);
    const wav = placeWav(dir, 'src_1');
    execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', aiff,
      '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);

    const queue = tmpQueue(t);
    const catalog = fakeCatalog([{ id: 'src_1', durationS: 3 }]);
    enqueueTranscribe(queue, { sourceId: 'src_1', wavPath: wav });

    const report = await runTranscribe({ queue, owner: OWNER, catalog, env: envFor(dir) });
    assert.equal(report.done.length, 1, JSON.stringify(report, null, 2));
    const row = catalog.transcripts.get('src_1');
    assert.equal(row.state, 'done');
    assert.match(row.text.toLowerCase(), /quick brown fox/);
    assert.equal(row.language, 'en');
    assert.equal(row.model, 'ggml-large-v3-turbo');
    assert.ok(row.words.length >= 8, `expected the nine spoken words, got ${JSON.stringify(row.words)}`);
    for (let i = 1; i < row.words.length; i += 1) {
      assert.ok(row.words[i].start >= row.words[i - 1].start, `word ${i} starts before word ${i - 1}`);
      assert.ok(row.words[i].end >= row.words[i].start);
    }
    assert.equal(queue.listJobs({ stage: STAGE_TRANSCRIBE })[0].state, 'done');
  });

// ── Reading whisper's JSON ──────────────────────────────────────────────────

test('whisper JSON: special tokens dropped, split words joined, each word ends where the next starts', () => {
  const doc = whisperDoc([
    [0, 3000, ' Starcaster is great.', [
      ['[_BEG_]', -1], [' Star', 50], ['caster', 70], [' is', 120], [' great', 150, 0.4], ['.', 200], ['[_TT_150]', -1],
    ]],
    [3000, 4500, ' Yes.', [[' Yes', 310], ['.', 350]]],
  ]);
  const parsed = parseWhisperJson(JSON.stringify(doc));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.text, 'Starcaster is great. Yes.');
  assert.deepEqual(parsed.segments, [
    { start: 0, end: 3, text: 'Starcaster is great.' },
    { start: 3, end: 4.5, text: 'Yes.' },
  ]);
  assert.deepEqual(parsed.words.map((w) => w.word), ['Starcaster', 'is', 'great.', 'Yes.']);
  assert.deepEqual(parsed.words.map((w) => [w.start, w.end]), [[0.5, 1.2], [1.2, 1.5], [1.5, 3], [3.1, 4.5]]);
  assert.equal(parsed.words[2].p, 0.4, 'a word is only as sure as its least sure token');
  assert.equal(parsed.language, 'en');
});

test('whisper JSON: a word is never timed before the one before it', () => {
  const doc = whisperDoc([[0, 2000, ' a b', [[' a', 80], [' b', 40]]]]);
  const parsed = parseWhisperJson(doc);
  assert.ok(parsed.words[1].start >= parsed.words[0].start);
});

test('whisper JSON that is not whisper\'s shape is a fault, never an empty transcript', () => {
  assert.equal(parseWhisperJson('{not json').ok, false);
  assert.equal(parseWhisperJson('{"foo":1}').ok, false);
  assert.equal(parseWhisperJson('{"transcription":[]}').ok, true, 'silence is a real, empty answer');
});

// ── Handing on from the proxy pass ──────────────────────────────────────────

function proxyBuild(audio) {
  return (opts) => ({
    ok: true,
    outputs: {
      proxy: { action: 'encoded', path: path.join(opts.derivedDir || '/derived', 'proxy.mp4') },
      audio,
    },
    failures: [],
  });
}

async function proxyOnce(t, row, audio) {
  const dir = tmpDir(t);
  const file = path.join(dir, 'f.mov');
  fs.writeFileSync(file, 'x');
  const queue = tmpQueue(t);
  const catalog = fakeCatalog([{ state: 'probed', localPath: file, durationS: 5, ...row }]);
  enqueueProxy(queue, { sourceId: row.id, localPath: file });
  const report = await runProxy({ queue, owner: OWNER, catalog, env: envFor(dir), build: proxyBuild(audio) });
  return { queue, catalog, report };
}

test('a recording that reaches ready with sound is queued for transcription, once', async (t) => {
  const { queue, catalog, report } = await proxyOnce(t, { id: 'src_1', deviceLane: 'iphone' },
    { action: 'encoded', path: '/derived/inbox/src_1/analysis-16k.wav' });
  assert.equal(report.ready.length, 1, JSON.stringify(report, null, 2));
  assert.equal(catalog.sources[0].state, 'ready');
  const jobs = queue.listJobs({ stage: STAGE_TRANSCRIBE });
  assert.equal(jobs.length, 1, 'one transcribe job for one ready recording');
  assert.equal(jobs[0].subjectId, 'src_1');
  assert.equal(jobs[0].payload.wavPath, '/derived/inbox/src_1/analysis-16k.wav');
  assert.equal(report.ready[0].transcription, 'transcription queued');
});

test('a plate reaching ready is NOT queued for transcription', async (t) => {
  const { queue, catalog, report } = await proxyOnce(t, { id: 'plate_1', deviceLane: 'plate' },
    { action: 'encoded', path: '/derived/plates/plate_1/analysis-16k.wav' });
  assert.equal(report.ready.length, 1);
  assert.equal(queue.listJobs({ stage: STAGE_TRANSCRIBE }).length, 0);
  assert.equal(catalog.writes.length, 0);
});

test('a recording with no sound gets a no_audio transcript row, not a job', async (t) => {
  const { queue, catalog, report } = await proxyOnce(t, { id: 'src_1', deviceLane: 'iphone' },
    { action: 'skipped', reason: 'source_has_no_audio_track', path: null });
  assert.equal(report.ready.length, 1, JSON.stringify(report, null, 2));
  assert.equal(queue.listJobs({ stage: STAGE_TRANSCRIBE }).length, 0);
  const row = catalog.transcripts.get('src_1');
  assert.equal(row.state, 'no_audio');
  assert.match(row.reason, /no sound track/);
});

// ── Machine faults: released, nothing spent, nothing written ────────────────

test('whisper NOT INSTALLED: the job is released with no attempt spent and no row written', async (t) => {
  const dir = tmpDir(t);
  placeWav(dir, 'src_1');
  const model = path.join(dir, 'model.bin');
  fs.writeFileSync(model, 'm');
  const queue = tmpQueue(t);
  const catalog = fakeCatalog([{ id: 'src_1', durationS: 5 }]);
  enqueueTranscribe(queue, { sourceId: 'src_1' });
  const run = () => ({ error: Object.assign(new Error('spawnSync whisper-cli ENOENT'), { code: 'ENOENT' }) });

  const report = await runTranscribe({ queue, owner: OWNER, catalog, env: envFor(dir, { STUDIO_WHISPER_MODEL: model }), run });
  assert.equal(report.released.length, 1, JSON.stringify(report, null, 2));
  assert.equal(catalog.writes.length, 0);
  const job = queue.listJobs({ stage: STAGE_TRANSCRIBE })[0];
  assert.equal(job.state, 'pending');
  assert.equal(job.attempts, 0);
  assert.match(job.lastError, /not installed/);
});

test('the MODEL missing is the machine\'s fault too: released, attempts 0, whisper never started', async (t) => {
  const dir = tmpDir(t);
  placeWav(dir, 'src_1');
  const queue = tmpQueue(t);
  const catalog = fakeCatalog([{ id: 'src_1', durationS: 5 }]);
  enqueueTranscribe(queue, { sourceId: 'src_1' });
  let started = false;
  const report = await runTranscribe({
    queue, owner: OWNER, catalog,
    env: envFor(dir, { STUDIO_WHISPER_MODEL: path.join(dir, 'no-such-model.bin') }),
    run: fakeWhisper(SIMPLE_DOC, () => { started = true; }),
  });
  assert.equal(report.released.length, 1);
  assert.equal(started, false);
  assert.equal(catalog.writes.length, 0);
  assert.equal(queue.listJobs({ stage: STAGE_TRANSCRIBE })[0].attempts, 0);
});

// ── The file's faults: a failed row with the reason ─────────────────────────

test('whisper failing on the file writes a FAILED row with its reason and fails the job through retries', async (t) => {
  const dir = tmpDir(t);
  placeWav(dir, 'src_1');
  const model = path.join(dir, 'model.bin');
  fs.writeFileSync(model, 'm');
  const queue = tmpQueue(t);
  const catalog = fakeCatalog([{ id: 'src_1', durationS: 5 }]);
  enqueueTranscribe(queue, { sourceId: 'src_1' });
  const run = () => ({ status: 3, stdout: '', stderr: 'error: failed to read audio data as wav' });

  const report = await runTranscribe({ queue, owner: OWNER, catalog, env: envFor(dir, { STUDIO_WHISPER_MODEL: model }), run });
  assert.equal(report.failed.length, 1, JSON.stringify(report, null, 2));
  const row = catalog.transcripts.get('src_1');
  assert.equal(row.state, 'failed');
  assert.match(row.reason, /whisper exited 3: error: failed to read audio data/);
  const job = queue.listJobs({ stage: STAGE_TRANSCRIBE })[0];
  assert.equal(job.state, 'pending', "through the queue's retry rules, not dropped");
  assert.equal(job.attempts, 1);
});

test('a WAV missing from disk is a FAILED row naming the fix, not silence', async (t) => {
  const dir = tmpDir(t);
  const model = path.join(dir, 'model.bin');
  fs.writeFileSync(model, 'm');
  const queue = tmpQueue(t);
  const catalog = fakeCatalog([{ id: 'src_1', durationS: 5 }]);
  enqueueTranscribe(queue, { sourceId: 'src_1' });
  const report = await runTranscribe({ queue, owner: OWNER, catalog, env: envFor(dir, { STUDIO_WHISPER_MODEL: model }) });
  assert.equal(report.failed.length, 1);
  assert.match(catalog.transcripts.get('src_1').reason, /not on disk at .*analysis-16k\.wav.*re-run the proxy step/);
});

test('a transcript that "saves" but does not stick is caught by the read-back', async (t) => {
  const dir = tmpDir(t);
  placeWav(dir, 'src_1');
  const model = path.join(dir, 'model.bin');
  fs.writeFileSync(model, 'm');
  const queue = tmpQueue(t);
  const catalog = fakeCatalog([{ id: 'src_1', durationS: 5 }]);
  catalog.upsertTranscript = async () => ({ ok: true, status: 200, data: {} }); // 200, stores nothing
  enqueueTranscribe(queue, { sourceId: 'src_1' });
  const report = await runTranscribe({
    queue, owner: OWNER, catalog, env: envFor(dir, { STUDIO_WHISPER_MODEL: model }), run: fakeWhisper(SIMPLE_DOC),
  });
  assert.equal(report.blocked.length, 1, JSON.stringify(report, null, 2));
  assert.match(report.blocked[0].reason, /reads back as "nothing"/);
});

// ── The lease ───────────────────────────────────────────────────────────────

test('a long transcription keeps its job: no other worker can reap it and start a second whisper', async (t) => {
  const dir = tmpDir(t);
  placeWav(dir, 'src_1');
  const model = path.join(dir, 'model.bin');
  fs.writeFileSync(model, 'm');
  let now = 1_000_000;
  const queue = tmpQueue(t, { clock: () => now });
  const durationS = 3226; // the measured length of the August test session
  const catalog = fakeCatalog([{ id: 'src_1', durationS }]);
  enqueueTranscribe(queue, { sourceId: 'src_1' });
  // The WAV's size is what sizes the lease; report one as long as the session.
  const stat = () => ({ size: 44 + durationS * 32000 });

  let stolen = null;
  const run = fakeWhisper(SIMPLE_DOC, () => {
    // Mid-transcription: well past the default lease, short of whisper's own timeout.
    now += DEFAULT_LEASE_MS * 4;
    queue.reap();
    stolen = queue.claim('another-worker', { stages: [STAGE_TRANSCRIBE] });
  });

  const report = await runTranscribe({
    queue, owner: OWNER, catalog, env: envFor(dir, { STUDIO_WHISPER_MODEL: model }), run, stat,
  });
  assert.equal(stolen, null, 'the job was not handed out again while whisper ran');
  assert.equal(report.done.length, 1, JSON.stringify(report, null, 2));
  assert.equal(queue.listJobs({ stage: STAGE_TRANSCRIBE })[0].state, 'done');
});

test('the lease covers whisper\'s whole timeout, and the timeout is generous against the measured speed', () => {
  assert.ok(leaseForTranscribe(3226) > whisperTimeoutMs(3226));
  // Measured real-time factor 0.07: an hour takes ~252 s. The allowance must be well above that.
  assert.ok(whisperTimeoutMs(3600) >= 3600 * 0.07 * 1000 * 5);
  assert.ok(whisperTimeoutMs(null) >= 10 * 60 * 1000, 'an unknown length still gets the floor');
});

test('the audio length is read from the WAV itself, and falls back to the catalog', () => {
  assert.equal(audioSeconds('/x.wav', 99, () => ({ size: 44 + 32000 * 10 })), 10);
  assert.equal(audioSeconds('/x.wav', 99, () => { throw new Error('ENOENT'); }), 99);
  assert.equal(audioSeconds('/x.wav', null, () => { throw new Error('ENOENT'); }), null);
});

test('a job that is no longer ours is left alone: whisper is never started', async (t) => {
  const dir = tmpDir(t);
  placeWav(dir, 'src_1');
  const model = path.join(dir, 'model.bin');
  fs.writeFileSync(model, 'm');
  const queue = tmpQueue(t);
  const catalog = fakeCatalog([{ id: 'src_1', durationS: 5 }]);
  enqueueTranscribe(queue, { sourceId: 'src_1' });
  const realHeartbeat = queue.heartbeat;
  queue.heartbeat = () => false;
  t.after(() => { queue.heartbeat = realHeartbeat; });
  let started = false;
  const report = await runTranscribe({
    queue, owner: OWNER, catalog, env: envFor(dir, { STUDIO_WHISPER_MODEL: model }),
    run: fakeWhisper(SIMPLE_DOC, () => { started = true; }),
  });
  assert.equal(started, false);
  assert.equal(report.lost.length, 1);
  assert.equal(catalog.writes.length, 0);
});

// ── The catch-up ────────────────────────────────────────────────────────────

test('backfill: the dry run lists the ready recording, --apply enqueues it once, a second --apply none', async (t) => {
  const queue = tmpQueue(t);
  const catalog = fakeCatalog([
    { id: 'img1962', localPath: '/cache/IMG_1962.MOV', deviceLane: 'iphone' },
    { id: 'plate_1', localPath: '/cache/PLATE.MOV', deviceLane: 'plate' },
    { id: 'done_1', localPath: '/cache/DONE.MOV', deviceLane: 'iphone' },
    { id: 'probing', localPath: '/cache/LATER.MOV', deviceLane: 'iphone', state: 'probed' },
  ]);
  catalog.transcripts.set('done_1', { state: 'done' });
  const scope = { projectId: PROJECT };

  const dry = await runBackfill({ queue, catalog, scope });
  assert.deepEqual(dry.plan.enqueue.map((e) => e.name), ['IMG_1962.MOV']);
  assert.equal(queue.listJobs({ stage: STAGE_TRANSCRIBE }).length, 0, 'the dry run writes nothing');

  const first = await runBackfill({ queue, catalog, scope, apply: true });
  assert.equal(first.enqueued.filter((e) => e.created).length, 1);
  assert.equal(queue.listJobs({ stage: STAGE_TRANSCRIBE }).length, 1);

  const second = await runBackfill({ queue, catalog, scope, apply: true });
  assert.equal(second.enqueued.length, 0);
  assert.equal(queue.listJobs({ stage: STAGE_TRANSCRIBE }).length, 1);
  assert.match(second.plan.skipped.find((s) => s.id === 'img1962').why, /already on the queue/);
});

test('backfill plan: plates and transcribed recordings are skipped with a reason, unready ones ignored', () => {
  const plan = planBackfill({
    sources: [
      { id: 'a', state: 'ready', deviceLane: 'plate' },
      { id: 'B', state: 'ready' },
      { id: 'c', state: 'downloaded' },
    ],
    transcribed: new Set(['b']),
    queued: new Set(),
  });
  assert.equal(plan.enqueue.length, 0);
  assert.deepEqual(plan.skipped.map((s) => s.why), ['a plate — plates are not transcribed', 'already has a transcript row']);
});

// ── The daemon ──────────────────────────────────────────────────────────────

test('the transcribe stage is registered, so a transcribe job is run rather than reported as unhandled', () => {
  assert.ok(STAGE_RUNNERS[STAGE_TRANSCRIBE], 'transcribe has a runner in workers/studio/daemon.js');
});
