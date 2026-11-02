'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * Reel Spinner 1a (86bcwaw80) — where each recording's cut marks live.
 *
 * Same harness as videoTranscriptsStore.test.js: the fake database reads its
 * schema FROM the setup files, so a tenant column deleted from the SQL fails
 * here rather than quietly disagreeing with the store (landmine 12), and the
 * fake's upsert merges ONLY when `Prefer: resolution=merge-duplicates` asks
 * (landmine 15). The store was also run against the real local Postgres +
 * PostgREST when this shipped; the ticket carries that output.
 */

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'SQL');
const SQL_TEXT = ['video_studio_setup.sql', 'video_cut_marks_setup.sql']
  .map((file) => fs.readFileSync(path.join(SQL_DIR, file), 'utf8'))
  .join('\n');
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const projectScopePath = require.resolve('../../lib/projectScope.js');
const sessionsStorePath = require.resolve('../../lib/videoSessionsStore.js');
const sourcesStorePath = require.resolve('../../lib/videoSourcesStore.js');
const transcriptsStorePath = require.resolve('../../lib/videoTranscriptsStore.js');
const cutMarksStorePath = require.resolve('../../lib/videoCutMarksStore.js');
const STORE_PATHS = [
  projectScopePath, sessionsStorePath, sourcesStorePath, transcriptsStorePath, cutMarksStorePath,
];

const SCOPE_A = { projectId: 'proj_a', userId: 'user_1' };
const SCOPE_B = { projectId: 'proj_b', userId: 'user_2' };

function withDb() {
  const schema = parseSchemaText(SQL_TEXT);
  const db = createFakeDb(schema);
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({
      videoSessions: 'video_sessions',
      videoSources: 'video_sources',
      videoTranscripts: 'video_transcripts',
      videoCutMarks: 'video_cut_marks',
    }),
    // A seam so a test can make the database refuse one write.
    sbQuery: (req) => (db.refuse && db.refuse(req)) || db.sbQuery(req),
  };
  const realSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase,
  };
  // projectScope caches its column probe per table, so every store is
  // re-required per test or it answers from the previous test's database.
  for (const p of STORE_PATHS) delete require.cache[p];

  const sessions = require(sessionsStorePath);
  const sources = require(sourcesStorePath);
  const cutMarks = require(cutMarksStorePath);

  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    for (const p of STORE_PATHS) delete require.cache[p];
  }
  return { schema, db, sessions, sources, cutMarks, restore };
}

async function seedSource({ sessions, sources }, scope = SCOPE_A) {
  const session = await sessions.createSession({ title: 'A talk' }, scope);
  assert.equal(session.ok, true, JSON.stringify(session));
  const source = await sources.createSource({ sessionId: session.data.id }, scope);
  assert.equal(source.ok, true, JSON.stringify(source));
  return source.data.id;
}

const THREE_MARKS = {
  state: 'done',
  rulesVersion: 'cut-rules-1',
  model: 'whisper-small',
  durationS: 30,
  verbatimText: 'So, uh, the the price... the price changed.',
  verbatimWords: [
    { start: 0, end: 0.3, word: 'So', p: 0.9 },
    { start: 0.5, end: 0.8, word: 'uh', p: 0.7 },
  ],
  marks: [
    { start: 0.5, end: 0.8, kind: 'filler', keep_s: 0, words: 'uh', why: "An 'uh' before the point." },
    { start: 1, end: 1.25, kind: 'repeat', keep_s: 0, words: 'the', why: "'the' said twice." },
    { start: 4, end: 6.5, kind: 'pause', keep_s: 0.5, words: '', why: 'A 2.5 s silence, kept to half a second.' },
  ],
};

// ── The table ───────────────────────────────────────────────────────────────

