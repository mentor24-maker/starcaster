'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const PROJECT_CONTEXT = path.join(ROOT, 'public', 'js', 'projectContext.js');
const { buildFaviconHeadTags, DEFAULT_FAVICON_PATH } = require('../../lib/projectFavicon.js');

/**
 * Which icon shows in the browser tab, and where.
 *
 * Dane, on task 86bbjndz1:
 *
 *   The starcaster.pro website always shows the favicon of whatever project is
 *   selected. This is new. It used to show the starcaster icon when on
 *   starcaster.pro and the client favicon only on the client's site.
 *
 * Two surfaces, two answers, and they had collapsed into one:
 *
 *   starcaster.pro   the admin app (app-shell.html)  -> the Alphire icon
 *   a client domain  the published site (site.html)  -> that client's icon
 *
 * The admin app had been swapping its tab to the selected project's favicon
 * "per active workspace" since a6d48508 (2026-06-25). Deliberate, and wrong:
 * the one tab that should always say Alphire wore whichever client happened to
 * be open.
 *
 * `public/js/` is parsed by nothing but the browser (landmine 9), so the admin
 * half is guarded at the source. The client half is real behaviour and is
 * exercised — it is the half that must NOT change, and a fix to one surface
 * quietly breaking the other is the obvious way to get this wrong.
 */

const readAdminSource = () => fs.readFileSync(PROJECT_CONTEXT, 'utf8');

/** The function body, comments stripped, so prose about the old behaviour
 *  cannot satisfy or defeat an assertion about the code. */
function applyFaviconBody() {
  const source = readAdminSource()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const start = source.indexOf('function applyFavicon()');
  assert.notEqual(start, -1, 'applyFavicon must still exist — many call sites use it');
  const body = source.slice(start, source.indexOf('\n  }', start) + 4);
  assert.ok(body.length > 20, 'the body should be findable');
  return body;
}

test('the admin tab always shows the Alphire icon', async (t) => {
  await t.test('applyFavicon sets the default and nothing else', () => {
    const body = applyFaviconBody();
    assert.match(body, /replaceDocumentFaviconLinks\(DEFAULT_FAVICON_URL\)/);
  });

  await t.test('it no longer reaches for the active project favicon', () => {
    const body = applyFaviconBody();
    assert.doesNotMatch(
      body,
      /projects\/active\/favicon/,
      'the admin tab must not request a project favicon — that is the bug'
    );
    assert.doesNotMatch(body, /getProjectFaviconDataUrl/, 'nor read one out of the session project');
    assert.doesNotMatch(body, /getSessionProject\b/, 'nor consult which project is selected at all');
  });

  await t.test('the default it uses is the Alphire asset the page ships with', () => {
    const source = readAdminSource();
    assert.match(source, /const DEFAULT_FAVICON_URL = '\/images\/favicon_alphire_512x512\.png'/);
    // The same file the layout links before any script runs, so the tab does
    // not flicker from one icon to another on load.
    const layout = fs.readFileSync(path.join(ROOT, 'src', 'layout.html'), 'utf8');
    assert.match(layout, /favicon_alphire_512x512\.png/);
  });
});

test('choosing a project favicon in Settings still works', () => {
  // Only the admin TAB stops borrowing it. The picker and the persistence are
  // untouched, because the value is what the published client site uses — a
  // fix that also disabled the setting would be a different, worse bug.
  const source = readAdminSource();
  const exported = source.slice(source.indexOf('return {'));
  assert.match(exported, /getProjectFaviconDataUrl/, 'Settings reads the stored favicon through this');
  assert.match(exported, /setProjectFaviconDataUrl/, 'and writes it back through this');

  const settings = fs.readFileSync(path.join(ROOT, 'public', 'js', 'settings.js'), 'utf8');
  assert.match(settings, /setProjectFaviconDataUrl/, 'the Settings screen still calls it');
});

test("a client's own site still shows that client's icon", async (t) => {
  // The half that must not change. This is real behaviour, not a source check.
  const project = { id: 'proj_1', faviconDataUrl: 'https://cdn.example.com/logo.png' };

  await t.test('the published page links the project favicon', () => {
    const tags = buildFaviconHeadTags(project);
    assert.match(tags, /rel="icon"/);
    assert.match(tags, /rel="shortcut icon"/);
    assert.match(tags, /rel="apple-touch-icon"/);
    // NOTE the endpoint: the public site uses /api/public/favicon, while the
    // admin app used /api/projects/active/favicon. Two different routes for
    // two different surfaces — which is the split this whole fix rests on, and
    // a first draft of this assertion had them confused.
    assert.match(tags, /\/api\/public\/favicon\?projectId=/, "the client's own icon, on the client's own site");
    assert.match(tags, /proj_1/);
  });

  await t.test('a project with no favicon falls back to the Alphire default', () => {
    const tags = buildFaviconHeadTags({ id: 'proj_2' });
    assert.match(tags, new RegExp(DEFAULT_FAVICON_PATH.replace(/[/.]/g, '\\$&')));
    assert.doesNotMatch(tags, /\/api\/public\/favicon/);
  });

  await t.test('and so does no project at all', () => {
    const tags = buildFaviconHeadTags(null);
    assert.match(tags, new RegExp(DEFAULT_FAVICON_PATH.replace(/[/.]/g, '\\$&')));
  });
});

test('the two surfaces are served from different places, which is why they differ', () => {
  // The architectural fact the fix rests on: app-shell.html is served only when
  // the host resolves to NO tenant, and a tenant domain gets site.html. If that
  // ever stops being true, the admin app could appear on a client domain and
  // this fix would need rethinking rather than quietly being wrong.
  const pages = fs.readFileSync(path.join(ROOT, 'routes', 'publicSitePages.js'), 'utf8');
  assert.match(pages, /app-shell\.html/, 'the admin app is served here');
  assert.match(pages, /buildFaviconHeadTags/, 'and the tenant site gets its favicon tags here');
  assert.match(pages, /servePublicSiteHtml/, 'via the tenant-resolved path');
});
