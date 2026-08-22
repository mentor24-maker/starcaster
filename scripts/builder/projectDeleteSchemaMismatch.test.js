'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Deleting a project purges every project-scoped table. One of them,
 * dev_sessions, was created with `project_id BIGINT` while every project id on
 * this platform is text, so Postgres refuses the filter outright:
 *
 *     invalid input syntax for type bigint: "proj_1780601126203_f3v0m1"
 *
 * That one table aborted the entire delete — the operator could not remove ANY
 * project (reported 2026-08-16). The schema is fixed separately
 * (docs/SQL/fix_dev_sessions_project_id_type.sql); this pins the behaviour so
 * a single mistyped column can never again take the whole operation down.
 *
 * The distinction that matters: a MISSING column is an ordinary absence and is
 * skipped silently. A WRONG-TYPED column provably cannot hold this project's
 * rows either, so the purge continues — but it is a defect, so it is reported
 * rather than swallowed. A delete that quietly skips a table it was asked to
 * clear is indistinguishable from one that cleared it.
 */

const supabasePath = require.resolve('../../lib/supabase.js');
const scopePath = require.resolve('../../lib/projectScope.js');
const storePath = require.resolve('../../lib/projectDeleteStore.js');

function stub(path, exports) {
  require.cache[path] = { id: path, filename: path, loaded: true, exports };
}

const TYPE_ERROR = 'invalid input syntax for type bigint: "proj_1780601126203_f3v0m1"';

/**
 * @param failures  table name -> error string the fake database returns
 */
function loadStore(failures = {}) {
  const saved = new Map();
  for (const p of [supabasePath, scopePath, storePath]) saved.set(p, require.cache[p]);

  const attempted = [];
  stub(supabasePath, {
    isConfigured: () => true,
    tableConfig: () => ({
      messagingPosts: 'messaging_posts',
      rogerSessions: 'dev_sessions',
      observeUsageLogs: 'observe_usage_logs',
      assets: 'assets',
      contacts: 'contacts',
    }),
    sbQuery: async ({ method, table }) => {
      if (method === 'DELETE') {
        attempted.push(table);
        if (failures[table]) return { ok: false, status: 400, error: failures[table] };
        return { ok: true, status: 204, data: [] };
      }
      return { ok: true, status: 200, data: [] };
    },
  });
  stub(scopePath, {
    scopedListQuery: async (_t, q) => q,
    scopedIdQuery: async (_t, q) => q,
    scopedInsertRow: async (_t, row) => row,
    scopedPatchRow: async () => ({ ok: true, data: [] }),
  });
  delete require.cache[storePath];
  const store = require(storePath);

  return {
    store,
    attempted,
    restore() {
      for (const [p, mod] of saved) {
        if (mod) require.cache[p] = mod; else delete require.cache[p];
      }
    },
  };
}

test('a wrong-typed project_id no longer aborts the whole delete', async () => {
  const { store, attempted, restore } = loadStore({ dev_sessions: TYPE_ERROR });
  try {
    const result = await store.purgeProjectAssociatedData('proj_1780601126203_f3v0m1');
    assert.equal(result.ok, true, 'the purge completes instead of returning the Postgres error');
    assert.ok(
      attempted.includes('observe_usage_logs'),
      'tables after the mistyped one are still purged'
    );
  } finally { restore(); }
});

test('the mistyped table is REPORTED, not silently skipped', async () => {
  const { store, restore } = loadStore({ dev_sessions: TYPE_ERROR });
  try {
    const result = await store.purgeProjectAssociatedData('proj_1780601126203_f3v0m1');
    assert.deepEqual(
      result.purge.schemaMismatches, ['dev_sessions'],
      'a schema defect must surface — skipping quietly hides it forever'
    );
  } finally { restore(); }
});

test('a clean run reports no mismatches', async () => {
  const { store, restore } = loadStore();
  try {
    const result = await store.purgeProjectAssociatedData('proj_1780601126203_f3v0m1');
    assert.deepEqual(result.purge.schemaMismatches, []);
  } finally { restore(); }
});

test('a real database error still stops the delete', async () => {
  // Only a type mismatch is survivable: it proves the table cannot hold this
  // project's rows. Anything else means the purge is genuinely incomplete and
  // must not report success.
  const { store, restore } = loadStore({ dev_sessions: 'permission denied for table dev_sessions' });
  try {
    const result = await store.purgeProjectAssociatedData('proj_1780601126203_f3v0m1');
    assert.equal(result.ok, false, 'a genuine failure is not swallowed');
  } finally { restore(); }
});

test('a missing column stays a silent skip', async () => {
  // An ordinary absence, not a defect — it must not be reported as one.
  const { store, restore } = loadStore({
    dev_sessions: 'column dev_sessions.project_id does not exist',
  });
  try {
    const result = await store.purgeProjectAssociatedData('proj_1780601126203_f3v0m1');
    assert.equal(result.ok, true);
    assert.deepEqual(result.purge.schemaMismatches, []);
  } finally { restore(); }
});
