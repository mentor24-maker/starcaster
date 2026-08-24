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
function withDb() {
  const schema = parseSchemaFile(SQL_PATH);
  const db = createFakeDb(schema);
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({ videoSessions: 'video_sessions', videoSources: 'video_sources' }),
    sbQuery: db.sbQuery,
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

test('a content hash round-trips at one length, whichever path wrote it', async () => {
  // It was capped at 200 on create and 1000 on update, so the same value came
  // back differently depending on how it got there.
  const { sessions, sources, restore } = withDb();
  try {
    const session = await seedSession(sessions);
    const long = 'h'.repeat(400);
    const created = await sources.createSource(
      { sessionId: session.id, layerRole: 'reference', contentHash: long }, SCOPE_A);
    assert.equal(created.ok, true, created.error);

    const updated = await sources.updateSource(created.data.id, { contentHash: long }, SCOPE_A);
    assert.equal(updated.ok, true, updated.error);
    assert.equal(updated.data.contentHash, created.data.contentHash,
      'create and update must store the same value for the same input');
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
