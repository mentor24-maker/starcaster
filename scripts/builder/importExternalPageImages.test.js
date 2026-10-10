'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  collectExternalImages,
  rewritePublishedCopy,
  countHostReferences,
} = require('../import_external_page_images');

/**
 * scripts/import_external_page_images.js moves a site's pictures off its old
 * server. It used to rewrite only the DRAFT of each page — but once a page has
 * been published, visitors are served its published copy
 * (lib/publishedPageRead.js), so a run reported every page fixed while the live
 * site kept loading every image from the server that was about to be switched
 * off (task 86bcgdac6, Dane of Earth, Hostinger ending 2026-10-23).
 */

const OLD = 'https://daneofearth.org/wp-content/uploads/2025/10/title-1080x675.jpg';
const NEW = 'https://example.public.blob.vercel-storage.com/title.jpg';
const SWAPS = [[OLD, NEW]];
const NOW = '2026-10-10T23:00:00.000Z';

function copyHolding(url, sourceUpdatedAt) {
  return {
    page_id: 1479,
    slug: 'category-autobiography',
    payload: JSON.stringify({ id: '1479', updatedAt: sourceUpdatedAt, html: `<img src="${url}">` }),
    source_updated_at: sourceUpdatedAt,
  };
}

test('a published copy holding the old address is rewritten, and stays a JSON string', () => {
  const out = rewritePublishedCopy(copyHolding(OLD, '2026-10-10T22:33:56Z'), '2026-10-09T21:40:11Z', SWAPS, NOW);
  assert.ok(out, 'the copy was not rewritten');
  assert.equal(typeof out.payload, 'string', 'the publish step stores a string; reading back an object would change its shape');
  assert.ok(out.payload.includes(NEW));
  assert.ok(!out.payload.includes('daneofearth.org'));
});

test('a copy in step with its draft is stamped in step after the run', () => {
  // Otherwise every rewritten page would suddenly read as "has unpublished changes".
  const out = rewritePublishedCopy(copyHolding(OLD, '2026-10-10T22:33:56Z'), '2026-10-09T21:40:11Z', SWAPS, NOW);
  assert.equal(out.sourceUpdatedAt, NOW);
  assert.equal(JSON.parse(out.payload).updatedAt, NOW);
});

test('a copy already behind its draft keeps its old stamp', () => {
  // That page really does have unpublished edits; stamping it current would
  // hide them from the Publish button.
  const out = rewritePublishedCopy(copyHolding(OLD, '2026-10-01T00:00:00Z'), '2026-10-09T21:40:11Z', SWAPS, NOW);
  assert.equal(out.sourceUpdatedAt, '2026-10-01T00:00:00Z');
});

test('when the draft is not rewritten, the copy keeps its stamp', () => {
  const out = rewritePublishedCopy(copyHolding(OLD, '2026-10-10T22:33:56Z'), '2026-10-09T21:40:11Z', SWAPS, null);
  assert.ok(out);
  assert.equal(out.sourceUpdatedAt, '2026-10-10T22:33:56Z');
});

test('a copy with nothing to rewrite, or an unreadable payload, is left alone', () => {
  assert.equal(rewritePublishedCopy(copyHolding(NEW, NOW), NOW, SWAPS, NOW), null);
  assert.equal(rewritePublishedCopy({ payload: 'not json', source_updated_at: NOW }, NOW, SWAPS, NOW), null);
});

test('an image only the published copy still holds is found', () => {
  // The draft can be clean while the copy is not; scanning drafts alone missed it.
  const files = collectExternalImages([{ slug: 'x', payload: copyHolding(OLD, NOW).payload }], 'daneofearth.org');
  assert.equal(files.length, 1);
  assert.equal(files[0].refs, 1);
});

test('the read-back counts what is left, and nothing on other hosts', () => {
  const rows = [{ layout_sections: { html: `<img src="${OLD}"><img src="${NEW}">` } }, copyHolding(OLD, NOW)];
  assert.equal(countHostReferences(rows, 'daneofearth.org'), 2);
  assert.equal(countHostReferences(rows, 'delraytennis.com'), 0);
});

// ---------------------------------------------------------------------------
// scripts/unpublish_project_pages.js — the other half of the same data pass.

const { planUnpublish } = require('../unpublish_project_pages');

test('unpublish: matches slugs loosely, and never acts on a missing or shared one', () => {
  const rows = [
    { id: 1463, slug: 'test', is_published: true },
    { id: 1474, slug: 'feed', is_published: true },
    { id: 1, slug: 'dup', is_published: true },
    { id: 2, slug: 'dup', is_published: true },
    { id: 9, slug: 'gone', is_published: false },
  ];
  const plan = planUnpublish(rows, ['/test/', 'FEED', 'dup', 'gone', 'nope', '']);
  assert.deepEqual(plan.change.map((r) => r.id), [1463, 1474]);
  assert.deepEqual(plan.already.map((r) => r.id), [9]);
  assert.deepEqual(plan.missing, ['nope']);
  assert.deepEqual(plan.ambiguous, [{ slug: 'dup', ids: [1, 2] }]);
});
