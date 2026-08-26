'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * Studio Phase 1 · 1 of 8 (86bbjv681) — the catalog tables and their stores.
 *
 * The fake database underneath these tests reads its schema FROM
 * docs/SQL/video_studio_setup.sql (scripts/builder/sqlSchemaFake.js), so a
 * column deleted from the SQL fails the test rather than quietly disagreeing
 * with the code. That matters most for the two tenant columns: a table
 * carrying only one makes lib/projectScope.js's probe fail, and scopedInsertRow
 * then stops stamping EITHER — inserts still succeed and the rows land with no
 * tenant at all (CLAUDE.md landmine 12; 550 such rows shipped on 2026-08-16).
 */

const SQL_PATH = path.join(__dirname, '..', '..', 'docs', 'SQL', 'video_studio_setup.sql');
const { parseSchemaFile, parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const projectScopePath = require.resolve('../../lib/projectScope.js');
const sessionsStorePath = require.resolve('../../lib/videoSessionsStore.js');
const sourcesStorePath = require.resolve('../../lib/videoSourcesStore.js');

const SCOPE_A = { projectId: 'proj_a', userId: 'user_1' };
const SCOPE_B = { projectId: 'proj_b', userId: 'user_2' };

/** Swap lib/supabase for the SQL-backed fake and hand back live stores. */
function withDb(wrapQuery = null) {
  const schema = parseSchemaFile(SQL_PATH);
  const db = createFakeDb(schema);
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({ videoSessions: 'video_sessions', videoSources: 'video_sources' }),
    sbQuery: wrapQuery ? wrapQuery(db.sbQuery) : db.sbQuery,
  };

  const realSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase,
  };
  // projectScope destructures sbQuery at load AND caches its column probe per
  // table, so it must be re-required per test or it answers from the last one.
  delete require.cache[projectScopePath];
  delete require.cache[sessionsStorePath];
  delete require.cache[sourcesStorePath];

  const projectScope = require(projectScopePath);
  const sessions = require(sessionsStorePath);
  const sources = require(sourcesStorePath);

  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    delete require.cache[projectScopePath];
    delete require.cache[sessionsStorePath];
    delete require.cache[sourcesStorePath];
  }

  return { schema, db, projectScope, sessions, sources, restore };
}

/**
 * A uuid-SHAPED literal for a test that needs a fixed id.
 *
 * The fake checks declared types now, so `'fixed-id'` in a uuid column is a
 * 400 before it can reach the constraint the test is actually about. These
 * stay hand-written rather than generated so each test's ids are legible.
 */
function uuid(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

async function seedSession(sessions, scope = SCOPE_A, title = 'A talk') {
  const created = await sessions.createSession({ title }, scope);
  assert.equal(created.ok, true, created.error);
  return created.data;
}

// ── The schema itself ───────────────────────────────────────────────────────

test('both tables carry BOTH tenant columns, and project_id is text', () => {
  const schema = parseSchemaFile(SQL_PATH);
  for (const tableName of ['video_sessions', 'video_sources']) {
    const table = schema.tables.get(tableName);
    assert.ok(table, `${tableName} is missing from the SQL`);
    const projectId = table.columns.get('project_id');
    assert.ok(projectId, `${tableName} has no project_id`);
    assert.ok(
      table.columns.get('owner_user_id'),
      `${tableName} has project_id but no owner_user_id — scopedInsertRow would stamp NEITHER`
    );
    assert.equal(projectId.type, 'text', `${tableName}.project_id must be text, never uuid (DOCTRINE 5.13)`);
    assert.equal(projectId.notNull, true, `${tableName}.project_id must be not null`);
    assert.ok(schema.rlsEnabled.has(tableName), `${tableName} does not enable row level security`);
  }
});

test("lib/projectScope.js's column probe succeeds on both tables", async () => {
  const { projectScope, restore } = withDb();
  try {
    assert.equal(await projectScope.supportsProjectColumns('video_sessions'), true);
    assert.equal(await projectScope.supportsProjectColumns('video_sources'), true);
  } finally {
    restore();
  }
});

test('the probe FAILS on a table missing owner_user_id — the guard above can fail', async () => {
  // Proves the probe test is a real test: same code, one column removed.
  const schema = parseSchemaText(`
    create table if not exists public.video_sessions (
      id uuid primary key default gen_random_uuid(),
      project_id text not null,
      title text not null default ''
    );
    alter table public.video_sessions enable row level security;
  `);
  const db = createFakeDb(schema);
  const realSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true,
    exports: { isConfigured: () => true, tableConfig: () => ({}), sbQuery: db.sbQuery },
  };
  delete require.cache[projectScopePath];
  try {
    const projectScope = require(projectScopePath);
    assert.equal(await projectScope.supportsProjectColumns('video_sessions'), false);
    const row = await projectScope.scopedInsertRow('video_sessions', { title: 'x' }, SCOPE_A);
    assert.equal(row.project_id, undefined, 'this is the silent failure landmine 12 describes');
  } finally {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    delete require.cache[projectScopePath];
  }
});

test('the SQL is idempotent: every statement is guarded, and parsing it twice is identical', () => {
  const sql = fs.readFileSync(SQL_PATH, 'utf8');
  const once = parseSchemaText(sql);
  const twice = parseSchemaText(`${sql}\n${sql}`);

  assert.deepEqual([...twice.tables.keys()], [...once.tables.keys()]);
  assert.deepEqual(twice.indexes.map((i) => i.name), once.indexes.map((i) => i.name));
  for (const [name, table] of once.tables) {
    assert.deepEqual([...twice.tables.get(name).columns.keys()], [...table.columns.keys()]);
  }

  for (const statement of once.statements) {
    const normalized = statement.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized.startsWith('create')) {
      assert.ok(
        normalized.includes('if not exists'),
        `not idempotent — "${normalized.slice(0, 70)}" would fail on a second run`
      );
    }
    assert.ok(
      !/^(drop|truncate|delete)\b/.test(normalized),
      `a setup file must not destroy anything: "${normalized.slice(0, 70)}"`
    );
  }
});

// ── Tenanting: the row that actually lands ──────────────────────────────────

test('a session written through scopedInsertRow READS BACK with a project_id', async () => {
  const { db, sessions, restore } = withDb();
  try {
    const created = await sessions.createSession({ title: 'Delray walkthrough' }, SCOPE_A);
    assert.equal(created.ok, true);
    assert.equal(created.status, 201);

    // Do NOT trust the insert's success — read the stored row back.
    const stored = db.data.get('video_sessions')[0];
    assert.equal(stored.project_id, 'proj_a');
    assert.ok(String(stored.project_id).trim().length > 0, 'row landed untenanted');
    assert.equal(stored.owner_user_id, 'user_1');

    const readBack = await sessions.getSessionById(created.data.id, SCOPE_A);
    assert.equal(readBack.ok, true);
    assert.equal(readBack.data.projectId, 'proj_a');
  } finally {
    restore();
  }
});

