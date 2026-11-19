'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * Reel Spinner 2b (SC-827) — where scored moments, sound pairs and edits live.
 *
 * Same harness as videoCutMarksStore.test.js: the fake database reads its
 * schema FROM the setup files, so a tenant column deleted from the SQL fails
 * here (landmine 12), and the fake's upsert merges ONLY when
 * `Prefer: resolution=merge-duplicates` asks (landmine 15). Tenant columns are
 * checked on the stored ROW, never trusted from the insert's answer.
 */

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'SQL');
const SQL_TEXT = ['video_studio_setup.sql', 'video_reel_spinner_setup.sql']
  .map((file) => fs.readFileSync(path.join(SQL_DIR, file), 'utf8'))
  .join('\n');
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const STORE_PATHS = [
  '../../lib/projectScope.js',
  '../../lib/videoSessionsStore.js',
  '../../lib/videoSourcesStore.js',
  '../../lib/videoMomentsStore.js',
  '../../lib/videoAudioPairsStore.js',
  '../../lib/videoEditsStore.js',
].map((p) => require.resolve(p));

const SCOPE_A = { projectId: 'proj_a', userId: 'user_1' };
const SCOPE_B = { projectId: 'proj_b', userId: 'user_2' };
const TABLES = ['video_moments', 'video_audio_pairs', 'video_edits'];

function withDb() {
  const schema = parseSchemaText(SQL_TEXT);
  const db = createFakeDb(schema);
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({
      videoSessions: 'video_sessions',
      videoSources: 'video_sources',
      videoMoments: 'video_moments',
      videoAudioPairs: 'video_audio_pairs',
      videoEdits: 'video_edits',
    }),
    sbQuery: (req) => (db.refuse && db.refuse(req)) || db.sbQuery(req),
  };
  const realSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase,
  };
  for (const p of STORE_PATHS) delete require.cache[p];
  const [, sessions, sources, moments, pairs, edits] = STORE_PATHS.map((p) => require(p));
  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    for (const p of STORE_PATHS) delete require.cache[p];
  }
  return { db, sessions, sources, moments, pairs, edits, restore };
}

async function seedSource({ sessions, sources }, scope = SCOPE_A) {
  const session = await sessions.createSession({ title: 'A talk' }, scope);
  assert.equal(session.ok, true, JSON.stringify(session));
  const source = await sources.createSource({ sessionId: session.data.id }, scope);
  assert.equal(source.ok, true, JSON.stringify(source));
  return source.data.id;
}

function refuseWrites(ctx, tableName) {
  ctx.db.refuse = (req) => (req.table === tableName && req.method !== 'GET'
    ? Promise.resolve({ ok: false, status: 503, error: 'the database is read-only right now' })
    : null);
}

const TWO_MOMENTS = {
  status: 'done',
  summary: 'A talk about the courts.',
  briefFingerprint: 'brief-1',
  model: 'claude-sonnet-5-5',
  rulesVersion: 'moment-rules-1',
  runStartedAt: new Date().toISOString(),
  moments: [
    { start_s: 41.2, end_s: 78.9, score: 86, reasons: ['A clear story.'], project: 'delray', mood: 'warm', quote: 'We built it.' },
    { start_s: 120, end_s: 150, score: 40 },
  ],
};

// ── The tables ──────────────────────────────────────────────────────────────

test('all three tables carry BOTH tenant columns and RLS', () => {
  const schema = parseSchemaText(SQL_TEXT);
  for (const name of TABLES) {
    const table = schema.tables.get(name);
    assert.ok(table, `${name} is created`);
    for (const column of ['project_id', 'owner_user_id']) {
      assert.ok(table.columns.has(column), `${name}.${column} must exist (CLAUDE.md landmine 12)`);
    }
    assert.ok(schema.rlsEnabled.has(name), `${name} must have RLS on`);
  }
});

