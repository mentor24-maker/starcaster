'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Substack Miner 2/7 (86bcfprxd) — the web-search pass. Search, page reads
 * and the store are all stubbed, so nothing here touches the network or a
 * database. The store stub keeps rows by handle and merges a second find the
 * way lib/substackMinerStore.js upsertCandidate does (keywords added, never
 * replaced), which is what the "found by every keyword" checks lean on.
 */

const {
  runSubstackMinerSearch, handleFromResultUrl, parseFrontPage,
} = require('../../lib/acquire/SubstackMinerRun.js');

const SCOPE = { projectId: 'proj_a', userId: 'user_1' };
const CONFIGURED = { configured: true, provider: 'brave', apiKey: 'k', pageSize: 20, maxPageIndex: 2 };

function fakeStore({ settings = {}, rows = [] } = {}) {
  const byHandle = new Map(rows.map((row) => [row.handle, { ...row }]));
  const upserts = [];
  return {
    byHandle,
    upserts,
    async getSettings() {
      return {
        ok: true,
        status: 200,
        data: { keywords: [], maxResultsPerKeyword: 20, pauseMsBetweenFetches: 1500, ...settings },
      };
    },
    async listCandidates(limit) {
      assert.equal(typeof limit, 'number', 'listCandidates takes the limit first');
      return { ok: true, status: 200, data: [...byHandle.values()] };
    },
    async upsertCandidate(find) {
      upserts.push(find);
      const current = byHandle.get(find.handle);
      if (current) {
        const keywordsHit = [...current.keywordsHit];
        for (const keyword of find.keywordsHit || []) if (!keywordsHit.includes(keyword)) keywordsHit.push(keyword);
        byHandle.set(find.handle, { ...current, keywordsHit });
        return { ok: true, status: 200, data: byHandle.get(find.handle) };
      }
      byHandle.set(find.handle, {
        handle: find.handle,
        name: find.name || '',
        subscriberText: find.subscriberText || '',
        description: find.description || '',
        keywordsHit: [...(find.keywordsHit || [])],
        foundVia: find.foundVia,
      });
      return { ok: true, status: 201, data: byHandle.get(find.handle) };
    },
  };
}

/** A search engine answering from a table of query → result links. */
function fakeSearch(table) {
  const calls = [];
  return {
    calls,
    async fetchWebSearchBatch(query, pageIndex) {
      calls.push({ query, pageIndex });
      const keyword = query.match(/"([^"]*)"/)[1];
      const links = table[keyword];
      if (links instanceof Error) return { ok: false, error: links.message };
      const page = pageIndex === 0 ? (links || []) : [];
      return { ok: true, items: page.map((link) => ({ link, title: '', snippet: '' })) };
    },
  };
}

function page(title, subscribers = '') {
  return {
    ok: true,
    html: `<html><head><title>${title} | Substack</title>`
      + '<meta name="description" content="Essays on &amp; about things"></head>'
      + `<body><div>${subscribers}</div></body></html>`,
  };
}

function deps(overrides = {}) {
  const pagesRead = [];
  const sleeps = [];
  return {
    pagesRead,
    sleeps,
    resolveWebSearchConfig: () => CONFIGURED,
    webSearchConfigurationError: () => 'Web search is not configured. Set BRAVE_API_KEY.',
    fetchFrontPage: async (url) => {
      pagesRead.push(url);
      return page(url.match(/^https:\/\/([^.]+)/)[1].toUpperCase(), '1,000 subscribers');
    },
    sleep: async (ms) => { sleeps.push(ms); },
    ...overrides,
  };
}

// ── Reading search results ─────────────────────────────────────────────────

