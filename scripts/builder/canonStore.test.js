'use strict';

/**
 * lib/canonStore.js — Reddit comments 1/4 (task 86bch3jmr).
 *
 * The two ways a store like this has lied before, driven against a stubbed
 * PostgREST rather than read off the source:
 *   - landmine 15: an upsert without `Prefer: resolution=merge-duplicates`
 *     409s on every save after the first, and a store that then falls back
 *     answers success with the caller's own input.
 *   - landmine 12: a row written without BOTH tenant columns.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const supabase = require('../../lib/supabase');
const store = require('../../lib/canonStore');

const SCOPE = { projectId: 'proj_test', userId: 'usr_owner' };
const realQuery = supabase.sbQuery;

function stubQuery(responder) {
  const calls = [];
  supabase.sbQuery = async (req) => {
    calls.push(req);
    return responder(req);
  };
  return calls;
}

test.afterEach(() => { supabase.sbQuery = realQuery; });

test('the upsert asks PostgREST to MERGE on (project_id, doc_key), not just names the columns', async () => {
  const calls = stubQuery((req) => ({ ok: true, status: 201, data: req.body }));
  const res = await store.upsertCanonDocument({ docKey: 'VOICE', title: 'Voice', body: '# Voice\nplain', sourcePath: 'doctrine/VOICE.md' }, SCOPE);
  assert.equal(res.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.match(calls[0].query, /on_conflict=project_id,doc_key/);
  assert.match(calls[0].headers.Prefer, /resolution=merge-duplicates/);
});

test('every written row carries BOTH tenant columns and a hash of its own body', async () => {
  const calls = stubQuery((req) => ({ ok: true, status: 201, data: req.body }));
  await store.upsertCanonDocument({ docKey: 'DEO', body: 'deo body' }, SCOPE);
  const row = calls[0].body[0];
  assert.equal(row.project_id, 'proj_test');
  assert.equal(row.owner_user_id, 'usr_owner');
  assert.equal(row.content_hash, store.hashCanon('deo body'));
});

test('a refused write is ok:false with the reason — never a fallback value', async () => {
  stubQuery(() => ({ ok: false, status: 409, error: 'duplicate key value violates unique constraint' }));
  const res = await store.upsertCanonDocument({ docKey: 'VOICE', body: 'x' }, SCOPE);
  assert.equal(res.ok, false);
  assert.equal(res.status, 409);
  assert.equal(res.data, undefined, 'a refused write must not hand back the caller\'s own input as if saved');
  assert.match(res.error, /duplicate key/);
});

test('a write the database accepted but returned no row for is not reported as saved', async () => {
  stubQuery(() => ({ ok: true, status: 201, data: [] }));
  const res = await store.upsertCanonDocument({ docKey: 'VOICE', body: 'x' }, SCOPE);
  assert.equal(res.ok, false);
});

test('tenancy fails closed: no project or no owner is refused before any request', async () => {
  const calls = stubQuery(() => ({ ok: true, status: 200, data: [] }));
  assert.equal((await store.upsertCanonDocument({ docKey: 'VOICE', body: 'x' }, { userId: 'u' })).ok, false);
  assert.equal((await store.upsertCanonDocument({ docKey: 'VOICE', body: 'x' }, { projectId: 'p' })).ok, false);
  assert.equal((await store.listCanon(10, {})).ok, false);
  assert.equal(calls.length, 0);
});

test('listCanon takes the limit FIRST — a scope in the limit slot is refused, not read as every project', async () => {
  const calls = stubQuery(() => ({ ok: true, status: 200, data: [] }));
  const res = await store.listCanon(SCOPE);
  assert.equal(res.ok, false);
  assert.equal(calls.length, 0);
});

test('listCanon filters on the project and maps rows', async () => {
  const calls = stubQuery(() => ({
    ok: true,
    status: 200,
    data: [{ id: 'a', project_id: 'proj_test', owner_user_id: 'usr_owner', doc_key: 'VOICE', body: 'b', content_hash: 'h' }],
  }));
  const res = await store.listCanon(50, SCOPE);
  assert.equal(res.ok, true);
  assert.match(calls[0].query, /project_id=eq\.proj_test/);
  assert.equal(res.data[0].docKey, 'VOICE');
  assert.equal(res.data[0].ownerUserId, 'usr_owner');
});

test('a blank body or a malformed key is refused', async () => {
  const calls = stubQuery(() => ({ ok: true, status: 201, data: [{}] }));
  assert.equal((await store.upsertCanonDocument({ docKey: 'VOICE', body: '   ' }, SCOPE)).ok, false);
  assert.equal((await store.upsertCanonDocument({ docKey: 'voice; drop', body: 'x' }, SCOPE)).ok, false);
  assert.equal(calls.length, 0);
});
