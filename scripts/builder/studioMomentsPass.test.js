'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Reel Spinner 2d (SC-829) — the moments pass on the Mini.
 *
 * Real SQLite queue, real scoring rules (moments.js) on the REAL recording 2c
 * measured (fixtures/studio-moments/recording.json) and its model answer.
 * Faked: the catalog, the notes reader, and the AI door's answer — the door is
 * stood in for at `scoreMoments`' own seam, so the pass sees exactly the
 * shapes `generate()` returns. No test touches the network or the bus.
 */

const { openQueue } = require('../../workers/studio/queue.js');
const {
  runMoments,
  enqueueMoments,
  watchRescores,
  machineFaultReason,
  describeSpend,
  STAGE_MOMENTS,
  MACHINE_HOLD_MS,
} = require('../../workers/studio/momentsPass.js');
const { scoreMoments, NO_BRIEF_REASON, RULES_VERSION } = require('../../workers/studio/moments.js');
const { momentsOrError } = require('../../lib/videoMomentsStore.js');
const { runBackfill, planBackfill } = require('../studio_backfill_moments.cjs');

const PROJECT = 'proj_studio';
const OWNER = 'moments-test';
const FIXTURE = path.join(__dirname, 'fixtures', 'studio-moments');
const recording = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'recording.json'), 'utf8'));
const replyText = fs.readFileSync(path.join(FIXTURE, 'reply.txt'), 'utf8');
const SRC = recording.sourceId;
const ENV = { STUDIO_PROJECT_ID: PROJECT };
const T0 = Date.parse('2026-11-18T20:00:00Z');

const BRIEF_TEXT = 'the purpose of this channel is to attract collaborators to my various projects, especially WaveCenter and the DEO movement.';