test('the SQL file says what breaks without it and what it runs after', () => {
  const text = fs.readFileSync(path.join(SQL_DIR, 'video_reel_spinner_setup.sql'), 'utf8');
  assert.match(text, /^-- FEATURE: Reel Spinner has nowhere to keep scored clips, matched recordings or edits, so steps 2 to 6 cannot run$/m);
  assert.match(text, /^-- RUN AFTER docs\/SQL\/video_studio_setup\.sql$/m);
});

test('the edit statuses in the SQL are exactly the statuses the store moves between', () => {
  const schema = parseSchemaText(SQL_TEXT);
  const { EDIT_STATUSES, EDIT_STEPS } = require('../../lib/videoEditsStore.js');
  assert.deepEqual(schema.tables.get('video_edits').columns.get('status').allowed, EDIT_STATUSES);
  assert.deepEqual(Object.keys(EDIT_STEPS).sort(), [...EDIT_STATUSES].sort());
  for (const targets of Object.values(EDIT_STEPS)) {
    for (const to of targets) assert.ok(EDIT_STATUSES.includes(to), to);
  }
});

// ── video_moments ───────────────────────────────────────────────────────────

test('moments: an upsert stamps both tenant columns on the stored row', async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx);
    const saved = await ctx.moments.upsertMoments(sourceId, TWO_MOMENTS, SCOPE_A);
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const rows = ctx.db.data.get('video_moments');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].project_id, 'proj_a');
    assert.equal(rows[0].owner_user_id, 'user_1');
    assert.equal(rows[0].moments[0].score, 86);
    assert.deepEqual(rows[0].moments[1], {
      start_s: 120, end_s: 150, score: 40, reasons: [], project: '', mood: '', quote: '',
    });
  } finally { ctx.restore(); }
});

test('moments: the upsert sends on_conflict AND the merge header, and a second save updates one row', async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx);
    const first = await ctx.moments.upsertMoments(sourceId, TWO_MOMENTS, SCOPE_A);
    const second = await ctx.moments.upsertMoments(sourceId, { status: 'failed', error: 'no audio', runStartedAt: new Date().toISOString() }, SCOPE_A);
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.equal(second.data.id, first.data.id);
    assert.equal(ctx.db.data.get('video_moments').length, 1);
    assert.deepEqual(second.data.moments, [], 'a replacement, not a patch');
    const write = ctx.db.calls.find((c) => c.method === 'POST' && c.table === 'video_moments');
    assert.match(write.query, /(^|&)on_conflict=project_id,source_id(&|$)/);
    assert.match(String(write.headers.Prefer), /resolution=merge-duplicates/);
  } finally { ctx.restore(); }
});

test('moments: a refused write is returned as itself, never a success', async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx);
    refuseWrites(ctx, 'video_moments');
    const res = await ctx.moments.upsertMoments(sourceId, TWO_MOMENTS, SCOPE_A);
    assert.deepEqual([res.ok, res.status, res.data], [false, 503, undefined]);
  } finally { ctx.restore(); }
});

test('moments: bad input is refused naming what is wrong; another project cannot reach the source', async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx);
    const good = TWO_MOMENTS.moments[0];
    const cases = [
      [{ status: 'pending' }, /status must be one of done, failed/],
      [{ status: 'failed' }, /error is required/],
      [{ status: 'done', moments: [{ ...good, score: 101 }] }, /moments\[0\] \(at 41\.2 s\): score must be a number from 0 to 100/],
      [{ status: 'done', moments: [{ ...good, end_s: 10 }] }, /must be before end_s/],
      [{ status: 'done', moments: [{ ...good, reasons: 'good' }] }, /reasons must be a list/],
      [{ status: 'done', score: 3 }, /Unknown field/],
    ];
    for (const [input, message] of cases) {
      const res = await ctx.moments.upsertMoments(sourceId, input, SCOPE_A);
      assert.equal(res.ok, false, `${JSON.stringify(input)} was accepted`);
      assert.match(res.error, message);
    }
    const theirs = await ctx.moments.upsertMoments(sourceId, TWO_MOMENTS, SCOPE_B);
    assert.equal(theirs.status, 404);
    assert.equal(ctx.db.data.get('video_moments').length, 0);
  } finally { ctx.restore(); }
});

