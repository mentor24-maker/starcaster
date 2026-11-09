'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Task 86bcwzu4b — a save that fails for ONE recording must not loop forever,
 * and a save that fails for EVERY recording (an outage) must still cost the
 * recording nothing.
 *
 * Real SQLite queue, real files, fake whisper/ffmpeg (each run is counted),
 * fake catalog whose writes can be made to fail per source. The incident: a
 * 106-minute recording's transcript failed to save on every try for two days,
 * attempts stayed 0, and every 15-minute retry re-ran whisper first.
 */

const { openQueue } = require('../../workers/studio/queue.js');
const { runTranscribe, enqueueTranscribe, parseWhisperJson, STAGE_TRANSCRIBE } = require('../../workers/studio/transcribePass.js');
const { runCutMarks, enqueueCutMarks, STAGE_CUT_MARKS } = require('../../workers/studio/cutMarksPass.js');
const { SAVE_FAILURE_LIMIT, unsavedPath } = require('../../workers/studio/saveRetry.js');
const { describeFetchError, sbQuery } = require('../../lib/supabase.js');

const PROJECT = 'proj_studio';
const OWNER = 'save-retry-test';
const FIXTURE = path.join(__dirname, 'fixtures', 'studio-cut-marks');
const WHISPER_JSON = fs.readFileSync(path.join(FIXTURE, 'verbatim.json'), 'utf8');
const CLEAN_WORDS = parseWhisperJson(fs.readFileSync(path.join(FIXTURE, 'clean.json'), 'utf8')).words;
const SILENCE_STDERR = fs.readFileSync(path.join(FIXTURE, 'silencedetect.txt'), 'utf8');
const STAT_300S = () => ({ size: 44 + 300 * 32000 });
const UNREACHABLE = 'Could not reach Supabase: fetch failed ← caused by: UND_ERR_SOCKET other side closed';

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-save-retry-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A queue whose clock the test moves, so the 15-minute hold can be stepped over. */
function machine(t, sources) {
  const dir = tmpDir(t);
  const model = path.join(dir, 'model.bin');
  fs.writeFileSync(model, 'm');
  for (const id of sources) {
    const out = path.join(dir, 'derived', 'inbox', id);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'analysis-16k.wav'), Buffer.alloc(64));
  }
  const tmpRoot = path.join(dir, 'tmp');
  fs.mkdirSync(tmpRoot);
  let now = 1_800_000_000_000;
  const queue = openQueue(path.join(dir, 'queue.sqlite'), { clock: () => now });
  t.after(() => queue.close());
  const env = {
    STUDIO_PROJECT_ID: PROJECT,
    STUDIO_DERIVED_DIR: path.join(dir, 'derived'),
    STUDIO_WHISPER_BIN: 'whisper-cli',
    STUDIO_WHISPER_MODEL: model,
    STUDIO_FFMPEG: 'ffmpeg',
  };
  const wav = (id) => path.join(dir, 'derived', 'inbox', id, 'analysis-16k.wav');
  return { queue, env, tmpRoot, wav, later: () => { now += 16 * 60 * 1000; } };
}

/** Writes fail with `UNREACHABLE` for every source in `failing` (a Set the test edits). */
function fakeCatalog(sources, failing) {
  const transcripts = new Map();
  const cuts = new Map();
  const writes = [];
  const refuse = (id) => failing.has(id) || failing.has('*');
  return {
    transcripts,
    cuts,
    writes,
    getSourceById: async (id) => (sources.includes(id)
      ? { ok: true, status: 200, data: { id, projectId: PROJECT, state: 'ready', durationS: 300 } }
      : { ok: false, status: 404, error: 'Source not found' }),
    getTranscriptBySource: async (id) => ({ ok: true, status: 200, data: transcripts.has(id) ? { ...transcripts.get(id) } : null }),
    upsertTranscript: async (id, data) => {
      writes.push({ kind: 'transcript', id, state: data.state });
      if (refuse(id)) return { ok: false, status: 502, error: UNREACHABLE };
      const row = { sourceId: id, text: '', segments: [], words: [], ...data };
      transcripts.set(id, row);
      return { ok: true, status: 200, data: { ...row } };
    },
    getCutMarksBySource: async (id) => ({ ok: true, status: 200, data: cuts.has(id) ? { ...cuts.get(id) } : null }),
    upsertCutMarks: async (id, data) => {
      writes.push({ kind: 'cuts', id, state: data.state });
      if (refuse(id)) return { ok: false, status: 502, error: UNREACHABLE };
      const row = { sourceId: id, verbatimWords: [], marks: [], ...data };
      cuts.set(id, row);
      return { ok: true, status: 200, data: { ...row } };
    },
  };
}

