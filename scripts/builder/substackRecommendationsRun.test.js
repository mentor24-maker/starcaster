'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Substack Miner 3/7 (86bcfprxk) — the recommendations snowball. Page reads
 * and the store are stubbed, so nothing here touches the network or a
 * database. The page is a saved copy of a real one
 * (https://kindoftsetsy.substack.com/recommendations, read 2026-10-09, with
 * its scripts, styles and stylesheet links stripped to keep the file small),
 * so the link extraction is checked against what Substack actually serves.
 *
 * The store stub keeps rows by handle and merges a second find the way
 * lib/substackMinerStore.js upsertCandidate does: `recommended_by` gains the
 * new entries, never duplicates them, and status is never touched.
 */

const {
  runSubstackSnowball, parseRecommendations,
} = require('../../lib/acquire/SubstackRecommendationsRun.js');

const SCOPE = { projectId: 'proj_a', userId: 'user_1' };
const REAL_PAGE = fs.readFileSync(path.join(__dirname, 'fixtures', 'substack-recommendations-kindoftsetsy.html'), 'utf8');
// The 19 publications that page recommends, in page order.
const REAL_RECOMMENDED = [
  'franturidesuflet', 'sauro', 'findingthekingdom', 'lucielmorgenstern', 'tappingthesubconscious',
  'natashaleona', 'bellyandthebeast', 'jessdonovancoaching',
];

function fakeStore({ rows = [], settings = {} } = {}) {
  const byHandle = new Map(rows.map((row) => [row.handle, { recommendedBy: [], status: 'candidate', ...row }]));
  const upserts = [];
  return {
    byHandle,
    upserts,
    async getSettings() {
      return { ok: true, status: 200, data: { keywords: [], maxResultsPerKeyword: 20, pauseMsBetweenFetches: 1500, ...settings } };
    },
    async listCandidates(limit, scope, options = {}) {
      assert.equal(typeof limit, 'number', 'listCandidates takes the limit first');
      assert.deepEqual(scope, SCOPE);
      const all = [...byHandle.values()];
      return { ok: true, status: 200, data: options.status ? all.filter((row) => row.status === options.status) : all };
    },
    async upsertCandidate(find) {
      upserts.push(find);
      assert.equal(find.status, undefined, 'a find never carries a status');
      const current = byHandle.get(find.handle);
      if (current) {
        const recommendedBy = [...current.recommendedBy];
        for (const handle of find.recommendedBy || []) if (!recommendedBy.includes(handle)) recommendedBy.push(handle);
        byHandle.set(find.handle, { ...current, recommendedBy });
        return { ok: true, status: 200, data: byHandle.get(find.handle) };
      }
      byHandle.set(find.handle, {
        handle: find.handle,
        name: find.name || '',
        foundVia: find.foundVia,
        recommendedBy: [...(find.recommendedBy || [])],
        status: 'candidate',
      });
      return { ok: true, status: 201, data: byHandle.get(find.handle) };
    },
  };
}

/** Pages by handle: a string of HTML, or `{ status }` for a page that fails. */
function fakePages(table) {
  const calls = [];
  return {
    calls,
    async fetchRecommendationsPage(url) {
      calls.push(url);
      const handle = new URL(url).hostname.split('.')[0];
      const page = table[handle];
      if (page === undefined) return { ok: false, httpStatus: 404, reason: 'answered HTTP 404' };
      if (typeof page === 'object') return { ok: false, httpStatus: page.status, reason: `answered HTTP ${page.status}` };
      return { ok: true, html: page };
    },
  };
}

function recPage(...handles) {
  return `<html><body>${handles.map((h) => `<a href="https://${h}.substack.com/?utm_source=recommendations_page&amp;utm_campaign=1">${h}</a>`).join('')}</body></html>`;
}

function deps(pages, store, extra = {}) {
  return { fetchRecommendationsPage: pages.fetchRecommendationsPage, store, sleep: async () => {}, ...extra };
}