test('moments: a rescore request is stamped, and the next score clears it', async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx);
    const never = await ctx.moments.requestRescore(sourceId, SCOPE_A);
    assert.equal(never.status, 404);
    assert.match(never.error, /not been scored yet/);

    await ctx.moments.upsertMoments(sourceId, TWO_MOMENTS, SCOPE_A);
    const asked = await ctx.moments.requestRescore(sourceId, SCOPE_A);
    assert.equal(asked.ok, true, JSON.stringify(asked));
    assert.ok(ctx.db.data.get('video_moments')[0].rescore_requested_at);

    const theirs = await ctx.moments.requestRescore(sourceId, SCOPE_B);
    assert.equal(theirs.status, 404);

    const answered = await ctx.moments.upsertMoments(
      sourceId, { ...TWO_MOMENTS, runStartedAt: new Date(Date.now() + 1000).toISOString() }, SCOPE_A
    );
    assert.equal(answered.ok, true, JSON.stringify(answered));
    assert.equal(answered.data.rescoreRequestedAt, '');
    assert.equal(ctx.db.data.get('video_moments')[0].rescore_requested_at, null);
    const read = await ctx.moments.getMomentsBySource(sourceId, SCOPE_A);
    assert.equal(read.data.rescoreRequestedAt, '');
  } finally { ctx.restore(); }
});

test('moments: a rescore Dane asks for WHILE a run is scoring survives that run\'s answer', async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx);
    await ctx.moments.upsertMoments(sourceId, TWO_MOMENTS, SCOPE_A);

    // The run starts, then he asks (scoring takes minutes), then the run answers.
    const runStartedAt = new Date(Date.now() - 60 * 1000).toISOString();
    const asked = await ctx.moments.requestRescore(sourceId, SCOPE_A);
    assert.equal(asked.ok, true, JSON.stringify(asked));
    const stamp = ctx.db.data.get('video_moments')[0].rescore_requested_at;
    assert.ok(stamp);

    const oldRun = await ctx.moments.upsertMoments(sourceId, { ...TWO_MOMENTS, runStartedAt }, SCOPE_A);
    assert.equal(oldRun.ok, true, JSON.stringify(oldRun));
    assert.equal(oldRun.data.summary, TWO_MOMENTS.summary, 'the run\'s moments are still saved');
    assert.equal(ctx.db.data.get('video_moments')[0].rescore_requested_at, stamp,
      'a request made after the run began is not answered by it, and must still stand');
    assert.ok(oldRun.data.rescoreRequestedAt, 'the reply shows the request still standing');

    // The clear is ONE conditional write — never a read and then a write.
    const clears = ctx.db.calls.filter((c) => c.method === 'PATCH' && c.table === 'video_moments'
      && /rescore_requested_at=lte\./.test(c.query));
    assert.equal(clears.length, 2);

    // The next run, started after he asked, answers it.
    const nextRun = await ctx.moments.upsertMoments(
      sourceId, { ...TWO_MOMENTS, runStartedAt: new Date(Date.parse(stamp) + 1).toISOString() }, SCOPE_A
    );
    assert.equal(nextRun.data.rescoreRequestedAt, '');
    assert.equal(ctx.db.data.get('video_moments')[0].rescore_requested_at, null);
  } finally { ctx.restore(); }
});

test('moments: a score must say when its run began — missing, unreadable or future is refused', async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx);
    const { runStartedAt, ...noStart } = TWO_MOMENTS;
    assert.ok(runStartedAt);
    const missing = await ctx.moments.upsertMoments(sourceId, noStart, SCOPE_A);
    assert.equal(missing.status, 400);
    assert.match(missing.error, /runStartedAt is required/);
    const junk = await ctx.moments.upsertMoments(sourceId, { ...TWO_MOMENTS, runStartedAt: 'yesterday-ish' }, SCOPE_A);
    assert.match(junk.error, /runStartedAt must be an ISO date and time/);
    const future = await ctx.moments.upsertMoments(
      sourceId, { ...TWO_MOMENTS, runStartedAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() }, SCOPE_A
    );
    assert.match(future.error, /is in the future/);
    assert.equal(ctx.db.data.get('video_moments').length, 0);
  } finally { ctx.restore(); }
});

