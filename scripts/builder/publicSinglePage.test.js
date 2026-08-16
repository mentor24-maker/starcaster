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

// The picker, lifted out of the store so it can be tested without a database.
// Kept identical in shape to getPublishedPageForProject's body — see the guard
// test at the bottom, which fails if that stops being true.
function pickPage(pages, slugInput) {
  const wanted = String(slugInput ?? '').trim().toLowerCase().replace(/^\/+|\/+$/g, '');
  const slugOf = (page) => String(page?.slug ?? '').trim().toLowerCase();
  const isRoot = wanted === '' || wanted === 'home';
  return isRoot
    ? (pages.find((p) => slugOf(p) === '') ?? pages.find((p) => slugOf(p) === 'home') ?? null)
    : (pages.find((p) => slugOf(p) === wanted) ?? null);
}

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

test('the store picks with the same rule this file tests', () => {
  // The picker above is a copy. If the store's rule changes shape, these tests
  // would keep passing against a rule nobody ships — so pin the real one.
  const store = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'builderPagesStore.js'), 'utf8');
  const fn = store.slice(store.indexOf('async function getPublishedPageForProject'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /wanted === ''\s*\|\|\s*wanted === 'home'/, 'root equivalence');
  assert.match(body, /toLowerCase\(\)/, 'case-insensitive');
  assert.match(body, /replace\(\/\^\\\/\+\|\\\/\+\$\/g, ''\)/, 'trims surrounding slashes');
  assert.match(body, /listPublishedPagesForProject/, 'must reuse the list path, not re-query');
});

test('the list endpoint survives — site-search still needs every page', () => {
  const routes = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'publicSite.js'), 'utf8');
  assert.match(routes, /pathname === '\/api\/public\/pages'/, '/api/public/pages must not be removed');
});
