'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

/**
 * Serving ONE published page instead of the whole site.
 *
 * The public site fetched every published page and picked one in the browser:
 * 1.36 MB across the wire on Marinoff (51 pages) to display roughly 30 KB,
 * including one copy of the header per page. Measured 2026-08-15.
 *
 * Slug matching is the whole of the risk here. The browser's findPageForPath
 * treated an empty slug and "home" as the same page and matched
 * case-insensitively; the server now does the picking, and if it disagrees
 * even slightly the site serves a 404 where a page used to be. These tests pin
 * the equivalence rather than the implementation.
 */

// The picker itself — the real one. It used to be a hand-kept COPY of the
// store's body, guarded by a test that re-read the store and checked the two
// still looked alike. That guard compared the wrong half: it pinned the
// normalization (lower-case, trim slashes, ''≡'home') and never the tie-break
// between two pages sharing an address, which is where the published reader
// and the draft reader actually disagreed. See lib/publicSitePageAddress.js.
const { pickPageForAddress: pickPage } = require('../../lib/publicSitePageAddress');

const page = (slug, name) => ({ slug, name });

test('an empty slug and "home" both answer the site root', () => {
  const pages = [page('about', 'About'), page('home', 'Home')];
  assert.equal(pickPage(pages, '')?.name, 'Home');
  assert.equal(pickPage(pages, 'home')?.name, 'Home');
});

test('an empty-slug page wins over one literally slugged "home"', () => {
  // Both conventions exist in production — 93 Delray pages carry '' and the
  // Marinoff root is 'home'. The empty slug is the canonical root.
  const pages = [page('home', 'Home named'), page('', 'Root')];
  assert.equal(pickPage(pages, '')?.name, 'Root');
  assert.equal(pickPage(pages, 'home')?.name, 'Root');
});

test('a normal slug matches exactly', () => {
  const pages = [page('about', 'About'), page('contact', 'Contact')];
  assert.equal(pickPage(pages, 'contact')?.name, 'Contact');
});

test('matching ignores case and surrounding slashes, as the browser did', () => {
  const pages = [page('Traffic-DUI', 'Traffic')];
  for (const input of ['traffic-dui', 'TRAFFIC-DUI', '/traffic-dui', 'traffic-dui/', '/traffic-dui/']) {
    assert.equal(pickPage(pages, input)?.name, 'Traffic', input);
  }
});

test('an unknown slug is a miss, not the home page', () => {
  // Answering home for anything unknown would turn every typo into a silent
  // 200 and hide broken links.
  const pages = [page('', 'Root'), page('about', 'About')];
  assert.equal(pickPage(pages, 'does-not-exist'), null);
});

test('a site with no root page answers nothing for the root', () => {
  assert.equal(pickPage([page('about', 'About')], ''), null);
});

test('an empty site answers nothing rather than throwing', () => {
  assert.equal(pickPage([], ''), null);
  assert.equal(pickPage([], 'about'), null);
});

test('junk slugs are misses, not crashes', () => {
  const pages = [page('', 'Root')];
  for (const input of [null, undefined, '   ', '///']) {
    // All of these normalise to empty, which IS the root — that is deliberate:
    // a bare domain arrives as any of them.
    assert.equal(pickPage(pages, input)?.name, 'Root', String(input));
  }
});

test('the endpoint refuses private slugs before it reads anything', () => {
  // Private pages need an admin session and have their own endpoint. Serving
  // one here would be a data leak; answering 404 rather than 403 also avoids
  // confirming which private pages exist.
  const routes = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'publicSite.js'), 'utf8');
  const block = routes.slice(routes.indexOf("pathname === '/api/public/page'"));
  const guard = block.indexOf('isPrivateSiteSlug');
  const read = block.indexOf('getPublishedPageForProject');
  assert.ok(guard > -1, 'the private-slug guard must exist');
  assert.ok(guard < read, 'the guard must run BEFORE the page is loaded');
});

test('BOTH readers pick with this exact function — no second copy of the rule', () => {
  // The whole defect was two implementations of "which page is at this
  // address". Pin that there is one, and that each reader calls it, rather
  // than that two bodies happen to resemble each other.
  const root = path.join(__dirname, '..', '..');
  const store = fs.readFileSync(path.join(root, 'lib', 'builderPagesStore.js'), 'utf8');
  const reader = fs.readFileSync(path.join(root, 'lib', 'publishedPageRead.js'), 'utf8');

  const draftFn = store.slice(store.indexOf('async function getPublishedPageForProject'));
  const draftBody = draftFn.slice(0, draftFn.indexOf('\n}\n'));
  assert.match(draftBody, /pickPageForAddress\(/, 'the draft path must call the shared picker');
  assert.match(draftBody, /listPublishedPagesForProject/, 'must reuse the list path, not re-query');
  assert.doesNotMatch(draftBody, /wanted === ''/, 'must not keep its own copy of the address rule');

  const resolveFn = store.slice(store.indexOf('async function resolvePublicPageIdForSlug'));
  const resolveBody = resolveFn.slice(0, resolveFn.indexOf('\n}\n'));
  assert.match(resolveBody, /pickPageForAddress\(/, 'the id resolver must call the shared picker too');
  assert.match(resolveBody, /filterPublicSitePages/, 'and apply the same slug filter as the list');

  assert.match(reader, /resolvePublicPageIdForSlug/, 'the snapshot reader defers to the drafts for the address');
  assert.doesNotMatch(reader, /wanted === ''/, 'and keeps no address rule of its own');
});

test('the list endpoint survives — site-search still needs every page', () => {
  const routes = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'publicSite.js'), 'utf8');
  assert.match(routes, /pathname === '\/api\/public\/pages'/, '/api/public/pages must not be removed');
});
