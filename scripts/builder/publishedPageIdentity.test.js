'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const {
  pickPageForAddress,
  sortPagesForAddressing,
} = require('../../lib/publicSitePageAddress');

/**
 * WHICH PAGE IS AT THIS ADDRESS — the 2026-09-02 Delray defect.
 *
 * `/pickleball-videos` served an abandoned page (1449, a PLACEHOLDER SECTION
 * and no header) while Dane edited the real one (1450) and watched his
 * canonical header changes do nothing. Two mistakes stacked:
 *
 *   1. The published table was WRITTEN keyed on page_id and READ keyed on
 *      slug, with nothing making slug unique. Two rows could match one
 *      address and the winner was whatever order Postgres returned.
 *   2. Nothing ever deleted a snapshot, so every deleted page left one behind
 *      to compete.
 *
 * A test already claimed to cover this — "the build read uses the same address
 * rules as the draft", with the comment "if these disagree, publishing a site
 * silently moves its pages". It compared the normalization, which matched. The
 * tie-break was the half that differed, and nothing looked at it. So these
 * tests are about ORDER and IDENTITY, not about lower-casing.
 */

/**
 * Comments out, so an assertion cannot pass against code that has been
 * commented out. Break-testing this file caught exactly that: commenting out
 * the `removeBuildForPage` call left the words on the line and the test went
 * on passing. Anchor on what runs, not on what is written.
 */
const codeOnly = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const page = (slug, id, updatedAt) => ({ slug, id, updatedAt });

test('two pages at one address: the most recently edited draft wins, in either input order', () => {
  // THE REGRESSION. Delray really has both `Apparel` and `apparel`, and
  // matching is case-insensitive, so this is not a hypothetical.
  const older = page('Apparel', '1451', '2026-08-01T00:00:00Z');
  const newer = page('apparel', '1452', '2026-09-01T00:00:00Z');

  assert.equal(pickPageForAddress([older, newer], 'apparel')?.id, '1452');
  assert.equal(pickPageForAddress([newer, older], 'apparel')?.id, '1452');
});

test('the pick does not depend on the order rows arrive in — for ANY address', () => {
  // The old published reader took `Array.find` over an unordered query. This
  // is the property that makes that impossible: shuffle the input, same answer.
  const pages = [
    page('', '10', '2026-01-01T00:00:00Z'),
    page('home', '11', '2026-09-01T00:00:00Z'),
    page('videos', '12', '2026-05-01T00:00:00Z'),
    page('VIDEOS', '13', '2026-06-01T00:00:00Z'),
    page('about', '14', '2026-02-01T00:00:00Z'),
  ];
  for (const address of ['', 'home', 'videos', 'about']) {
    const expected = pickPageForAddress(pages, address)?.id;
    for (let i = 0; i < 40; i += 1) {
      const shuffled = pages.slice().sort(() => Math.random() - 0.5);
      assert.equal(pickPageForAddress(shuffled, address)?.id, expected, `${address} run ${i}`);
    }
  }
});

test('the root still outranks a page literally slugged "home", newer or not', () => {
  // The rank must beat recency, not lose to it — 93 Delray pages carry '' and
  // the Marinoff root is 'home'.
  const rootPage = page('', 'root', '2026-01-01T00:00:00Z');
  const homePage = page('home', 'home', '2026-09-01T00:00:00Z');
  assert.equal(pickPageForAddress([homePage, rootPage], '')?.id, 'root');
  assert.equal(pickPageForAddress([homePage, rootPage], 'home')?.id, 'root');
});

test('sorting does not mutate the caller’s array', () => {
  const pages = [page('b', '2', '2026-01-01Z'), page('a', '1', '2026-09-01Z')];
  const before = pages.map((p) => p.id).join(',');
  sortPagesForAddressing(pages);
  assert.equal(pages.map((p) => p.id).join(','), before);
});

test('the snapshot is fetched by page id, never by address', () => {
  // The write upserts on page_id. If the read keys on anything else, an
  // address can select a row belonging to a different page — which is exactly
  // what happened. Same key both directions, or it happens again.
  const reader = read('lib/publishedPageRead.js');
  const fn = reader.slice(reader.indexOf('async function getPublishedPageById'));
  const body = codeOnly(fn.slice(0, fn.indexOf('\n}\n')));
  assert.match(body, /page_id=eq\./, 'selects on page_id');
  assert.doesNotMatch(body, /slug=in\.|slug=eq\./, 'must not select on slug');
  assert.match(body, /limit=1/, 'one page id is one row');
});

test('the address is resolved against the DRAFTS, which own it — not the snapshots', () => {
  // A snapshot can outlive its page; the drafts table cannot. Only the drafts
  // can say who holds an address right now. This is also the only ordering
  // that fixes the live case, where the real page had no snapshot at all and
  // the sole matching row belonged to the abandoned one.
  const reader = read('lib/publishedPageRead.js');
  const fn = reader.slice(reader.indexOf('async function getPublishedPage('));
  const body = codeOnly(fn.slice(0, fn.indexOf('\n}\n')));
  const resolve = body.indexOf('resolvePublicPageIdForSlug');
  const fetch = body.indexOf('getPublishedPageById');
  assert.ok(resolve > -1 && fetch > -1, 'both steps present');
  assert.ok(resolve < fetch, 'resolve the address FIRST, then fetch that page');
  assert.match(body, /if \(!pageId\) return null;/, 'an unresolvable address serves no snapshot');
});