test('video_cut_marks carries BOTH tenant columns, RLS, and one row per source per project', () => {
  const schema = parseSchemaText(SQL_TEXT);
  const table = schema.tables.get('video_cut_marks');
  assert.ok(table, 'video_cut_marks is created');
  for (const column of ['project_id', 'owner_user_id']) {
    assert.ok(table.columns.has(column), `${column} must exist (CLAUDE.md landmine 12)`);
  }
  for (const column of ['rules_version', 'verbatim_text', 'verbatim_words', 'marks', 'cut_s', 'updated_at']) {
    assert.ok(table.columns.has(column), `${column} must exist`);
  }
  assert.ok(schema.rlsEnabled.has('video_cut_marks'), 'RLS must be enabled');
  const unique = schema.indexes.find((index) => index.name === 'idx_video_cut_marks_project_source');
  assert.ok(unique && unique.unique, 'the upsert target must be a unique index');
  assert.deepEqual(unique.columns, ['project_id', 'source_id']);
  assert.deepEqual(table.columns.get('state').allowed, ['done', 'failed'],
    'no row means not looked at yet — never a third state');
  assert.deepEqual(
    table.foreignKeys.find((fk) => fk.column === 'source_id'),
    { column: 'source_id', refTable: 'video_sources', refColumn: 'id', onDelete: 'cascade' }
  );
});

// ── upsertCutMarks ──────────────────────────────────────────────────────────

test('three marks round-trip and read back identical, with the total they cut', async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx);
    const saved = await ctx.cutMarks.upsertCutMarks(sourceId, THREE_MARKS, SCOPE_A);
    assert.equal(saved.ok, true, JSON.stringify(saved));

    const read = await ctx.cutMarks.getCutMarksBySource(sourceId, SCOPE_A);
    assert.equal(read.ok, true, JSON.stringify(read));
    assert.deepEqual(read.data.marks, THREE_MARKS.marks);
    assert.deepEqual(read.data.verbatimWords, THREE_MARKS.verbatimWords);
    assert.equal(read.data.verbatimText, THREE_MARKS.verbatimText);
    assert.equal(read.data.rulesVersion, 'cut-rules-1');
    assert.equal(read.data.model, 'whisper-small');
    assert.equal(read.data.durationS, 30);
    // 0.3 + 0.25 + (2.5 - 0.5)
    assert.equal(read.data.cutS, 2.55);
    assert.equal(read.data.projectId, 'proj_a');
    assert.equal(read.data.ownerUserId, 'user_1');
  } finally { ctx.restore(); }
});

test('a second upsert for the same source leaves ONE row carrying the second payload', async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx);
    const first = await ctx.cutMarks.upsertCutMarks(sourceId, { state: 'done', marks: [] }, SCOPE_A);
    assert.equal(first.ok, true, JSON.stringify(first));

    const second = await ctx.cutMarks.upsertCutMarks(sourceId, THREE_MARKS, SCOPE_A);
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.equal(second.data.id, first.data.id, 'the same row, updated — not a second one');

    const rows = ctx.db.data.get('video_cut_marks');
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].marks, THREE_MARKS.marks);
    assert.equal(rows[0].project_id, 'proj_a');
    assert.equal(rows[0].owner_user_id, 'user_1');
  } finally { ctx.restore(); }
});

test('the upsert sends on_conflict AND the merge header — either alone is a 409 on the second save', async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx);
    await ctx.cutMarks.upsertCutMarks(sourceId, THREE_MARKS, SCOPE_A);
    const write = ctx.db.calls.find((call) => call.method === 'POST' && call.table === 'video_cut_marks');
    assert.match(write.query, /(^|&)on_conflict=project_id,source_id(&|$)/);
    assert.match(String(write.headers.Prefer), /resolution=merge-duplicates/);

    // The fake really does refuse without the header, or the assertion above
    // would be guarding nothing.
    const again = await ctx.db.sbQuery({
      method: 'POST',
      table: 'video_cut_marks',
      query: 'on_conflict=project_id,source_id',
      headers: { Prefer: 'return=representation' },
      body: [{ project_id: 'proj_a', owner_user_id: 'user_1', source_id: sourceId, state: 'done' }],
    });
    assert.equal(again.ok, false);
    assert.equal(again.status, 409);
  } finally { ctx.restore(); }
});