test('the real page: every recommended publication, not the page itself or substack.com', () => {
  const parsed = parseRecommendations(REAL_PAGE, 'kindoftsetsy');
  assert.equal(parsed.handles.length, 19);
  assert.deepEqual(parsed.handles.slice(0, REAL_RECOMMENDED.length), REAL_RECOMMENDED);
  assert.ok(!parsed.handles.includes('kindoftsetsy'), 'the page\'s own handle is dropped');
  assert.ok(parsed.handles.every((h) => /^[a-z0-9-]+$/.test(h)), 'only bare handles, never substack.com or the cdn');
  assert.equal(parsed.skippedNotSubstack, 0);
});

test('a custom-domain recommendation is counted as skipped and not followed', () => {
  const html = recPage('alpha')
    + '<a href="https://www.example.com/?utm_source=recommendations_page">x</a>'
    + '<a href="https://substack.com/@someone">profile</a>'
    + '<a href="https://www.substack.com/">home</a>'
    + '<a href="https://open.substack.com/pub/beta">share</a>';
  const parsed = parseRecommendations(html, 'self');
  assert.deepEqual(parsed.handles, ['alpha']);
  assert.equal(parsed.skippedNotSubstack, 1);
});

test('one approved handle whose page lists N publications yields N candidates, each recommended by it', async () => {
  const store = fakeStore({ rows: [{ handle: 'kindoftsetsy', status: 'approved' }] });
  const pages = fakePages({ kindoftsetsy: REAL_PAGE });
  const res = await runSubstackSnowball({}, SCOPE, deps(pages, store));
  assert.equal(res.ok, true);
  assert.deepEqual(pages.calls, ['https://kindoftsetsy.substack.com/recommendations']);
  const summary = res.data;
  assert.equal(summary.sourcesRead, 1);
  assert.equal(summary.linksFound, 19);
  assert.equal(summary.added, 19);
  assert.equal(summary.merged, 0);
  assert.deepEqual(summary.sources[0], { handle: 'kindoftsetsy', read: 'ok', linksFound: 19, added: 19, merged: 0, skippedNotSubstack: 0 });
  for (const handle of REAL_RECOMMENDED) {
    const row = store.byHandle.get(handle);
    assert.equal(row.foundVia, 'recommendations');
    assert.deepEqual(row.recommendedBy, ['kindoftsetsy']);
  }
  assert.equal(store.byHandle.get('kindoftsetsy').status, 'approved');
});

test('writers already present are merged, not added, and keep their name', async () => {
  const store = fakeStore({
    rows: [
      { handle: 'seed', status: 'approved' },
      { handle: 'beta', name: 'Beta Weekly', recommendedBy: ['other'] },
    ],
  });
  const res = await runSubstackSnowball({}, SCOPE, deps(fakePages({ seed: recPage('alpha', 'beta') }), store));
  assert.equal(res.data.added, 1);
  assert.equal(res.data.merged, 1);
  assert.deepEqual(store.byHandle.get('beta').recommendedBy, ['other', 'seed']);
  const betaFind = store.upserts.find((find) => find.handle === 'beta');
  assert.equal(betaFind.name, undefined, 'a known writer\'s name is never overwritten with the handle');
  assert.equal(store.upserts.find((find) => find.handle === 'alpha').name, 'alpha');
});

test('running twice does not duplicate a handle inside recommended_by', async () => {
  const store = fakeStore({ rows: [{ handle: 'seed', status: 'approved' }] });
  const pages = fakePages({ seed: recPage('alpha', 'beta') });
  await runSubstackSnowball({}, SCOPE, deps(pages, store));
  const second = await runSubstackSnowball({}, SCOPE, deps(pages, store));
  assert.equal(second.data.added, 0);
  assert.equal(second.data.merged, 2);
  assert.deepEqual(store.byHandle.get('alpha').recommendedBy, ['seed']);
  assert.deepEqual(store.byHandle.get('beta').recommendedBy, ['seed']);
});

test('a page that fails is reported by handle and status, and the run continues', async () => {
  const store = fakeStore({ rows: [{ handle: 'gone', status: 'approved' }, { handle: 'fine', status: 'approved' }] });
  const pages = fakePages({ gone: { status: 403 }, fine: recPage('alpha') });
  const res = await runSubstackSnowball({}, SCOPE, deps(pages, store));
  assert.equal(res.ok, true);
  assert.equal(res.data.sourcesFailed, 1);
  assert.equal(res.data.sourcesRead, 1);
  const failed = res.data.sources.find((s) => s.handle === 'gone');
  assert.equal(failed.read, 'failed');
  assert.equal(failed.httpStatus, 403);
  assert.ok(store.byHandle.has('alpha'), 'the next page was still read');
});