/** whisper writes the fixture JSON where -of says; ffmpeg answers with the fixture's pauses. Both are counted. */
function fakeTools() {
  const calls = { whisper: 0, ffmpeg: 0 };
  const run = (bin, args) => {
    if (bin === 'whisper-cli') {
      calls.whisper += 1;
      fs.writeFileSync(`${args[args.indexOf('-of') + 1]}.json`, WHISPER_JSON);
      return { status: 0, stdout: '', stderr: '' };
    }
    if (bin === 'ffmpeg') {
      calls.ffmpeg += 1;
      return { status: 0, stdout: '', stderr: SILENCE_STDERR };
    }
    throw new Error(`unexpected tool ${bin}`);
  };
  return { run, calls };
}

const jobFor = (queue, stage, id) => queue.listJobs({ stage }).find((j) => j.subjectId === id);

async function transcribeNext(m, catalog, tools) {
  return runTranscribe({ queue: m.queue, owner: OWNER, catalog, env: m.env, run: tools.run, stat: STAT_300S, options: { tmpRoot: m.tmpRoot } });
}

// ── The log line names the cause ────────────────────────────────────────────

test('a failed fetch names the cause undici hides on err.cause, two levels deep, and never the query string', () => {
  const inner = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
  const mid = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET', cause: inner });
  const err = Object.assign(new TypeError('fetch failed'), { cause: mid });
  const said = describeFetchError(err);
  assert.match(said, /^fetch failed/);
  assert.match(said, /UND_ERR_SOCKET other side closed/);
  assert.match(said, /ECONNRESET read ECONNRESET/);
  assert.equal(describeFetchError(new Error('GET https://x.supabase.co/rest/v1/t?apikey=secret failed')).includes('secret'), false);
  assert.equal(describeFetchError(undefined), 'network error');
});

test('sbQuery puts the cause in "Could not reach Supabase"', async (t) => {
  const saved = { fetch: global.fetch, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_KEY };
  t.after(() => {
    global.fetch = saved.fetch;
    if (saved.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = saved.url;
    if (saved.key === undefined) delete process.env.SUPABASE_SERVICE_KEY; else process.env.SUPABASE_SERVICE_KEY = saved.key;
  });
  process.env.SUPABASE_URL = 'https://abcdefgh.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'sb_secret_test_value_long_enough_0123456789';
  global.fetch = async () => {
    throw Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('Headers Timeout Error'), { code: 'UND_ERR_HEADERS_TIMEOUT' }),
    });
  };
  const res = await sbQuery({ method: 'POST', table: 'video_transcripts', body: { a: 1 } });
  assert.equal(res.ok, false);
  assert.match(res.error, /^Could not reach Supabase: fetch failed ← caused by: UND_ERR_HEADERS_TIMEOUT Headers Timeout Error$/);
  assert.equal(res.error.includes('sb_secret'), false);
});

// ── One recording's fault vs an outage ──────────────────────────────────────