test('moments: a refused rescore clear is reported, never a success', async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx);
    ctx.db.refuse = (req) => (req.table === 'video_moments' && req.method === 'PATCH'
      ? Promise.resolve({ ok: false, status: 503, error: 'the database is read-only right now' })
      : null);
    const res = await ctx.moments.upsertMoments(sourceId, TWO_MOMENTS, SCOPE_A);
    assert.equal(res.ok, false);
    assert.equal(res.status, 503);
    assert.match(res.error, /rescore request they answer was not cleared: the database is read-only/);
  } finally { ctx.restore(); }
});

// ── video_audio_pairs ───────────────────────────────────────────────────────

test('pairs: either order is one row, measured A to B, both tenant columns on the row', async () => {
  const ctx = withDb();
  try {
    const one = await seedSource(ctx);
    const two = await seedSource(ctx);
    const [low, high] = [one, two].sort();
    const first = await ctx.pairs.upsertAudioPair(low, high, {
      status: 'done', offsetS: 2.5, driftS: 0.1, confidence: 0.9, audioSourceId: high,
    }, SCOPE_A);
    assert.equal(first.ok, true, JSON.stringify(first));
    // The same pair asked the other way round: B starts 2.5 s after A means A
    // starts 2.5 s BEFORE B, so the stored offset keeps its sign.
    const second = await ctx.pairs.upsertAudioPair(high, low, {
      status: 'done', offsetS: -2.5, driftS: -0.1, confidence: 0.95,
    }, SCOPE_A);
    assert.equal(second.ok, true, JSON.stringify(second));
    const rows = ctx.db.data.get('video_audio_pairs');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source_a_id, low);
    assert.equal(rows[0].offset_s, 2.5);
    assert.equal(rows[0].drift_s, 0.1);
    assert.equal(rows[0].confidence, 0.95);
    assert.equal(rows[0].project_id, 'proj_a');
    assert.equal(rows[0].owner_user_id, 'user_1');
    const write = ctx.db.calls.find((c) => c.method === 'POST' && c.table === 'video_audio_pairs');
    assert.match(write.query, /(^|&)on_conflict=project_id,source_a_id,source_b_id(&|$)/);
    assert.match(String(write.headers.Prefer), /resolution=merge-duplicates/);
  } finally { ctx.restore(); }
});

test("pairs: Dane's choice of sound survives a later measurement", async () => {
  const ctx = withDb();
  try {
    const one = await seedSource(ctx);
    const two = await seedSource(ctx);
    const saved = await ctx.pairs.upsertAudioPair(one, two, { status: 'done', audioSourceId: one }, SCOPE_A);
    const chose = await ctx.pairs.chooseAudioSource(saved.data.id, two, SCOPE_A);
    assert.equal(chose.ok, true, JSON.stringify(chose));
    assert.equal(chose.data.chosenBy, 'dane');
    const again = await ctx.pairs.upsertAudioPair(one, two, { status: 'done', offsetS: 1, audioSourceId: one }, SCOPE_A);
    assert.equal(again.data.audioSourceId, two);
    assert.equal(again.data.chosenBy, 'dane');
    assert.equal(again.data.offsetS, 1);

    const stranger = await seedSource(ctx);
    const wrong = await ctx.pairs.chooseAudioSource(saved.data.id, stranger, SCOPE_A);
    assert.equal(wrong.status, 400);
    const theirs = await ctx.pairs.chooseAudioSource(saved.data.id, one, SCOPE_B);
    assert.equal(theirs.status, 404);

    const listed = await ctx.pairs.listAudioPairsForSource(two, SCOPE_A);
    assert.equal(listed.data.length, 1);
  } finally { ctx.restore(); }
});