test('a rejected candidate that a new page recommends stays rejected', async () => {
  const store = fakeStore({
    rows: [{ handle: 'seed', status: 'approved' }, { handle: 'nope', status: 'rejected' }, { handle: 'yes', status: 'approved' }],
  });
  await runSubstackSnowball({ handles: ['seed'] }, SCOPE, deps(fakePages({ seed: recPage('nope', 'yes') }), store));
  assert.equal(store.byHandle.get('nope').status, 'rejected');
  assert.deepEqual(store.byHandle.get('nope').recommendedBy, ['seed']);
  assert.equal(store.byHandle.get('yes').status, 'approved');
});

test('the fetch cap stops the run and the summary names what it left unread', async () => {
  const rows = ['a1', 'a2', 'a3', 'a4'].map((handle) => ({ handle, status: 'approved' }));
  const store = fakeStore({ rows });
  const pages = fakePages({ a1: recPage('x'), a2: recPage('y'), a3: recPage('z'), a4: recPage('w') });
  const res = await runSubstackSnowball({}, SCOPE, deps(pages, store, { maxFetches: 2 }));
  assert.equal(pages.calls.length, 2);
  assert.equal(res.data.fetches, 2);
  assert.equal(res.data.stoppedByCap, true);
  assert.deepEqual(res.data.notRead.map((n) => n.handle), ['a3', 'a4']);
  assert.match(res.data.notRead[0].reason, /cap of 2/);
});

test('the default cap is 100 pages a run', async () => {
  const rows = Array.from({ length: 105 }, (_, i) => ({ handle: `w${i}`, status: 'approved' }));
  const pages = fakePages({});
  const res = await runSubstackSnowball({}, SCOPE, deps(pages, fakeStore({ rows })));
  assert.equal(pages.calls.length, 100);
  assert.equal(res.data.stoppedByCap, true);
  assert.equal(res.data.notRead.length, 5);
});

test('pages are read one at a time, pauseMsBetweenFetches apart', async () => {
  const waits = [];
  const store = fakeStore({ rows: [{ handle: 'a1', status: 'approved' }, { handle: 'a2', status: 'approved' }], settings: { pauseMsBetweenFetches: 700 } });
  await runSubstackSnowball({}, SCOPE, deps(fakePages({ a1: recPage('x'), a2: recPage('y') }), store, { sleep: async (ms) => { waits.push(ms); } }));
  assert.deepEqual(waits, [700]);
});

test('handles passed in are read instead of the approved list, and checked', async () => {
  const store = fakeStore({ rows: [{ handle: 'approved1', status: 'approved' }] });
  const pages = fakePages({ chosen: recPage('x') });
  const res = await runSubstackSnowball({ handles: ['https://Chosen.substack.com'] }, SCOPE, deps(pages, store));
  assert.equal(res.ok, true);
  assert.deepEqual(pages.calls, ['https://chosen.substack.com/recommendations']);

  const bad = await runSubstackSnowball({ handles: ['not a handle!'] }, SCOPE, deps(pages, store));
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 400);
});

test('nothing approved and no handles is refused with the reason, not answered as an empty success', async () => {
  const res = await runSubstackSnowball({}, SCOPE, deps(fakePages({}), fakeStore({ rows: [{ handle: 'c', status: 'candidate' }] })));
  assert.equal(res.ok, false);
  assert.match(res.error, /no approved writers/);
});

test('a database failure stops the run and is returned as-is', async () => {
  const store = fakeStore({ rows: [{ handle: 'seed', status: 'approved' }] });
  store.upsertCandidate = async () => ({ ok: false, status: 503, error: 'table missing' });
  const res = await runSubstackSnowball({}, SCOPE, deps(fakePages({ seed: recPage('x') }), store));
  assert.deepEqual(res, { ok: false, status: 503, error: 'table missing' });
});