test('a source written through scopedInsertRow READS BACK with a project_id', async () => {
  const { db, sessions, sources, restore } = withDb();
  try {
    const session = await seedSession(sessions);
    const created = await sources.createSource(
      { sessionId: session.id, layerRole: 'subject', contentHash: 'abc123' },
      SCOPE_A
    );
    assert.equal(created.ok, true, created.error);

    const stored = db.data.get('video_sources')[0];
    assert.equal(stored.project_id, 'proj_a');
    assert.equal(stored.owner_user_id, 'user_1');
    assert.equal(stored.layer_role, 'subject');
  } finally {
    restore();
  }
});

test("another project cannot read this project's session", async () => {
  const { sessions, restore } = withDb();
  try {
    const session = await seedSession(sessions, SCOPE_A);
    const stolen = await sessions.getSessionById(session.id, SCOPE_B);
    assert.equal(stolen.ok, false);
    assert.equal(stolen.status, 404);
  } finally {
    restore();
  }
});

// ── content_hash dedupe ─────────────────────────────────────────────────────

test('the same content_hash twice in ONE project is rejected', async () => {
  const { sessions, sources, restore } = withDb();
  try {
    const session = await seedSession(sessions);
    const first = await sources.createSource(
      { sessionId: session.id, contentHash: 'hash-1', layerRole: 'background' }, SCOPE_A
    );
    assert.equal(first.ok, true, first.error);

    const second = await sources.createSource(
      { sessionId: session.id, contentHash: 'hash-1', layerRole: 'reference' }, SCOPE_A
    );
    assert.equal(second.ok, false);
    assert.equal(second.status, 409);
    assert.match(second.error, /already in the catalog/i);
  } finally {
    restore();
  }
});

test('the same content_hash under a DIFFERENT project is allowed', async () => {
  const { db, sessions, sources, restore } = withDb();
  try {
    const sessionA = await seedSession(sessions, SCOPE_A);
    const sessionB = await seedSession(sessions, SCOPE_B, 'Another shoot');

    const first = await sources.createSource({ sessionId: sessionA.id, contentHash: 'shared' }, SCOPE_A);
    const second = await sources.createSource({ sessionId: sessionB.id, contentHash: 'shared' }, SCOPE_B);

    assert.equal(first.ok, true, first.error);
    assert.equal(second.ok, true, second.error);
    assert.equal(db.data.get('video_sources').length, 2);
  } finally {
    restore();
  }
});

test('rows with no content_hash yet do not collide with each other', async () => {
  const { sessions, sources, restore } = withDb();
  try {
    const session = await seedSession(sessions);
    const first = await sources.createSource({ sessionId: session.id }, SCOPE_A);
    const second = await sources.createSource({ sessionId: session.id }, SCOPE_A);
    assert.equal(first.ok, true, first.error);
    assert.equal(second.ok, true, 'the unique index is partial: hashes are null until Studio 4/8 reads the bytes');
  } finally {
    restore();
  }
});

// ── layer_role ──────────────────────────────────────────────────────────────

test('layer_role accepts exactly the four values, in the store and in the table', async () => {
  const { db, sessions, sources, restore } = withDb();
  try {
    const session = await seedSession(sessions);
    for (const role of ['background', 'subject', 'plate', 'reference']) {
      const created = await sources.createSource({ sessionId: session.id, layerRole: role }, SCOPE_A);
      assert.equal(created.ok, true, `${role} should be allowed: ${created.error}`);
      assert.equal(created.data.layerRole, role);
    }

    const rejected = await sources.createSource({ sessionId: session.id, layerRole: 'hero' }, SCOPE_A);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.status, 400);

    // And the table refuses it too, so a future caller that skips the store
    // cannot write a fifth role.
    const direct = await db.sbQuery({
      method: 'POST',
      table: 'video_sources',
      query: 'select=*',
      body: [{ project_id: 'proj_a', session_id: session.id, layer_role: 'hero' }],
    });
    assert.equal(direct.ok, false);
    assert.match(direct.error, /check constraint/i);
  } finally {
    restore();
  }
});

// ── Envelopes and the limit-first signature ─────────────────────────────────

test('every store function returns the { ok, status, data } envelope', async () => {
  const { sessions, sources, restore } = withDb();
  try {
    const session = await seedSession(sessions);
    const source = await sources.createSource({ sessionId: session.id }, SCOPE_A);

    const results = [
      await sessions.getSessionById(session.id, SCOPE_A),
      await sessions.listSessions(10, SCOPE_A),
      await sessions.updateSession(session.id, { state: 'ready' }, SCOPE_A),
      await sources.getSourceById(source.data.id, SCOPE_A),
      await sources.listSources(10, SCOPE_A),
      await sources.listSourcesForSession(session.id, SCOPE_A),
      await sources.updateSource(source.data.id, { state: 'probed', width: 1920 }, SCOPE_A),
    ];

    for (const result of results) {
      assert.equal(typeof result.ok, 'boolean', 'a store returned a bare row, not an envelope');
      assert.equal(typeof result.status, 'number');
      assert.ok('data' in result, 'no data key on the envelope');
      assert.equal(result.ok, true, result.error);
    }
    assert.equal(results[1].status, 200);
    assert.ok(Array.isArray(results[1].data));
  } finally {
    restore();
  }
});

test('lists take the LIMIT first — a scope in that position is refused, not coerced', async () => {
  const { sessions, sources, restore } = withDb();
  try {
    await seedSession(sessions, SCOPE_A);
    await seedSession(sessions, SCOPE_B, 'Other project');

    // The bug this guards (DOCTRINE 5.10): listSessions(scope) would read the
    // scope as a limit, apply no project filter, and return both projects.
    const wrong = await sessions.listSessions(SCOPE_A);
    assert.equal(wrong.ok, false);
    assert.equal(wrong.status, 400);
    assert.match(wrong.error, /limit must be a number/i);

    const wrongSources = await sources.listSources(SCOPE_A);
    assert.equal(wrongSources.ok, false);
    assert.equal(wrongSources.status, 400);

    const right = await sessions.listSessions(50, SCOPE_A);
    assert.equal(right.ok, true);
    assert.equal(right.data.length, 1, 'only this project’s sessions');
    assert.equal(right.data[0].projectId, 'proj_a');
  } finally {
    restore();
  }
});

test('a list defaults its limit and caps it', async () => {
  const { db, sessions, restore } = withDb();
  try {
    await sessions.listSessions(undefined, SCOPE_A);
    await sessions.listSessions(99999, SCOPE_A);
    const queries = db.calls.filter((call) => call.method === 'GET').map((call) => call.query);
    assert.ok(queries.some((query) => query.includes('limit=200')), 'default limit');
    assert.ok(queries.some((query) => query.includes('limit=1000')), 'capped limit');
  } finally {
    restore();
  }
});

// ── Updates ─────────────────────────────────────────────────────────────────

