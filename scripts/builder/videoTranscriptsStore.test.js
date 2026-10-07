'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * Studio Phase 2 · 1 of 6 (86bcdejyr) — where a recording's transcript lives.
 *
 * Same harness as videoStudioCatalog.test.js: the fake database reads its
 * schema FROM the two setup files, so a tenant column deleted from the SQL
 * fails here rather than quietly disagreeing with the store (landmine 12).
 *
 * The fake implements the two things this store leans on that nothing before
 * it did: PostgREST's upsert — which merges ONLY when `Prefer:
 * resolution=merge-duplicates` asks, and is a plain insert (409 on the second
 * write) when it does not (landmine 15) — and the `plfts` search over the
 * generated tsvector column. Both were also run against the real local
 * Postgres + PostgREST when this shipped; the ticket carries that output.
 */

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'SQL');
const SQL_TEXT = ['video_studio_setup.sql', 'video_transcripts_setup.sql']
  .map((file) => fs.readFileSync(path.join(SQL_DIR, file), 'utf8'))
  .join('\n');
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const projectScopePath = require.resolve('../../lib/projectScope.js');
const sessionsStorePath = require.resolve('../../lib/videoSessionsStore.js');
const sourcesStorePath = require.resolve('../../lib/videoSourcesStore.js');
const transcriptsStorePath = require.resolve('../../lib/videoTranscriptsStore.js');
const STORE_PATHS = [projectScopePath, sessionsStorePath, sourcesStorePath, transcriptsStorePath];

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
    }),
    sbQuery: db.sbQuery,
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
  const transcripts = require(transcriptsStorePath);

  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    for (const p of STORE_PATHS) delete require.cache[p];
  }
  return { schema, db, sessions, sources, transcripts, restore };
}

async function seedSource({ sessions, sources }, scope = SCOPE_A) {
  const session = await sessions.createSession({ title: 'A talk' }, scope);
  assert.equal(session.ok, true, JSON.stringify(session));
  const source = await sources.createSource({ sessionId: session.data.id }, scope);
  assert.equal(source.ok, true, JSON.stringify(source));
  return source.data.id;
}

const PRICING = {
  state: 'done',
  language: 'en',
  model: 'whisper-small',
  durationS: 12.5,
  text: 'Our pricing changed. Nothing else did. Pricing, again.',
  segments: [
    { start: 0, end: 2.1, text: 'Our pricing changed.' },
    { start: 2.1, end: 4, text: 'Nothing else did.' },
    { start: 4, end: 5.5, text: 'Pricing, again.' },
  ],
  words: [{ start: 0, end: 0.3, word: 'Our', p: 0.91 }],
};

// ── The table ───────────────────────────────────────────────────────────────

test('video_transcripts carries BOTH tenant columns, RLS, and one row per source per project', () => {
  const schema = parseSchemaText(SQL_TEXT);
  const table = schema.tables.get('video_transcripts');
  assert.ok(table, 'video_transcripts is created');
  for (const column of ['project_id', 'owner_user_id']) {
    assert.ok(table.columns.has(column), `${column} must exist (CLAUDE.md landmine 12)`);
  }
  assert.ok(schema.rlsEnabled.has('video_transcripts'), 'RLS must be enabled');
  const unique = schema.indexes.find((index) => index.name === 'idx_video_transcripts_project_source');
  assert.ok(unique && unique.unique, 'the upsert target must be a unique index');
  assert.deepEqual(unique.columns, ['project_id', 'source_id']);
  assert.deepEqual(table.columns.get('search_tsv').generated, { config: 'simple', source: 'text' });
  assert.deepEqual(table.columns.get('state').allowed, ['done', 'failed', 'no_audio']);
  assert.deepEqual(
    table.foreignKeys.find((fk) => fk.column === 'source_id'),
    { column: 'source_id', refTable: 'video_sources', refColumn: 'id', onDelete: 'cascade' }
  );
});

// ── upsertTranscript ────────────────────────────────────────────────────────

test('a second upsert for the same source leaves ONE row carrying the second payload', async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx);
    const first = await ctx.transcripts.upsertTranscript(sourceId, {
      state: 'done', text: 'hello world', segments: [{ start: 0, end: 1, text: 'hello world' }],
    }, SCOPE_A);
    assert.equal(first.ok, true, JSON.stringify(first));

    const second = await ctx.transcripts.upsertTranscript(sourceId, PRICING, SCOPE_A);
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.equal(second.data.id, first.data.id, 'the same row, updated — not a second one');

    const rows = ctx.db.data.get('video_transcripts');
    assert.equal(rows.length, 1);
    const [row] = rows;
    assert.equal(row.text, PRICING.text);
    assert.equal(row.language, 'en');
    assert.equal(row.model, 'whisper-small');
    assert.equal(row.duration_s, 12.5);
    assert.deepEqual(row.segments, PRICING.segments);
    assert.deepEqual(row.words, PRICING.words);
    // Both tenant columns stamped — the failure landmine 12 describes writes
    // the row fine and leaves these blank.
    assert.equal(row.project_id, 'proj_a');
    assert.equal(row.owner_user_id, 'user_1');
  } finally { ctx.restore(); }
});

test('the upsert sends on_conflict AND the merge header — either alone is a 409 on the second save', async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx);
    await ctx.transcripts.upsertTranscript(sourceId, PRICING, SCOPE_A);
    const write = ctx.db.calls.find((call) => call.method === 'POST' && call.table === 'video_transcripts');
    assert.match(write.query, /(^|&)on_conflict=project_id,source_id(&|$)/);
    assert.match(String(write.headers.Prefer), /resolution=merge-duplicates/);

    // And the fake really does refuse without the header, or the assertion
    // above would be guarding nothing: the same write, header dropped.
    const again = await ctx.db.sbQuery({
      method: 'POST',
      table: 'video_transcripts',
      query: 'on_conflict=project_id,source_id',
      headers: { Prefer: 'return=representation' },
      body: [{ project_id: 'proj_a', owner_user_id: 'user_1', source_id: sourceId, state: 'done', text: 'x' }],
    });
    assert.equal(again.ok, false);
    assert.equal(again.status, 409);
    assert.match(again.error, /idx_video_transcripts_project_source/);
  } finally { ctx.restore(); }
});

test('an upsert REPLACES: a failed run after a good one keeps none of the old text', async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx);
    await ctx.transcripts.upsertTranscript(sourceId, PRICING, SCOPE_A);
    const failed = await ctx.transcripts.upsertTranscript(sourceId, {
      state: 'failed', reason: 'whisper exited 1',
    }, SCOPE_A);
    assert.equal(failed.ok, true, JSON.stringify(failed));
    assert.equal(failed.data.state, 'failed');
    assert.equal(failed.data.reason, 'whisper exited 1');
    assert.equal(failed.data.text, '');
    assert.deepEqual(failed.data.segments, []);
    assert.equal(failed.data.language, '');

    // ...and the failure leaves the search, too.
    const search = await ctx.transcripts.searchTranscripts('pricing', SCOPE_A);
    assert.deepEqual(search.data, []);
  } finally { ctx.restore(); }
});

test("an upsert in another project's scope cannot reach the source", async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx, SCOPE_A);
    const res = await ctx.transcripts.upsertTranscript(sourceId, PRICING, SCOPE_B);
    assert.equal(res.ok, false);
    assert.equal(res.status, 404);
    assert.equal(ctx.db.data.get('video_transcripts').length, 0);
  } finally { ctx.restore(); }
});

test('junk is refused before anything is written', async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx);
    const cases = [
      [{ state: 'pending' }, /state must be one of/],
      [{ state: 'failed' }, /reason is required/],
      [{ state: 'done', segments: 'hello' }, /segments must be an array/],
      [{ state: 'done', segments: [{ start: '0', end: 1, text: 'x' }] }, /segments\[0\]/],
      [{ state: 'done', words: [{ start: 0, end: 1, word: 'x', p: 2 }] }, /words\[0\]/],
      [{ state: 'done', durationS: 'long' }, /durationS/],
      [{ state: 'done', text: { a: 1 } }, /text must be text/],
      [{ state: 'done', language: true }, /language must be text/],
      [{ state: 'done', searchTsv: 'x' }, /searchTsv|search_tsv|not accepted|unknown/i],
    ];
    for (const [input, message] of cases) {
      const res = await ctx.transcripts.upsertTranscript(sourceId, input, SCOPE_A);
      assert.equal(res.ok, false, `${JSON.stringify(input)} was accepted`);
      assert.equal(res.status, 400);
      assert.match(res.error, message);
    }
    assert.equal(ctx.db.data.get('video_transcripts').length, 0);
  } finally { ctx.restore(); }
});

test('only the declared segment and word keys are stored', async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx);
    const res = await ctx.transcripts.upsertTranscript(sourceId, {
      state: 'done',
      text: 'hi',
      segments: [{ start: 0, end: 1, text: 'hi', tokens: [1, 2], temperature: 0 }],
      words: [{ start: 0, end: 1, word: 'hi' }],
    }, SCOPE_A);
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.deepEqual(res.data.segments, [{ start: 0, end: 1, text: 'hi' }]);
    assert.deepEqual(res.data.words, [{ start: 0, end: 1, word: 'hi', p: null }]);
  } finally { ctx.restore(); }
});

test('the generated search column cannot be written, and is never returned', async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx);
    const direct = await ctx.db.sbQuery({
      method: 'POST',
      table: 'video_transcripts',
      body: [{ project_id: 'proj_a', source_id: sourceId, state: 'done', search_tsv: ['x'] }],
    });
    assert.equal(direct.ok, false);
    assert.match(direct.error, /non-DEFAULT value into column "search_tsv"/);

    await ctx.transcripts.upsertTranscript(sourceId, PRICING, SCOPE_A);
    for (const call of ctx.db.calls.filter((c) => c.table === 'video_transcripts')) {
      assert.doesNotMatch(String(call.query), /select=\*/, 'select=* would ship the tsvector to callers');
    }
  } finally { ctx.restore(); }
});

// ── getTranscriptBySource ───────────────────────────────────────────────────

test('getTranscriptBySource: the row in scope; null when there is none or it is another project', async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx);
    const none = await ctx.transcripts.getTranscriptBySource(sourceId, SCOPE_A);
    assert.deepEqual([none.ok, none.status, none.data], [true, 200, null]);

    await ctx.transcripts.upsertTranscript(sourceId, PRICING, SCOPE_A);
    const mine = await ctx.transcripts.getTranscriptBySource(sourceId, SCOPE_A);
    assert.equal(mine.data.text, PRICING.text);
    assert.equal(mine.data.projectId, 'proj_a');
    assert.equal(mine.data.ownerUserId, 'user_1');

    const theirs = await ctx.transcripts.getTranscriptBySource(sourceId, SCOPE_B);
    assert.deepEqual([theirs.ok, theirs.data], [true, null]);
  } finally { ctx.restore(); }
});

// ── listTranscriptStates ────────────────────────────────────────────────────

test('listTranscriptStates: keyed by source; an untranscribed source is simply absent', async () => {
  const ctx = withDb();
  try {
    const done = await seedSource(ctx);
    const failed = await seedSource(ctx);
    const untouched = await seedSource(ctx);
    await ctx.transcripts.upsertTranscript(done, PRICING, SCOPE_A);
    await ctx.transcripts.upsertTranscript(failed, { state: 'failed', reason: 'no model' }, SCOPE_A);

    const res = await ctx.transcripts.listTranscriptStates([done, failed, untouched], SCOPE_A);
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.deepEqual(Object.keys(res.data).sort(), [done, failed].sort());
    assert.equal(res.data[done].state, 'done');
    assert.equal(res.data[done].durationS, 12.5);
    assert.equal(res.data[failed].state, 'failed');
    assert.equal(res.data[failed].reason, 'no model');
    assert.equal('text' in res.data[done], false, 'the screen list carries no transcript text');

    const other = await ctx.transcripts.listTranscriptStates([done, failed], SCOPE_B);
    assert.deepEqual(other.data, {});
  } finally { ctx.restore(); }
});

test('listTranscriptStates refuses the wrong shape instead of guessing', async () => {
  const ctx = withDb();
  try {
    const empty = await ctx.transcripts.listTranscriptStates([], SCOPE_A);
    assert.deepEqual([empty.ok, empty.data], [true, {}]);
    const scopeFirst = await ctx.transcripts.listTranscriptStates(SCOPE_A);
    assert.equal(scopeFirst.status, 400);
    const tooMany = await ctx.transcripts.listTranscriptStates(
      Array.from({ length: ctx.transcripts.MAX_STATE_IDS + 1 }, (_, i) => `id-${i}`),
      SCOPE_A
    );
    assert.equal(tooMany.status, 400);
    assert.match(tooMany.error, /at most/);
  } finally { ctx.restore(); }
});

// ── searchTranscripts ───────────────────────────────────────────────────────

test("searchTranscripts('pricing') returns the source and the segments that say it, with start times", async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx);
    await ctx.transcripts.upsertTranscript(sourceId, PRICING, SCOPE_A);

    const res = await ctx.transcripts.searchTranscripts('pricing', SCOPE_A);
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.data.length, 1);
    assert.equal(res.data[0].sourceId, sourceId);
    assert.deepEqual(res.data[0].matches, [
      { start: 0, end: 2.1, text: 'Our pricing changed.' },
      { start: 4, end: 5.5, text: 'Pricing, again.' },
    ]);
  } finally { ctx.restore(); }
});

test('a word nobody said is an empty list, not an error; every word must be in the recording', async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx);
    await ctx.transcripts.upsertTranscript(sourceId, PRICING, SCOPE_A);

    const absent = await ctx.transcripts.searchTranscripts('zebra', SCOPE_A);
    assert.deepEqual([absent.ok, absent.status, absent.data], [true, 200, []]);

    const both = await ctx.transcripts.searchTranscripts('Pricing NOTHING', SCOPE_A);
    assert.equal(both.data.length, 1);
    assert.deepEqual(both.data[0].matches.map((m) => m.start), [0, 2.1, 4]);

    const half = await ctx.transcripts.searchTranscripts('pricing zebra', SCOPE_A);
    assert.deepEqual(half.data, []);
  } finally { ctx.restore(); }
});

test("searchTranscripts never returns another project's recordings", async () => {
  const ctx = withDb();
  try {
    const sourceId = await seedSource(ctx, SCOPE_A);
    await ctx.transcripts.upsertTranscript(sourceId, PRICING, SCOPE_A);
    const res = await ctx.transcripts.searchTranscripts('pricing', SCOPE_B);
    assert.deepEqual([res.ok, res.data], [true, []]);
  } finally { ctx.restore(); }
});

test('searchTranscripts refuses a blank query and both argument misorderings', async () => {
  const ctx = withDb();
  try {
    const blank = await ctx.transcripts.searchTranscripts('  ,. ', SCOPE_A);
    assert.equal(blank.status, 400);
    const scopeFirst = await ctx.transcripts.searchTranscripts(SCOPE_A, 'pricing');
    assert.equal(scopeFirst.status, 400);
    assert.match(scopeFirst.error, /\(query, scope, limit\)/);
    const limitFirst = await ctx.transcripts.searchTranscripts(20, 'pricing', SCOPE_A);
    assert.equal(limitFirst.status, 400);
    const scopeAsLimit = await ctx.transcripts.searchTranscripts('pricing', SCOPE_A, SCOPE_A);
    assert.equal(scopeAsLimit.status, 400);
    assert.equal(ctx.db.calls.filter((c) => c.table === 'video_transcripts').length, 0,
      'nothing reached the database');
  } finally { ctx.restore(); }
});

test('searchWords splits the way the simple config does: case-folded, punctuation dropped', () => {
  const { searchWords } = require('../../lib/videoTranscriptsStore.js');
  assert.deepEqual(searchWords("Pricing, it's ÜBER-cheap!"), ['pricing', 'it', 's', 'über', 'cheap']);
  assert.deepEqual(searchWords(''), []);
});
