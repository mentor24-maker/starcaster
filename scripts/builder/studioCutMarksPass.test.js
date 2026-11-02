'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Reel Spinner 1c (86bcwaw8c) — the cut-marks pass.
 *
 * Real SQLite queue and real files; the catalog is faked, as in
 * studioTranscribePass.test.js. whisper and ffmpeg are stood in for by the
 * REAL outputs 1b measured on the Mini (scripts/builder/fixtures/
 * studio-cut-marks/), so the success path runs 1b's rules on real speech
 * through the same readers production uses.
 */

const { openQueue, DEFAULT_LEASE_MS } = require('../../workers/studio/queue.js');
const {
  runTranscribe,
  enqueueTranscribe,
  parseWhisperJson,
  whisperTimeoutMs,
  STAGE_TRANSCRIBE,
} = require('../../workers/studio/transcribePass.js');
const {
  runCutMarks,
  enqueueCutMarks,
  leaseForCutMarks,
  silenceTimeoutMs,
  silencedetectArgs,
  STAGE_CUT_MARKS,
} = require('../../workers/studio/cutMarksPass.js');
const { VERBATIM_PROMPT, RULES_VERSION } = require('../../workers/studio/cutMarks.js');
const { marksOrError } = require('../../lib/videoCutMarksStore.js');
const { STAGE_RUNNERS } = require('../../workers/studio/daemon.js');
const { runBackfill, planBackfill } = require('../studio_backfill_cuts.cjs');

const PROJECT = 'proj_studio';
const OWNER = 'cut-marks-test';
const FIXTURE = path.join(__dirname, 'fixtures', 'studio-cut-marks');
const VERBATIM_JSON = fs.readFileSync(path.join(FIXTURE, 'verbatim.json'), 'utf8');
const CLEAN_WORDS = parseWhisperJson(fs.readFileSync(path.join(FIXTURE, 'clean.json'), 'utf8')).words;
const SILENCE_STDERR = fs.readFileSync(path.join(FIXTURE, 'silencedetect.txt'), 'utf8');

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-cuts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function tmpQueue(t, options) {
  const queue = openQueue(path.join(tmpDir(t), 'queue.sqlite'), options);
  t.after(() => queue.close());
  return queue;
}

/** A model file, a WAV, and the settings that point at them. */
function machine(t, { wav = true } = {}) {
  const dir = tmpDir(t);
  const model = path.join(dir, 'model.bin');
  fs.writeFileSync(model, 'm');
  if (wav) {
    const out = path.join(dir, 'derived', 'inbox', 'src_1');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'analysis-16k.wav'), Buffer.alloc(64));
  }
  const tmpRoot = path.join(dir, 'tmp');
  fs.mkdirSync(tmpRoot);
  const env = {
    STUDIO_PROJECT_ID: PROJECT,
    STUDIO_DERIVED_DIR: path.join(dir, 'derived'),
    STUDIO_WHISPER_BIN: 'whisper-cli',
    STUDIO_WHISPER_MODEL: model,
    STUDIO_FFMPEG: 'ffmpeg',
  };
  return { dir, env, tmpRoot };
}

