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
