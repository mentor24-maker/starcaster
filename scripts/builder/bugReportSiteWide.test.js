'use strict';

// Bug Report "Show on: Every page of the site" (SC-804): which module the
// live site shows on every page. The database is passed in as stubs, so this
// needs no credentials.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  siteWideModulesInPage,
  pickSiteWideBugReport,
  publicSiteWideBugReport,
  resolveSiteWideBugReport,
  SCAN_TTL_MS,
} = require('../../lib/bugReportSiteWide');

const bug = (id, showOn, extra = {}) => ({ id, type: 'bug-report', settings: { showOn, blockColor: '#111111', ...extra } });
const pageWith = (...modules) => ({ layoutSections: [{ id: 's1', modules }] });

test('only a bug-report module set to "site" counts; "page", absent and other types do not', () => {
  const found = siteWideModulesInPage(pageWith(
    bug('a', 'page'),
    { id: 'b', type: 'bug-report', settings: {} },
    { id: 'c', type: 'text', settings: { showOn: 'site' } },
    bug('d', 'site'),
  ));
  assert.deepEqual(found.map((m) => m.moduleId), ['d']);
});

test('a module nested in a table cell is found, and copies of one module count once', () => {
  const nested = { layoutSections: { sections: [{ modules: [{ type: 'table', settings: {}, cells: [{ modules: [bug('n', 'site')] }] }, bug('n', 'site')] }] } };
  assert.deepEqual(siteWideModulesInPage(nested).map((m) => m.moduleId), ['n']);
});

test('the most recently published page wins, and a different module elsewhere is listed as another', () => {
  const answer = pickSiteWideBugReport([
    { pageId: '1', pageSlug: '', pageName: 'Home', publishedAt: '2026-11-01T00:00:00Z', modules: [{ moduleId: 'old', settings: {} }] },
    { pageId: '2', pageSlug: 'about', pageName: 'About', publishedAt: '2026-11-10T00:00:00Z', modules: [{ moduleId: 'new', settings: { blockColor: '#c0392b' } }] },
    { pageId: '3', pageSlug: 'blank', pageName: 'Blank', publishedAt: '2026-11-12T00:00:00Z', modules: [] },
  ]);
  assert.equal(answer.moduleId, 'new');
  assert.equal(answer.pageSlug, 'about');
  assert.equal(answer.settings.blockColor, '#c0392b');
  assert.deepEqual(answer.others.map((o) => o.moduleId), ['old']);
});

test('one shared module on many pages is not "another module"', () => {
  const shared = { moduleId: 'header-bug', settings: {} };
  const answer = pickSiteWideBugReport([
    { pageId: '1', pageSlug: '', pageName: 'Home', publishedAt: '2026-11-01T00:00:00Z', modules: [shared] },
    { pageId: '2', pageSlug: 'about', pageName: 'About', publishedAt: '2026-11-02T00:00:00Z', modules: [shared] },
  ]);
  assert.equal(answer.moduleId, 'header-bug');
  assert.deepEqual(answer.others, []);
});

test('nothing site-wide answers null, and the visitor-facing copy never carries the others list', () => {
  assert.equal(pickSiteWideBugReport([]), null);
  assert.equal(publicSiteWideBugReport(null), null);
  const out = publicSiteWideBugReport({ moduleId: 'm', settings: {}, pageId: '1', pageSlug: '', pageName: 'Home', publishedAt: 'x', others: [{}] });
  assert.equal('others' in out, false);
  assert.equal('publishedAt' in out, false);
});

function stubs({ pages, builds, payloads }) {
  const fetched = [];
  return {
    fetched,
    deps: {
      noCache: true,
      listPublicPages: async () => ({ ok: true, data: pages }),
      listBuilds: async () => ({ ok: true, data: builds }),
      fetchPayloads: async (_projectId, ids) => {
        fetched.push(...ids);
        return { ok: true, data: ids.map((id) => ({ pageId: id, publishedAt: builds.find((b) => b.pageId === id).publishedAt, payload: payloads[id] })) };
      },
    },
  };
}