test('a session records its programme-audio source and sync confidence', async () => {
  const { sessions, sources, restore } = withDb();
  try {
    const session = await seedSession(sessions);
    const source = await sources.createSource({ sessionId: session.id, layerRole: 'subject' }, SCOPE_A);

    const updated = await sessions.updateSession(
      session.id,
      { programAudioSourceId: source.data.id, syncConfidence: 0.92, state: 'synced' },
      SCOPE_A
    );
    assert.equal(updated.ok, true, updated.error);
    assert.equal(updated.data.programAudioSourceId, source.data.id);
    assert.equal(updated.data.syncConfidence, 0.92);
    assert.equal(updated.data.state, 'synced');
  } finally {
    restore();
  }
});

test('sync confidence is clamped to 0..1 so it cannot be stored as a percentage', async () => {
  const { sessions, restore } = withDb();
  try {
    const session = await seedSession(sessions);
    const updated = await sessions.updateSession(session.id, { syncConfidence: 92 }, SCOPE_A);
    assert.equal(updated.data.syncConfidence, 1);
  } finally {
    restore();
  }
});

test('an unknown state is refused rather than written', async () => {
  const { db, sessions, restore } = withDb();
  try {
    const session = await seedSession(sessions);
    const before = db.calls.length;
    const bad = await sessions.updateSession(session.id, { state: 'rendering' }, SCOPE_A);
    assert.equal(bad.ok, false);
    assert.equal(bad.status, 400);
    assert.equal(db.calls.length, before, 'nothing should have been sent');
  } finally {
    restore();
  }
});

test("another project's update finds nothing and says so", async () => {
  const { sessions, restore } = withDb();
  try {
    const session = await seedSession(sessions, SCOPE_A);
    const stolen = await sessions.updateSession(session.id, { state: 'ready' }, SCOPE_B);
    assert.equal(stolen.ok, false);
    assert.equal(stolen.status, 404);
  } finally {
    restore();
  }
});

test('a session lists only its own sources', async () => {
  const { sessions, sources, restore } = withDb();
  try {
    const first = await seedSession(sessions, SCOPE_A, 'First');
    const second = await seedSession(sessions, SCOPE_A, 'Second');
    await sources.createSource({ sessionId: first.id, layerRole: 'background' }, SCOPE_A);
    await sources.createSource({ sessionId: first.id, layerRole: 'subject' }, SCOPE_A);
    await sources.createSource({ sessionId: second.id, layerRole: 'plate' }, SCOPE_A);

    const listed = await sources.listSourcesForSession(first.id, SCOPE_A);
    assert.equal(listed.ok, true);
    assert.equal(listed.data.length, 2);
    assert.deepEqual(listed.data.map((row) => row.layerRole), ['background', 'subject']);
  } finally {
    restore();
  }
});

test('the probe columns land as numbers the pipeline can use', async () => {
  const { sessions, sources, restore } = withDb();
  try {
    const session = await seedSession(sessions);
    const created = await sources.createSource({ sessionId: session.id }, SCOPE_A);
    const updated = await sources.updateSource(created.data.id, {
      durationS: '61.5', width: '1920', height: '1080', fps: '29.97',
      codec: 'hevc', deviceLane: 'iphone', state: 'probed',
    }, SCOPE_A);

    assert.equal(updated.ok, true, updated.error);
    assert.equal(updated.data.durationS, 61.5);
    assert.equal(updated.data.width, 1920);
    assert.equal(updated.data.fps, 29.97);
    assert.equal(updated.data.codec, 'hevc');
    assert.equal(updated.data.deviceLane, 'iphone');
  } finally {
    restore();
  }
});

// ── Review fixes on PR #422 ─────────────────────────────────────────────────

/**
 * Five things review found, three of them blockers. The two that matter most
 * are a tenancy hole in the ticket whose whole subject is tenancy, and a test
 * fake that silently ignored ORDER BY — so twenty ordering assertions were
 * asserting nothing at all.
 */

test('a source cannot be attached to ANOTHER project\'s session', async () => {
  // The foreign key is satisfied by any session anywhere, so without an
  // explicit check project A could hang a row off project B's session: the row
  // lands stamped project_id = A while living under B's session, and B
  // deleting that session cascades A's row away. Review reproduced exactly
  // that, end to end.
  const { sessions, sources, restore } = withDb();
  try {
    const bSession = await seedSession(sessions, SCOPE_B, "B's private session");

    const stolen = await sources.createSource({ sessionId: bSession.id, layerRole: 'reference' }, SCOPE_A);
    assert.equal(stolen.ok, false, 'A must not be able to attach to B\'s session');
    assert.equal(stolen.status, 404);
    assert.match(stolen.error, /does not exist in this project/);

    // And B is unaffected — nothing was created anywhere.
    const bList = await sources.listSourcesForSession(bSession.id, SCOPE_B);
    assert.equal(bList.ok, true, bList.error);
    assert.equal(bList.data.length, 0, 'nothing may have been written under B');
  } finally { restore(); }
});

test('a session id that does not exist says so, instead of "already in the catalog"', async () => {
  // isDuplicateHashError used to treat ANY 409 as a duplicate hash, and
  // PostgREST answers 409 for a foreign-key violation too — so a bad session
  // id produced a message that lied about what went wrong.
  const { sources, restore } = withDb();
  try {
    const out = await sources.createSource({ sessionId: 'no_such_session', layerRole: 'reference' }, SCOPE_A);
    assert.equal(out.ok, false);
    assert.match(out.error, /does not exist in this project/);
    assert.doesNotMatch(out.error, /already in the catalog/, 'it must not blame a duplicate hash');
  } finally { restore(); }
});

test('a genuine duplicate content hash still says duplicate', async () => {
  // The other half: narrowing the match must not stop it recognising the real
  // thing.
  const { sessions, sources, restore } = withDb();
  try {
    const session = await seedSession(sessions);
    const first = await sources.createSource(
      { sessionId: session.id, layerRole: 'reference', contentHash: 'abc123' }, SCOPE_A);
    assert.equal(first.ok, true, first.error);

    const second = await sources.createSource(
      { sessionId: session.id, layerRole: 'reference', contentHash: 'abc123' }, SCOPE_A);
    assert.equal(second.ok, false);
    assert.equal(second.status, 409);
    assert.match(second.error, /already in the catalog/);
  } finally { restore(); }
});

test('an unparseable date is a 400, not a silent wipe', async () => {
  // updateSource(id, { recordedAt: 'not a date' }) used to answer ok:true and
  // erase the timestamp the row already had — the only invalid input in these
  // stores that destroyed data and reported success.
  const { sessions, sources, restore } = withDb();
  try {
    const session = await seedSession(sessions);
    const src = await sources.createSource(
      { sessionId: session.id, layerRole: 'reference', recordedAt: '2026-08-01T10:00:00Z' }, SCOPE_A);
    assert.equal(src.ok, true, src.error);
    assert.ok(src.data.recordedAt, 'the good date must have been stored');

    const bad = await sources.updateSource(src.data.id, { recordedAt: 'not a date' }, SCOPE_A);
    assert.equal(bad.ok, false, 'a bad date must be refused');
    assert.equal(bad.status, 400);

    // And the value it already had is still there.
    const after = await sources.getSourceById(src.data.id, SCOPE_A);
    assert.equal(after.ok, true, after.error);
    assert.ok(after.data.recordedAt, 'the existing timestamp must not have been wiped');
  } finally { restore(); }
});