function tmpQueue(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-moments-'));
  const queue = openQueue(path.join(dir, 'queue.sqlite'), options);
  t.after(() => { queue.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return queue;
}

/** A clock the test moves, shared by the queue and the pass. */
function clock(start = T0) {
  let at = start;
  return { now: () => at, advance: (ms) => { at += ms; } };
}

function fakeCatalog({ cuts = 'done', rescoreAt = '' } = {}) {
  const moments = new Map();
  const writes = [];
  if (rescoreAt) {
    moments.set(SRC, { sourceId: SRC, status: 'done', moments: [], briefFingerprint: 'fp-old', rulesVersion: RULES_VERSION, rescoreRequestedAt: rescoreAt });
  }
  return {
    moments,
    writes,
    getSourceById: async (id) => (id === SRC
      ? { ok: true, status: 200, data: { id: SRC, projectId: PROJECT, durationS: recording.durationS } }
      : { ok: false, status: 404, error: 'Source not found' }),
    getTranscriptBySource: async () => ({ ok: true, status: 200, data: { state: 'done', words: recording.words } }),
    getCutMarksBySource: async () => ({
      ok: true,
      status: 200,
      data: cuts ? { state: cuts, marks: recording.marks, durationS: recording.durationS } : null,
    }),
    // The store's own checks, and its conditional clear of the rescore stamp.
    upsertMoments: async (id, data) => {
      const checked = momentsOrError(data.moments);
      if (!checked.ok) return checked;
      if (data.status === 'failed' && !data.error) return { ok: false, status: 400, error: 'error is required when status is failed' };
      if (!data.runStartedAt) return { ok: false, status: 400, error: 'runStartedAt is required' };
      writes.push({ id, data });
      const old = moments.get(id);
      const stamp = old && old.rescoreRequestedAt && Date.parse(old.rescoreRequestedAt) <= Date.parse(data.runStartedAt)
        ? '' : (old && old.rescoreRequestedAt) || '';
      const row = { sourceId: id, ...data, moments: checked.value, rescoreRequestedAt: stamp };
      moments.set(id, row);
      return { ok: true, status: 200, data: { ...row } };
    },
    getMomentsBySource: async (id) => ({ ok: true, status: 200, data: moments.has(id) ? { ...moments.get(id) } : null }),
    listRescoreRequests: async () => ({
      ok: true,
      status: 200,
      data: [...moments.values()].filter((r) => r.rescoreRequestedAt)
        .map((r) => ({ sourceId: r.sourceId, rescoreRequestedAt: r.rescoreRequestedAt })),
    }),
    listSources: async () => ({ ok: true, status: 200, data: [{ id: SRC, localPath: '/cache/IMG_0042.MOV' }] }),
    listCutMarkStates: async (ids) => {
      const out = {};
      for (const id of ids) if (id === SRC && cuts) out[id.toLowerCase()] = { state: cuts };
      return { ok: true, status: 200, data: out };
    },
    listMomentStates: async (ids) => {
      const out = {};
      for (const id of ids) if (moments.has(id)) out[id.toLowerCase()] = { status: moments.get(id).status };
      return { ok: true, status: 200, data: out };
    },
  };
}

const brief = (fingerprint = 'fp-v2', textValue = BRIEF_TEXT) => async (args) => {
  assert.deepEqual(args, { projectId: PROJECT, use: 'reel-spinner' }, 'notes read for this project, for Reel Spinner');
  return {
    ok: true,
    status: 200,
    data: { text: textValue, fingerprint, entries: [], unreadable: [], reason: textValue ? '' : 'No Context entry in this project is switched on for Reel Spinner.' },
  };
};

/** The real rules, with the AI door's answer stood in for. */
function scorer(answers) {
  const calls = [];
  const queue = Array.isArray(answers) ? [...answers] : null;
  const score = (input, deps) => scoreMoments(input, {
    ...deps,
    query: async (system, user, options) => {
      calls.push({ system, user, options });
      const next = queue ? queue.shift() : answers;
      return typeof next === 'function' ? next() : next;
    },
  });
  return { score, calls };
}

const ANSWERED = {
  ok: true,
  text: replyText,
  provider: 'anthropic',
  providerLabel: 'Anthropic',
  model: 'anthropic/claude-sonnet-5-5',
  usage: { promptTokens: 31000, completionTokens: 2400, cachedTokens: 0 },
  stopReason: 'end_turn',
};
const NO_PROVIDER = {
  ok: false,
  code: 'no_provider',
  error: 'No AI provider could answer. Anthropic: credit balance too low; OpenAI: no key set (add OPENAI_API_KEY).',
  skipped: [
    { provider: 'anthropic', label: 'Anthropic', verdict: 'OUT OF CREDIT', reason: 'credit balance too low' },
    { provider: 'openai', label: 'OpenAI', verdict: 'NOT SET', reason: 'no key set (add OPENAI_API_KEY)' },
  ],
};

function alarms() {
  const posted = [];
  let cleared = 0;
  return {
    posted,
    cleared: () => cleared,
    alarm: (reason) => { posted.push(reason); return { said: 'posted' }; },
    clearAlarm: () => { cleared += 1; },
  };
}

async function pass(queue, catalog, extra = {}) {
  return runMoments({ queue, owner: OWNER, catalog, env: ENV, readBrief: brief(), ...extra });
}

// ── The success path ────────────────────────────────────────────────────────

test('a scored recording is written with the brief\'s fingerprint, read back, and the job completes', async (t) => {
  const c = clock();
  const queue = tmpQueue(t, { clock: c.now });
  const catalog = fakeCatalog();
  const bus = alarms();
  const ai = scorer(ANSWERED);
  enqueueMoments(queue, { sourceId: SRC });

  const report = await pass(queue, catalog, { score: ai.score, readBrief: brief('fp-v2'), now: c.now, ...bus });
  assert.equal(report.done.length, 1, JSON.stringify(report, null, 2));
  assert.equal(ai.calls.length, 1);
  assert.ok(ai.calls[0].system.includes(BRIEF_TEXT), 'Dane\'s notes, word for word, in the prompt');
  assert.equal(ai.calls[0].options.feature, 'studio_reel_moments');

  const row = catalog.moments.get(SRC);
  assert.equal(row.status, 'done');
  assert.equal(row.moments.length, 5);
  assert.equal(row.briefFingerprint, 'fp-v2', 'the row says which version of the notes it was scored against');
  assert.equal(row.rulesVersion, RULES_VERSION);
  assert.equal(row.model, 'anthropic/claude-sonnet-5-5', 'which provider answered, and its model');
  assert.equal(row.runStartedAt, new Date(T0).toISOString());
  assert.ok(row.summary.length > 20);
  assert.equal(queue.listJobs({ stage: STAGE_MOMENTS })[0].state, 'done');
  assert.equal(bus.cleared(), 1, 'a score clears the alarm stamp, so the next stoppage is news at once');
  assert.deepEqual(bus.posted, []);
  assert.match(report.done[0].reason, /5 moment\(s\) — anthropic\/claude-sonnet-5-5, 31000 in \/ 2400 out, \$0\.0860/);
});

test('changing the notes does NOT rescore by itself: the row keeps the fingerprint it was scored against', async (t) => {
  const c = clock();
  const queue = tmpQueue(t, { clock: c.now });
  const catalog = fakeCatalog();
  const ai = scorer(ANSWERED);
  enqueueMoments(queue, { sourceId: SRC });
  await pass(queue, catalog, { score: ai.score, readBrief: brief('fp-v2'), now: c.now, ...alarms() });

  // Dane edits his notes. Nothing asks for a rescore.
  c.advance(10 * 60 * 1000);
  const watched = await watchRescores({ queue, env: ENV, catalog });
  assert.equal(watched.processed.length, 0);
  const again = await pass(queue, catalog, { score: ai.score, readBrief: brief('fp-v3'), now: c.now, ...alarms() });
  assert.equal(again.done.length + again.failed.length, 0, 'no job, no call, no spend');
  assert.equal(ai.calls.length, 1);
  assert.equal(catalog.moments.get(SRC).briefFingerprint, 'fp-v2', 'still visibly scored against the old notes');
});

// ── The machine's faults: no attempt, no row, the bus told once ─────────────

test('no AI provider able to pay: released for an hour, no attempt, no row, the alarm names each provider', async (t) => {
  const c = clock();
  const queue = tmpQueue(t, { clock: c.now });
  const catalog = fakeCatalog();
  const bus = alarms();
  const ai = scorer(NO_PROVIDER);
  enqueueMoments(queue, { sourceId: SRC });

  const report = await pass(queue, catalog, { score: ai.score, now: c.now, ...bus });
  assert.equal(report.released.length, 1, JSON.stringify(report, null, 2));
  assert.equal(catalog.writes.length, 0, 'no row: this is not a verdict on the recording');
  const job = queue.listJobs({ stage: STAGE_MOMENTS })[0];
  assert.equal(job.state, 'pending');
  assert.equal(job.attempts, 0, 'no attempt spent');
  assert.equal(job.runAfter, T0 + MACHINE_HOLD_MS, 'waits an hour');
  assert.deepEqual(bus.posted, [
    'Reel Spinner scoring is stopped: no AI provider can pay. Anthropic: out of credit. OpenAI: no key.',
  ]);
  assert.match(job.lastError, /^Reel Spinner scoring is stopped: no AI provider can pay\./);
  assert.equal(bus.cleared(), 0);
});

test('no network at all is the machine\'s fault too; a TIMEOUT is not (it spends an attempt)', async (t) => {
  const c = clock();
  const queue = tmpQueue(t, { clock: c.now });
  const catalog = fakeCatalog();
  const bus = alarms();
  enqueueMoments(queue, { sourceId: SRC });
  const offline = scorer({ ok: false, code: 'no_answer', error: 'Anthropic did not answer: fetch failed' });
  const first = await pass(queue, catalog, { score: offline.score, now: c.now, ...bus });
  assert.equal(first.released.length, 1);
  assert.equal(queue.listJobs({ stage: STAGE_MOMENTS })[0].attempts, 0);
  assert.match(bus.posted[0], /could not reach any AI provider .*fetch failed/);

  c.advance(MACHINE_HOLD_MS);
  const slow = scorer({ ok: false, code: 'no_answer', error: 'Anthropic did not answer: no answer within 180s' });
  const second = await pass(queue, catalog, { score: slow.score, now: c.now, ...bus });
  assert.equal(second.failed.length, 1, JSON.stringify(second, null, 2));
  const job = queue.listJobs({ stage: STAGE_MOMENTS })[0];
  assert.equal(job.attempts, 1, 'this recording\'s prompt may be too long: an attempt');
  assert.equal(job.state, 'pending', 'through the retry rules');
  assert.equal(catalog.writes.length, 0, 'not a verdict yet');
  assert.equal(bus.posted.length, 1, 'a timeout posts nothing');
});

test('a call that keeps failing writes a FAILED row only when the retries run out', async (t) => {
  const c = clock();
  const queue = tmpQueue(t, { clock: c.now, maxAttempts: 3 });
  const catalog = fakeCatalog();
  const ai = scorer({ ok: false, code: 'provider_error', error: 'Anthropic refused the request (429): rate limited' });
  enqueueMoments(queue, { sourceId: SRC });
  for (let i = 0; i < 3; i += 1) {
    c.advance(2 * 60 * 60 * 1000);
    // eslint-disable-next-line no-await-in-loop
    await pass(queue, catalog, { score: ai.score, now: c.now, ...alarms() });
    if (i < 2) assert.equal(catalog.writes.length, 0, `try ${i + 1}: still no row`);
  }
  assert.equal(queue.listJobs({ stage: STAGE_MOMENTS })[0].state, 'blocked');
  const row = catalog.moments.get(SRC);
  assert.equal(row.status, 'failed');
  assert.match(row.error, /429\): rate limited/);
});

test('a RESCORE that keeps hitting temporary errors keeps the good moments it already had', async (t) => {
  const c = clock();
  const queue = tmpQueue(t, { clock: c.now, maxAttempts: 3 });
  const catalog = fakeCatalog();
  enqueueMoments(queue, { sourceId: SRC });
  await pass(queue, catalog, { score: scorer(ANSWERED).score, readBrief: brief('fp-v2'), now: c.now, ...alarms() });
  const good = catalog.moments.get(SRC);
  assert.equal(good.status, 'done');
  assert.equal(good.moments.length, 5);
  const writesBefore = catalog.writes.length;

  // Dane asks for a rescore; the provider rate-limits every try until the job blocks.
  c.advance(60 * 1000);
  const askedAt = new Date(c.now()).toISOString();
  good.rescoreRequestedAt = askedAt;
  assert.equal((await watchRescores({ queue, env: ENV, catalog })).processed.length, 1);
  const limited = scorer({ ok: false, code: 'provider_error', error: 'Anthropic refused the request (429): rate limited' });
  let last;
  for (let i = 0; i < 3; i += 1) {
    c.advance(2 * 60 * 60 * 1000);
    // eslint-disable-next-line no-await-in-loop
    last = await pass(queue, catalog, { score: limited.score, readBrief: brief('fp-v3'), now: c.now, ...alarms() });
  }
  const job = queue.listJobs({ stage: STAGE_MOMENTS }).find((j) => j.state === 'blocked');
  assert.ok(job, 'the rescore job is blocked, carrying the reason');
  assert.match(job.lastError, /429\): rate limited/);
  assert.equal(last.failed[0].keptEarlierMoments, 5, JSON.stringify(last, null, 2));

  const row = catalog.moments.get(SRC);
  assert.equal(row.status, 'done', 'a temporary outage is not a verdict on the recording');
  assert.equal(row.moments.length, 5, 'the paid-for moments survive');
  assert.equal(row.briefFingerprint, 'fp-v2');
  assert.equal(catalog.writes.length, writesBefore, 'nothing was written over them');
  assert.equal(row.rescoreRequestedAt, askedAt, 'the request is still standing, unanswered');
  const watched = await watchRescores({ queue, env: ENV, catalog });
  assert.equal(watched.processed.length, 0, 'not re-queued every minute');
  assert.match(watched.skipped[0].why, /is blocked: .*rate limited/);
});