test('a result names a publication only when its host is <handle>.substack.com', () => {
  assert.deepEqual(handleFromResultUrl('https://kindoftsetsy.substack.com/p/some-post'), { ok: true, handle: 'kindoftsetsy' });
  assert.deepEqual(handleFromResultUrl('https://Game-B.substack.com/'), { ok: true, handle: 'game-b' });
  assert.deepEqual(handleFromResultUrl('https://open.substack.com/pub/metamoderna/p/x'), { ok: true, handle: 'metamoderna' });
  for (const link of [
    'https://substack.com/@someone',
    'https://www.substack.com/home',
    'https://open.substack.com/',
    'https://support.substack.com/hc/en-us',
    'https://example.com/substack.com',
    'https://evil-substack.com/',
    'not a url',
  ]) {
    assert.equal(handleFromResultUrl(link).ok, false, link);
  }
});

test('a front page gives its title, description and subscriber wording', () => {
  const details = parseFrontPage(page('Kind of Tsetsy', 'Join <b>1,000 subscribers</b>').html);
  assert.equal(details.name, 'Kind of Tsetsy');
  assert.equal(details.description, 'Essays on & about things');
  assert.equal(details.subscriberText, '1,000 subscribers');
  assert.equal(parseFrontPage('<title>No count</title>').subscriberText, '');
  assert.equal(parseFrontPage('<p>Over 2K subscribers</p>').subscriberText, 'Over 2K subscribers');
});

// ── The run ────────────────────────────────────────────────────────────────

test('three keywords: each distinct handle is added once, with every keyword that found it', async () => {
  const store = fakeStore();
  const search = fakeSearch({
    'Game B': ['https://alpha.substack.com/p/1', 'https://beta.substack.com/', 'https://alpha.substack.com/p/2'],
    metamodern: ['https://beta.substack.com/p/x', 'https://gamma.substack.com/'],
    sensemaking: ['https://alpha.substack.com/about'],
  });
  const d = deps({ fetchWebSearchBatch: search.fetchWebSearchBatch });
  const run = await runSubstackMinerSearch({ keywords: ['Game B', 'metamodern', 'sensemaking'] }, SCOPE, { ...d, store });

  assert.equal(run.ok, true, run.error);
  assert.equal(run.data.engine, 'Brave Search');
  assert.equal(run.data.handlesFound, 3);
  assert.equal(run.data.added, 3);
  assert.equal(run.data.merged, 0);
  assert.equal(store.upserts.length, 3, 'one save per writer, however many results named them');
  assert.deepEqual(store.byHandle.get('alpha').keywordsHit, ['Game B', 'sensemaking']);
  assert.deepEqual(store.byHandle.get('beta').keywordsHit, ['Game B', 'metamodern']);
  assert.deepEqual(store.byHandle.get('gamma').keywordsHit, ['metamodern']);
  for (const row of store.byHandle.values()) assert.equal(row.foundVia, 'web_search');
  assert.equal(store.byHandle.get('alpha').subscriberText, '1,000 subscribers');
  assert.equal(store.byHandle.get('alpha').name, 'ALPHA');
  assert.deepEqual(search.calls.map((call) => call.query), [
    'site:substack.com "Game B"', 'site:substack.com "metamodern"', 'site:substack.com "sensemaking"',
  ]);
  assert.deepEqual(d.pagesRead.sort(), [
    'https://alpha.substack.com/', 'https://beta.substack.com/', 'https://gamma.substack.com/',
  ]);
});

test('hosts that are not *.substack.com are dropped and counted', async () => {
  const store = fakeStore();
  const search = fakeSearch({
    'Game B': ['https://alpha.substack.com/', 'https://medium.com/@x/y', 'https://substack.com/@person', 'https://www.substack.com/'],
  });
  const run = await runSubstackMinerSearch({ keywords: ['Game B'] }, SCOPE, { ...deps({ fetchWebSearchBatch: search.fetchWebSearchBatch }), store });
  assert.equal(run.ok, true, run.error);
  assert.equal(run.data.resultsSeen, 4);
  assert.equal(run.data.droppedNotSubstack, 3);
  assert.equal(run.data.handlesFound, 1);
  assert.deepEqual([...store.byHandle.keys()], ['alpha']);
});

