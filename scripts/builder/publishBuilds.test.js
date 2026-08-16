'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

/**
 * Publishing: drafts → the live snapshot.
 *
 * Two properties carry the whole design, and both are the direct product of
 * incidents this repo has already had:
 *
 *  1. THE READ FALLS BACK. A page with no build is served from its draft,
 *     exactly as before publishing existed. Without that, shipping this turns
 *     every unpublished page into a blank site.
 *
 *  2. PUBLISH IS A LOOP, NOT ONE LONG REQUEST. propagateCanonicalSection was a
 *     single loop over every page inside a serverless function, and on
 *     2026-07-22 it was killed when the response went out — 30 pages updated,
 *     20 stale, a different split each save. A batch that dies must cost only
 *     that batch.
 *
 * These are source-level assertions on purpose: driving the real thing needs a
 * database, so the properties would go untested in practice — and untested is
 * how the first one comes back.
 */

test('the public read prefers a build but falls back to the draft', () => {
  const route = read('routes/publicSite.js');
  const block = route.slice(route.indexOf("pathname === '/api/public/page'"));
  const built = block.indexOf('getPublishedPage(');
  const draft = block.indexOf('getPublishedPageForProject(');
  assert.ok(built > -1, 'must consult the build');
  assert.ok(draft > -1, 'must still be able to serve the draft');
  assert.ok(built < draft, 'the build is consulted FIRST');
  assert.match(block, /if \(!page\) \{/, 'the draft path is the fallback, not the default');
});

test('a broken publish table degrades to the draft, never to no page', () => {
  const reader = read('lib/publishedPageRead.js');
  assert.match(reader, /catch \(_\) \{\s*return null;/, 'any failure returns null so the caller falls back');
  assert.match(reader, /if \(!res\.ok \|\| !Array\.isArray\(res\.data\) \|\| !res\.data\.length\) return null;/);
});

test('the build read uses the same address rules as the draft', () => {
  // If these disagree, publishing a site silently moves its pages.
  const reader = read('lib/publishedPageRead.js');
  assert.match(reader, /wanted === ''\s*\|\|\s*wanted === 'home'/, 'root equivalence');
  assert.match(reader, /toLowerCase\(\)/, 'case-insensitive');
  assert.match(reader, /replace\(\/\^\\\/\+\|\\\/\+\$\/g, ''\)/, 'trims surrounding slashes');
});

test('publishing writes a batch and reports what remains', () => {
  const store = read('lib/builderPublishStore.js');
  assert.match(store, /remaining/, 'must report what is left');
  assert.match(store, /done: remaining === 0/, 'done is derived, not assumed');
  assert.match(store, /PUBLISH_BATCH_SIZE/, 'batch size is a named limit');
  assert.doesNotMatch(store, /for \(const page of pagesResult\.data\)/, 'must not loop the whole site in one pass');
});

test('a publish can be resumed by passing its build id back', () => {
  const store = read('lib/builderPublishStore.js');
  assert.match(store, /options\.buildId/, 'caller can continue an existing build');
  assert.match(store, /newBuildId\(\)/, 'or start a new one');
});

test('what gets photographed is what the public endpoint would have served', () => {
  // Publishing must not build from raw rows — the frame resolution and theme
  // shell live in listPublishedPagesForProject, and a second path would drift.
  const store = read('lib/builderPublishStore.js');
  assert.match(store, /listPublishedPagesForProject/);
});

test('staleness is decided by comparing the draft against what was built', () => {
  const store = read('lib/builderPublishStore.js');
  assert.match(store, /source_updated_at/, 'the build records the draft time it came from');
  assert.match(store, /draftAt > builtAt/, 'newer draft means pending');
});

test('one build per page — publishing twice replaces rather than accumulates', () => {
  const sql = read('docs/SQL/develop_builder_published_pages_setup.sql');
  assert.match(sql, /create unique index if not exists builder_published_pages_page_idx/i);
  const store = read('lib/builderPublishStore.js');
  assert.match(store, /on_conflict=page_id/, 'the write upserts on that index');
  assert.match(store, /merge-duplicates/);
});

test('the publish endpoints are authenticated and project-scoped', () => {
  const route = read('routes/publish.js');
  // /api/builder/* is not in routes/index.js's public exemptions, so these
  // require a session by default. The scope must still come from the session's
  // project, never from the request body.
  assert.match(route, /req\?\.projectContext\?\.project\?\.id/, 'scope comes from the session');
  assert.doesNotMatch(route, /body\?\.projectId|searchParams\.get\('projectId'\)/, 'never trust a caller-supplied project');
  // The exemptions are the `isPublic*` / `isWebhookRoute` / CRON_PATHS
  // predicates in routes/index.js. Assert against those specifically — an
  // earlier version of this test matched the word anywhere in the file and
  // failed on the registration comment, which is noise, not an exemption.
  const index = read('routes/index.js');
  const exemptionLines = index
    .split('\n')
    .filter((line) => /isPublic[A-Za-z]*Route|isWebhookRoute|CRON_PATHS|isPublicContactSubmit/.test(line));
  for (const line of exemptionLines) {
    assert.ok(
      !line.includes('/api/builder/publish'),
      `publish must not be exempted from auth: ${line.trim()}`
    );
  }
});

test('publish is registered ahead of builder, which claims the wider prefix', () => {
  const index = read('routes/index.js');
  const p = index.indexOf('\n  publish,');
  const b = index.indexOf('\n  builder,');
  assert.ok(p > -1 && b > -1, 'both registered');
  assert.ok(p < b, 'publish must be matched before builder');
});

test('the SQL is additive and says which "published" it means', () => {
  const sql = read('docs/SQL/develop_builder_published_pages_setup.sql');
  assert.match(sql, /create table if not exists public\.builder_published_pages/i);
  assert.doesNotMatch(sql, /drop table|alter table builder_landing_page/i, 'must not touch existing tables');
  assert.match(sql, /is_published/, 'must disambiguate from the visibility flag');
});