test('retries running out with no earlier moments: the FAILED row is read back, and a row that did not stick is named', async (t) => {
  const c = clock();
  const queue = tmpQueue(t, { clock: c.now, maxAttempts: 1 });
  const catalog = fakeCatalog();
  const realUpsert = catalog.upsertMoments;
  catalog.upsertMoments = async (id, data) => {
    const res = await realUpsert(id, data);
    catalog.moments.delete(id); // "saved", but nothing kept
    return res;
  };
  enqueueMoments(queue, { sourceId: SRC });
  const ai = scorer({ ok: false, code: 'provider_error', error: 'Anthropic refused the request (429): rate limited' });
  const report = await pass(queue, catalog, { score: ai.score, now: c.now, ...alarms() });
  assert.equal(report.failed.length, 1, JSON.stringify(report, null, 2));
  assert.match(report.failed[0].rowNotWritten, /read back as "nothing"/);
});

test('retries running out when the existing moments cannot be READ writes nothing over them', async (t) => {
  const c = clock();
  const queue = tmpQueue(t, { clock: c.now, maxAttempts: 1 });
  const catalog = fakeCatalog();
  catalog.getMomentsBySource = async () => ({ ok: false, status: 503, error: 'fetch failed' });
  enqueueMoments(queue, { sourceId: SRC });
  const ai = scorer({ ok: false, code: 'provider_error', error: 'Anthropic refused the request (429): rate limited' });
  const report = await pass(queue, catalog, { score: ai.score, now: c.now, ...alarms() });
  assert.equal(catalog.writes.length, 0);
  assert.match(report.failed[0].rowNotWritten, /could not be read \(fetch failed\)/);
});

