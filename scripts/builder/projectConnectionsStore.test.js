'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

/**
 * Connections 1 of 7 (86bbpz1d0) — the vault and its store.
 *
 * The fake database underneath these tests reads its schema FROM
 * docs/SQL/project_connections_setup.sql (scripts/builder/sqlSchemaFake.js), so
 * a column deleted from the SQL fails a test here rather than quietly
 * disagreeing with the code. That matters most for the two tenant columns: a
 * table carrying only one makes lib/projectScope.js's probe fail, and
 * scopedInsertRow then stamps NEITHER — inserts still succeed and the rows land
 * with no tenant at all (CLAUDE.md landmine 12; 550 such rows shipped on
 * 2026-08-16). Here an untenanted row is somebody's OAuth token filed under no
 * project, so the store refuses the write outright, and the test below proves
 * the refusal by handing it a table with the column removed.
 */

const SQL_PATH = path.join(__dirname, '..', '..', 'docs', 'SQL', 'project_connections_setup.sql');
const { parseSchemaFile, parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const projectScopePath = require.resolve('../../lib/projectScope.js');
const storePath = require.resolve('../../lib/projectConnectionsStore.js');

const SCOPE_A = { projectId: 'proj_a', userId: 'user_1' };
const SCOPE_B = { projectId: 'proj_b', userId: 'user_2' };

/** A valid AES-256 key: 32 bytes, base64, the shape channelsCipher demands. */
const TEST_KEY = Buffer.alloc(32, 7).toString('base64');

/**
 * Swap lib/supabase for the SQL-backed fake and hand back a live store.
 *
 * `schemaOverride` lets a test build the SAME store against a DIFFERENT table —
 * that is how the tenant-column guard below is shown to be able to fail.
 */
function withDb({ schemaOverride = null } = {}) {
  const schema = schemaOverride || parseSchemaFile(SQL_PATH);
  const db = createFakeDb(schema);
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({
      projectConnections: 'project_connections',
      projectConnectionHandoffs: 'project_connection_handoffs',
    }),
    sbQuery: db.sbQuery,
  };

  const realSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase,
  };
  // projectScope destructures sbQuery at load AND caches its column probe per
  // table, so it must be re-required per test or it answers from the last one.
  delete require.cache[projectScopePath];
  delete require.cache[storePath];

  const projectScope = require(projectScopePath);
  const store = require(storePath);

  const hadKey = Object.prototype.hasOwnProperty.call(process.env, 'CHANNELS_ENCRYPTION_KEY');
  const previousKey = process.env.CHANNELS_ENCRYPTION_KEY;
  process.env.CHANNELS_ENCRYPTION_KEY = TEST_KEY;

  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    delete require.cache[projectScopePath];
    delete require.cache[storePath];
    if (hadKey) process.env.CHANNELS_ENCRYPTION_KEY = previousKey;
    else delete process.env.CHANNELS_ENCRYPTION_KEY;
  }

  return { schema, db, projectScope, store, restore };
}

/** The rows actually sitting in the fake's table — not what a store said. */
function storedRows(db) {
  return db.data.get('project_connections');
}

const GRANT = {
  provider: 'instagram',
  accountId: '17841400000000000',
  accountLabel: '@delraytennis',
  accountAvatarUrl: 'https://cdn.example.com/a.jpg',
  scopes: ['instagram_basic', 'instagram_content_publish'],
  accessToken: 'IGQVJYc3VwZXItc2VjcmV0LXRva2Vu',
};

// ── The schema itself ───────────────────────────────────────────────────────