test('a front page that errors is reported by handle, and the writer is still saved', async () => {
  const store = fakeStore();
  const search = fakeSearch({ 'Game B': ['https://alpha.substack.com/', 'https://broken.substack.com/'] });
  const d = deps({
    fetchWebSearchBatch: search.fetchWebSearchBatch,
    fetchFrontPage: async (url) => (url.includes('broken') ? { ok: false, reason: 'answered HTTP 503' } : page('Alpha', '12 subscribers')),
  });
  const run = await runSubstackMinerSearch({ keywords: ['Game B'] }, SCOPE, { ...d, store });
  assert.equal(run.ok, true, run.error);
  assert.deepEqual(run.data.unreadablePages, [{ handle: 'broken', reason: 'answered HTTP 503' }]);
  assert.equal(run.data.added, 2);
  const broken = store.byHandle.get('broken');
  assert.equal(broken.name, 'broken', 'name falls back to the handle');
  assert.equal(broken.subscriberText, '');
  assert.equal(store.byHandle.get('alpha').subscriberText, '12 subscribers');
});

test('the per-keyword cap stops a keyword at maxResultsPerKeyword writers', async () => {
  const store = fakeStore({ settings: { maxResultsPerKeyword: 2 } });
  const search = fakeSearch({
    'Game B': ['https://a1.substack.com/', 'https://a1.substack.com/p/2', 'https://a2.substack.com/', 'https://a3.substack.com/', 'https://a4.substack.com/'],
    metamodern: ['https://a3.substack.com/', 'https://b1.substack.com/', 'https://b2.substack.com/'],
  });
  const run = await runSubstackMinerSearch({ keywords: ['Game B', 'metamodern'] }, SCOPE, { ...deps({ fetchWebSearchBatch: search.fetchWebSearchBatch }), store });
  assert.equal(run.ok, true, run.error);
  assert.deepEqual([...store.byHandle.keys()].sort(), ['a1', 'a2', 'a3', 'b1']);
  assert.deepEqual(store.byHandle.get('a3').keywordsHit, ['metamodern'], 'the cap left a3 out of Game B');
});

test('a writer already on the list is merged, not re-read', async () => {
  const store = fakeStore({ rows: [{ handle: 'alpha', name: 'Alpha', keywordsHit: ['old'], foundVia: 'seed' }] });
  const search = fakeSearch({ 'Game B': ['https://alpha.substack.com/', 'https://beta.substack.com/'] });
  const d = deps({ fetchWebSearchBatch: search.fetchWebSearchBatch });
  const run = await runSubstackMinerSearch({ keywords: ['Game B'] }, SCOPE, { ...d, store });
  assert.equal(run.ok, true, run.error);
  assert.equal(run.data.added, 1);
  assert.equal(run.data.merged, 1);
  assert.deepEqual(d.pagesRead, ['https://beta.substack.com/']);
  assert.deepEqual(store.byHandle.get('alpha').keywordsHit, ['old', 'Game B']);
  assert.equal(store.byHandle.get('alpha').foundVia, 'seed');
});

test('outside requests are paced pauseMsBetweenFetches apart', async () => {
  const store = fakeStore({ settings: { pauseMsBetweenFetches: 1500 } });
  const search = fakeSearch({ 'Game B': ['https://alpha.substack.com/', 'https://beta.substack.com/'] });
  const d = deps({ fetchWebSearchBatch: search.fetchWebSearchBatch });
  await runSubstackMinerSearch({ keywords: ['Game B'] }, SCOPE, { ...d, store });
  // One search and two page reads: a pause before each request but the first.
  assert.deepEqual(d.sleeps, [1500, 1500]);
});