// ── Verdicts: a failed row with the reason ──────────────────────────────────

test('an answer the rules refuse writes a FAILED row with the reason, and the job is done with it', async (t) => {
  const c = clock();
  const queue = tmpQueue(t, { clock: c.now });
  const catalog = fakeCatalog();
  const bus = alarms();
  const ai = scorer({ ...ANSWERED, text: 'I would rather not say.' });
  enqueueMoments(queue, { sourceId: SRC });
  const report = await pass(queue, catalog, { score: ai.score, now: c.now, ...bus });
  assert.equal(report.failed.length, 1, JSON.stringify(report, null, 2));
  const row = catalog.moments.get(SRC);
  assert.equal(row.status, 'failed');
  assert.equal(row.error, 'the answer had no JSON object in it');
  assert.equal(row.briefFingerprint, 'fp-v2');
  assert.equal(row.model, 'anthropic/claude-sonnet-5-5', 'who gave the refused answer');
  assert.deepEqual(row.moments, []);
  assert.equal(queue.listJobs({ stage: STAGE_MOMENTS })[0].state, 'done', 'not retried five times at five times the cost');
  assert.deepEqual(bus.posted, []);
});

test('no notes switched on is a FAILED row naming 2c\'s refusal and the reader\'s reason, with no call made', async (t) => {
  const queue = tmpQueue(t);
  const catalog = fakeCatalog();
  const ai = scorer(ANSWERED);
  enqueueMoments(queue, { sourceId: SRC });
  await pass(queue, catalog, { score: ai.score, readBrief: brief('fp-empty', ''), ...alarms() });
  assert.equal(ai.calls.length, 0, 'never scored against nothing');
  const row = catalog.moments.get(SRC);
  assert.equal(row.status, 'failed');
  assert.ok(row.error.startsWith(NO_BRIEF_REASON), row.error);
  assert.match(row.error, /switched on for Reel Spinner/);
});

