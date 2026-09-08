'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const { selectPagesToPublish } = require('../../lib/builderPublishStore');
const { propagateCanonicalSection } = require('../../lib/canonicalPropagation');

/**
 * "Save & Publish" on a saved section publishes THOSE pages — not the site.
 *
 * Saving a saved section rewrites it on every following page, in those pages'
 * drafts only, and the operator's next step was to leave the screen and find
 * the Publish panel (2026-09-03). Offering to do it from the save dialog is
 * only safe if the publish is NARROW: `POST /api/builder/publish` with no
 * `pageIds` publishes everything pending, so the obvious wiring would put
 * every unrelated half-finished draft in the project in front of visitors as a
 * side effect of a routine section edit.
 *
 * Two things have to hold for that, and both are tested here rather than
 * eyeballed: the propagation has to report WHICH pages it wrote, and the
 * publish has to honour that list — including the reading that is easy to get
 * backwards, that an EMPTY list means nothing rather than everything.
 */

// --- The narrowing rule -----------------------------------------------------

const PENDING = [
  { id: '1', slug: 'home' },
  { id: '2', slug: 'about' },
  { id: '3', slug: 'half-finished' },
];

test('no page list at all publishes everything pending', () => {
  assert.deepEqual(selectPagesToPublish(PENDING, undefined), PENDING);
  assert.deepEqual(selectPagesToPublish(PENDING, null), PENDING);
});

test('an EMPTY page list publishes nothing — never everything', () => {
  // The whole hazard in one line. `if (pageIds.length)` reads this as "no
  // filter" and puts the entire site live.
  assert.deepEqual(selectPagesToPublish(PENDING, []), []);
});

test('a named list publishes only those pages, leaving other drafts alone', () => {
  const chosen = selectPagesToPublish(PENDING, ['1', '2']);
  assert.deepEqual(chosen.map((p) => p.slug), ['home', 'about']);
  assert.ok(
    !chosen.some((p) => p.slug === 'half-finished'),
    'an unrelated pending draft must not be swept up by a saved-section save'
  );
});

test('naming a page that is not pending does not publish it', () => {
  // Intersection, never a source: a stale or wrong id costs nothing.
  assert.deepEqual(selectPagesToPublish(PENDING, ['999']), []);
  assert.deepEqual(selectPagesToPublish(PENDING, [' 2 ', '', null, '999']).map((p) => p.slug), ['about']);
});

test('page ids compare as strings, so a numeric id from the tally still matches', () => {
  const numeric = [{ id: 7, slug: 'contact' }];
  assert.deepEqual(selectPagesToPublish(numeric, ['7']).map((p) => p.slug), ['contact']);
});

// --- The tally has to name the pages ---------------------------------------

function sectionOn(masterId, text) {
  return {
    id: `s-${masterId}`,
    savedSectionId: masterId,
    canonical: true,
    modules: [{ id: 'm', type: 'text', text: text ?? 'original', settings: {} }],
  };
}

const MASTER = sectionOn('m1', 'the new master content');

function depsOver(pages, updatePage) {
  return {
    listPages: async () => ({ ok: true, data: pages }),
    updatePage,
    listPageTemplates: async () => ({ ok: false }),
    updatePageTemplate: async () => ({ ok: true }),
  };
}

test('a push reports WHICH pages it rewrote, not only how many', async () => {
  const pages = [
    { id: '10', name: 'Home', layoutSections: [sectionOn('m1')] },
    { id: '11', name: 'About', layoutSections: [sectionOn('m1')] },
    { id: '12', name: 'Elsewhere', layoutSections: [sectionOn('other')] },
  ];
  const written = [];
  const tally = await propagateCanonicalSection('m1', MASTER, {}, {
    deps: depsOver(pages, async (id) => {
      written.push(String(id));
      return { ok: true };
    }),
  });

  assert.equal(tally.updated, 2);
  assert.deepEqual(
    tally.updatedPages,
    [{ pageId: '10', name: 'Home' }, { pageId: '11', name: 'About' }],
    'the ids are what "Save & Publish" hands to the publish route'
  );
  assert.equal(tally.updatedPages.length, tally.updated, 'the list and the count are the same fact');
  assert.deepEqual(written, ['10', '11'], 'and no other page was written');
});