test('an unpublished or private page cannot resolve an address', () => {
  // Otherwise taking a page private would still serve its snapshot.
  const store = read('lib/builderPagesStore.js');
  const fn = store.slice(store.indexOf('async function resolvePublicPageIdForSlug'));
  const body = codeOnly(fn.slice(0, fn.indexOf('\n}\n')));
  assert.match(body, /is_published\.eq\.true,is_published\.is\.null/, 'published only');
  assert.match(body, /is_private=eq\.false/, 'not private');
  assert.match(body, /filterPublicSitePages/, 'and not a private slug');
});

test('the resolver tells "no such page" apart from "the lookup failed"', () => {
  // '' means the address resolves to nothing; null means we could not tell.
  // Collapsing the two would turn a database blip into a 404 on a live site.
  const store = read('lib/builderPagesStore.js');
  const fn = store.slice(store.indexOf('async function resolvePublicPageIdForSlug'));
  const body = codeOnly(fn.slice(0, fn.indexOf('\n}\n')));
  assert.match(body, /if \(!res\.ok \|\| !Array\.isArray\(res\.data\)\) return null;/, 'a failed read is null');
  assert.match(body, /return page \? String\(page\.id\) : '';/, 'a clean miss is empty string');
});

test('deleting a page deletes its published snapshot', () => {
  // Nothing used to. The snapshot outlived the page, keyed on an id that no
  // longer existed — unreachable, unlistable, and impossible to clean up from
  // any surface the operator has.
  const store = read('lib/builderPagesStore.js');
  const fn = store.slice(store.indexOf('async function deletePage'));
  const body = codeOnly(fn.slice(0, fn.indexOf('\n}\n')));
  assert.match(body, /await removeBuildForPage\(/, 'the snapshot removal actually runs');

  const del = body.indexOf('await removeBuildForPage(');
  const ret = body.indexOf('ok: true');
  assert.ok(del > -1 && ret > -1 && del < ret, 'before the success is reported');
  assert.match(body, /catch \(_\)/, 'best-effort: the page is already gone');
});

/**
 * RETENTION: deleting clears a snapshot, hiding a page does not.
 *
 * The other half of the test above, and it has to sit beside it -- reading
 * "deleting a page deletes its published snapshot" on its own makes tidying up
 * the unpublish path look like finishing the job, and it is the opposite.
 *
 * Put to the operator on 2026-09-14 as a three-way choice (drop the snapshot
 * on unpublish / shelve it somewhere unservable / keep it and document it) and
 * answered: keep it and document it. Measured the same day against production,
 * the three events this covers accounted for ONE row and 26 kB -- and dropping
 * the snapshot would have charged for that by changing what Publish promises
 * on every future republish, since a page put back would serve its draft.
 *
 * These tests fail if somebody implements the option that was NOT chosen.
 */

test('unpublishing, privating or renaming a page leaves its snapshot alone', () => {
  // The regression, and the natural-looking change that would cause it:
  // a `removeBuildForPage` call added to the save path, mirroring deletePage.
  const store = read('lib/builderPagesStore.js');
  const fn = store.slice(store.indexOf('async function updatePage'));
  const body = codeOnly(fn.slice(0, fn.indexOf('\n}\n')));

  assert.ok(body.length > 0, 'updatePage body was actually extracted');
  assert.match(body, /is_published|scopedPatchRow/, 'and it is the save path');
  assert.doesNotMatch(
    body,
    /removeBuildForPage/,
    'a save must not remove the published snapshot -- unpublish HIDES a page, '
      + 'it does not erase what was published of it (operator, 2026-09-14)'
  );
});

test('deletePage is the ONLY thing in the store that removes a snapshot', () => {
  // Stated as a whole-file property rather than per-function, so a removal
  // added to a helper the save path calls is caught too.
  const store = codeOnly(read('lib/builderPagesStore.js'));
  const calls = store.match(/removeBuildForPage\(/g) || [];
  assert.equal(
    calls.length,
    1,
    `exactly one snapshot removal in the store, found ${calls.length}`
  );

  const del = store.indexOf('async function deletePage');
  const call = store.indexOf('removeBuildForPage(');
  assert.ok(del > -1, 'deletePage is present');
  assert.ok(call > del, 'and the one removal is inside it, not in the save path');
});

test('the retention decision is written down on the table itself', () => {
  // Option 3 IS the documentation -- "keep it AND say so" -- so the saying so
  // is part of the deliverable and this is what stops a later cleanup dropping
  // it and leaving behaviour nobody can explain.
  //
  // Deliberately loose: it checks that the three events are named and that the
  // rule is stated, not the wording. Reword it freely; just keep saying it.
  const sql = read('docs/SQL/develop_builder_published_pages_setup.sql');
  assert.match(sql, /keeps its snapshot/, 'the rule is stated');
  for (const event of [/is_published -> false/, /is_private -> true/, /slug/]) {
    assert.match(sql, event, `names the ${event} case`);
  }
});

test('the snapshot delete is project-scoped', () => {
  // A DELETE on page_id alone would reach across tenants.
  const publish = read('lib/builderPublishStore.js');
  const fn = publish.slice(publish.indexOf('async function removeBuildForPage'));
  const body = codeOnly(fn.slice(0, fn.indexOf('\n}\n')));
  assert.match(body, /method: 'DELETE'/);
  assert.match(body, /project_id=eq\./, 'scoped to the project');
  assert.match(body, /page_id=eq\./, 'and to the one page');
});