test('notes that cannot be READ are the machine\'s: released, no row, no call', async (t) => {
  const queue = tmpQueue(t);
  const catalog = fakeCatalog();
  const ai = scorer(ANSWERED);
  enqueueMoments(queue, { sourceId: SRC });
  const report = await pass(queue, catalog, {
    score: ai.score, readBrief: async () => ({ ok: false, status: 503, error: 'Could not read the Context entries' }), ...alarms(),
  });
  assert.equal(report.released.length, 1);
  assert.equal(ai.calls.length, 0);
  assert.equal(catalog.writes.length, 0);
  assert.equal(queue.listJobs({ stage: STAGE_MOMENTS })[0].attempts, 0);
});

test('a recording without finished cut marks is blocked with the fix, never scored', async (t) => {
  const queue = tmpQueue(t);
  const catalog = fakeCatalog({ cuts: 'failed' });
  const ai = scorer(ANSWERED);
  enqueueMoments(queue, { sourceId: SRC });
  const report = await pass(queue, catalog, { score: ai.score, ...alarms() });
  assert.equal(report.blocked.length, 1);
  assert.match(report.blocked[0].reason, /no finished cut marks .*studio:backfill-cuts/);
  assert.equal(ai.calls.length, 0);
});

test('a save that fails after the model answered keeps the answer, and the retry saves it without paying again', async (t) => {
  const c = clock();
  const queue = tmpQueue(t, { clock: c.now });
  const catalog = fakeCatalog();
  const realUpsert = catalog.upsertMoments;
  let refuse = true;
  catalog.upsertMoments = async (...args) => (refuse ? { ok: false, status: 503, error: 'fetch failed' } : realUpsert(...args));
  const ai = scorer(ANSWERED);
  enqueueMoments(queue, { sourceId: SRC });

  const first = await pass(queue, catalog, { score: ai.score, now: c.now, ...alarms() });
  assert.equal(first.released.length, 1, JSON.stringify(first, null, 2));
  assert.match(first.released[0].reason, /kept on this machine for a day/);
  assert.equal(queue.listJobs({ stage: STAGE_MOMENTS })[0].attempts, 0);

  refuse = false;
  c.advance(20 * 60 * 1000);
  const second = await pass(queue, catalog, { score: ai.score, now: c.now, ...alarms() });
  assert.equal(second.done.length, 1, JSON.stringify(second, null, 2));
  assert.equal(second.done[0].savedFromEarlierTry, true);
  assert.equal(ai.calls.length, 1, 'paid for once');
  assert.equal(catalog.moments.get(SRC).moments.length, 5);
  assert.equal(catalog.moments.get(SRC).runStartedAt, new Date(T0).toISOString(), 'the run that paid is the run recorded');
});