test('a page skipped for local changes is not in the list, so it is not published', async () => {
  // Page 11's copy no longer matches the master as it stood BEFORE this save,
  // so the push leaves it alone. Publishing it anyway would put the operator's
  // own unfinished edit on that page live, as part of a change he made
  // somewhere else entirely.
  const previous = sectionOn('m1', 'original');
  const pages = [
    { id: '10', name: 'Home', layoutSections: [sectionOn('m1', 'original')] },
    { id: '11', name: 'Drifted', layoutSections: [sectionOn('m1', 'hand-edited on this page')] },
  ];
  const written = [];
  const tally = await propagateCanonicalSection('m1', MASTER, {}, {
    previousSection: previous,
    deps: depsOver(pages, async (id) => {
      written.push(String(id));
      return { ok: true };
    }),
  });

  assert.equal(tally.skipped.length, 1, 'the drifted page is reported as skipped');
  assert.deepEqual(written, ['10'], 'and it was never written');
  assert.deepEqual(
    tally.updatedPages.map((p) => p.pageId),
    ['10'],
    'so it must not be offered for publishing either'
  );
});

test('a page whose write FAILED is not offered for publishing', async () => {
  const pages = [
    { id: '10', name: 'Home', layoutSections: [sectionOn('m1')] },
    { id: '11', name: 'About', layoutSections: [sectionOn('m1')] },
  ];
  const tally = await propagateCanonicalSection('m1', MASTER, {}, {
    deps: depsOver(pages, async (id) => (String(id) === '11' ? { ok: false } : { ok: true })),
  });

  assert.equal(tally.failed, 1);
  assert.deepEqual(
    tally.updatedPages.map((p) => p.pageId),
    ['10'],
    'publishing a page whose new content never landed would put the OLD draft live'
  );
});

test('a page written for its CLEAN copy is not reported as an overwrite', async () => {
  // The shape the UI fixture's "Block States" page has: two copies of one
  // master, one hand-edited and one not. The page is written — the clean copy
  // takes the update — while the edited copy is left exactly as it was.
  // Calling that "1 page with local changes was overwritten" tells the
  // operator his edit is gone when it is still on the page.
  const previous = sectionOn('m1', 'original');
  const pages = [{
    id: '10',
    name: 'Block States',
    layoutSections: [sectionOn('m1', 'original'), { ...sectionOn('m1', 'hand-edited'), id: 's-m1-b' }],
  }];
  const tally = await propagateCanonicalSection('m1', MASTER, {}, {
    previousSection: previous,
    deps: depsOver(pages, async () => ({ ok: true })),
  });

  assert.equal(tally.updated, 1, 'the page IS written, for the clean copy');
  assert.deepEqual(tally.updatedPages.map((p) => p.pageId), ['10'], 'so it is publishable');
  assert.deepEqual(tally.overwritten, [], 'but nothing drifted was overwritten');
});

test('a FORCED push does report the drifted pages it overwrote', async () => {
  const previous = sectionOn('m1', 'original');
  const pages = [{ id: '10', name: 'Rates', layoutSections: [sectionOn('m1', 'hand-edited')] }];
  const tally = await propagateCanonicalSection('m1', MASTER, {}, {
    previousSection: previous,
    overwriteDrifted: true,
    deps: depsOver(pages, async () => ({ ok: true })),
  });
  assert.deepEqual(tally.overwritten, [{ pageId: '10', name: 'Rates' }]);
});

// --- The wiring, at source level -------------------------------------------

test('the publish route forwards pageIds', () => {
  const route = read('routes/publish.js');
  assert.match(route, /pageIds: Array\.isArray\(body\?\.pageIds\) \? body\.pageIds : undefined/);
});

test('the browser reaches the publish route through the scoped adapter', () => {
  // An unmapped path falls through to a plain fetch carrying neither the
  // /api/builder prefix nor the project-scope headers — the 404 that produces
  // reads as a missing feature. propagation-runs had exactly this bug.
  const adapter = read('lib/builder-client/adapters/builder-admin-fetch.ts');
  assert.match(adapter, /\/api\\\/admin\\\/publish/, 'the rewrite entry must exist');
  const editor = read('components/admin-builder-editor.tsx');
  assert.ok(
    !/builderAdminFetch\(["\'`]\/api\/builder\/publish/.test(editor),
    'the editor must call the /api/admin/ path so the rewrite applies'
  );
});
