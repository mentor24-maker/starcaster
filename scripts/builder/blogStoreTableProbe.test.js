'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Ticket 86bbu4qh5, found while building the blog links manager.
 *
 * `blogPostsStore` decides whether a Supabase table exists by SELECTing one
 * column from it. `blog_post_categories` is a pure join table -- its primary
 * key is (post_id, category_id) and it has no `id` column -- so probing
 * `select=id` came back "column blog_post_categories.id does not exist",
 * which isMissingTable() reads as the TABLE being gone.
 *
 * The store then used the local JSON file for every read and write of that
 * join, silently. On Vercel the filesystem is read-only (landmine 6), so
 * assigning a category to a blog post reported success and persisted nothing,
 * and listing posts by category returned an empty list on a blog that had
 * them. Both looked exactly like "this tenant has no categories yet".
 *
 * This test reads the source rather than hitting a database, so it runs
 * anywhere. What it pins is the rule: a probe must name a column the table it
 * probes actually HAS.
 */

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'lib', 'blogPostsStore.js'),
  'utf8'
);

const SCHEMA = fs.readFileSync(
  path.join(__dirname, '..', '..', 'docs', 'SQL', 'blog_setup.sql'),
  'utf8'
);

test('the join table genuinely has no id column - the reason the probe had to change', () => {
  // Anchored on the CREATE TABLE body, so this keeps telling the truth even
  // if the surrounding file is reorganised.
  const body = SCHEMA.split('create table if not exists public.blog_post_categories')[1];
  assert.ok(body, 'blog_post_categories should still be defined in blog_setup.sql');
  const columns = body.split(');')[0];
  assert.ok(/post_id/.test(columns), 'join table should have post_id');
  assert.ok(/category_id/.test(columns), 'join table should have category_id');
  assert.ok(
    !/^\s*id\s+/m.test(columns),
    'if the join table ever gains an id column, this whole test can go - but until then, probing id is a lie'
  );
});

test('the store probes a column each table actually has, not a hardcoded id', () => {
  assert.ok(
    /PROBE_COLUMN/.test(SOURCE),
    'supportsSupabase should look the probe column up per table'
  );
  // The join must be probed by post_id. Asserting on the mapping rather than
  // on a phrase, so a reworded comment cannot pass this.
  assert.match(
    SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''),
    /join:\s*'post_id'/,
    'the join table must be probed by post_id - it has no id column'
  );
});

test('no probe in this store selects id from the join table', () => {
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const probes = code.match(/select=\$\{column\}|select=id/g) || [];
  assert.ok(
    !probes.includes('select=id'),
    'a literal select=id probe is back; it silently disables the join table'
  );
});