test('a bad date is refused on the way in too, on both stores', async () => {
  const { sessions, sources, restore } = withDb();
  try {
    const badSession = await sessions.createSession({ title: 'x', recordedAt: 'nonsense' }, SCOPE_A);
    assert.equal(badSession.ok, false);
    assert.equal(badSession.status, 400);

    const session = await seedSession(sessions);
    const badSource = await sources.createSource(
      { sessionId: session.id, layerRole: 'reference', recordedAt: 'nonsense' }, SCOPE_A);
    assert.equal(badSource.ok, false);
    assert.equal(badSource.status, 400);
  } finally { restore(); }
});

test('a content hash is STORED at one length, whichever path wrote it', async () => {
  // It was capped at 200 on create and 1000 on update, so the same value was
  // stored differently depending on how it got there.
  //
  // This test asserts against the row in the database, not against what the
  // stores hand back. The first version compared updateSource's return value
  // to createSource's, and both of those have already been through
  // rowToSource, which truncates content_hash to probeLimit('contentHash') on
  // the way OUT. A 400-character write and a 200-character write therefore
  // read back identical and the assertion held either way — review reinstated
  // the exact bug and this test still reported a pass while the stored value
  // went from 200 characters to 400. An assertion that cannot fail is worse
  // than no test on a column the per-project dedupe index is built on.
  const { db, sessions, sources, restore } = withDb();
  try {
    const limit = sources.probeLimit('contentHash');
    const session = await seedSession(sessions);
    const long = 'h'.repeat(limit * 2);

    const created = await sources.createSource(
      { sessionId: session.id, layerRole: 'reference', contentHash: long }, SCOPE_A);
    assert.equal(created.ok, true, created.error);

    const storedRow = () => db.data.get('video_sources')
      .find((row) => row.id === created.data.id);

    assert.equal(storedRow().content_hash.length, limit,
      'createSource must store the hash capped at the declared length');

    const updated = await sources.updateSource(created.data.id, { contentHash: long }, SCOPE_A);
    assert.equal(updated.ok, true, updated.error);

    assert.equal(storedRow().content_hash.length, limit,
      'updateSource must store the hash capped at the SAME declared length');
  } finally { restore(); }
});

// ── The fake now actually orders ────────────────────────────────────────────

test('the fake applies ORDER BY, ascending and descending', () => {
  const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');
  const schema = parseSchemaText(`
    create table if not exists public.t (
      id text primary key,
      n integer,
      s text
    );
  `);
  const db = createFakeDb(schema);
  const rows = [
    { id: 'a', n: 2, s: 'beta' },
    { id: 'b', n: 1, s: 'alpha' },
    { id: 'c', n: 3, s: 'gamma' },
  ];
  return (async () => {
    for (const row of rows) {
      await db.sbQuery({ method: 'POST', table: 't', query: 'select=*', body: [row] });
    }
    const asc = await db.sbQuery({ method: 'GET', table: 't', query: 'select=*&order=n.asc' });
    assert.deepEqual(asc.data.map((r) => r.id), ['b', 'a', 'c']);

    const desc = await db.sbQuery({ method: 'GET', table: 't', query: 'select=*&order=n.desc' });
    assert.deepEqual(desc.data.map((r) => r.id), ['c', 'a', 'b']);

    const bare = await db.sbQuery({ method: 'GET', table: 't', query: 'select=*&order=s' });
    assert.deepEqual(bare.data.map((r) => r.id), ['b', 'a', 'c'], 'no direction means ascending');
  })();
});

test('the fake honours nulls first/last, and Postgres defaults', () => {
  const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');
  const schema = parseSchemaText('create table if not exists public.t ( id text primary key, n integer );');
  const db = createFakeDb(schema);
  return (async () => {
    for (const row of [{ id: 'a', n: 1 }, { id: 'b', n: null }, { id: 'c', n: 2 }]) {
      await db.sbQuery({ method: 'POST', table: 't', query: 'select=*', body: [row] });
    }
    const ascDefault = await db.sbQuery({ method: 'GET', table: 't', query: 'select=*&order=n.asc' });
    assert.deepEqual(ascDefault.data.map((r) => r.id), ['a', 'c', 'b'], 'ASC defaults to nulls last');

    const descDefault = await db.sbQuery({ method: 'GET', table: 't', query: 'select=*&order=n.desc' });
    assert.deepEqual(descDefault.data.map((r) => r.id), ['b', 'c', 'a'], 'DESC defaults to nulls first');

    const explicit = await db.sbQuery({ method: 'GET', table: 't', query: 'select=*&order=n.asc.nullsfirst' });
    assert.deepEqual(explicit.data.map((r) => r.id), ['b', 'a', 'c']);
  })();
});

test('the fake orders by more than one key', () => {
  const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');
  const schema = parseSchemaText('create table if not exists public.t ( id text primary key, g text, n integer );');
  const db = createFakeDb(schema);
  return (async () => {
    for (const row of [
      { id: 'a', g: 'x', n: 2 }, { id: 'b', g: 'x', n: 1 }, { id: 'c', g: 'w', n: 9 },
    ]) {
      await db.sbQuery({ method: 'POST', table: 't', query: 'select=*', body: [row] });
    }
    const out = await db.sbQuery({ method: 'GET', table: 't', query: 'select=*&order=g.asc,n.asc' });
    assert.deepEqual(out.data.map((r) => r.id), ['c', 'b', 'a']);
  })();
});

test('the fake REFUSES an unknown order column, as PostgREST does', () => {
  // The proof review used: pointing a list at order=no_such_column.asc used to
  // pass all 20 tests. Silently ignoring it is what kept the hole open.
  const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');
  const schema = parseSchemaText('create table if not exists public.t ( id text primary key );');
  const db = createFakeDb(schema);
  return (async () => {
    const out = await db.sbQuery({ method: 'GET', table: 't', query: 'select=*&order=no_such_column.asc' });
    assert.equal(out.ok, false);
    assert.equal(out.status, 400);
    assert.match(out.error, /no_such_column/);
  })();
});

test('the fake orders BEFORE limiting', () => {
  // Limiting first returns a different SET of rows, not merely a differently
  // sorted one — the classic off-by-a-whole-query mistake.
  const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');
  const schema = parseSchemaText('create table if not exists public.t ( id text primary key, n integer );');
  const db = createFakeDb(schema);
  return (async () => {
    for (const row of [{ id: 'a', n: 3 }, { id: 'b', n: 1 }, { id: 'c', n: 2 }]) {
      await db.sbQuery({ method: 'POST', table: 't', query: 'select=*', body: [row] });
    }
    const out = await db.sbQuery({ method: 'GET', table: 't', query: 'select=*&order=n.asc&limit=2' });
    assert.deepEqual(out.data.map((r) => r.id), ['b', 'c'], 'the two SMALLEST, not the first two inserted');
  })();
});