test(`the same source failing to save ${SAVE_FAILURE_LIMIT} times in a row while others save is charged to it and stops`, async (t) => {
  const sources = ['src_bad', 'src_1', 'src_2', 'src_3', 'src_4'];
  const m = machine(t, sources);
  const catalog = fakeCatalog(sources, new Set(['src_bad']));
  const tools = fakeTools();
  enqueueTranscribe(m.queue, { sourceId: 'src_bad' });

  for (let n = 1; n <= SAVE_FAILURE_LIMIT; n += 1) {
    const report = await transcribeNext(m, catalog, tools);
    const job = jobFor(m.queue, STAGE_TRANSCRIBE, 'src_bad');
    if (n < SAVE_FAILURE_LIMIT) {
      assert.equal(report.released.length, 1, `try ${n}: ${JSON.stringify(report, null, 2)}`);
      assert.equal(job.state, 'pending');
      assert.equal(job.attempts, 0, 'a release spends no attempt');
      assert.match(job.lastError, new RegExp(`failed save ${n} of ${SAVE_FAILURE_LIMIT} in a row`));
      assert.match(job.lastError, /UND_ERR_SOCKET other side closed/, 'the cause reaches the queue');
      // Another recording saves fine in between — the catalog was reachable.
      // The bad one is held for 15 minutes, so the good one is all that is due.
      enqueueTranscribe(m.queue, { sourceId: sources[n] });
      await transcribeNext(m, catalog, tools);
      assert.equal(jobFor(m.queue, STAGE_TRANSCRIBE, sources[n]).state, 'done');
    } else {
      assert.equal(report.blocked.length, 1, `try ${n}: ${JSON.stringify(report, null, 2)}`);
      assert.equal(job.state, 'blocked', 'charged to the file: it stops');
      assert.match(job.lastError, new RegExp(`failed ${SAVE_FAILURE_LIMIT} times in a row while other saves succeeded`));
      assert.match(job.lastError, /UND_ERR_SOCKET other side closed/);
      assert.match(job.lastError, /Fix:/);
    }
    m.later();
  }
  // Nothing left to claim for it: no forever.
  assert.equal(m.queue.claim(OWNER, { stages: [STAGE_TRANSCRIBE] }), null);
});

test('an outage that fails every source is still released free, however long it lasts', async (t) => {
  const sources = ['src_a', 'src_b'];
  const m = machine(t, sources);
  const catalog = fakeCatalog(sources, new Set(['*']));
  const tools = fakeTools();
  enqueueTranscribe(m.queue, { sourceId: 'src_a' });
  enqueueTranscribe(m.queue, { sourceId: 'src_b' });

  for (let n = 0; n < SAVE_FAILURE_LIMIT * 3; n += 1) {
    // One pass stops at the first outage, so two passes reach both sources.
    await transcribeNext(m, catalog, tools);
    await transcribeNext(m, catalog, tools);
    m.later();
  }
  for (const id of sources) {
    const job = jobFor(m.queue, STAGE_TRANSCRIBE, id);
    assert.equal(job.state, 'pending', `${id} is never charged for an outage`);
    assert.equal(job.attempts, 0, `${id} spent no attempt`);
    assert.match(job.lastError, /no other save has succeeded since the first/);
  }

  // The outage ends: both save, from what was kept.
  catalog.transcripts.clear();
  const whisperRuns = tools.calls.whisper;
  const failing = new Set();
  const healed = fakeCatalog(sources, failing);
  for (let n = 0; n < 2; n += 1) await transcribeNext(m, healed, tools);
  assert.equal(jobFor(m.queue, STAGE_TRANSCRIBE, 'src_a').state, 'done');
  assert.equal(jobFor(m.queue, STAGE_TRANSCRIBE, 'src_b').state, 'done');
  assert.equal(tools.calls.whisper, whisperRuns, 'the saves after the outage ran no whisper');
});

// ── A retry is a save, not another whisper ──────────────────────────────────