// Dane's pick landing at EACH point inside a measurement's save: before its
// first write, and between its two writes. A read-then-write store loses it at
// the first point and still answers 200 (review of PR #1025).
for (const at of ['POST', 'PATCH']) {
  test(`pairs: Dane's pick landing mid-save (before the ${at}) is kept, not overwritten`, async () => {
    const ctx = withDb();
    try {
      const one = await seedSource(ctx);
      const two = await seedSource(ctx);
      const saved = await ctx.pairs.upsertAudioPair(one, two, { status: 'done', audioSourceId: one }, SCOPE_A);
      assert.equal(saved.data.audioSourceId, one.toLowerCase());

      let fired = false;
      ctx.db.refuse = (req) => {
        if (fired || req.table !== 'video_audio_pairs' || req.method !== at) return null;
        fired = true;
        return ctx.pairs.chooseAudioSource(saved.data.id, two, SCOPE_A).then((chose) => {
          assert.equal(chose.ok, true, JSON.stringify(chose));
          return ctx.db.sbQuery(req);
        });
      };
      const measured = await ctx.pairs.upsertAudioPair(one, two, {
        status: 'done', offsetS: 3, audioSourceId: one,
      }, SCOPE_A);
      assert.ok(fired, `the pick was interleaved before the ${at}`);
      assert.equal(measured.ok, true, JSON.stringify(measured));
      const row = ctx.db.data.get('video_audio_pairs')[0];
      assert.equal(row.chosen_by, 'dane');
      assert.equal(row.audio_source_id, two.toLowerCase());
      assert.equal(Number(row.offset_s), 3, 'the measurement itself still lands');
      assert.equal(measured.data.chosenBy, 'dane', 'the reply shows his pick, not the measured one');
      assert.equal(measured.data.audioSourceId, two.toLowerCase());
    } finally { ctx.restore(); }
  });
}

test('pairs: refusals — itself, another project, a stranger\'s sound, a failure with no why, a refused write', async () => {
  const ctx = withDb();
  try {
    const one = await seedSource(ctx);
    const two = await seedSource(ctx);
    const theirs = await seedSource(ctx, SCOPE_B);
    assert.match((await ctx.pairs.upsertAudioPair(one, one, { status: 'done' }, SCOPE_A)).error, /with itself/);
    assert.equal((await ctx.pairs.upsertAudioPair(one, theirs, { status: 'done' }, SCOPE_A)).status, 404);
    assert.match((await ctx.pairs.upsertAudioPair(one, two, { status: 'done', audioSourceId: theirs }, SCOPE_A)).error, /one of the two/);
    assert.match((await ctx.pairs.upsertAudioPair(one, two, { status: 'failed' }, SCOPE_A)).error, /error is required/);
    assert.match((await ctx.pairs.upsertAudioPair(one, two, { status: 'done', confidence: 2 }, SCOPE_A)).error, /confidence must be between 0 and 1/);
    refuseWrites(ctx, 'video_audio_pairs');
    const refused = await ctx.pairs.upsertAudioPair(one, two, { status: 'done' }, SCOPE_A);
    assert.deepEqual([refused.ok, refused.status], [false, 503]);
    assert.equal(ctx.db.data.get('video_audio_pairs').length, 0);
  } finally { ctx.restore(); }
});

// ── video_edits ─────────────────────────────────────────────────────────────

async function walk(ctx, id, steps) {
  let last;
  for (const [to, patch] of steps) {
    last = await ctx.edits.moveEdit(id, to, patch || {}, SCOPE_A);
    assert.equal(last.ok, true, `${to}: ${JSON.stringify(last)}`);
  }
  return last;
}