test('sessionId is still not patchable — if that changes, it needs the tenancy check', () => {
  // updateSource does not accept sessionId today, which is why createSource is
  // the only place the ownership check lives. If a later slice makes it
  // patchable without adding the same check, this fails and says why.
  const src = fs.readFileSync(path.join(__dirname, '../../lib/videoSourcesStore.js'), 'utf8');
  const updateBody = src.slice(src.indexOf('async function updateSource'));
  assert.ok(!/next\.session_id/.test(updateBody),
    'updateSource now sets session_id — it must call getSessionById(scope) first, as createSource does');
});

test('a 409 is only a duplicate hash when it actually says so', () => {
  // isDuplicateHashError used to return true for ANY 409, and PostgREST
  // answers 409 for a foreign-key violation too.
  //
  // Tested directly because createSource's tenancy check now catches a missing
  // session BEFORE the insert, leaving this branch reachable only in a race —
  // the session deleted between the check and the write. A break-test proved
  // that: reinstating "any 409" failed nothing through createSource, which
  // means this predicate had no coverage at all.
  const sources = require('../../lib/videoSourcesStore.js');
  const { isDuplicateHashError, isMissingSessionError } = sources;

  const fk = { status: 409, error: 'insert or update on table "video_sources" violates foreign key constraint "video_sources_session_id_fkey" (23503)' };
  assert.equal(isDuplicateHashError(fk), false, 'a foreign-key violation is not a duplicate hash');
  assert.equal(isMissingSessionError(fk), true);

  const dup = { status: 409, error: 'duplicate key value violates unique constraint "idx_video_sources_project_content_hash" (23505)' };
  assert.equal(isDuplicateHashError(dup), true);
  assert.equal(isMissingSessionError(dup), false);

  // A 409 that says neither is neither — it falls through to the raw response
  // rather than being described as something it is not.
  const vague = { status: 409, error: 'conflict' };
  assert.equal(isDuplicateHashError(vague), false);
  assert.equal(isMissingSessionError(vague), false);
});

// ── Review round three on PR #422 ───────────────────────────────────────────
// Five defects, and four of them are the SAME defect the first two rounds
// already sent this back for, in a column the fix did not reach: an invalid
// input that DESTROYS the value it was meant to replace and reports success.
// The date was fixed in round one; the numbers went on doing exactly what the
// date used to do. These tests are written per COLUMN for that reason — the
// class is what recurs, so the coverage has to be exhaustive rather than
// representative.

test('a bad probe number is a 400, and leaves the measured value alone', async () => {
  const { sources, sessions, restore } = withDb();
  try {
    const session = await seedSession(sessions);
    const created = await sources.createSource({
      sessionId: session.id, durationS: 61.5, fps: 29.97, width: 1920, height: 1080,
    }, SCOPE_A);
    assert.equal(created.ok, true, created.error);

    // Every number a probe writes. `'N/A'` is precisely what ffprobe hands back
    // for a stream it cannot read, and slices 4/8-6/8 are the only callers.
    for (const [field, junk] of [
      ['durationS', 'N/A'], ['fps', 'N/A'], ['width', 'unknown'], ['height', ''],
    ]) {
      const before = await sources.getSourceById(created.data.id, SCOPE_A);
      const res = await sources.updateSource(created.data.id, { [field]: junk }, SCOPE_A);
      if (junk === '') {
        // A blank string is a legitimate "clear this", not junk — asserted here
        // so the boundary is pinned rather than assumed.
        assert.equal(res.ok, true, `${field}: '' should clear, not fail`);
        continue;
      }
      assert.equal(res.ok, false, `${field}: junk was accepted`);
      assert.equal(res.status, 400, `${field}: junk must be a 400, not a silent wipe`);
      assert.match(res.error, /must be a number/);

      const after = await sources.getSourceById(created.data.id, SCOPE_A);
      assert.equal(after.data[field], before.data[field],
        `${field}: the measured value was destroyed by a refused write`);
    }
  } finally { restore(); }
});

test('a bad probe number is refused on the way IN too, not only on update', async () => {
  const { sources, sessions, restore } = withDb();
  try {
    const session = await seedSession(sessions);
    for (const field of ['durationS', 'fps', 'width', 'height']) {
      const res = await sources.createSource({ sessionId: session.id, [field]: 'N/A' }, SCOPE_A);
      assert.equal(res.ok, false, `${field}: junk was written on create`);
      assert.equal(res.status, 400);
    }
    // And nothing landed while being refused.
    const listed = await sources.listSources(100, SCOPE_A);
    assert.equal(listed.data.length, 0, 'a refused create still inserted a row');
  } finally { restore(); }
});

test('numberOrError refuses what Number() would have coerced', () => {
  const { numberOrError, integerOrError } = require('../../lib/videoSourcesStore.js');
  // Number(true) is 1, Number([]) is 0, Number(['5']) is 5 — every one of those
  // is a confident wrong value arriving through a coercion nobody asked for.
  for (const junk of [true, false, [], ['5'], {}, NaN, Infinity, 'N/A', '12px']) {
    assert.equal(numberOrError(junk, 'x').ok, false, `${JSON.stringify(junk)} was accepted`);
  }
  // Absent and blank are a genuine null; a numeric string is a number.
  for (const blank of [undefined, null, '', '   ']) {
    assert.deepEqual(numberOrError(blank, 'x'), { ok: true, value: null });
  }
  assert.deepEqual(numberOrError('61.5', 'x'), { ok: true, value: 61.5 });
  assert.deepEqual(numberOrError(-3, 'x'), { ok: true, value: -3 });
  assert.deepEqual(integerOrError('29.6', 'x'), { ok: true, value: 30 });
});

test('an unmeasured sync offset stays NULL, because 0 is a claim', async () => {
  const { sources, sessions, db, restore } = withDb();
  try {
    const session = await seedSession(sessions);
    const created = await sources.createSource({ sessionId: session.id }, SCOPE_A);
    assert.equal(created.ok, true, created.error);

    // 0 would mean "these two tracks are already perfectly in sync", which is
    // an answer. Nothing has measured this file yet, so the honest value is
    // "we do not know" — and the column has to be able to hold it.
    const [row] = db.data.get('video_sources');
    assert.equal(row.sync_offset_ms, null, 'an unmeasured offset was written as 0');
    assert.equal(created.data.syncOffsetMs, null, 'the row reader turned a null offset back into 0');

    const measured = await sources.updateSource(created.data.id, { syncOffsetMs: 250 }, SCOPE_A);
    assert.equal(measured.data.syncOffsetMs, 250);
  } finally { restore(); }
});