function fakeCatalog({ transcript = { state: 'done', words: CLEAN_WORDS } } = {}) {
  const sources = [{ id: 'src_1', projectId: PROJECT, state: 'ready', durationS: 300, localPath: '/cache/ZOOM.mp4' }];
  const transcripts = new Map(transcript ? [['src_1', { sourceId: 'src_1', text: 'x', ...transcript }]] : []);
  const cuts = new Map();
  const writes = [];
  return {
    sources,
    transcripts,
    cuts,
    writes,
    getSourceById: async (id) => {
      const found = sources.find((s) => s.id === id);
      return found ? { ok: true, status: 200, data: { ...found } } : { ok: false, status: 404, error: 'Source not found' };
    },
    getTranscriptBySource: async (id) => ({ ok: true, status: 200, data: transcripts.has(id) ? { ...transcripts.get(id) } : null }),
    upsertTranscript: async (id, data) => {
      const row = { sourceId: id, text: '', segments: [], words: [], ...data };
      transcripts.set(id, row);
      return { ok: true, status: 200, data: { ...row } };
    },
    upsertCutMarks: async (id, data) => {
      // The store's own check on the marks, so a shape the store would refuse fails here too.
      const checked = marksOrError(data.marks);
      if (!checked.ok) return checked;
      if (data.state === 'failed' && !data.reason) return { ok: false, status: 400, error: 'reason is required when state is failed' };
      writes.push({ id, data });
      const row = { sourceId: id, verbatimWords: [], ...data, marks: checked.value };
      cuts.set(id, row);
      return { ok: true, status: 200, data: { ...row } };
    },
    getCutMarksBySource: async (id) => ({ ok: true, status: 200, data: cuts.has(id) ? { ...cuts.get(id) } : null }),
    listSources: async () => ({ ok: true, status: 200, data: sources.map((s) => ({ ...s })) }),
    listTranscriptStates: async (ids) => {
      const out = {};
      for (const id of ids) if (transcripts.has(id)) out[id.toLowerCase()] = { state: transcripts.get(id).state };
      return { ok: true, status: 200, data: out };
    },
    listCutMarkStates: async (ids) => {
      const out = {};
      for (const id of ids) if (cuts.has(id)) out[id.toLowerCase()] = { state: cuts.get(id).state };
      return { ok: true, status: 200, data: out };
    },
  };
}

/**
 * A spawnSync stand-in for both tools: whisper writes the measured verbatim
 * JSON where -of says, ffmpeg answers with the measured silencedetect stderr.
 */
function fakeTools({ whisper, ffmpeg, onRun = () => {} } = {}) {
  const calls = [];
  const run = (bin, args) => {
    calls.push({ bin, args });
    onRun(bin, args);
    if (bin === 'whisper-cli') {
      if (whisper) return whisper(args);
      fs.writeFileSync(`${args[args.indexOf('-of') + 1]}.json`, VERBATIM_JSON);
      return { status: 0, stdout: '', stderr: '' };
    }
    if (bin === 'ffmpeg') {
      if (ffmpeg) return ffmpeg(args);
      return { status: 0, stdout: '', stderr: SILENCE_STDERR };
    }
    throw new Error(`unexpected tool ${bin}`);
  };
  return { run, calls };
}

/** The fixture is 300 s of audio; the placeholder WAV is 64 bytes, so report the real size. */
const STAT_300S = () => ({ size: 44 + 300 * 32000 });

const ENOENT = () => ({ error: Object.assign(new Error('spawnSync ENOENT'), { code: 'ENOENT' }) });

// ── The handoff from transcription ──────────────────────────────────────────

/** A transcription job, run with a fake whisper that writes the given JSON. */
async function transcribeOnce(t, whisperDoc) {
  const { env, tmpRoot } = machine(t);
  const queue = tmpQueue(t);
  const catalog = fakeCatalog({ transcript: null });
  enqueueTranscribe(queue, { sourceId: 'src_1' });
  const run = (bin, args) => {
    fs.writeFileSync(`${args[args.indexOf('-of') + 1]}.json`, JSON.stringify(whisperDoc));
    return { status: 0, stdout: '', stderr: '' };
  };
  const report = await runTranscribe({ queue, owner: OWNER, catalog, env, run, tmpRoot });
  return { queue, catalog, report };
}

test('a DONE transcript puts one cut_marks job on the queue for that source', async (t) => {
  const doc = { result: { language: 'en' }, transcription: [{ offsets: { from: 0, to: 1500 }, text: ' Hello there.',
    tokens: [{ text: ' Hello', t_dtw: 10 }, { text: ' there', t_dtw: 60 }] }] };
  const { queue, report } = await transcribeOnce(t, doc);
  assert.equal(report.done.length, 1, JSON.stringify(report, null, 2));
  assert.equal(report.done[0].cutMarks, 'cut marks queued');
  const jobs = queue.listJobs({ stage: STAGE_CUT_MARKS });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].subjectId, 'src_1');
  assert.match(jobs[0].payload.wavPath, /inbox\/src_1\/analysis-16k\.wav$/);

  // A second enqueue for the same source is the same job, not a second one.
  const again = enqueueCutMarks(queue, { sourceId: 'src_1' });
  assert.equal(again.created, false);
  assert.equal(queue.listJobs({ stage: STAGE_CUT_MARKS }).length, 1);
});