test('moments that "save" but do not stick are caught by the read-back and the job is blocked', async (t) => {
  const queue = tmpQueue(t);
  const catalog = fakeCatalog();
  catalog.getMomentsBySource = async () => ({ ok: true, status: 200, data: { status: 'done', moments: [], rulesVersion: RULES_VERSION, briefFingerprint: 'fp-v2' } });
  enqueueMoments(queue, { sourceId: SRC });
  const report = await pass(queue, catalog, { score: scorer(ANSWERED).score, ...alarms() });
  assert.equal(report.blocked.length, 1);
  assert.match(report.blocked[0].reason, /read back as "done" with 0/);
});

// ── Rescoring ───────────────────────────────────────────────────────────────

test('a rescore request queues ONE job, is answered by the next score, and clears', async (t) => {
  const c = clock();
  const queue = tmpQueue(t, { clock: c.now });
  const catalog = fakeCatalog({ rescoreAt: new Date(T0 - 60 * 1000).toISOString() });
  const ai = scorer(ANSWERED);

  const first = await watchRescores({ queue, env: ENV, catalog });
  assert.equal(first.processed.length, 1);
  const second = await watchRescores({ queue, env: ENV, catalog });
  assert.equal(second.processed.length, 0, 'seen twice, still one job');
  assert.equal(queue.listJobs({ stage: STAGE_MOMENTS }).length, 1);

  const report = await pass(queue, catalog, { score: ai.score, readBrief: brief('fp-v3'), now: c.now, ...alarms() });
  assert.equal(report.done.length, 1, JSON.stringify(report, null, 2));
  assert.equal(catalog.moments.get(SRC).rescoreRequestedAt, '', 'answered, so cleared');
  assert.equal(catalog.moments.get(SRC).briefFingerprint, 'fp-v3');

  const third = await watchRescores({ queue, env: ENV, catalog });
  assert.equal(third.processed.length, 0);
  assert.equal(queue.listJobs({ stage: STAGE_MOMENTS }).length, 1, 'nothing queued again');
  assert.equal(ai.calls.length, 1);
});

