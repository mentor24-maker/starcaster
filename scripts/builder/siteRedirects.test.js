'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MODULE_URL = new URL('../../lib/siteRedirects.mjs', `file://${__filename}`).href;
const MIDDLEWARE = path.join(__dirname, '..', '..', 'middleware.mjs');

/**
 * Redirects for addresses carried over from a tenant's previous site.
 *
 * The failure these exist against is quiet: a public Builder site renders in
 * the browser, so an address with no matching page answers HTTP 200 with a
 * BLANK page. It never 404s. So an old inbound link does not look like a
 * moved page, it looks like a broken website — and nothing in the stack
 * reports it, because 200 is a success.
 */

test('a known old address resolves to its new page', async () => {
  const { resolveSiteRedirect } = await import(MODULE_URL);
  assert.equal(resolveSiteRedirect('delraytennis.com', '/programs/junior'), '/programs-junior');
  assert.equal(resolveSiteRedirect('delraytennis.com', '/contact-us/directions'), '/directions-hours');
});

test('a migrated blog post goes to the post view, not to the bare slug', async () => {
  const { resolveSiteRedirect } = await import(MODULE_URL);
  // The new site addresses posts as /blog-post?post=<slug>. Redirecting to
  // /<slug> would land on a blank page, which is the bug, not the fix.
  assert.equal(
    resolveSiteRedirect('delraytennis.com', '/davis-cup-at-delray-beach-tennis-center'),
    '/blog-post?post=davis-cup-at-delray-beach-tennis-center'
  );
});

test('an old post that was never migrated goes to the blog index', async () => {
  const { resolveSiteRedirect } = await import(MODULE_URL);
  assert.equal(resolveSiteRedirect('delraytennis.com', '/elite-tennis'), '/programs');
  assert.equal(
    resolveSiteRedirect('delraytennis.com', '/christmas-day-mixer-delray-beach-tennis-center'),
    '/blog'
  );
});

test('the lookup ignores a trailing slash and letter case', async () => {
  const { resolveSiteRedirect } = await import(MODULE_URL);
  // Old WordPress addresses all carried a trailing slash, and the archived
  // list contains /Events-Calendar with capitals. Both must still match.
  assert.equal(resolveSiteRedirect('delraytennis.com', '/programs/junior/'), '/programs-junior');
  assert.equal(resolveSiteRedirect('delraytennis.com', '/PROGRAMS/Junior/'), '/programs-junior');
  // /Events-Calendar carries no entry on purpose: lowercased it IS a real
  // published page, so an entry would redirect it to itself forever.
  assert.equal(resolveSiteRedirect('delraytennis.com', '/Events-Calendar'), null);
});

test('an address with no entry, and any other host, resolve to nothing', async () => {
  const { resolveSiteRedirect } = await import(MODULE_URL);
  // Returning a target here would redirect pages that are working fine.
  assert.equal(resolveSiteRedirect('delraytennis.com', '/membership'), null);
  assert.equal(resolveSiteRedirect('delraytennis.com', '/'), null);
  assert.equal(resolveSiteRedirect('brandonmarinoff.com', '/programs/junior'), null);
  assert.equal(resolveSiteRedirect('', '/programs/junior'), null);
});

test('every destination is a path on the new site, never an outside URL', async () => {
  const { SITE_REDIRECTS } = await import(MODULE_URL);
  const targets = Object.values(SITE_REDIRECTS).flatMap((t) => Object.values(t));
  assert.ok(targets.length > 100, `expected a populated table, got ${targets.length}`);
  for (const target of targets) {
    assert.match(target, /^\/[a-z0-9/?=-]*$/, `destination is not a site-relative path: ${target}`);
  }
});

test('no entry redirects an address to itself', async () => {
  const { SITE_REDIRECTS } = await import(MODULE_URL);
  // A self-redirect is an infinite loop in the browser, and the table is
  // generated, so one could be introduced by a future regeneration.
  for (const [host, table] of Object.entries(SITE_REDIRECTS)) {
    for (const [from, to] of Object.entries(table)) {
      assert.notEqual(to.toLowerCase(), from, `${host}${from} redirects to itself`);
    }
  }
});

test('no destination is itself a redirect key, so one hop is always enough', async () => {
  const { SITE_REDIRECTS } = await import(MODULE_URL);
  for (const [host, table] of Object.entries(SITE_REDIRECTS)) {
    for (const [from, to] of Object.entries(table)) {
      const landing = to.split('?')[0].toLowerCase();
      assert.ok(
        !(landing in table),
        `${host}${from} -> ${to}, but ${landing} is itself redirected (a chain)`
      );
    }
  }
});

test('the middleware redirects BEFORE it rewrites', () => {
  // Order is the whole correctness of this feature: after the rewrite the
  // request is a blank 200 render and there is nothing left to redirect.
  // Anchored on structure rather than on a comment phrase.
  const source = fs.readFileSync(MIDDLEWARE, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  const redirectAt = source.indexOf('resolveSiteRedirect(');
  const rewriteAt = source.indexOf('return rewrite(');
  assert.ok(redirectAt > 0, 'middleware never consults the redirect table');
  assert.ok(rewriteAt > 0, 'middleware no longer rewrites');
  assert.ok(redirectAt < rewriteAt, 'the redirect lookup must come before the rewrite');
});

test('the middleware redirects permanently, not temporarily', () => {
  // A 302 asks search engines to keep the old address indexed, which keeps
  // the blank-page result in Google. A move is a 301.
  const source = fs.readFileSync(MIDDLEWARE, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.match(source, /Response\.redirect\([\s\S]*?,\s*301\s*\)/);
});