test('a bad sync offset is a 400, not a confident zero', async () => {
  const { sources, sessions, restore } = withDb();
  try {
    const session = await seedSession(sessions);
    const created = await sources.createSource({ sessionId: session.id, syncOffsetMs: 250 }, SCOPE_A);
    assert.equal(created.data.syncOffsetMs, 250);

    const res = await sources.updateSource(created.data.id, { syncOffsetMs: 'unknown' }, SCOPE_A);
    assert.equal(res.ok, false, 'junk offset was accepted');
    assert.equal(res.status, 400);

    const after = await sources.getSourceById(created.data.id, SCOPE_A);
    assert.equal(after.data.syncOffsetMs, 250, 'a measured offset was replaced by 0');

    // And on the way in.
    const onCreate = await sources.createSource(
      { sessionId: session.id, syncOffsetMs: 'unknown' }, SCOPE_A
    );
    assert.equal(onCreate.ok, false);
    assert.equal(onCreate.status, 400);
  } finally { restore(); }
});

test('the offset column can hold "not measured yet"', () => {
  const schema = parseSchemaFile(SQL_PATH);
  const offset = schema.tables.get('video_sources').columns.get('sync_offset_ms');
  assert.equal(offset.notNull, false,
    'sync_offset_ms is not null, so an unmeasured offset has to be written as 0 — a claim, not a blank');
  assert.equal(offset.default, null,
    'sync_offset_ms defaults to a value, so an omitted offset still arrives as a measurement');
});

test('a bad sync confidence is a 400, not an erased measurement', async () => {
  const { sessions, restore } = withDb();
  try {
    const created = await sessions.createSession({ title: 'A talk', syncConfidence: 0.92 }, SCOPE_A);
    assert.equal(created.data.syncConfidence, 0.92);

    const res = await sessions.updateSession(created.data.id, { syncConfidence: 'high' }, SCOPE_A);
    assert.equal(res.ok, false, "'high' was accepted as a confidence");
    assert.equal(res.status, 400);

    const after = await sessions.getSessionById(created.data.id, SCOPE_A);
    assert.equal(after.data.syncConfidence, 0.92, 'a measured confidence was erased by a refused write');

    const onCreate = await sessions.createSession({ title: 'B', syncConfidence: 'high' }, SCOPE_A);
    assert.equal(onCreate.ok, false);
    assert.equal(onCreate.status, 400);
  } finally { restore(); }
});

test('an out-of-range confidence is still clamped, which is a different judgement', () => {
  // 1.4 is a legible answer from a sync pass that over-normalised, and the real
  // hazard is it being read as a percentage later. 'high' is not an answer at
  // all. The two are deliberately handled differently; this pins that.
  const { confidenceOrError } = require('../../lib/videoSessionsStore.js');
  assert.deepEqual(confidenceOrError(1.4, 'c'), { ok: true, value: 1 });
  assert.deepEqual(confidenceOrError(-2, 'c'), { ok: true, value: 0 });
  assert.equal(confidenceOrError('high', 'c').ok, false);
  assert.equal(confidenceOrError(true, 'c').ok, false);
  assert.deepEqual(confidenceOrError(null, 'c'), { ok: true, value: null });
});

test('a database failure is NOT reported as "that session does not exist"', async () => {
  // `if (!owner.ok || !owner.data)` was true for a Supabase 500, a timeout and
  // an auth failure just as much as for a missing row — so a database that was
  // briefly down told the caller their session did not exist. That is a
  // message that lies about what went wrong, which is what round one sent this
  // back for, appearing inside the code written to fix round one.
  const { sources, sessions, restore } = withDb((real) => async (options) => {
    if (options.method === 'GET' && options.table === 'video_sessions') {
      return { ok: false, status: 500, error: 'upstream connect error or disconnect/reset before headers' };
    }
    return real(options);
  });
  try {
    // The session genuinely exists; only the READ is broken.
    const res = await sources.createSource({ sessionId: 'row-1' }, SCOPE_A);
    assert.equal(res.ok, false);
    assert.equal(res.status, 500, 'a database failure was reported as a 404 "no such session"');
    assert.match(res.error, /upstream connect/);
    assert.doesNotMatch(String(res.error), /does not exist in this project/);
    assert.equal(typeof sessions.createSession, 'function');
  } finally { restore(); }
});

test('a genuinely missing session is still a 404 that says so', async () => {
  const { sources, restore } = withDb();
  try {
    const res = await sources.createSource({ sessionId: 'no-such-session' }, SCOPE_A);
    assert.equal(res.ok, false);
    assert.equal(res.status, 404);
    assert.match(res.error, /does not exist in this project/);
  } finally { restore(); }
});

// ── The fake now enforces the constraints it reads ──────────────────────────
// Its own header promised it "refuses loudly rather than ignoring". That was
// not true: parseColumn read inline `primary key`, `unique` and `references`
// straight past. It is reusable infrastructure for Studio slices 2/8-8/8, so a
// later slice testing "the same id cannot be used twice" would have passed
// while enforcing nothing.

test('the fake rejects a duplicate primary key, as Postgres does', async () => {
  const schema = parseSchemaFile(SQL_PATH);
  const db = createFakeDb(schema);
  const row = { id: uuid(77), project_id: 'proj_a', title: 'A talk' };

  const first = await db.sbQuery({ method: 'POST', table: 'video_sessions', query: 'select=*', body: [row] });
  assert.equal(first.ok, true, first.error);

  const second = await db.sbQuery({ method: 'POST', table: 'video_sessions', query: 'select=*', body: [row] });
  assert.equal(second.ok, false, 'the same primary key was inserted twice');
  assert.equal(second.status, 409);
  assert.match(second.error, /23505/);
});

test('the fake rejects a session_id that points at nothing, as Postgres does', async () => {
  const schema = parseSchemaFile(SQL_PATH);
  const db = createFakeDb(schema);

  const res = await db.sbQuery({
    method: 'POST',
    table: 'video_sources',
    query: 'select=*',
    body: [{ project_id: 'proj_a', session_id: uuid(404) }],
  });
  assert.equal(res.ok, false, 'a dangling foreign key was accepted');
  assert.equal(res.status, 409, 'PostgREST answers 409 for a foreign-key violation');
  assert.match(res.error, /23503/);
  // The exact shape lib/videoSourcesStore.js reads, so that branch is tested
  // against a message it will actually see.
  const { isMissingSessionError, isDuplicateHashError } = require('../../lib/videoSourcesStore.js');
  assert.equal(isMissingSessionError(res), true);
  assert.equal(isDuplicateHashError(res), false);

  // A null session_id is not a violation — Postgres does not check a null FK.
  const orphan = await db.sbQuery({
    method: 'POST', table: 'video_sources', query: 'select=*', body: [{ project_id: 'proj_a' }],
  });
  assert.equal(orphan.ok, true, orphan.error);
});

