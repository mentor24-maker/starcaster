'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
// Line comments first: a `/*` inside a `//` line (routes/index.js has
// '/api/builder/*' in one) would otherwise open a block match that swallows
// real code up to the next `*/`.
const stripComments = (src) => src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

const { publishSourceStamp, isPagePendingPublish } = require('../../lib/builderPublishStore');
const { pickThemeForPage } = require('../../lib/builderPagesStore');

/**
 * A THEME SAVE HAS TO REACH THE PUBLISH PANEL.
 *
 * A theme is a reference (themeIsAReference.test.js): saving one writes the
 * theme row and no page row. A published page is a snapshot, stale when the
 * page is newer than its build. Nothing connected the two, so a theme save
 * changed the draft site and NOT the live one, and the Publish panel said
 * there was nothing to publish (2026-09-13, task 86bbzy9ym). The operator's
 * only way through was to open every page, save it to bump its clock, and
 * publish.
 *
 * The rule now: a page's source stamp is the LATER of its own clock and its
 * theme's clock, and the same function writes the stamp a publish records —
 * otherwise a page whose theme is newer would be pending again the moment it
 * was published, forever.
 */

const OLD = '2026-09-01T10:00:00.000Z';
const MID = '2026-09-05T10:00:00.000Z';
const NEW = '2026-09-10T10:00:00.000Z';

test('a page whose THEME was saved after its build is pending', () => {
  const page = { id: '1', updatedAt: OLD, themeShell: { id: 't1', updatedAt: NEW } };
  assert.equal(isPagePendingPublish(page, { sourceUpdatedAt: MID }), true);
});

test('a page whose theme is older than its build is NOT pending', () => {
  const page = { id: '1', updatedAt: OLD, themeShell: { id: 't1', updatedAt: OLD } };
  assert.equal(isPagePendingPublish(page, { sourceUpdatedAt: MID }), false);
});

test('a page edited after its build is still pending, theme or no theme', () => {
  assert.equal(isPagePendingPublish({ id: '1', updatedAt: NEW }, { sourceUpdatedAt: MID }), true);
  assert.equal(
    isPagePendingPublish({ id: '1', updatedAt: NEW, themeShell: { updatedAt: OLD } }, { sourceUpdatedAt: MID }),
    true
  );
});

test('a page never published is pending', () => {
  assert.equal(isPagePendingPublish({ id: '1', updatedAt: OLD }, null), true);
  assert.equal(isPagePendingPublish({ id: '1', updatedAt: OLD }, undefined), true);
});

test('the stamp is the later of the two clocks, as an ISO string', () => {
  assert.equal(publishSourceStamp({ updatedAt: OLD, themeShell: { updatedAt: NEW } }), NEW);
  assert.equal(publishSourceStamp({ updatedAt: NEW, themeShell: { updatedAt: OLD } }), NEW);
  assert.equal(publishSourceStamp({ updatedAt: MID }), MID);
  assert.equal(publishSourceStamp({ updatedAt: '', themeShell: {} }), '');
  assert.equal(publishSourceStamp(null), '');
});

test('publishing a theme-stale page settles it: the recorded stamp is not older than the source', () => {
  // The round trip the bug lives in: build, theme save, publish, check again.
  const page = { id: '1', updatedAt: OLD, themeShell: { id: 't1', updatedAt: NEW } };
  assert.equal(isPagePendingPublish(page, { sourceUpdatedAt: OLD }), true, 'stale after the theme save');
  const build = { sourceUpdatedAt: publishSourceStamp(page) };
  assert.equal(isPagePendingPublish(page, build), false, 'settled by a publish that records the same stamp');
});

test('the write records the SAME stamp the check reads — one function, both sides', () => {
  const store = stripComments(read('lib/builderPublishStore.js'));
  assert.match(store, /source_updated_at:\s*publishSourceStamp\(page\)/, 'publishPages must record publishSourceStamp');
  assert.match(store, /isPagePendingPublish\(page,\s*built\.get\(/, 'listPendingPublish must ask isPagePendingPublish');
  assert.doesNotMatch(store, /source_updated_at:\s*page\.updatedAt/, 'the page clock alone is the bug');
});

test('the theme shell carries the clock the publish store reads', () => {
  const pages = stripComments(read('lib/builderPagesStore.js'));
  const shell = pages.slice(pages.indexOf('themeShell: {'), pages.indexOf('};', pages.indexOf('themeShell: {')));
  assert.match(shell, /updatedAt:\s*theme\.updatedAt/, 'themeShell.updatedAt is the theme clock');
  assert.match(shell, /id:\s*String\(theme\.id/, 'themeShell.id is what usage matches on');
});

// --- Which pages does a theme reach? ----------------------------------------

const THEMES = [
  { id: 'default', updatedAt: NEW },
  { id: 'navy', updatedAt: OLD },
];

test('a page picks the theme it names', () => {
  assert.equal(pickThemeForPage({ themeId: 'navy' }, THEMES).id, 'navy');
});

test('a page naming no theme, or a deleted one, picks the first listed theme', () => {
  assert.equal(pickThemeForPage({ themeId: '' }, THEMES).id, 'default');
  assert.equal(pickThemeForPage({}, THEMES).id, 'default');
  assert.equal(pickThemeForPage({ themeId: 'gone' }, THEMES).id, 'default');
});

test('with no themes at all there is nothing to pick', () => {
  assert.equal(pickThemeForPage({ themeId: 'navy' }, []), null);
  assert.equal(pickThemeForPage({ themeId: 'navy' }, null), null);
});

test('the public site and the usage list pick by the same rule', () => {
  const pages = stripComments(read('lib/builderPagesStore.js'));
  const enrich = pages.slice(pages.indexOf('async function enrichPagesWithThemeShell('), pages.indexOf('async function listPublishedPagesForProject('));
  const usage = pages.slice(pages.indexOf('async function listPagesFollowingTheme('), pages.indexOf('async function enrichPagesWithThemeShell('));
  assert.match(enrich, /pickThemeForPage\(page,/, 'the theme shell is picked by the shared rule');
  assert.match(usage, /pickThemeForPage\(page,/, 'the usage list is picked by the shared rule');
  assert.doesNotMatch(enrich, /themesResult\.data\[0\]/, 'no second copy of the default-theme rule');
});

test('the usage route is registered ahead of builder, and only answers GET', () => {
  const index = stripComments(read('routes/index.js'));
  const order = index.slice(index.indexOf('const ROUTE_MODULES = ['));
  assert.ok(order.indexOf('themeUsage,') > -1, 'themeUsage must be in ROUTE_MODULES');
  assert.ok(order.indexOf('themeUsage,') < order.indexOf('builder,'), 'themeUsage must come before builder');
  const route = stripComments(read('routes/themeUsage.js'));
  assert.match(route, /!== 'GET'\) return false/, 'anything but GET falls through');
  assert.match(route, /projectContext\?\.project\?\.id/, 'the read is scoped to the active project');
});

test('saving a theme still writes to no page — the pending rule is derived, not stamped', () => {
  // The whole point of the two-clock rule: the existing invariant holds.
  const routes = stripComments(read('routes/builder.js'));
  const start = routes.indexOf("if (themeMatch && requestMethod === 'PATCH')");
  const body = routes.slice(start, routes.indexOf('return sendOk', start));
  assert.doesNotMatch(body, /updatePage\s*\(/);
  assert.doesNotMatch(body, /listPagesFollowingTheme\s*\(/, 'the theme save does not even read pages');
});