test('a refused write is returned as itself — no local-file fallback, no echo of the input', async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx);
    ctx.db.refuse = (req) => (req.method === 'POST' && req.table === 'video_cut_marks'
      ? Promise.resolve({ ok: false, status: 409, error: 'duplicate key value violates unique constraint' })
      : null);
    const res = await ctx.cutMarks.upsertCutMarks(sourceId, THREE_MARKS, SCOPE_A);
    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.equal(res.data, undefined);
  } finally { ctx.restore(); }
});

test('an upsert REPLACES: a failed run after a good one keeps none of the old marks', async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx);
    await ctx.cutMarks.upsertCutMarks(sourceId, THREE_MARKS, SCOPE_A);
    const failed = await ctx.cutMarks.upsertCutMarks(sourceId, {
      state: 'failed', reason: 'whisper exited 1',
    }, SCOPE_A);
    assert.equal(failed.ok, true, JSON.stringify(failed));
    assert.equal(failed.data.state, 'failed');
    assert.equal(failed.data.reason, 'whisper exited 1');
    assert.deepEqual(failed.data.marks, []);
    assert.equal(failed.data.cutS, 0);
    assert.equal(failed.data.verbatimText, '');
    assert.equal(failed.data.rulesVersion, '');
  } finally { ctx.restore(); }
});

test("an upsert in another project's scope cannot reach the source", async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx, SCOPE_A);
    const res = await ctx.cutMarks.upsertCutMarks(sourceId, THREE_MARKS, SCOPE_B);
    assert.equal(res.ok, false);
    assert.equal(res.status, 404);
    assert.equal(ctx.db.data.get('video_cut_marks').length, 0);
  } finally { ctx.restore(); }
});

test('a bad mark is refused with a message naming it, and nothing is written', async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx);
    const good = THREE_MARKS.marks[0];
    const cases = [
      [[good, { ...good, start: 12.7, end: 12.4 }], /marks\[1\] \(filler at 12\.7 s\): start \(12\.7 s\) must be before end \(12\.4 s\)/],
      [[{ ...good, start: 3, end: 3 }], /marks\[0\] \(filler at 3 s\): start .* must be before end/],
      [[good, good, { ...good, kind: 'cough' }], /marks\[2\] \(cough at 0\.5 s\): kind "cough" is not one of pause, filler, repeat, false_start/],
      [[{ ...good, kind: undefined }], /marks\[0\] \(mark at 0\.5 s\): kind undefined is not one of/],
      [[{ ...good, start: '0.5' }], /marks\[0\] \(filler\): start and end must be numbers of seconds/],
      [[{ ...good, keep_s: 1 }], /marks\[0\] .*keep_s \(1 s\) is longer than the mark itself \(0\.3 s\)/],
      [[{ ...good, keep_s: -1 }], /marks\[0\] .*keep_s must be a number of seconds/],
      [[{ ...good, why: { a: 1 } }], /marks\[0\] .*why must be text/],
      [['filler'], /marks\[0\] \(mark\): must be/],
      ['all of them', /marks must be an array/],
    ];
    for (const [marks, message] of cases) {
      const res = await ctx.cutMarks.upsertCutMarks(sourceId, { state: 'done', marks }, SCOPE_A);
      assert.equal(res.ok, false, `${JSON.stringify(marks)} was accepted`);
      assert.equal(res.status, 400);
      assert.match(res.error, message);
    }
    assert.equal(ctx.db.data.get('video_cut_marks').length, 0);
  } finally { ctx.restore(); }
});