test('a rescore asked for WHILE a score runs survives it and is queued again', async (t) => {
  const c = clock();
  const queue = tmpQueue(t, { clock: c.now });
  const catalog = fakeCatalog({ rescoreAt: new Date(T0 - 60 * 1000).toISOString() });
  await watchRescores({ queue, env: ENV, catalog });
  const ai = scorer(() => {
    // Dane presses Rescore again mid-run.
    catalog.moments.get(SRC).rescoreRequestedAt = new Date(T0 + 30 * 1000).toISOString();
    return ANSWERED;
  });
  await pass(queue, catalog, { score: ai.score, now: c.now, ...alarms() });
  assert.ok(catalog.moments.get(SRC).rescoreRequestedAt, 'the newer request is kept');
  const watched = await watchRescores({ queue, env: ENV, catalog });
  assert.equal(watched.processed.length, 1);
});

test('a rescore whose job is blocked since the request is not re-queued every minute', async (t) => {
  const queue = tmpQueue(t);
  const catalog = fakeCatalog({ cuts: 'failed', rescoreAt: new Date(Date.now() - 60 * 1000).toISOString() });
  await watchRescores({ queue, env: ENV, catalog });
  await pass(queue, catalog, { score: scorer(ANSWERED).score, ...alarms() });
  assert.equal(queue.listJobs({ stage: STAGE_MOMENTS })[0].state, 'blocked');
  const watched = await watchRescores({ queue, env: ENV, catalog });
  assert.equal(watched.processed.length, 0);
  assert.match(watched.skipped[0].why, /is blocked: .*no finished cut marks/);
});

test('the rescore watch is OFF, not broken, without a project; and says COULD NOT TELL when the read fails', async (t) => {
  const queue = tmpQueue(t);
  assert.ok((await watchRescores({ queue, env: {}, catalog: fakeCatalog() })).notConfigured);
  const catalog = fakeCatalog();
  catalog.listRescoreRequests = async () => ({ ok: false, status: 503, error: 'fetch failed' });
  const r = await watchRescores({ queue, env: ENV, catalog });
  assert.equal(r.ok, false);
  assert.match(r.error, /fetch failed/);
});

// ── The words the alarm and the log use ─────────────────────────────────────