test('both tables carry BOTH tenant columns, project_id is text, and RLS is on', () => {
  const schema = parseSchemaFile(SQL_PATH);
  for (const tableName of ['project_connections', 'project_connection_handoffs']) {
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

test('the key is (project_id, provider, account_id) — all three, and not null', () => {
  const schema = parseSchemaFile(SQL_PATH);
  const pkey = schema.indexes.find((index) => index.name === 'project_connections_pkey');
  assert.ok(pkey, 'project_connections declares no primary key the fake can see');
  assert.deepEqual(pkey.columns, ['project_id', 'provider', 'account_id']);
  assert.equal(pkey.unique, true);
  const table = schema.tables.get('project_connections');
  for (const column of pkey.columns) {
    assert.equal(table.columns.get(column).notNull, true, `${column} is in the key and must be not null`);
  }
});

test('no plaintext token column exists to write one into', () => {
  const table = parseSchemaFile(SQL_PATH).tables.get('project_connections');
  for (const name of ['access_token', 'refresh_token', 'token', 'password']) {
    assert.equal(table.columns.has(name), false, `${name} is a plaintext column and must not exist`);
  }
  for (const name of ['access_token_enc', 'access_token_iv', 'access_token_tag',
    'refresh_token_enc', 'refresh_token_iv', 'refresh_token_tag', 'key_version']) {
    assert.ok(table.columns.has(name), `${name} is missing`);
  }
});

test("lib/projectScope.js's column probe succeeds on the connections table", async () => {
  const { projectScope, restore } = withDb();
  try {
    assert.equal(await projectScope.supportsProjectColumns('project_connections'), true);
    assert.equal(await projectScope.supportsProjectColumns('project_connection_handoffs'), true);
  } finally {
    restore();
  }
});

// ── The tenant stamp, and the proof the guard can fail ──────────────────────

test('a save lands BOTH tenant columns in the stored row — read back, not assumed', async () => {
  const { db, store, restore } = withDb();
  try {
    const saved = await store.saveConnection(GRANT, SCOPE_A);
    assert.equal(saved.ok, true, saved.error);
    assert.equal(saved.status, 201);

    // The insert returning ok proves nothing (landmine 12). The ROW does.
    const rows = storedRows(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].project_id, 'proj_a', 'project_id was not stamped');
    assert.equal(rows[0].owner_user_id, 'user_1', 'owner_user_id was not stamped');

    // ...and it comes back out through a read, not only off the write.
    const read = await store.getConnection(
      { provider: GRANT.provider, accountId: GRANT.accountId }, SCOPE_A
    );
    assert.equal(read.ok, true, read.error);
    assert.equal(read.data.projectId, 'proj_a');
    assert.equal(read.data.ownerUserId, 'user_1');
  } finally {
    restore();
  }
});

test('with owner_user_id missing the store REFUSES to write — the guard can fail', async () => {
  // The same store, against a table one column short. Without the guard this is
  // an ok:true insert whose row carries no tenant at all.
  const schema = parseSchemaText(`
    create table if not exists public.project_connections (
      project_id            text not null,
      provider              text not null,
      account_id            text not null,
      account_label         text not null default '',
      account_avatar_url    text not null default '',
      scopes                jsonb not null default '[]'::jsonb,
      status                text not null default 'connected',
      expires_at            timestamptz,
      connected_by_user_id  text,
      last_verified_at      timestamptz,
      last_error            text not null default '',
      access_token_enc      text not null default '',
      access_token_iv       text not null default '',
      access_token_tag      text not null default '',
      refresh_token_enc     text not null default '',
      refresh_token_iv      text not null default '',
      refresh_token_tag     text not null default '',
      key_version           text not null default 'v1',
      created_at            timestamptz not null default now(),
      updated_at            timestamptz not null default now(),
      primary key (project_id, provider, account_id)
    );
    alter table public.project_connections enable row level security;
  `);
  const { db, projectScope, store, restore } = withDb({ schemaOverride: schema });
  try {
    assert.equal(
      await projectScope.supportsProjectColumns('project_connections'), false,
      'the probe must fail here, or this test is not testing what it says'
    );
    const saved = await store.saveConnection(GRANT, SCOPE_A);
    assert.equal(saved.ok, false, 'an unstampable connection must not be written');
    assert.match(saved.error, /project_id and owner_user_id/);
    assert.equal(storedRows(db).length, 0, 'nothing may be written when the tenant cannot be stamped');
  } finally {
    restore();
  }
});

// ── The token ───────────────────────────────────────────────────────────────

test('the stored row contains the token nowhere, and it round-trips', async () => {
  const { db, store, restore } = withDb();
  try {
    const saved = await store.saveConnection(
      { ...GRANT, refreshToken: 'refresh-me-later-9f8e7d' }, SCOPE_A
    );
    assert.equal(saved.ok, true, saved.error);

    const row = storedRows(db)[0];
    for (const [column, value] of Object.entries(row)) {
      assert.equal(
        String(JSON.stringify(value)).includes(GRANT.accessToken), false,
        `the access token is readable in column "${column}"`
      );
      assert.equal(
        String(JSON.stringify(value)).includes('refresh-me-later-9f8e7d'), false,
        `the refresh token is readable in column "${column}"`
      );
    }
    assert.ok(row.access_token_enc && row.access_token_iv && row.access_token_tag);
    assert.equal(row.key_version, 'v1');

    // The write path never hands the token back either.
    assert.equal('accessToken' in saved.data, false, 'saveConnection must not return the secret');
    assert.equal(saved.data.hasAccessToken, true);
    assert.equal(saved.data.hasRefreshToken, true);

    const read = await store.getConnection(
      { provider: GRANT.provider, accountId: GRANT.accountId }, SCOPE_A
    );
    assert.equal(read.ok, true, read.error);
    assert.equal(read.data.accessToken, GRANT.accessToken);
    assert.equal(read.data.refreshToken, 'refresh-me-later-9f8e7d');
  } finally {
    restore();
  }
});

test('listing never carries a token, only whether there is one', async () => {
  const { store, restore } = withDb();
  try {
    await store.saveConnection(GRANT, SCOPE_A);
    const listed = await store.listConnections(50, SCOPE_A);
    assert.equal(listed.ok, true, listed.error);
    assert.equal(listed.data.length, 1);
    assert.equal('accessToken' in listed.data[0], false);
    assert.equal('refreshToken' in listed.data[0], false);
    assert.equal(listed.data[0].hasAccessToken, true);
    assert.equal(listed.data[0].hasRefreshToken, false, 'this grant had no refresh token');
    assert.deepEqual(listed.data[0].scopes, GRANT.scopes);
  } finally {
    restore();
  }
});

test('a missing encryption key is a clear error, and NOTHING is written', async () => {
  const { db, store, restore } = withDb();
  try {
    delete process.env.CHANNELS_ENCRYPTION_KEY;
    const saved = await store.saveConnection(GRANT, SCOPE_A);
    assert.equal(saved.ok, false, 'a token that cannot be encrypted must not be saved');
    assert.match(saved.error, /CHANNELS_ENCRYPTION_KEY/);
    // The failure this guards is writing '' into access_token_enc and calling
    // the connection saved — a card that says connected over no credential.
    assert.equal(storedRows(db).length, 0);
  } finally {
    restore();
  }
});

test('a key that cannot decrypt an existing token is an error, not an empty token', async () => {
  const { store, restore } = withDb();
  try {
    await store.saveConnection(GRANT, SCOPE_A);
    // Same shape, different key — what a half-finished rotation looks like.
    process.env.CHANNELS_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
    const read = await store.getConnection(
      { provider: GRANT.provider, accountId: GRANT.accountId }, SCOPE_A
    );
    assert.equal(read.ok, false, "a token that cannot be read must not come back as ''");
    assert.match(read.error, /decrypt/i);
  } finally {
    restore();
  }
});

test('a connection with no refresh token reads back as empty, not as an error', async () => {
  // The empty case must NOT go down the failure path above: plenty of providers
  // issue no refresh token at all, and that is a fact about the grant rather
  // than a broken key.
  const { store, restore } = withDb();
  try {
    await store.saveConnection(GRANT, SCOPE_A);
    const read = await store.getConnection(
      { provider: GRANT.provider, accountId: GRANT.accountId }, SCOPE_A
    );
    assert.equal(read.ok, true, read.error);
    assert.equal(read.data.refreshToken, '');
    assert.equal(read.data.hasRefreshToken, false);
  } finally {
    restore();
  }
});

// ── The key: re-authorising, and two accounts on one provider ───────────────

test('re-authorising the same account updates the row instead of duplicating it', async () => {
  const { db, store, restore } = withDb();
  try {
    const first = await store.saveConnection(GRANT, SCOPE_A);
    assert.equal(first.status, 201);

    const again = await store.saveConnection(
      { ...GRANT, accessToken: 'a-brand-new-token', accountLabel: '@delray_tennis' }, SCOPE_A
    );
    assert.equal(again.ok, true, again.error);
    assert.equal(again.status, 200, 'the second save is an update, not an insert');
    assert.equal(storedRows(db).length, 1, 'the primary key must stop a second row');
    assert.equal(again.data.accountLabel, '@delray_tennis');

    const read = await store.getConnection(
      { provider: GRANT.provider, accountId: GRANT.accountId }, SCOPE_A
    );
    assert.equal(read.data.accessToken, 'a-brand-new-token', 'the new token replaced the old one');
    // The tenant stamp survives the update path too.
    assert.equal(storedRows(db)[0].project_id, 'proj_a');
    assert.equal(storedRows(db)[0].owner_user_id, 'user_1');
  } finally {
    restore();
  }
});

test('two accounts on one provider are two connections', async () => {
  // The reason the key carries account_id. Keyed on (project, provider) alone,
  // the second grant would silently overwrite the first.
  const { db, store, restore } = withDb();
  try {
    await store.saveConnection(GRANT, SCOPE_A);
    const second = await store.saveConnection(
      { ...GRANT, accountId: '17841499999999999', accountLabel: '@delray_pro_shop' }, SCOPE_A
    );
    assert.equal(second.ok, true, second.error);
    assert.equal(second.status, 201);
    assert.equal(storedRows(db).length, 2);
    const listed = await store.listConnections(50, SCOPE_A);
    assert.equal(listed.data.length, 2);
  } finally {
    restore();
  }
});

test('the primary key is what stops the duplicate — remove it and the row lands twice', async () => {
  // The break test for the one above: same file, primary key line deleted. If
  // this passes as a duplicate, the fake really is enforcing the key.
  const schema = parseSchemaText(`
    create table if not exists public.project_connections (
      project_id            text not null,
      owner_user_id         text,
      provider              text not null,
      account_id            text not null,
      account_label         text not null default '',
      account_avatar_url    text not null default '',
      scopes                jsonb not null default '[]'::jsonb,
      status                text not null default 'connected',
      expires_at            timestamptz,
      connected_by_user_id  text,
      last_verified_at      timestamptz,
      last_error            text not null default '',
      access_token_enc      text not null default '',
      access_token_iv       text not null default '',
      access_token_tag      text not null default '',
      refresh_token_enc     text not null default '',
      refresh_token_iv      text not null default '',
      refresh_token_tag     text not null default '',
      key_version           text not null default 'v1',
      created_at            timestamptz not null default now(),
      updated_at            timestamptz not null default now()
    );
    alter table public.project_connections enable row level security;
  `);
  const { db, store, restore } = withDb({ schemaOverride: schema });
  try {
    await store.saveConnection(GRANT, SCOPE_A);
    await store.saveConnection(GRANT, SCOPE_A);
    assert.equal(storedRows(db).length, 2, 'with no key declared, nothing stops the duplicate');
  } finally {
    restore();
  }
});

// ── Tenancy ─────────────────────────────────────────────────────────────────

test('another project cannot read, overwrite or delete this project\'s connection', async () => {
  const { db, store, restore } = withDb();
  try {
    await store.saveConnection(GRANT, SCOPE_A);

    const read = await store.getConnection(
      { provider: GRANT.provider, accountId: GRANT.accountId }, SCOPE_B
    );
    assert.equal(read.ok, false, "project B must not see project A's token");
    assert.equal(read.status, 404);

    const listed = await store.listConnections(50, SCOPE_B);
    assert.equal(listed.ok, true, listed.error);
    assert.equal(listed.data.length, 0);

    const removed = await store.deleteConnection(
      { provider: GRANT.provider, accountId: GRANT.accountId }, SCOPE_B
    );
    assert.equal(removed.ok, false, 'a delete that removed nothing must not report success');
    assert.equal(removed.status, 404);
    assert.equal(storedRows(db).length, 1, "project A's connection is still there");
  } finally {
    restore();
  }
});

test('the same account connected to two projects is two rows, each its own', async () => {
  const { db, store, restore } = withDb();
  try {
    await store.saveConnection(GRANT, SCOPE_A);
    const forB = await store.saveConnection({ ...GRANT, accessToken: 'b-token' }, SCOPE_B);
    assert.equal(forB.ok, true, forB.error);
    assert.equal(storedRows(db).length, 2);

    const a = await store.getConnection({ provider: GRANT.provider, accountId: GRANT.accountId }, SCOPE_A);
    const b = await store.getConnection({ provider: GRANT.provider, accountId: GRANT.accountId }, SCOPE_B);
    assert.equal(a.data.accessToken, GRANT.accessToken);
    assert.equal(b.data.accessToken, 'b-token');
  } finally {
    restore();
  }
});

test('deleting removes only the scoped row, and says so once', async () => {
  const { db, store, restore } = withDb();
  try {
    await store.saveConnection(GRANT, SCOPE_A);
    await store.saveConnection({ ...GRANT, accountId: '17841499999999999' }, SCOPE_A);

    const removed = await store.deleteConnection(
      { provider: GRANT.provider, accountId: GRANT.accountId }, SCOPE_A
    );
    assert.equal(removed.ok, true, removed.error);
    assert.equal(removed.data.deleted, true);
    assert.equal(storedRows(db).length, 1, 'the other account is untouched');

    // Deleting it again is a 404, not a second cheerful success.
    const twice = await store.deleteConnection(
      { provider: GRANT.provider, accountId: GRANT.accountId }, SCOPE_A
    );
    assert.equal(twice.ok, false);
    assert.equal(twice.status, 404);
  } finally {
    restore();
  }
});

test('every entry point refuses to run without a project scope', async () => {
  const { store, restore } = withDb();
  try {
    const key = { provider: GRANT.provider, accountId: GRANT.accountId };
    for (const [name, call] of [
      ['saveConnection', () => store.saveConnection(GRANT, null)],
      ['getConnection', () => store.getConnection(key, null)],
      ['listConnections', () => store.listConnections(50, null)],
      ['deleteConnection', () => store.deleteConnection(key, null)],
    ]) {
      const res = await call();
      assert.equal(res.ok, false, `${name} ran with no scope`);
      assert.equal(res.status, 400, `${name} should be a 400`);
      assert.match(res.error, /project scope/i);
    }
  } finally {
    restore();
  }
});

// ── What a caller hands in ──────────────────────────────────────────────────

test('a scope object in the limit position is refused, not coerced (DOCTRINE 5.10)', async () => {
  // listConnections(scope) would otherwise read the scope as a limit, drop the
  // project filter, and hand back every client's connections.
  const { store, restore } = withDb();
  try {
    await store.saveConnection(GRANT, SCOPE_A);
    const res = await store.listConnections(SCOPE_A);
    assert.equal(res.ok, false);
    assert.equal(res.status, 400);
    assert.match(res.error, /limit must be a number/);
  } finally {
    restore();
  }
});

test('an unknown field is named rather than ignored', async () => {
  const { db, store, restore } = withDb();
  try {
    const res = await store.saveConnection({ ...GRANT, acessToken: 'typo' }, SCOPE_A);
    assert.equal(res.ok, false);
    assert.equal(res.status, 400);
    assert.match(res.error, /acessToken/);
    assert.equal(storedRows(db).length, 0);
  } finally {
    restore();
  }
});

test('the key halves are both required, and a bad status or date is a 400', async () => {
  const { store, restore } = withDb();
  try {
    const noProvider = await store.saveConnection({ ...GRANT, provider: '' }, SCOPE_A);
    assert.equal(noProvider.ok, false);
    assert.match(noProvider.error, /provider is required/);

    const noAccount = await store.saveConnection({ ...GRANT, accountId: '' }, SCOPE_A);
    assert.equal(noAccount.ok, false);
    assert.match(noAccount.error, /accountId is required/);

    const badStatus = await store.saveConnection({ ...GRANT, status: 'sort-of-connected' }, SCOPE_A);
    assert.equal(badStatus.ok, false);
    assert.match(badStatus.error, /status must be one of/);

    // storeInput.timestampOrError: 0 used to become 2000-01-01 under ok:true.
    const badDate = await store.saveConnection({ ...GRANT, expiresAt: 0 }, SCOPE_A);
    assert.equal(badDate.ok, false);
    assert.match(badDate.error, /expiresAt/);
  } finally {
    restore();
  }
});

test('scopes: a list or a comma-separated string is read, an object is refused', async () => {
  const { store, restore } = withDb();
  try {
    assert.deepEqual(store.readScopes(['a', 'b']), ['a', 'b']);
    assert.deepEqual(store.readScopes('a,b'), ['a', 'b']);
    assert.deepEqual(store.readScopes('["a","b"]'), ['a', 'b']);
    assert.deepEqual(store.readScopes('[]'), [], 'the column default, as the fake returns it');
    assert.deepEqual(store.readScopes(null), []);

    // Refused rather than stored as [] — "this grant has no permissions" is a
    // statement about the connection, and a false one reads as unremarkable.
    const res = await store.saveConnection({ ...GRANT, scopes: { read: true } }, SCOPE_A);
    assert.equal(res.ok, false);
    assert.match(res.error, /scopes must be/);
  } finally {
    restore();
  }
});

test('the provider is stored lowercase, so Instagram and instagram are one connection', async () => {
  const { db, store, restore } = withDb();
  try {
    await store.saveConnection(GRANT, SCOPE_A);
    const again = await store.saveConnection({ ...GRANT, provider: 'Instagram' }, SCOPE_A);
    assert.equal(again.ok, true, again.error);
    assert.equal(storedRows(db).length, 1, 'a capitalised provider must not open a second row');
  } finally {
    restore();
  }
});

test('who connected it is recorded, and is not the same fact as who owns the project', async () => {
  const { store, restore } = withDb();
  try {
    const saved = await store.saveConnection(
      { ...GRANT, connectedByUserId: 'staff_9' }, { projectId: 'proj_a', userId: 'user_1' }
    );
    assert.equal(saved.ok, true, saved.error);
    assert.equal(saved.data.connectedByUserId, 'staff_9');
    assert.equal(saved.data.ownerUserId, 'user_1');
  } finally {
    restore();
  }
});

test('the status vocabulary lives in the store, not in a check constraint', () => {
  // Slice 6 adds states to this list. If a future edit moves it into the SQL as
  // a check, every added state becomes a migration — see the note in the file.
  const sql = require('fs').readFileSync(SQL_PATH, 'utf8');
  assert.doesNotMatch(sql, /check\s*\(\s*status\s+in/i, 'status must not be constrained in SQL');
  const { CONNECTION_STATUSES } = require('../../lib/projectConnectionsStore.js');
  assert.ok(CONNECTION_STATUSES.includes('connected'));
  assert.ok(CONNECTION_STATUSES.includes('revoked'));
});
