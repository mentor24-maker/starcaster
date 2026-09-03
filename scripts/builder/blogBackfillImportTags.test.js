'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { planTags, normalizeSlug } = require('../blog_backfill_import_tags.cjs');

/**
 * The backfill's whole risk is in deciding which posts to touch. Four
 * outcomes, and the dangerous confusion is between two of them: a post whose
 * source genuinely had no tags, and a post whose source could not be found at
 * all. Folding the second into the first is an all-clear over a post nobody
 * checked (docs/DOCTRINE.md — a sweep must report what it could not check).
 */

function snapshotWith(slug, tagsHtml) {
  return {
    page_id: `p-${slug}`,
    slug,
    payload: JSON.stringify({
      name: slug,
      layoutSections: [{
        title: 'Imported',
        modules: [{
          type: 'text',
          text:
            `<h1>${slug}</h1><p>The article body.</p>` +
            (tagsHtml ? `<p class="entry-meta"><span class="entry-tags">Tagged With: ${tagsHtml}</span></p>` : ''),
        }],
      }],
    }),
  };
}

function bySlug(...rows) {
  return new Map(rows.map((r) => [normalizeSlug(r.slug), r]));
}

test('a post with an untagged snapshot is separated from one with no snapshot', () => {
  const posts = [
    { id: '1', title: 'Has a source, no tags', slug: 'untagged', tags: [] },
    { id: '2', title: 'Source is missing entirely', slug: 'orphan', tags: [] },
  ];
  const plan = planTags(posts, bySlug(snapshotWith('untagged', '')));

  assert.equal(plan.noTagsInSource.length, 1);
  assert.equal(plan.noTagsInSource[0].id, '1');
  assert.equal(plan.noSource.length, 1, 'the post with no snapshot must be reported, not folded in');
  assert.equal(plan.noSource[0].id, '2');
  assert.equal(plan.writes.length, 0);
});

test('a post whose snapshot carries tags is planned for a write', () => {
  const posts = [{ id: '1', title: 'Tagged', slug: 'tagged', tags: [] }];
  const snap = snapshotWith('tagged',
    '<a href="/tag-junior-tennis" rel="tag">junior tennis</a>, <a href="/tag-tournaments" rel="tag">tournaments</a>');
  const plan = planTags(posts, bySlug(snap));

  assert.equal(plan.writes.length, 1);
  assert.deepEqual(plan.writes[0].tags, ['junior tennis', 'tournaments']);
  assert.equal(plan.writes[0].id, '1');
});

test('a post that already has tags is left completely alone', () => {
  // Running twice must be a no-op — the second run is a different program.
  const posts = [{ id: '1', title: 'Already done', slug: 'tagged', tags: ['junior tennis'] }];
  const snap = snapshotWith('tagged', '<a href="/tag-something-else" rel="tag">something else</a>');
  const plan = planTags(posts, bySlug(snap));

  assert.equal(plan.writes.length, 0, 'an already-tagged post was queued for a rewrite');
  assert.equal(plan.alreadyTagged.length, 1);
});

test('every post lands in exactly one outcome', () => {
  // A post that fell through every branch would be silently untouched, which
  // reads identically to "nothing needed doing".
  const posts = [
    { id: '1', title: 'a', slug: 'tagged', tags: [] },
    { id: '2', title: 'b', slug: 'untagged', tags: [] },
    { id: '3', title: 'c', slug: 'orphan', tags: [] },
    { id: '4', title: 'd', slug: 'tagged', tags: ['kept'] },
  ];
  const plan = planTags(posts, bySlug(
    snapshotWith('tagged', '<a href="/tag-x" rel="tag">x</a>'),
    snapshotWith('untagged', ''),
  ));
  const total = plan.writes.length + plan.noSource.length + plan.noTagsInSource.length + plan.alreadyTagged.length;
  assert.equal(total, posts.length);
});

test('the slug match ignores case and surrounding space', () => {
  const posts = [{ id: '1', title: 'a', slug: '  Tagged  ', tags: [] }];
  const plan = planTags(posts, bySlug(snapshotWith('tagged', '<a href="/tag-x" rel="tag">x</a>')));
  assert.equal(plan.writes.length, 1, 'the snapshot was not matched to its post');
});