test('a NO_AUDIO transcript enqueues nothing', async (t) => {
  const { env, tmpRoot } = machine(t, { wav: false });
  fs.mkdirSync(path.join(env.STUDIO_DERIVED_DIR, 'inbox', 'src_1'), { recursive: true });
  fs.writeFileSync(path.join(env.STUDIO_DERIVED_DIR, 'inbox', 'src_1', 'derivatives.json'),
    JSON.stringify({ outputs: { audio: { action: 'skipped', reason: 'source_has_no_audio_track' } } }));
  const queue = tmpQueue(t);
  const catalog = fakeCatalog({ transcript: null });
  enqueueTranscribe(queue, { sourceId: 'src_1' });
  const report = await runTranscribe({ queue, owner: OWNER, catalog, env, tmpRoot });
  assert.equal(report.noAudio.length, 1, JSON.stringify(report, null, 2));
  assert.equal(queue.listJobs({ stage: STAGE_CUT_MARKS }).length, 0);
});

test('a FAILED transcript enqueues nothing', async (t) => {
  const { env, tmpRoot } = machine(t);
  const queue = tmpQueue(t);
  const catalog = fakeCatalog({ transcript: null });
  enqueueTranscribe(queue, { sourceId: 'src_1' });
  const run = () => ({ status: 3, stdout: '', stderr: 'error: failed to read audio data as wav' });
  const report = await runTranscribe({ queue, owner: OWNER, catalog, env, run, tmpRoot });
  assert.equal(report.failed.length, 1, JSON.stringify(report, null, 2));
  assert.equal(queue.listJobs({ stage: STAGE_CUT_MARKS }).length, 0);
});

// ── The real thing, on the measured fixture ─────────────────────────────────

test('real speech: the verbatim whisper and silencedetect run, and 1b\'s marks are written and read back', async (t) => {
  const { env, tmpRoot } = machine(t);
  const queue = tmpQueue(t);
  const catalog = fakeCatalog();
  enqueueCutMarks(queue, { sourceId: 'src_1' });
  const tools = fakeTools();

  const report = await runCutMarks({ queue, owner: OWNER, catalog, env, run: tools.run, stat: STAT_300S, options: { tmpRoot } });
  assert.equal(report.done.length, 1, JSON.stringify(report, null, 2));
  assert.equal(queue.listJobs({ stage: STAGE_CUT_MARKS })[0].state, 'done');

  const whisperCall = tools.calls.find((c) => c.bin === 'whisper-cli');
  assert.equal(whisperCall.args[whisperCall.args.indexOf('--prompt') + 1], VERBATIM_PROMPT, 'the VERBATIM whisper ran');
  const ffmpegCall = tools.calls.find((c) => c.bin === 'ffmpeg');
  assert.ok(ffmpegCall.args.some((a) => /^silencedetect=noise=-35dB:d=1/.test(a)));
  assert.ok(!ffmpegCall.args.includes('-loglevel'), 'silencedetect reports on stderr at the default level');

  const row = catalog.cuts.get('src_1');
  assert.equal(row.state, 'done');
  assert.equal(row.rulesVersion, RULES_VERSION);
  assert.equal(row.model, 'model');
  assert.equal(row.verbatimWords.length, 804, 'the measured verbatim transcript, read by the production reader');
  const kinds = new Set(row.marks.map((m) => m.kind));
  assert.ok(kinds.has('filler') && kinds.has('pause'), `expected fillers and pauses, got ${[...kinds]}`);
  assert.match(report.done[0].reason, /mark\(s\) \(.*filler.*\), [\d.]+ s to cut/);

  assert.deepEqual(fs.readdirSync(tmpRoot), [], 'whisper\'s temporary JSON is deleted');
});