test('the saved keyword list is used when the request names none', async () => {
  const store = fakeStore({ settings: { keywords: ['Game B'] } });
  const search = fakeSearch({ 'Game B': ['https://alpha.substack.com/'] });
  const run = await runSubstackMinerSearch({}, SCOPE, { ...deps({ fetchWebSearchBatch: search.fetchWebSearchBatch }), store });
  assert.equal(run.ok, true, run.error);
  assert.deepEqual(run.data.keywordsSearched, ['Game B']);

  const empty = await runSubstackMinerSearch({}, SCOPE, { ...deps(), store: fakeStore() });
  assert.equal(empty.ok, false);
  assert.equal(empty.status, 400);
  assert.match(empty.error, /no keywords/);
});

test('with no search key the run is refused with the configuration message, not an empty success', async () => {
  const store = fakeStore({ settings: { keywords: ['Game B'] } });
  let searched = false;
  const run = await runSubstackMinerSearch({ keywords: ['Game B'] }, SCOPE, {
    ...deps({ fetchWebSearchBatch: async () => { searched = true; return { ok: true, items: [] }; } }),
    resolveWebSearchConfig: () => ({ configured: false, provider: '' }),
    store,
  });
  assert.equal(run.ok, false);
  assert.equal(run.status, 400);
  assert.equal(run.error, 'Web search is not configured. Set BRAVE_API_KEY.');
  assert.equal(searched, false);
  assert.equal(store.upserts.length, 0);
});

test('the real configuration message is the one lib/webSearch.js writes', async () => {
  const saved = {};
  for (const key of ['BRAVE_API_KEY', 'BRAVE_SEARCH_API_KEY', 'GOOGLE_CUSTOM_SEARCH_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_CUSTOM_SEARCH_ENGINE_ID', 'GOOGLE_CUSTOM_SEARCH_CX', 'WEB_SEARCH_PROVIDER']) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  try {
    const webSearch = require('../../lib/webSearch.js');
    const config = webSearch.resolveWebSearchConfig();
    if (config.configured) return; // a key saved in Settings → APIs; nothing to prove here
    const run = await runSubstackMinerSearch({ keywords: ['Game B'] }, SCOPE, { store: fakeStore() });
    assert.equal(run.ok, false);
    assert.equal(run.status, 400);
    assert.equal(run.error, webSearch.webSearchConfigurationError(config));
  } finally {
    for (const [key, value] of Object.entries(saved)) if (value !== undefined) process.env[key] = value;
  }
});

test('when every search fails the run says so instead of reporting nothing found', async () => {
  const store = fakeStore();
  const search = fakeSearch({ 'Game B': new Error('Brave search failed (429)') });
  const run = await runSubstackMinerSearch({ keywords: ['Game B'] }, SCOPE, { ...deps({ fetchWebSearchBatch: search.fetchWebSearchBatch }), store });
  assert.equal(run.ok, false);
  assert.equal(run.status, 502);
  assert.match(run.error, /429/);
});

test('one failed keyword is named while the others still run', async () => {
  const store = fakeStore();
  const search = fakeSearch({ 'Game B': new Error('Brave search failed (429)'), metamodern: ['https://beta.substack.com/'] });
  const run = await runSubstackMinerSearch({ keywords: ['Game B', 'metamodern'] }, SCOPE, { ...deps({ fetchWebSearchBatch: search.fetchWebSearchBatch }), store });
  assert.equal(run.ok, true, run.error);
  assert.deepEqual(run.data.searchErrors, [{ keyword: 'Game B', error: 'Brave search failed (429)' }]);
  assert.equal(run.data.added, 1);
});

test('a database failure on save stops the run and is returned as-is', async () => {
  const store = fakeStore();
  store.upsertCandidate = async () => ({ ok: false, status: 503, error: 'table missing' });
  const search = fakeSearch({ 'Game B': ['https://alpha.substack.com/'] });
  const run = await runSubstackMinerSearch({ keywords: ['Game B'] }, SCOPE, { ...deps({ fetchWebSearchBatch: search.fetchWebSearchBatch }), store });
  assert.deepEqual(run, { ok: false, status: 503, error: 'table missing' });
});
