'use strict';

/**
 * createMessagingTag driven end to end against a fake database.
 *
 * Everything else that guards this consolidation asserts on the SHAPE of the
 * source — that create branches on `clone`, that the lookup does not list the
 * table. Shape assertions cannot see the defect they were written for actually
 * happening, and round 3 of 86bbu4gdu got through a full round of them: the
 * store's own tests were green while cloning a media tag created an unrelated
 * three-word row and reported success.
 *
 * So this file asks the store the real question and reads the row it tried to
 * insert. `sbQuery` is replaced in the module cache BEFORE the store is
 * required, because the store destructures it at load time — patching the
 * module afterwards would leave the real function in place and the test would
 * silently be measuring nothing.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const SUPABASE = require.resolve('../../lib/supabase');
const STORE = require.resolve('../../lib/messagingTagsStore');
const SCOPE = require.resolve('../../lib/projectScope');

const TABLE = 'messaging_tags';
const SCOPE_VALUES = { projectId: 'proj_test', userId: 'user_test' };

/**
 * Enough of PostgREST to answer this store: the tenant-column probe, a
 * `tag=ilike.` read with LIKE semantics, and an insert that returns what it
 * wrote. Every request is recorded so a test can assert what was ASKED as well
 * as what came back.
 */
function fakeDatabase(seedTags) {
  const rows = seedTags.map((tag, i) => ({
    id: i + 1,
    tag,
    topic: '',
    importance: null,
    source: '',
    project_id: SCOPE_VALUES.projectId,
    owner_user_id: SCOPE_VALUES.userId,
    created_at: '2026-09-05T00:00:00Z',
    updated_at: '2026-09-05T00:00:00Z',
  }));
  const requests = [];
  let nextId = rows.length + 1;

  function matches(pattern, value) {
    // PostgREST turns `*` into `%`; SQL LIKE then reads % and _ as wildcards
    // and \ as the escape character. Case-insensitive, because it is ilike.
    let re = '';
    for (let i = 0; i < pattern.length; i += 1) {
      const ch = pattern[i];
      if (ch === '\\') { re += pattern[i + 1] ? pattern[i + 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : ''; i += 1; }
      else if (ch === '%' || ch === '*') re += '.*';
      else if (ch === '_') re += '.';
      else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`^${re}$`, 'i').test(value);
  }

  async function sbQuery({ method = 'GET', table, query, body }) {
    requests.push({ method, table, query });
    if (String(query || '').includes('select=project_id,owner_user_id')) {
      return { ok: true, status: 200, data: [] };
    }
    if (method === 'GET') {
      const m = /tag=ilike\.([^&]*)/.exec(String(query || ''));
      if (!m) return { ok: true, status: 200, data: rows.slice() };
      const pattern = decodeURIComponent(m[1]);
      return { ok: true, status: 200, data: rows.filter((r) => matches(pattern, r.tag)) };
    }
    if (method === 'POST') {
      const input = Array.isArray(body) ? body[0] : body;
      if (rows.some((r) => r.tag.toLowerCase() === String(input.tag).toLowerCase())) {
        return {
          ok: false,
          status: 409,
          error: 'duplicate key value violates unique constraint "idx_messaging_tags_project_tag"',
        };
      }
      const row = {
        id: nextId, topic: '', importance: null, source: '',
        created_at: '', updated_at: '', ...input,
      };
      nextId += 1;
      rows.push(row);
      return { ok: true, status: 201, data: [row] };
    }
    return { ok: false, status: 500, error: `unexpected ${method}` };
  }

  return { rows, requests, sbQuery };
}

/** A store wired to a fresh fake database. */
function loadStore(seedTags) {
  const db = fakeDatabase(seedTags);
  for (const id of [SUPABASE, STORE, SCOPE]) delete require.cache[id];
  require.cache[SUPABASE] = {
    id: SUPABASE,
    filename: SUPABASE,
    loaded: true,
    exports: { sbQuery: db.sbQuery, tableConfig: () => ({ messagingTags: TABLE }) },
  };
  const store = require(STORE);
  return { store, db };
}

test.afterEach(() => {
  for (const id of [SUPABASE, STORE, SCOPE]) delete require.cache[id];
});

test('the fake database really does refuse a duplicate — the instrument works', async () => {
  // Prove the harness can FAIL before trusting anything it passes.
  const { store } = loadStore(['Courts']);
  const res = await store.createMessagingTag({ tag: 'courts' }, SCOPE_VALUES);
  assert.equal(res.ok, false);
  assert.equal(res.status, 409);
  assert.match(res.error, /already has a tag called "Courts"/);
});

test('cloning a media tag of more than three words copies it, and does not coin', async () => {
  // Round 3, exactly as measured on the running app: Clone Tag on
  // "Zz Rv3 Center Court North Entrance" sent "<it> Copy" and created
  // "Zz Rv3 Center" — three words, no " Copy" in it, matching nothing on
  // assets.tags — and the toast reported success.
  const original = 'Center Court North Entrance';
  const { store, db } = loadStore([original]);

  const res = await store.createMessagingTag(
    { tag: `${original} Copy`, clone: true },
    SCOPE_VALUES
  );

  assert.equal(res.ok, true);
  assert.equal(res.status, 201);
  assert.equal(res.data.tag, 'Center Court North Entrance Copy');
  assert.ok(res.data.tag.includes(original), 'the clone must contain the tag it copied');

  // And the row that actually landed says the same thing — a 201 carrying the
  // right name would still be a bug if a different name reached the table.
  const stored = db.rows.map((r) => r.tag);
  assert.deepEqual(stored, [original, 'Center Court North Entrance Copy']);
  assert.equal(stored.includes('Center Court North'), false,
    'the truncation must not exist anywhere in the table');
});

test('cloning the same tag twice numbers the copy rather than refusing it', async () => {
  const original = 'Center Court North Entrance';
  const { store } = loadStore([original, `${original} Copy`]);
  const res = await store.createMessagingTag(
    { tag: `${original} Copy`, clone: true },
    SCOPE_VALUES
  );
  assert.equal(res.status, 201);
  assert.equal(res.data.tag, 'Center Court North Entrance Copy 2');
});

test('cloning a three-word messaging tag also keeps the word Copy', async () => {
  // Round 2 fixed this button by numbering INSIDE three words
  // ("Zz Look Three" -> "Zz Look Three2"). Off the coining path the fourth
  // word survives, so the copy now says what it is.
  const { store } = loadStore(['Zz Look Three']);
  const res = await store.createMessagingTag(
    { tag: 'Zz Look Three Copy', clone: true },
    SCOPE_VALUES
  );
  assert.equal(res.status, 201);
  assert.equal(res.data.tag, 'Zz Look Three Copy');
});

test('the Add form still COINS — a long tag typed in is shaped, and a duplicate refused', async () => {
  // The other half of the split, and the one a careless fix would break: this
  // is Messaging authoring a tag, so the hashtag vocabulary still applies.
  const { store } = loadStore([]);
  const coined = await store.createMessagingTag({ tag: 'center court north entrance' }, SCOPE_VALUES);
  assert.equal(coined.status, 201);
  assert.equal(coined.data.tag, 'Center Court North');

  const again = await store.createMessagingTag({ tag: '  CENTER   court North ' }, SCOPE_VALUES);
  assert.equal(again.ok, false);
  assert.equal(again.status, 409, 'a duplicate typed into the Add form is still a sentence');
  assert.doesNotMatch(again.error, /duplicate key value/, 'never the raw constraint dump');
});

test('one create reads one row, not the whole table', async () => {
  // Both importers call createMessagingTag inside a per-tag loop. While the
  // lookup listed 5000 rows, an import creating 600 tags made 600 full-table
  // reads inside one serverless invocation.
  const { store, db } = loadStore(['Courts', 'Junior Tennis']);
  await store.createMessagingTag({ tag: 'Adult Clinics' }, SCOPE_VALUES);

  const reads = db.requests.filter(
    (r) => r.method === 'GET' && !String(r.query).includes('select=project_id,owner_user_id')
  );
  assert.ok(reads.length >= 1, 'it must still ask the uniqueness question');
  for (const r of reads) {
    assert.match(r.query, /tag=ilike\./, `a create must not read the table unfiltered: ${r.query}`);
    assert.doesNotMatch(r.query, /limit=5000/, 'and must not ask for 5000 rows');
  }
});

test('a tag holding a LIKE wildcard is not reported as a duplicate of another', async () => {
  // Unescaped, the pattern for "50_off" matches "500off" and the store would
  // refuse a tag the project does not have.
  const { store, db } = loadStore(['500off']);
  const res = await store.createMessagingTag({ tag: '50_off', clone: true }, SCOPE_VALUES);
  assert.equal(res.ok, true, `"50_off" must not clash with "500off": ${res.error || ''}`);
  assert.equal(res.data.tag, '50_off');
  assert.deepEqual(db.rows.map((r) => r.tag), ['500off', '50_off']);
});