test('a transcript with no words is marked done with nothing cut, and neither tool runs', async (t) => {
  const { env, tmpRoot } = machine(t);
  const queue = tmpQueue(t);
  const catalog = fakeCatalog({ transcript: { state: 'done', words: [] } });
  enqueueCutMarks(queue, { sourceId: 'src_1' });
  const tools = fakeTools();
  const report = await runCutMarks({ queue, owner: OWNER, catalog, env, run: tools.run, stat: STAT_300S, options: { tmpRoot } });
  assert.equal(report.done.length, 1, JSON.stringify(report, null, 2));
  assert.equal(tools.calls.length, 0);
  assert.deepEqual(catalog.cuts.get('src_1').marks, []);
  assert.match(catalog.cuts.get('src_1').reason, /no words/);
});

// ── Machine faults: released, nothing spent, nothing written ────────────────

for (const [label, tools] of [
  ['whisper NOT INSTALLED', () => fakeTools({ whisper: ENOENT })],
  ['ffmpeg NOT INSTALLED', () => fakeTools({ ffmpeg: ENOENT })],
]) {
  test(`${label}: the job is released with no attempt spent and no row written`, async (t) => {
    const { env, tmpRoot } = machine(t);
    const queue = tmpQueue(t);
    const catalog = fakeCatalog();
    enqueueCutMarks(queue, { sourceId: 'src_1' });
    const report = await runCutMarks({ queue, owner: OWNER, catalog, env, run: tools().run, stat: STAT_300S, options: { tmpRoot } });
    assert.equal(report.released.length, 1, JSON.stringify(report, null, 2));
    assert.equal(catalog.writes.length, 0);
    const job = queue.listJobs({ stage: STAGE_CUT_MARKS })[0];
    assert.equal(job.state, 'pending');
    assert.equal(job.attempts, 0);
    assert.match(job.lastError, /not installed or not on PATH/);
  });
}

test('the MODEL missing is the machine\'s fault: released, attempts 0, no tool started', async (t) => {
  const { env, tmpRoot, dir } = machine(t);
  const queue = tmpQueue(t);
  const catalog = fakeCatalog();
  enqueueCutMarks(queue, { sourceId: 'src_1' });
  const tools = fakeTools();
  const report = await runCutMarks({
    queue, owner: OWNER, catalog, env: { ...env, STUDIO_WHISPER_MODEL: path.join(dir, 'nope.bin') }, run: tools.run, options: { tmpRoot },
  });
  assert.equal(report.released.length, 1);
  assert.equal(tools.calls.length, 0);
  assert.equal(catalog.writes.length, 0);
  assert.equal(queue.listJobs({ stage: STAGE_CUT_MARKS })[0].attempts, 0);
});

test('the catalog unreachable is the machine\'s fault: released, no row', async (t) => {
  const { env, tmpRoot } = machine(t);
  const queue = tmpQueue(t);
  const catalog = fakeCatalog();
  catalog.getTranscriptBySource = async () => ({ ok: false, status: 503, error: 'fetch failed' });
  enqueueCutMarks(queue, { sourceId: 'src_1' });
  const report = await runCutMarks({ queue, owner: OWNER, catalog, env, run: fakeTools().run, stat: STAT_300S, options: { tmpRoot } });
  assert.equal(report.released.length, 1);
  assert.equal(catalog.writes.length, 0);
  assert.equal(queue.listJobs({ stage: STAGE_CUT_MARKS })[0].attempts, 0);
});

// ── The file's faults: a failed row with the reason ─────────────────────────

test('whisper failing on the file writes a FAILED row with its reason and fails the job through retries', async (t) => {
  const { env, tmpRoot } = machine(t);
  const queue = tmpQueue(t);
  const catalog = fakeCatalog();
  enqueueCutMarks(queue, { sourceId: 'src_1' });
  const tools = fakeTools({ whisper: () => ({ status: 3, stdout: '', stderr: 'error: failed to read audio data as wav' }) });
  const report = await runCutMarks({ queue, owner: OWNER, catalog, env, run: tools.run, stat: STAT_300S, options: { tmpRoot } });
  assert.equal(report.failed.length, 1, JSON.stringify(report, null, 2));
  const row = catalog.cuts.get('src_1');
  assert.equal(row.state, 'failed');
  assert.match(row.reason, /word-for-word whisper pass .*whisper exited 3: error: failed to read audio data/);
  const job = queue.listJobs({ stage: STAGE_CUT_MARKS })[0];
  assert.equal(job.state, 'pending', "through the queue's retry rules, not dropped");
  assert.equal(job.attempts, 1);
  assert.deepEqual(fs.readdirSync(tmpRoot), []);
});