test('a retry after a failed save does not run whisper again, and the kept output is deleted once saved', async (t) => {
  const m = machine(t, ['src_1']);
  const failing = new Set(['src_1']);
  const catalog = fakeCatalog(['src_1'], failing);
  const tools = fakeTools();
  enqueueTranscribe(m.queue, { sourceId: 'src_1' });

  const first = await transcribeNext(m, catalog, tools);
  assert.equal(first.released.length, 1);
  assert.equal(tools.calls.whisper, 1);
  const kept = unsavedPath(m.wav('src_1'), STAGE_TRANSCRIBE);
  assert.ok(fs.existsSync(kept), 'whisper\'s output is kept beside the WAV');
  assert.match(jobFor(m.queue, STAGE_TRANSCRIBE, 'src_1').lastError, /kept at .*transcribe-unsaved\.json/);

  m.later();
  await transcribeNext(m, catalog, tools); // still failing
  assert.equal(tools.calls.whisper, 1, 'the second try re-tried the save, not the transcription');

  failing.clear();
  m.later();
  const third = await transcribeNext(m, catalog, tools);
  assert.equal(third.done.length, 1, JSON.stringify(third, null, 2));
  assert.equal(third.done[0].savedFromEarlierTry, kept);
  assert.equal(tools.calls.whisper, 1, 'whisper ran once in three tries');
  assert.equal(catalog.transcripts.get('src_1').state, 'done');
  assert.ok(catalog.transcripts.get('src_1').words.length > 0, 'the kept words are what was saved');
  assert.equal(fs.existsSync(kept), false, 'deleted after the save was read back');
  assert.equal(jobFor(m.queue, STAGE_CUT_MARKS, 'src_1').state, 'pending', 'and it still hands on to the cut marks');
});

test('kept output for a WAV that has since been remade is thrown away, and whisper runs again', async (t) => {
  const m = machine(t, ['src_1']);
  const failing = new Set(['src_1']);
  const catalog = fakeCatalog(['src_1'], failing);
  const tools = fakeTools();
  enqueueTranscribe(m.queue, { sourceId: 'src_1' });
  await transcribeNext(m, catalog, tools);
  failing.clear();
  m.later();
  const remade = () => ({ size: 44 + 301 * 32000 });
  const report = await runTranscribe({ queue: m.queue, owner: OWNER, catalog, env: m.env, run: tools.run, stat: remade, options: { tmpRoot: m.tmpRoot } });
  assert.equal(report.done.length, 1);
  assert.equal(tools.calls.whisper, 2);
});

// ── The cut-marks pass had the same loop ────────────────────────────────────

test('cut marks: a retry saves the kept cuts without whisper or ffmpeg, and a lone failing source is charged', async (t) => {
  const sources = ['src_bad', 'src_1', 'src_2', 'src_3', 'src_4'];
  const m = machine(t, sources);
  const failing = new Set(['src_bad']);
  const catalog = fakeCatalog(sources, failing);
  for (const id of sources) catalog.transcripts.set(id, { sourceId: id, state: 'done', text: 'x', words: CLEAN_WORDS });
  const tools = fakeTools();
  const cutNext = () => runCutMarks({ queue: m.queue, owner: OWNER, catalog, env: m.env, run: tools.run, stat: STAT_300S, options: { tmpRoot: m.tmpRoot } });
  enqueueCutMarks(m.queue, { sourceId: 'src_bad' });

  for (let n = 1; n <= SAVE_FAILURE_LIMIT; n += 1) {
    const report = await cutNext();
    if (n < SAVE_FAILURE_LIMIT) {
      assert.equal(report.released.length, 1, `try ${n}: ${JSON.stringify(report, null, 2)}`);
      assert.equal(tools.calls.whisper, 1 + (n - 1), 'whisper ran for the bad source once, and once per good one');
      enqueueCutMarks(m.queue, { sourceId: sources[n] });
      await cutNext();
      assert.equal(jobFor(m.queue, STAGE_CUT_MARKS, sources[n]).state, 'done');
    } else {
      assert.equal(report.blocked.length, 1, `try ${n}: ${JSON.stringify(report, null, 2)}`);
    }
    m.later();
  }
  const bad = jobFor(m.queue, STAGE_CUT_MARKS, 'src_bad');
  assert.equal(bad.state, 'blocked');
  assert.equal(bad.attempts, 0);
  assert.match(bad.lastError, /while other saves succeeded/);
  assert.equal(tools.calls.whisper, SAVE_FAILURE_LIMIT, 'one whisper for the bad source in all its tries, plus one per good source');
  assert.equal(tools.calls.ffmpeg, SAVE_FAILURE_LIMIT);
});
