'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

/**
 * Every blog post gets an address (86bbu23n7).
 *
 * A post with a blank slug is unreachable: the public blog serves a post BY
 * slug, so the row exists, the manager lists it, and every link to it goes
 * nowhere. Five of Delray's published posts were in exactly that state — the
 * Create Post form's Slug field says "auto-generated if blank" and the store
 * wrote the empty string it was handed. Nothing errored, so nothing said so.
 *
 * These run against a fake database whose schema is read from
 * docs/SQL/blog_setup.sql, the same harness the events store uses.
 */

const SQL_PATH = path.join(__dirname, '..', '..', 'docs', 'SQL', 'blog_setup.sql');
const { parseSchemaFile, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const storePath = require.resolve('../../lib/blogPostsStore.js');

const SCOPE_A = { projectId: 'proj_a', userId: 'user_1' };
const SCOPE_B = { projectId: 'proj_b', userId: 'user_2' };

function withStore() {
  const db = createFakeDb(parseSchemaFile(SQL_PATH));
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({ blogPosts: 'blog_posts', blogPostCategories: 'blog_post_categories' }),
    sbQuery: async (args) => db.sbQuery(args),
  };

  const realSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase,
  };
  // The store caches "does this table exist" per table name, so it has to be
  // re-required per test or it answers from the previous test's database.
  delete require.cache[storePath];
  const store = require(storePath);

  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    delete require.cache[storePath];
  }
  return { store, restore };
}

test('a post created with no slug is given one from its title', async (t) => {
  const { store, restore } = withStore();
  t.after(restore);

  const created = await store.createPost({ title: 'What Level Tennis Player Are You?' }, SCOPE_A);
  assert.equal(created.slug, 'what-level-tennis-player-are-you');

  // And it is reachable by that address, which is the whole point.
  const read = await store.getPostBySlug('what-level-tennis-player-are-you', SCOPE_A);
  assert.ok(read, 'the post could not be found at the address it was given');
  assert.equal(read.id, created.id);
});

test('a hand-typed slug is normalized on the way in', async (t) => {
  const { store, restore } = withStore();
  t.after(restore);

  const created = await store.createPost({ title: 'Anything', slug: 'My CHOSEN Address!' }, SCOPE_A);
  assert.equal(created.slug, 'my-chosen-address');
});

test('two posts with the same title do not collide', async (t) => {
  const { store, restore } = withStore();
  t.after(restore);

  const first = await store.createPost({ title: 'Weekly Roundup' }, SCOPE_A);
  const second = await store.createPost({ title: 'Weekly Roundup' }, SCOPE_A);
  assert.equal(first.slug, 'weekly-roundup');
  assert.equal(second.slug, 'weekly-roundup-2');
  assert.notEqual(first.id, second.id);
});

test('addresses are unique per project, not globally', async (t) => {
  const { store, restore } = withStore();
  t.after(restore);

  const mine = await store.createPost({ title: 'Weekly Roundup' }, SCOPE_A);
  const theirs = await store.createPost({ title: 'Weekly Roundup' }, SCOPE_B);
  // Two tenants may both own /weekly-roundup on their own sites.
  assert.equal(mine.slug, 'weekly-roundup');
  assert.equal(theirs.slug, 'weekly-roundup');
});

test('editing a post keeps its own address rather than suffixing it', async (t) => {
  const { store, restore } = withStore();
  t.after(restore);

  const created = await store.createPost({ title: 'Keep My Address' }, SCOPE_A);
  const updated = await store.updatePost(created.id, { excerpt: 'edited' }, SCOPE_A);
  assert.equal(updated.slug, created.slug, 'an unrelated edit renamed the post');
});

test('clearing the slug field re-derives it instead of blanking it', async (t) => {
  const { store, restore } = withStore();
  t.after(restore);

  const created = await store.createPost({ title: 'Derive Me Again', slug: 'something-else' }, SCOPE_A);
  const updated = await store.updatePost(created.id, { slug: '' }, SCOPE_A);
  assert.equal(updated.slug, 'derive-me-again');
});

test('a slug edited to capitals and punctuation is stored normalized', async (t) => {
  const { store, restore } = withStore();
  t.after(restore);

  const created = await store.createPost({ title: 'Original' }, SCOPE_A);
  const updated = await store.updatePost(created.id, { slug: 'New TITLE, Revised!' }, SCOPE_A);
  assert.equal(updated.slug, 'new-title-revised');
});

test('a post with a title that yields nothing usable is not given a fake address', async (t) => {
  const { store, restore } = withStore();
  t.after(restore);

  const created = await store.createPost({ title: '!!!' }, SCOPE_A);
  assert.equal(created.slug, '', 'an invented address is worse than an obvious gap');
});