test('ffmpeg failing on the file writes a FAILED row naming ffmpeg\'s complaint', async (t) => {
  const { env, tmpRoot } = machine(t);
  const queue = tmpQueue(t);
  const catalog = fakeCatalog();
  enqueueCutMarks(queue, { sourceId: 'src_1' });
  const tools = fakeTools({ ffmpeg: () => ({ status: 1, stdout: '', stderr: 'analysis-16k.wav: Invalid data found when processing input' }) });
  const report = await runCutMarks({ queue, owner: OWNER, catalog, env, run: tools.run, stat: STAT_300S, options: { tmpRoot } });
  assert.equal(report.failed.length, 1, JSON.stringify(report, null, 2));
  assert.match(catalog.cuts.get('src_1').reason, /could not listen for pauses.*Invalid data found/);
});

test('a WAV missing from disk is a FAILED row naming the fix', async (t) => {
  const { env, tmpRoot } = machine(t, { wav: false });
  const queue = tmpQueue(t);
  const catalog = fakeCatalog();
  enqueueCutMarks(queue, { sourceId: 'src_1' });
  const report = await runCutMarks({ queue, owner: OWNER, catalog, env, run: fakeTools().run, stat: STAT_300S, options: { tmpRoot } });
  assert.equal(report.failed.length, 1);
  assert.match(catalog.cuts.get('src_1').reason, /not on disk at .*analysis-16k\.wav.*re-run the proxy step/);
});

// ── The read-back ───────────────────────────────────────────────────────────

test('cut marks that "save" but do not stick are caught by the read-back and the job is blocked', async (t) => {
  const { env, tmpRoot } = machine(t);
  const queue = tmpQueue(t);
  const catalog = fakeCatalog();
  catalog.upsertCutMarks = async () => ({ ok: true, status: 200, data: {} }); // 200, stores nothing
  enqueueCutMarks(queue, { sourceId: 'src_1' });
  const report = await runCutMarks({ queue, owner: OWNER, catalog, env, run: fakeTools().run, stat: STAT_300S, options: { tmpRoot } });
  assert.equal(report.blocked.length, 1, JSON.stringify(report, null, 2));
  assert.match(report.blocked[0].reason, /read back as "nothing"/);
  assert.equal(queue.listJobs({ stage: STAGE_CUT_MARKS })[0].state, 'blocked');
});

test('a read-back with different marks is blocked too, not completed', async (t) => {
  const { env, tmpRoot } = machine(t);
  const queue = tmpQueue(t);
  const catalog = fakeCatalog();
  const realGet = catalog.getCutMarksBySource;
  catalog.getCutMarksBySource = async (id) => {
    const res = await realGet(id);
    return { ...res, data: { ...res.data, marks: res.data.marks.slice(1) } }; // one mark lost
  };
  enqueueCutMarks(queue, { sourceId: 'src_1' });
  const report = await runCutMarks({ queue, owner: OWNER, catalog, env, run: fakeTools().run, stat: STAT_300S, options: { tmpRoot } });
  assert.equal(report.blocked.length, 1, JSON.stringify(report, null, 2));
});

test('a source whose transcript is not done is blocked with the reason, not marked', async (t) => {
  const { env, tmpRoot } = machine(t);
  const queue = tmpQueue(t);
  const catalog = fakeCatalog({ transcript: { state: 'failed', reason: 'x' } });
  enqueueCutMarks(queue, { sourceId: 'src_1' });
  const report = await runCutMarks({ queue, owner: OWNER, catalog, env, run: fakeTools().run, stat: STAT_300S, options: { tmpRoot } });
  assert.equal(report.blocked.length, 1);
  assert.match(report.blocked[0].reason, /no finished transcript \(it reads "failed"\)/);
  assert.equal(catalog.writes.length, 0);
});

// ── The lease ───────────────────────────────────────────────────────────────