test('a PATCH cannot move a row onto a session that is not there either', async () => {
  const schema = parseSchemaFile(SQL_PATH);
  const db = createFakeDb(schema);
  await db.sbQuery({
    method: 'POST', table: 'video_sessions', query: 'select=*',
    body: [{ id: uuid(1), project_id: 'proj_a', title: 'A talk' }],
  });
  const seeded = await db.sbQuery({
    method: 'POST', table: 'video_sources', query: 'select=*',
    body: [{ id: uuid(2), project_id: 'proj_a', session_id: uuid(1) }],
  });
  assert.equal(seeded.ok, true, seeded.error);
  const res = await db.sbQuery({
    method: 'PATCH', table: 'video_sources', query: `id=eq.${uuid(2)}&select=*`,
    body: { session_id: uuid(999) },
  });
  assert.equal(res.ok, false);
  assert.match(res.error, /23503/);
});

test('the SQL declares the cascade, and the fake says it does not cover it', async () => {
  const schema = parseSchemaFile(SQL_PATH);
  const sourceTable = schema.tables.get('video_sources');
  const fk = (sourceTable.foreignKeys || []).find((key) => key.column === 'session_id');
  assert.ok(fk, 'video_sources.session_id no longer declares a foreign key');
  assert.equal(fk.refTable, 'video_sessions');
  assert.equal(fk.onDelete, 'cascade');

  // Declared and NOT exercised. The fake refuses out loud rather than letting a
  // later slice believe cascade behaviour is under test here.
  const db = createFakeDb(schema);
  await assert.rejects(
    () => db.sbQuery({ method: 'DELETE', table: 'video_sources', query: 'id=eq.x' }),
    /cascade/i
  );
});

test('an inline unique is enforced, and nulls do not collide', async () => {
  const schema = parseSchemaText(`
    create table if not exists public.widgets (
      id      uuid primary key default gen_random_uuid(),
      slug    text unique,
      name    text not null default ''
    );
    alter table public.widgets enable row level security;
  `);
  const db = createFakeDb(schema);
  const insert = (body) => db.sbQuery({ method: 'POST', table: 'widgets', query: 'select=*', body: [body] });

  assert.equal((await insert({ slug: 'a' })).ok, true);
  const clash = await insert({ slug: 'a' });
  assert.equal(clash.ok, false, 'a duplicate unique value was accepted');
  assert.match(clash.error, /23505/);

  // Postgres allows many nulls in a unique column.
  assert.equal((await insert({})).ok, true);
  assert.equal((await insert({})).ok, true, 'two null slugs collided, which Postgres would allow');
});

test('the fake REFUSES a column clause it does not implement', () => {
  // The point of the rewrite: an unrecognised clause can no longer be read
  // past in silence. Each of these used to parse "fine" and enforce nothing.
  const cases = [
    'total integer generated always as (1) stored',
    "n integer check (n >= 0)",
    'ref uuid references',
    'name text collate "C"',
  ];
  for (const column of cases) {
    assert.throws(
      () => parseSchemaText(`create table if not exists public.t (\n  id uuid primary key,\n  ${column}\n);`),
      /sqlSchemaFake:/,
      `"${column}" was parsed without complaint`
    );
  }
});

test('alter column drop not null / drop default is applied, and stays idempotent', () => {
  const schema = parseSchemaText(`
    create table if not exists public.widgets (
      id     uuid primary key default gen_random_uuid(),
      count  integer not null default 0
    );
    alter table public.widgets alter column count drop not null;
    alter table public.widgets alter column count drop default;
  `);
  const count = schema.tables.get('widgets').columns.get('count');
  assert.equal(count.notNull, false);
  assert.equal(count.default, null);
});

// ── Round four: two writes that succeeded while storing something false ─────
// Both are the same class the three rounds before this one were spent on — an
// answer of ok:true over a row that is now wrong.

test('updateSession REFUSES a programme-audio source belonging to another project', async () => {
  // There is deliberately no foreign key on program_audio_source_id (a second
  // FK back would be a cycle), so the store is the ONLY thing that can catch
  // this — and it wasn't looking. Review reproduced it live: project A pointed
  // its session's programme audio at project B's source and got ok:true/200.
  // Then B deletes that source and A's session points at nothing.
  const { sessions, sources, restore } = withDb();
  try {
    const mine = await seedSession(sessions, SCOPE_A, 'My talk');
    const theirs = await seedSession(sessions, SCOPE_B, 'Their talk');
    const theirSource = await sources.createSource(
      { sessionId: theirs.id, layerRole: 'reference' }, SCOPE_B
    );
    assert.equal(theirSource.ok, true, theirSource.error);

    const res = await sessions.updateSession(
      mine.id, { programAudioSourceId: theirSource.data.id }, SCOPE_A
    );
    assert.equal(res.ok, false, 'a cross-tenant programme-audio pointer was stored');
    assert.equal(res.status, 404);
    assert.match(res.error, /does not exist in this project/);

    // Read it back rather than trusting the refusal: nothing may have landed.
    const after = await sessions.getSessionById(mine.id, SCOPE_A);
    assert.equal(after.ok, true, after.error);
    assert.equal(after.data.programAudioSourceId, '', 'the pointer was written anyway');
  } finally { restore(); }
});

test('updateSession ACCEPTS a source in its own project, and still allows clearing it', async () => {
  // The other half: the check must not make the legitimate write impossible.
  const { sessions, sources, restore } = withDb();
  try {
    const mine = await seedSession(sessions, SCOPE_A, 'My talk');
    const mySource = await sources.createSource(
      { sessionId: mine.id, layerRole: 'reference' }, SCOPE_A
    );
    assert.equal(mySource.ok, true, mySource.error);

    const set = await sessions.updateSession(
      mine.id, { programAudioSourceId: mySource.data.id }, SCOPE_A
    );
    assert.equal(set.ok, true, set.error);
    assert.equal(set.data.programAudioSourceId, mySource.data.id);

    const cleared = await sessions.updateSession(mine.id, { programAudioSourceId: null }, SCOPE_A);
    assert.equal(cleared.ok, true, cleared.error);
    assert.equal(cleared.data.programAudioSourceId, '');
  } finally { restore(); }
});

test('a database failure resolving the programme audio is NOT "no such source"', async () => {
  // Same lesson as the session check on createSource: only a genuine 404 is a
  // 404. A 500 reported as "that source does not exist" is a message that lies
  // about what went wrong.
  const { sessions, sources, restore } = withDb((real) => {
    let sessionSeeded = false;
    return async (options) => {
      if (options.method === 'GET' && options.table === 'video_sources' && sessionSeeded) {
        return { ok: false, status: 500, error: 'upstream connect error or disconnect/reset before headers' };
      }
      if (options.method === 'POST' && options.table === 'video_sources') sessionSeeded = true;
      return real(options);
    };
  });
  try {
    const mine = await seedSession(sessions, SCOPE_A, 'My talk');
    const mySource = await sources.createSource({ sessionId: mine.id }, SCOPE_A);
    assert.equal(mySource.ok, true, mySource.error);

    const res = await sessions.updateSession(
      mine.id, { programAudioSourceId: mySource.data.id }, SCOPE_A
    );
    assert.equal(res.ok, false);
    assert.equal(res.status, 500, 'a database failure was reported as a 404 "no such source"');
    assert.doesNotMatch(String(res.error), /does not exist in this project/);
  } finally { restore(); }
});