test('edits: a new edit is a draft with both tenant columns on the stored row', async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx);
    const full = await ctx.edits.createEdit(sourceId, {
      kind: 'full', keepRanges: [{ start_s: 0, end_s: 10 }, { start_s: 12, end_s: 30 }],
    }, SCOPE_A);
    assert.equal(full.ok, true, JSON.stringify(full));
    assert.equal(full.data.status, 'draft');
    const row = ctx.db.data.get('video_edits')[0];
    assert.equal(row.project_id, 'proj_a');
    assert.equal(row.owner_user_id, 'user_1');

    const again = await ctx.edits.createEdit(sourceId, { kind: 'full' }, SCOPE_A);
    assert.equal(again.status, 409);
    assert.match(again.error, /already has a full edit/);

    const short0 = await ctx.edits.createEdit(sourceId, { kind: 'short', momentIndex: 0 }, SCOPE_A);
    const short1 = await ctx.edits.createEdit(sourceId, { kind: 'short', momentIndex: 1 }, SCOPE_A);
    assert.equal(short0.ok && short1.ok, true);
    assert.equal((await ctx.edits.createEdit(sourceId, { kind: 'short', momentIndex: 1 }, SCOPE_A)).status, 409);
    assert.match((await ctx.edits.createEdit(sourceId, { kind: 'short' }, SCOPE_A)).error, /needs momentIndex/);
    assert.match((await ctx.edits.createEdit(sourceId, { kind: 'full', momentIndex: 2 }, SCOPE_A)).error, /no momentIndex/);
    assert.match((await ctx.edits.createEdit(sourceId, {
      kind: 'short', momentIndex: 3, keepRanges: [{ start_s: 0, end_s: 10 }, { start_s: 5, end_s: 12 }],
    }, SCOPE_A)).error, /keepRanges\[1\]: starts at 5 s, before the range before it ends \(10 s\)/);
    assert.equal((await ctx.edits.createEdit(sourceId, { kind: 'full' }, SCOPE_B)).status, 404);
  } finally { ctx.restore(); }
});

test('edits: a sent-back edit can go back to review UNCHANGED, only with a reason, which it keeps (Reel Spinner 4d)', async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx);
    const edit = (await ctx.edits.createEdit(sourceId, { kind: 'full', keepRanges: [{ start_s: 0, end_s: 10 }] }, SCOPE_A)).data;
    await walk(ctx, edit.id, [['rendering'], ['review', { roughCutDriveFileId: 'drive-1' }]]);
    assert.equal((await ctx.edits.reviewEdit(edit.id, { status: 'sent_back', daneNote: 'Make it purple.' }, SCOPE_A)).ok, true);

    const silent = await ctx.edits.moveEdit(edit.id, 'review', {}, SCOPE_A);
    assert.equal(silent.status, 400);
    assert.match(silent.error, /error is required when a sent-back edit goes back to review/);

    const back = await ctx.edits.moveEdit(edit.id, 'review', { error: 'could not re-cut: colour is not an edit' }, SCOPE_A);
    assert.equal(back.ok, true, JSON.stringify(back));
    assert.equal(back.data.status, 'review');
    assert.equal(back.data.error, 'could not re-cut: colour is not an edit');
    assert.equal(back.data.recutCount, 0, 'a hand-back is not a re-cut');
    assert.equal(back.data.roughCutDriveFileId, 'drive-1', 'the rough cut he watched is still the one shown');
    assert.deepEqual(back.data.keepRanges, [{ start_s: 0, end_s: 10 }]);

    // The next machine move clears it, as every move but failed does.
    assert.equal((await ctx.edits.reviewEdit(edit.id, { status: 'sent_back', daneNote: 'Start at 2 s.' }, SCOPE_A)).ok, true);
    const recut = await ctx.edits.moveEdit(edit.id, 'rendering', { keepRanges: [{ start_s: 2, end_s: 10 }] }, SCOPE_A);
    assert.equal(recut.data.error, '');
    assert.equal(recut.data.recutCount, 1);
  } finally { ctx.restore(); }
});