test('other junk is refused before anything is written', async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx);
    const cases = [
      [{ state: 'pending' }, /state must be one of done, failed/],
      [{ state: 'failed' }, /reason is required/],
      [{ state: 'done', durationS: 'long' }, /durationS/],
      [{ state: 'done', verbatimText: { a: 1 } }, /verbatimText must be text/],
      [{ state: 'done', verbatimWords: [{ start: 0, end: 1, word: 'x', p: 2 }] }, /verbatimWords: words\[0\]/],
      [{ state: 'done', rulesVersion: 3 }, /rulesVersion must be text/],
      [{ state: 'done', cutS: 99 }, /cutS|cut_s|not accepted|unknown/i],
    ];
    for (const [input, message] of cases) {
      const res = await ctx.cutMarks.upsertCutMarks(sourceId, input, SCOPE_A);
      assert.equal(res.ok, false, `${JSON.stringify(input)} was accepted`);
      assert.equal(res.status, 400);
      assert.match(res.error, message);
    }
    assert.equal(ctx.db.data.get('video_cut_marks').length, 0);
  } finally { ctx.restore(); }
});

test('only the declared mark keys are stored; keep_s, words and why default', async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx);
    const res = await ctx.cutMarks.upsertCutMarks(sourceId, {
      state: 'done',
      marks: [{ start: 1, end: 2, kind: 'false_start', score: 0.4 }],
    }, SCOPE_A);
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.deepEqual(res.data.marks, [{ start: 1, end: 2, kind: 'false_start', keep_s: 0, words: '', why: '' }]);
    assert.equal(res.data.cutS, 1);
  } finally { ctx.restore(); }
});

// ── getCutMarksBySource ─────────────────────────────────────────────────────

test('getCutMarksBySource: the row in scope; null when there is none or it is another project', async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx);
    const none = await ctx.cutMarks.getCutMarksBySource(sourceId, SCOPE_A);
    assert.deepEqual([none.ok, none.status, none.data], [true, 200, null]);

    await ctx.cutMarks.upsertCutMarks(sourceId, THREE_MARKS, SCOPE_A);
    const theirs = await ctx.cutMarks.getCutMarksBySource(sourceId, SCOPE_B);
    assert.deepEqual([theirs.ok, theirs.data], [true, null]);
  } finally { ctx.restore(); }
});

// ── listCutMarkStates ───────────────────────────────────────────────────────

test('listCutMarkStates: keyed by source; an unchecked source is simply absent', async () => {
  const ctx = withDb();
  try {
    const done = await seedSource(ctx);
    const failed = await seedSource(ctx);
    const untouched = await seedSource(ctx);
    await ctx.cutMarks.upsertCutMarks(done, THREE_MARKS, SCOPE_A);
    await ctx.cutMarks.upsertCutMarks(failed, { state: 'failed', reason: 'no audio track' }, SCOPE_A);

    const res = await ctx.cutMarks.listCutMarkStates([done, failed, untouched], SCOPE_A);
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.deepEqual(Object.keys(res.data).sort(), [done, failed].sort());
    assert.equal(res.data[done].state, 'done');
    assert.equal(res.data[done].cutS, 2.55);
    assert.equal(res.data[done].rulesVersion, 'cut-rules-1');
    assert.equal(res.data[failed].state, 'failed');
    assert.equal(res.data[failed].reason, 'no audio track');
    assert.equal('marks' in res.data[done], false, 'the state list carries no marks');

    const other = await ctx.cutMarks.listCutMarkStates([done, failed], SCOPE_B);
    assert.deepEqual(other.data, {});
  } finally { ctx.restore(); }
});

test('listCutMarkStates refuses the wrong shape instead of guessing', async () => {
  const ctx = withDb();
  try {
    const empty = await ctx.cutMarks.listCutMarkStates([], SCOPE_A);
    assert.deepEqual([empty.ok, empty.data], [true, {}]);
    const scopeFirst = await ctx.cutMarks.listCutMarkStates(SCOPE_A);
    assert.equal(scopeFirst.status, 400);
    const tooMany = await ctx.cutMarks.listCutMarkStates(
      Array.from({ length: ctx.cutMarks.MAX_STATE_IDS + 1 }, (_, i) => `id-${i}`),
      SCOPE_A
    );
    assert.equal(tooMany.status, 400);
    assert.match(tooMany.error, /at most/);
  } finally { ctx.restore(); }
});