test('a non-string contentHash is a 400, not the string "[object Object]"', async () => {
  // safeText String-coerced anything, so `{}` was stored as '[object Object]'
  // under ok:true — and the next genuinely different file in that project was
  // then turned away 409 "already in the catalog", which is simply untrue.
  const { sessions, sources, restore } = withDb();
  try {
    const session = await seedSession(sessions, SCOPE_A);
    const junk = await sources.createSource(
      { sessionId: session.id, contentHash: {} }, SCOPE_A
    );
    assert.equal(junk.ok, false, "'[object Object]' was stored as a content hash");
    assert.equal(junk.status, 400);
    assert.match(junk.error, /contentHash must be text/);

    // The consequence the refusal prevents: two unrelated files colliding.
    const first = await sources.createSource(
      { sessionId: session.id, contentHash: 'hash-of-file-one' }, SCOPE_A
    );
    assert.equal(first.ok, true, first.error);
    const second = await sources.createSource(
      { sessionId: session.id, contentHash: 'hash-of-file-two' }, SCOPE_A
    );
    assert.equal(second.ok, true, 'a different file was rejected as a duplicate');
  } finally { restore(); }
});

test('a non-string contentHash on UPDATE leaves the stored hash alone', async () => {
  const { sessions, sources, restore } = withDb();
  try {
    const session = await seedSession(sessions, SCOPE_A);
    const created = await sources.createSource(
      { sessionId: session.id, contentHash: 'the-real-hash' }, SCOPE_A
    );
    assert.equal(created.ok, true, created.error);

    const res = await sources.updateSource(created.data.id, { contentHash: ['x'] }, SCOPE_A);
    assert.equal(res.ok, false);
    assert.equal(res.status, 400);

    const after = await sources.getSourceById(created.data.id, SCOPE_A);
    assert.equal(after.data.contentHash, 'the-real-hash', 'the measured hash was overwritten');
  } finally { restore(); }
});

test('every probe text field refuses junk, and a number is still legible text', async () => {
  const { sessions, sources, restore } = withDb();
  try {
    const session = await seedSession(sessions, SCOPE_A);
    for (const field of ['codec', 'deviceLane', 'localPath', 'proxyPath', 'driveFileId']) {
      const res = await sources.createSource(
        { sessionId: session.id, [field]: true }, SCOPE_A
      );
      assert.equal(res.ok, false, `${field} accepted a boolean`);
      assert.equal(res.status, 400);
    }
    // A device lane of 2 is text a person can read; refusing it would be
    // pedantry rather than protection.
    const numeric = await sources.createSource(
      { sessionId: session.id, deviceLane: 2 }, SCOPE_A
    );
    assert.equal(numeric.ok, true, numeric.error);
    assert.equal(numeric.data.deviceLane, '2');
  } finally { restore(); }
});

test('rowToSource takes every probe length from probeLimit, not from a literal', () => {
  // PROBE_TEXT_FIELDS + probeLimit() exist so ONE number governs each column.
  // The reader still wrote 1000/100/300 by hand, which is harmless only while
  // the numbers agree: raise localPath to 4000 and a full path would be stored
  // and read back truncated — the exact round-trip mismatch that table killed.
  const src = fs.readFileSync(path.join(__dirname, '../../lib/videoSourcesStore.js'), 'utf8');
  const reader = src.slice(src.indexOf('function rowToSource'), src.indexOf('function isDuplicateHashError'));
  for (const column of ['drive_file_id', 'content_hash', 'codec', 'device_lane', 'local_path', 'proxy_path']) {
    const line = reader.split('\n').find((text) => text.includes(`row.${column}`));
    assert.ok(line, `rowToSource no longer reads ${column}`);
    assert.match(line, /probeLimit\(/, `rowToSource hard-codes the length for ${column}: ${line.trim()}`);
  }
});

// ── The fake's own four holes ───────────────────────────────────────────────

test('the fake refuses an unknown PATCH column even when NO rows match', async () => {
  // The check sat inside the per-row loop, so a filter matching nothing
  // answered ok:true/200/[] where PostgREST answers 400 — and a filter
  // matching nothing is exactly the shape of every cross-project test here,
  // so a typo'd column name in one of those would have shipped green.
  const { db, restore } = withDb();
  try {
    const res = await db.sbQuery({
      method: 'PATCH',
      table: 'video_sessions',
      query: `id=eq.${uuid(31337)}&select=*`,
      body: { no_such_column: 'x' },
    });
    assert.equal(res.ok, false, 'a typo\'d column passed because nothing matched the filter');
    assert.equal(res.status, 400);
    assert.match(res.error, /no_such_column/);
  } finally { restore(); }
});

test('the fake refuses a value that does not fit the column type', async () => {
  const { db, restore } = withDb();
  try {
    const badUuid = await db.sbQuery({
      method: 'POST',
      table: 'video_sessions',
      query: 'select=*',
      body: [{ id: 'not-a-uuid-at-all', project_id: 'proj_a' }],
    });
    assert.equal(badUuid.ok, false, 'a non-uuid landed in a uuid column');
    assert.equal(badUuid.status, 400);
    assert.match(badUuid.error, /invalid input syntax for type uuid/);

    const badText = await db.sbQuery({
      method: 'POST',
      table: 'video_sessions',
      query: 'select=*',
      body: [{ project_id: 'proj_a', title: { a: 1 } }],
    });
    assert.equal(badText.ok, false, 'an object landed in a text column');
    assert.match(badText.error, /invalid input syntax for type text/);

    const badNumber = await db.sbQuery({
      method: 'POST',
      table: 'video_sources',
      query: 'select=*',
      body: [{ project_id: 'proj_a', width: 'wide' }],
    });
    assert.equal(badNumber.ok, false, 'a word landed in an integer column');
    assert.match(badNumber.error, /invalid input syntax for type integer/);

    const badDate = await db.sbQuery({
      method: 'POST',
      table: 'video_sessions',
      query: 'select=*',
      body: [{ project_id: 'proj_a', recorded_at: 'someday' }],
    });
    assert.equal(badDate.ok, false, 'an unparseable date landed in a timestamptz column');
  } finally { restore(); }
});

test('the fake REFUSES a declared type it cannot check, rather than reading past it', () => {
  // Same bargain as the unsupported column clause above: a check that quietly
  // does not run is worse than no check, because the green run is taken as
  // proof. A later Studio slice adding an `inet` or an array column has to
  // teach the fake what "valid" means for it.
  assert.throws(
    () => parseSchemaText('create table if not exists public.t ( id uuid primary key, addr inet );'),
    /sqlSchemaFake:.*inet/,
    'an unenforceable column type was accepted in silence'
  );
});

test('a generated id is uuid-shaped, and two of them differ', async () => {
  const { sessions, restore } = withDb();
  try {
    const first = await seedSession(sessions, SCOPE_A, 'One');
    const second = await seedSession(sessions, SCOPE_A, 'Two');
    assert.match(first.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.notEqual(first.id, second.id);
  } finally { restore(); }
});