test('edits: the whole road, rough cut to YouTube, with one send-back counted as a recut', async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx);
    const edit = (await ctx.edits.createEdit(sourceId, { kind: 'full' }, SCOPE_A)).data;
    await walk(ctx, edit.id, [['rendering'], ['review', { roughCutDriveFileId: 'drive-1' }]]);

    const sent = await ctx.edits.reviewEdit(edit.id, { status: 'sent_back', daneNote: 'Cut the cough at 0:40.' }, SCOPE_A);
    assert.equal(sent.ok, true, JSON.stringify(sent));
    const recut = await walk(ctx, edit.id, [['rendering']]);
    assert.equal(recut.data.recutCount, 1);
    await walk(ctx, edit.id, [['review', { roughCutDriveFileId: 'drive-2' }]]);

    // A second send-back must bring its OWN note; the first one's is stale.
    const staleNote = await ctx.edits.reviewEdit(edit.id, { status: 'sent_back' }, SCOPE_A);
    assert.equal(staleNote.status, 400);
    assert.match(staleNote.error, /needs a note, in the same save/);
    const blankNote = await ctx.edits.reviewEdit(edit.id, { status: 'sent_back', daneNote: '   ' }, SCOPE_A);
    assert.equal(blankNote.status, 400);
    assert.equal(ctx.db.data.get('video_edits')[0].status, 'review');

    const approved = await ctx.edits.reviewEdit(edit.id, {
      status: 'approved', youtubeTitle: 'Building the courts', youtubeTags: ['tennis', ' delray '],
    }, SCOPE_A);
    assert.equal(approved.ok, true, JSON.stringify(approved));
    assert.deepEqual(approved.data.youtubeTags, ['tennis', 'delray']);

    const done = await walk(ctx, edit.id, [['finished', { musicTrack: 'calm-1' }], ['uploading'], ['on_youtube', { youtubeVideoId: 'yt123' }]]);
    assert.equal(done.data.status, 'on_youtube');
    assert.equal(done.data.youtubeVideoId, 'yt123');
    assert.equal(done.data.recutCount, 1);
    const row = ctx.db.data.get('video_edits')[0];
    assert.equal(row.project_id, 'proj_a');
    assert.equal(row.status, 'on_youtube');
  } finally { ctx.restore(); }
});

test('edits: a status that skips a step is refused, naming both statuses, and nothing changes', async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx);
    const edit = (await ctx.edits.createEdit(sourceId, { kind: 'full' }, SCOPE_A)).data;

    const skip = await ctx.edits.moveEdit(edit.id, 'finished', {}, SCOPE_A);
    assert.equal(skip.ok, false);
    assert.equal(skip.status, 409);
    assert.match(skip.error, /cannot move from draft to finished: it can go to rendering or failed/);

    const upload = await ctx.edits.moveEdit(edit.id, 'on_youtube', { youtubeVideoId: 'x' }, SCOPE_A);
    assert.match(upload.error, /cannot move from draft to on_youtube/);

    const early = await ctx.edits.reviewEdit(edit.id, { status: 'approved' }, SCOPE_A);
    assert.match(early.error, /cannot move from draft to approved/);

    assert.equal(ctx.db.data.get('video_edits')[0].status, 'draft');

    await walk(ctx, edit.id, [['rendering'], ['review']]);
    const machineVerdict = await ctx.edits.moveEdit(edit.id, 'approved', {}, SCOPE_A);
    assert.match(machineVerdict.error, /Dane's verdict, set through reviewEdit/);
    const noNote = await ctx.edits.reviewEdit(edit.id, { status: 'sent_back' }, SCOPE_A);
    assert.match(noNote.error, /needs a note/);
    const websiteMachine = await ctx.edits.reviewEdit(edit.id, { status: 'finished' }, SCOPE_A);
    assert.match(websiteMachine.error, /only to approved, skipped, sent_back/);
    const skipped = await ctx.edits.reviewEdit(edit.id, { status: 'skipped' }, SCOPE_A);
    assert.equal(skipped.ok, true);
    const after = await ctx.edits.moveEdit(edit.id, 'rendering', {}, SCOPE_A);
    assert.match(after.error, /skipped is the end of the line/);
  } finally { ctx.restore(); }
});

test('edits: a move guarded on a status that changed underneath is refused as moved, not applied', async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx);
    const edit = (await ctx.edits.createEdit(sourceId, { kind: 'full' }, SCOPE_A)).data;
    // Between the store's read and its write, another writer moves the edit.
    let moved = false;
    ctx.db.refuse = (req) => {
      if (!moved && req.method === 'PATCH' && req.table === 'video_edits') {
        moved = true;
        ctx.db.data.get('video_edits')[0].status = 'failed';
      }
      return null;
    };
    const res = await ctx.edits.moveEdit(edit.id, 'rendering', {}, SCOPE_A);
    assert.equal(res.ok, false, JSON.stringify(res));
    assert.equal(res.status, 409);
    assert.match(res.error, /moved from draft to failed while this was being written/);
    assert.equal(ctx.db.data.get('video_edits')[0].status, 'failed');
  } finally { ctx.restore(); }
});

