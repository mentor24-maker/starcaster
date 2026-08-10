'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * sbQuery() takes `headers`. It silently ignores any other key, so passing
 * `extraHeaders` (the name used by the ContactsStore/store.js wrappers, which
 * translate it) means the Prefer header never reaches PostgREST — writes then
 * come back with an empty body. A create still works but returns null, and a
 * delete reports "not found" for a row it just removed.
 *
 * These tests pin the wire format by swapping lib/supabase for a recorder.
 */

const supabasePath = require.resolve('../../lib/supabase.js');
const storePath = require.resolve('../../lib/objectAssociationsStore.js');

function loadStoreWithRecorder() {
  const calls = [];
  const fakeSupabase = {
    sbQuery: async (options) => {
      calls.push(options);
      return { ok: true, status: 200, data: [{ id: 1 }] };
    },
    tableConfig: () => ({ objectAssociations: 'object_associations' }),
  };

  const realSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: fakeSupabase,
  };
  delete require.cache[storePath];
  const store = require(storePath);

  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    delete require.cache[storePath];
  }

  return { store, calls, restore };
}

test('creating an association asks PostgREST to return the new row', async () => {
  const { store, calls, restore } = loadStoreWithRecorder();
  try {
    await store.createAssociation({
      a: { type: 'messaging_tweets', id: '42', label: 'Launch tweet' },
      b: { type: 'asset', id: '88', label: 'Hero image' },
    }, null);

    const post = calls.find((call) => call.method === 'POST');
    assert.ok(post, 'a POST should have been issued');
    assert.equal(post.headers?.Prefer, 'return=representation');
    assert.equal(post.extraHeaders, undefined, 'extraHeaders is not a thing sbQuery reads');
  } finally {
    restore();
  }
});

test('deleting an association asks PostgREST to return the removed row', async () => {
  const { store, calls, restore } = loadStoreWithRecorder();
  try {
    await store.deleteAssociation(7, null);

    const del = calls.find((call) => call.method === 'DELETE');
    assert.ok(del, 'a DELETE should have been issued');
    assert.equal(del.headers?.Prefer, 'return=representation');
    assert.equal(del.extraHeaders, undefined, 'extraHeaders is not a thing sbQuery reads');
  } finally {
    restore();
  }
});

test('the canonical pair is what actually gets written', async () => {
  const { store, calls, restore } = loadStoreWithRecorder();
  try {
    // Given in the "wrong" order on purpose — the row must still come out sorted.
    await store.createAssociation({
      a: { type: 'messaging_tweets', id: '42', label: 'Launch tweet' },
      b: { type: 'asset', id: '88', label: 'Hero image' },
    }, null);

    const post = calls.find((call) => call.method === 'POST');
    const row = Array.isArray(post.body) ? post.body[0] : post.body;
    assert.equal(row.a_type, 'asset');
    assert.equal(row.a_id, '88');
    assert.equal(row.b_type, 'messaging_tweets');
    assert.equal(row.b_id, '42');
  } finally {
    restore();
  }
});

test('listing reads both sides of the link', async () => {
  const { store, calls, restore } = loadStoreWithRecorder();
  try {
    await store.listAssociationsForObject({ type: 'messaging_tweets', id: '42' }, null);

    const queries = calls.map((call) => String(call.query || ''));
    assert.ok(queries.some((q) => q.includes('a_type=eq.messaging_tweets')), 'should query the A side');
    assert.ok(queries.some((q) => q.includes('b_type=eq.messaging_tweets')), 'should query the B side');
  } finally {
    restore();
  }
});