test('a snapshot of a page that is no longer public (unpublished, private, deleted) is ignored', async () => {
  const { deps } = stubs({
    pages: [{ id: '1', slug: '', name: 'Home' }],
    builds: [
      { pageId: '1', publishedAt: '2026-11-01T00:00:00Z' },
      { pageId: '9', publishedAt: '2026-11-12T00:00:00Z' }, // its page was unpublished
    ],
    payloads: { 1: pageWith(bug('home-bug', 'page')), 9: pageWith(bug('gone', 'site')) },
  });
  const result = await resolveSiteWideBugReport('proj-a', deps);
  assert.equal(result.ok, true);
  assert.equal(result.data, null, 'the unpublished page\'s site-wide module must not reach the live site');
});

test('switching back to "This page only" and republishing takes the site-wide icon down', async () => {
  const builds = [{ pageId: '1', publishedAt: '2026-11-01T00:00:00Z' }];
  const pages = [{ id: '1', slug: '', name: 'Home' }];
  const on = await resolveSiteWideBugReport('proj-b', stubs({ pages, builds, payloads: { 1: pageWith(bug('m', 'site')) } }).deps);
  assert.equal(on.data.moduleId, 'm');

  const republished = [{ pageId: '1', publishedAt: '2026-11-02T00:00:00Z' }];
  const off = await resolveSiteWideBugReport('proj-b', stubs({ pages, builds: republished, payloads: { 1: pageWith(bug('m', 'page')) } }).deps);
  assert.equal(off.data, null);
});

test('a page already scanned at the same publish time is not fetched again', async () => {
  const pages = [{ id: '1', slug: '', name: 'Home' }, { id: '2', slug: 'about', name: 'About' }];
  const builds = [{ pageId: '1', publishedAt: '2026-11-03T00:00:00Z' }, { pageId: '2', publishedAt: '2026-11-03T00:00:00Z' }];
  const payloads = { 1: pageWith(bug('m', 'site')), 2: pageWith() };
  const first = stubs({ pages, builds, payloads });
  await resolveSiteWideBugReport('proj-c', first.deps);
  assert.deepEqual(first.fetched.sort(), ['1', '2']);
  const second = stubs({ pages, builds, payloads });
  const again = await resolveSiteWideBugReport('proj-c', second.deps);
  assert.deepEqual(second.fetched, [], 'unchanged snapshots must be answered from memory');
  assert.equal(again.data.moduleId, 'm');
});

test('a snapshot rewritten in place (same publish time) is re-read once its scan is an hour old', async () => {
  const pages = [{ id: '1', slug: '', name: 'Home' }];
  const builds = [{ pageId: '1', publishedAt: '2026-11-04T00:00:00Z' }];
  const t0 = 1_800_000_000_000;
  const first = stubs({ pages, builds, payloads: { 1: pageWith(bug('m', 'site')) } });
  await resolveSiteWideBugReport('proj-e', { ...first.deps, now: () => t0 });
  const soon = stubs({ pages, builds, payloads: { 1: pageWith() } });
  const before = await resolveSiteWideBugReport('proj-e', { ...soon.deps, now: () => t0 + 60_000 });
  assert.equal(before.data.moduleId, 'm', 'within the hour the remembered scan stands');
  const later = stubs({ pages, builds, payloads: { 1: pageWith() } });
  const after = await resolveSiteWideBugReport('proj-e', { ...later.deps, now: () => t0 + SCAN_TTL_MS + 1 });
  assert.deepEqual(later.fetched, ['1']);
  assert.equal(after.data, null);
});

test('an unreadable list answers ok:false — never a guess at "none"', async () => {
  const result = await resolveSiteWideBugReport('proj-d', {
    noCache: true,
    listPublicPages: async () => ({ ok: false, error: 'boom' }),
    listBuilds: async () => ({ ok: true, data: [] }),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /boom/);
});