test('a long cut-marks job keeps its job while both tools run', async (t) => {
  const { env, tmpRoot } = machine(t);
  let now = 1_000_000;
  const queue = tmpQueue(t, { clock: () => now });
  const catalog = fakeCatalog();
  catalog.sources[0].durationS = 3226;
  enqueueCutMarks(queue, { sourceId: 'src_1' });
  let stolen = null;
  const tools = fakeTools({
    onRun: (bin) => {
      if (bin !== 'ffmpeg') return;
      now += DEFAULT_LEASE_MS * 4;
      queue.reap();
      stolen = queue.claim('another-worker', { stages: [STAGE_CUT_MARKS] });
    },
  });
  const stat = () => ({ size: 44 + 3226 * 32000 });
  const report = await runCutMarks({ queue, owner: OWNER, catalog, env, run: tools.run, stat, options: { tmpRoot } });
  assert.equal(stolen, null, 'the job was not handed out again while the tools ran');
  assert.equal(report.done.length, 1, JSON.stringify(report, null, 2));
});

test('the lease covers both tools\' whole timeouts', () => {
  assert.ok(leaseForCutMarks(3600) > whisperTimeoutMs(3600) + silenceTimeoutMs(3600));
  assert.ok(silenceTimeoutMs(null) >= 5 * 60 * 1000, 'an unknown length still gets the floor');
  assert.deepEqual(silencedetectArgs('/a.wav').slice(-3), ['-f', 'null', '-'], 'silencedetect writes no file');
});

// ── The catch-up ────────────────────────────────────────────────────────────

test('backfill: the dry run lists the transcribed recording, --apply enqueues it once, a second --apply none', async (t) => {
  const queue = tmpQueue(t);
  const catalog = fakeCatalog();
  catalog.sources.push(
    { id: 'marked', localPath: '/cache/MARKED.MOV', state: 'ready' },
    { id: 'silent', localPath: '/cache/SILENT.MOV', state: 'ready' },
    { id: 'untranscribed', localPath: '/cache/LATER.MOV', state: 'ready' },
  );
  catalog.transcripts.set('marked', { state: 'done' });
  catalog.transcripts.set('silent', { state: 'no_audio' });
  catalog.cuts.set('marked', { state: 'done' });
  const scope = { projectId: PROJECT };

  const dry = await runBackfill({ queue, catalog, scope });
  assert.deepEqual(dry.plan.enqueue.map((e) => e.name), ['ZOOM.mp4']);
  assert.deepEqual(dry.counts, { transcribed: 2, done: 1, failed: 0, missing: 1 });
  assert.equal(queue.listJobs({ stage: STAGE_CUT_MARKS }).length, 0, 'the dry run writes nothing');

  const first = await runBackfill({ queue, catalog, scope, apply: true });
  assert.equal(first.enqueued.filter((e) => e.created).length, 1);
  assert.equal(queue.listJobs({ stage: STAGE_CUT_MARKS }).length, 1);

  const second = await runBackfill({ queue, catalog, scope, apply: true });
  assert.equal(second.enqueued.length, 0);
  assert.equal(queue.listJobs({ stage: STAGE_CUT_MARKS }).length, 1);
  assert.match(second.plan.skipped.find((s) => s.id === 'src_1').why, /already on the queue/);
});

test('backfill plan: a failed cut-marks row is a row (skipped with its state); unfinished transcripts are ignored', () => {
  const plan = planBackfill({
    sources: [{ id: 'A' }, { id: 'b' }, { id: 'c' }],
    transcripts: new Map([['a', 'done'], ['b', 'failed']]),
    marked: new Map([['a', 'failed']]),
    queued: new Set(),
  });
  assert.equal(plan.enqueue.length, 0);
  assert.deepEqual(plan.skipped.map((s) => s.why), ['already has a cut-marks row (failed)']);
});

// ── The daemon ──────────────────────────────────────────────────────────────

test('the cut_marks stage is registered, and AFTER transcribe so a backlog never delays new transcriptions', () => {
  assert.ok(STAGE_RUNNERS[STAGE_CUT_MARKS], 'cut_marks has a runner in workers/studio/daemon.js');
  const order = Object.keys(STAGE_RUNNERS);
  assert.ok(order.indexOf(STAGE_CUT_MARKS) > order.indexOf(STAGE_TRANSCRIBE));
});