test('edits: failing needs a why; trying again clears it; a refused write is returned as itself', async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx);
    const edit = (await ctx.edits.createEdit(sourceId, { kind: 'full' }, SCOPE_A)).data;
    await walk(ctx, edit.id, [['rendering']]);
    assert.match((await ctx.edits.moveEdit(edit.id, 'failed', {}, SCOPE_A)).error, /error is required/);
    const failed = await walk(ctx, edit.id, [['failed', { error: 'ffmpeg exited 1' }]]);
    assert.equal(failed.data.error, 'ffmpeg exited 1');
    const retry = await walk(ctx, edit.id, [['draft']]);
    assert.equal(retry.data.error, '');

    refuseWrites(ctx, 'video_edits');
    const refused = await ctx.edits.moveEdit(edit.id, 'rendering', {}, SCOPE_A);
    assert.deepEqual([refused.ok, refused.status, refused.data], [false, 503, undefined]);
    assert.equal(ctx.db.data.get('video_edits')[0].status, 'draft');
  } finally { ctx.restore(); }
});

test('edits: the Mini polls for verdicts by status, limit first, in its own project only', async () => {
  const ctx = withDb();
  try {
    const mine = await seedSource(ctx);
    const theirs = await seedSource(ctx, SCOPE_B);
    const a = (await ctx.edits.createEdit(mine, { kind: 'full' }, SCOPE_A)).data;
    const b = (await ctx.edits.createEdit(theirs, { kind: 'full' }, SCOPE_B)).data;
    await walk(ctx, a.id, [['rendering'], ['review']]);
    await ctx.edits.moveEdit(b.id, 'rendering', {}, SCOPE_B);
    await ctx.edits.moveEdit(b.id, 'review', {}, SCOPE_B);
    await ctx.edits.reviewEdit(a.id, { status: 'approved' }, SCOPE_A);
    await ctx.edits.reviewEdit(b.id, { status: 'approved' }, SCOPE_B);

    const waiting = await ctx.edits.listEditsByStatus(10, ['approved', 'sent_back'], SCOPE_A);
    assert.equal(waiting.ok, true, JSON.stringify(waiting));
    assert.deepEqual(waiting.data.map((e) => e.id), [a.id]);

    const scopeFirst = await ctx.edits.listEditsByStatus(SCOPE_A, ['approved']);
    assert.equal(scopeFirst.status, 400);
    assert.match(scopeFirst.error, /takes the limit first/);
    assert.equal((await ctx.edits.listEditsByStatus(10, ['nope'], SCOPE_A)).status, 400);

    const listed = await ctx.edits.listEditsForSource(mine, SCOPE_B);
    assert.deepEqual(listed.data, []);
  } finally { ctx.restore(); }
});

test('edits: the YouTube text can be saved before upload and not after', async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx);
    const edit = (await ctx.edits.createEdit(sourceId, { kind: 'full' }, SCOPE_A)).data;
    const early = await ctx.edits.reviewEdit(edit.id, { youtubeTitle: 'Draft title' }, SCOPE_A);
    assert.equal(early.ok, true, JSON.stringify(early));
    assert.equal(early.data.status, 'draft', 'saving text does not move the edit');
    await walk(ctx, edit.id, [['rendering'], ['review']]);
    await ctx.edits.reviewEdit(edit.id, { status: 'approved' }, SCOPE_A);
    await walk(ctx, edit.id, [['finished'], ['uploading']]);
    const late = await ctx.edits.reviewEdit(edit.id, { youtubeTitle: 'Too late' }, SCOPE_A);
    assert.equal(late.status, 409);
    assert.match(late.error, /uploading, so its text can no longer be changed/);
  } finally { ctx.restore(); }
});
