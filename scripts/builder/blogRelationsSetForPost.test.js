'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/**
 * Ticket 86bbufu83 - relating posts from the post editor.
 *
 * The links manager's write only ever ADDS: it relates a checked set to each
 * other, and there is no way to say "not that one any more". The post editor
 * owns one post's whole list, so unchecking has to REMOVE a pair, and it must
 * touch only pairs that involve this post - a relation between two other
 * posts belongs to them, and quietly deleting it while saving an unrelated
 * article is the kind of loss nobody reports because nobody sees it happen.
 *
 * The store is exercised against a fake Supabase rather than a real one, so
 * this runs anywhere: the fake is the whole table, and the assertions are
 * about the rows that end up in it.
 */

const supabasePath = require.resolve('../../lib/supabase');

function loadStoreWithFakeTable(initialRows, { refuseWrites = false } = {}) {
  // Both modules are re-required fresh so the store's table-support cache and
  // the fake table start empty on every test.
  delete require.cache[supabasePath];
  delete require.cache[require.resolve('../../lib/blogPostRelationsStore')];

  const supabase = require(supabasePath);
  const rows = initialRows.map((r) => ({ ...r }));

  supabase.isConfigured = () => true;
  supabase.tableConfig = () => ({ blogPostRelations: 'blog_post_relations' });
  supabase.sbQuery = async ({ method = 'GET', query = '', body }) => {
    if (method === 'GET') return { ok: true, data: rows.map((r) => ({ ...r })) };
    if (method === 'POST') {
      if (refuseWrites) return { ok: false, error: 'permission denied for table blog_post_relations' };
      const added = (Array.isArray(body) ? body : [body]).map((r) => ({ ...r }));
      rows.push(...added);
      return { ok: true, data: added };
    }
    if (method === 'DELETE') {
      const a = decodeURIComponent((query.match(/post_id_a=eq\.([^&]*)/) || [])[1] || '');
      const b = decodeURIComponent((query.match(/post_id_b=eq\.([^&]*)/) || [])[1] || '');
      const gone = rows.filter((r) => r.post_id_a === a && r.post_id_b === b);
      for (const row of gone) rows.splice(rows.indexOf(row), 1);
      return { ok: true, data: gone };
    }
    return { ok: false, error: 'unexpected method' };
  };

  return { store: require('../../lib/blogPostRelationsStore'), rows };
}

const pair = (a, b) => ({ id: `brel_${a}_${b}`, project_id: 'p1', post_id_a: a, post_id_b: b });
const keys = (rows) => rows.map((r) => `${r.post_id_a} ${r.post_id_b}`).sort();
const scope = { projectId: 'p1', userId: 'u1' };

test('checking two posts writes one pair each, both canonically ordered', async () => {
  const { store, rows } = loadStoreWithFakeTable([]);
  const result = await store.setRelatedPosts('b', ['a', 'c'], scope);
  assert.deepEqual(result, { added: 2, removed: 0 });
  assert.deepEqual(keys(rows), ['a b', 'b c']);
});

test('unchecking a post removes its pair', async () => {
  const { store, rows } = loadStoreWithFakeTable([pair('a', 'b'), pair('b', 'c')]);
  const result = await store.setRelatedPosts('b', ['c'], scope);
  assert.deepEqual(result, { added: 0, removed: 1 });
  assert.deepEqual(keys(rows), ['b c']);
});

test('saving with the selection unchanged writes nothing at all', async () => {
  const { store, rows } = loadStoreWithFakeTable([pair('a', 'b'), pair('b', 'c')]);
  const result = await store.setRelatedPosts('b', ['c', 'a'], scope);
  assert.deepEqual(result, { added: 0, removed: 0 });
  assert.deepEqual(keys(rows), ['a b', 'b c']);
});

test('a relation between two OTHER posts is left alone', async () => {
  // a--c is somebody else's pair. Saving post b must not touch it, even
  // though b is being cleared completely.
  const { store, rows } = loadStoreWithFakeTable([pair('a', 'c'), pair('b', 'c')]);
  const result = await store.setRelatedPosts('b', [], scope);
  assert.deepEqual(result, { added: 0, removed: 1 });
  assert.deepEqual(keys(rows), ['a c']);
});

test('a post is never related to itself, however the id arrives', async () => {
  const { store, rows } = loadStoreWithFakeTable([]);
  const result = await store.setRelatedPosts('b', ['b', '', '   ', 'a'], scope);
  assert.deepEqual(result, { added: 1, removed: 0 });
  assert.deepEqual(keys(rows), ['a b']);
});

test('the rows carry BOTH tenant columns', async () => {
  // CLAUDE.md landmine 12: a scoped table needs project_id AND owner_user_id,
  // and rows landing with no tenant is a failure that reads as success.
  const { store, rows } = loadStoreWithFakeTable([]);
  await store.setRelatedPosts('b', ['a'], scope);
  assert.equal(rows[0].project_id, 'p1');
  assert.equal(rows[0].owner_user_id, 'u1');
});

test('a database REFUSAL is reported, never absorbed', async () => {
  // Landmine 15: answering the caller with its own input while the database
  // kept the old rows is how the card template stayed frozen for two months.
  //
  // Note the message: it contains the word "relation", because the table is
  // CALLED blog_post_relations. isMissingTable() used to match that bare word
  // and read every refusal about this table as the table being absent.
  const { store, rows } = loadStoreWithFakeTable([], { refuseWrites: true });
  assert.equal(await store.setRelatedPosts('b', ['a'], scope), null);
  assert.deepEqual(rows, [], 'nothing may be written when the database refused');
});

test('a blank post id relates nothing rather than writing a stray row', async () => {
  const { store, rows } = loadStoreWithFakeTable([]);
  assert.equal(await store.setRelatedPosts('', ['a', 'b'], scope), null);
  assert.deepEqual(rows, []);
});

test('the store is the one the route calls', () => {
  // Cheap, but it is the join: a perfect store nothing is wired to is nothing.
  const routeSource = require('node:fs').readFileSync(
    path.join(__dirname, '..', '..', 'routes', 'blog.js'), 'utf8'
  );
  assert.match(routeSource, /setRelatedPosts.*require\('\.\.\/lib\/blogPostRelationsStore'\)|setRelatedPosts/);
  assert.match(routeSource, /'\/api\/blog\/relations' && method === 'PUT'/);
  assert.match(routeSource, /await setRelatedPosts\(/);
});