test('the alarm sentence names every provider the door could not use', () => {
  const said = machineFaultReason({
    callCode: 'no_provider',
    skipped: [
      { label: 'Anthropic', verdict: 'OUT OF CREDIT' },
      { label: 'OpenAI', verdict: 'NOT SET' },
      { label: 'Google Gemini', verdict: 'INVALID' },
    ],
  });
  assert.equal(said, 'Reel Spinner scoring is stopped: no AI provider can pay. Anthropic: out of credit. OpenAI: no key. Google Gemini: key refused.');
});

test('spend: an unpriced provider says so, never $0', () => {
  const said = describeSpend({ provider: 'openai', model: 'openai/gpt-5.5', usage: { promptTokens: 10, completionTokens: 5 } });
  assert.match(said, /openai\/gpt-5\.5, 10 in \/ 5 out, cost not priced/);
  assert.doesNotMatch(said, /\$0/);
});

// ── The backfill ────────────────────────────────────────────────────────────

test('backfill: the dry run lists the recording, --apply queues it once, a second --apply queues nothing', async (t) => {
  const queue = tmpQueue(t);
  const catalog = fakeCatalog();
  const scope = { projectId: PROJECT };

  const dry = await runBackfill({ queue, catalog, scope, apply: false });
  assert.equal(dry.ok, true);
  assert.equal(dry.plan.enqueue.length, 1);
  assert.equal(queue.listJobs({ stage: STAGE_MOMENTS }).length, 0, 'a dry run writes nothing');
  assert.deepEqual(dry.counts, { cut: 1, done: 0, failed: 0, missing: 1 });

  const applied = await runBackfill({ queue, catalog, scope, apply: true });
  assert.equal(applied.enqueued.length, 1);
  assert.equal(queue.listJobs({ stage: STAGE_MOMENTS }).length, 1);

  const again = await runBackfill({ queue, catalog, scope, apply: true });
  assert.equal(again.enqueued.length, 0, 'the first run\'s job is a reason to skip');
  assert.equal(queue.listJobs({ stage: STAGE_MOMENTS }).length, 1);

  await pass(queue, catalog, { score: scorer(ANSWERED).score, ...alarms() });
  const after = await runBackfill({ queue, catalog, scope, apply: true });
  assert.equal(after.enqueued.length, 0, 'and later its row is');
  assert.deepEqual(after.counts, { cut: 1, done: 1, failed: 0, missing: 0 });
  const { report } = require('../studio_backfill_moments.cjs');
  assert.match(report(after), /^moments: 1 done · 0 failed · 0 still to do/);
});

test('backfill: a BLOCKED job is not "waiting" — it is listed on its own with its reason, and not re-queued', async (t) => {
  const queue = tmpQueue(t);
  const catalog = fakeCatalog();
  const scope = { projectId: PROJECT };
  queue.block({ stage: STAGE_MOMENTS, subjectKind: 'video_source', subjectId: SRC, reason: 'Anthropic refused the request (429): rate limited' });

  const dry = await runBackfill({ queue, catalog, scope, apply: true });
  assert.equal(dry.enqueued.length, 0, 'each job is a paid call, and what blocked it is still there');
  assert.equal(dry.plan.blocked.length, 1);
  const { report } = require('../studio_backfill_moments.cjs');
  const said = report(dry);
  assert.doesNotMatch(said, /has a job waiting/);
  assert.doesNotMatch(said, /already waiting on the queue/);
  assert.match(said, /1 BLOCKED — these will not be scored until somebody acts/);
  assert.match(said, /rate limited/);
});

test('backfill plan: a failed row is a row (skipped with its state); recordings without finished cut marks are ignored', () => {
  const plan = planBackfill({
    sources: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    cuts: new Map([['a', 'done'], ['b', 'done'], ['c', 'failed']]),
    scored: new Map([['b', 'failed']]),
    queued: new Map(),
  });
  assert.deepEqual(plan.enqueue.map((e) => e.id), ['a']);
  assert.deepEqual(plan.skipped.map((s) => s.id), ['b']);
  assert.match(plan.skipped[0].why, /already has a moments row \(failed\)/);
});
