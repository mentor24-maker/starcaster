'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * Substack Miner seed list (86bch05xg) — a pasted substack.com/@name profile
 * link is looked up and filed under that person's publication; a person with
 * no publication is refused on its own line while the rest still saves; every
 * other line goes through the ordinary import untouched.
 *
 * The store is the REAL one over a fake database whose schema is read from the
 * setup file, so a column the SQL lacks fails here too.
 */

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'SQL');
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const ALL = [
  '../../lib/projectScope.js', '../../lib/substackMinerStore.js', '../../lib/substackNotesStore.js',
  '../../lib/acquire/SubstackNotesCapture.js', '../../lib/acquire/SubstackNotesReadRun.js',
  '../../lib/acquire/SubstackNotesSearch.js', '../../lib/acquire/SubstackSeedImport.js',
].map((p) => require.resolve(p));

const SCOPE = { projectId: 'proj_a', userId: 'user_1' };

function withDb() {
  const sql = ['substack_miner_setup.sql', 'substack_notes_setup.sql']
    .map((f) => fs.readFileSync(path.join(SQL_DIR, f), 'utf8')).join('\n');
  const db = createFakeDb(parseSchemaText(sql));
  const realSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true,
    exports: {
      isConfigured: () => true,
      tableConfig: () => ({
        substackCandidates: 'substack_candidates',
        substackMinerSettings: 'substack_miner_settings',
        substackNotesItems: 'substack_notes_items',
        substackNotesSettings: 'substack_notes_settings',
      }),
      sbQuery: db.sbQuery,
    },
  };
  for (const p of ALL) delete require.cache[p];
  const miner = require('../../lib/substackMinerStore.js');
  const seeds = require('../../lib/acquire/SubstackSeedImport.js');
  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    for (const p of ALL) delete require.cache[p];
  }
  return { miner, seeds, restore };
}

// The shape Substack answered for @ankairos on 2026-10-12: the publication is
// on publicationUsers (role admin), its subdomain unlike the person's handle.
const PROFILES = {
  ankairos: {
    id: 456225539, handle: 'ankairos', name: 'Philosophy and AI',
    publicationUsers: [{ role: 'admin', is_primary: true, publication: { subdomain: 'magickalchemyandai', name: 'Philosophy & AI' } }],
  },
  reader: { id: 5, handle: 'reader', primaryPublication: null, publicationUsers: [] },
};

function fakeFetch(calls = []) {
  return async (url) => {
    calls.push(url);
    const m = url.match(/\/api\/v1\/user\/([^/]+)\/public_profile$/);
    const profile = m && PROFILES[decodeURIComponent(m[1])];
    if (!profile) return { ok: false, httpStatus: 404, reason: 'answered HTTP 404' };
    return { ok: true, data: profile };
  };
}

test('profileHandle: only substack.com/@name links count as a person', () => {
  const { seeds, restore } = withDb();
  try {
    assert.equal(seeds.profileHandle('https://substack.com/@ankairos'), 'ankairos');
    assert.equal(seeds.profileHandle('substack.com/@Ankairos?utm_source=x'), 'ankairos');
    assert.equal(seeds.profileHandle('https://www.substack.com/@ankairos/note/c-123'), 'ankairos');
    assert.equal(seeds.profileHandle('@ankairos'), '', 'a bare @name stays a publication handle, as before');
    assert.equal(seeds.profileHandle('https://ankairos.substack.com'), '');
    assert.equal(seeds.profileHandle(''), '');
  } finally { restore(); }
});

test('a profile link is filed under the person\'s publication; the rest saves around a refusal', async () => {
  const { miner, seeds, restore } = withDb();
  try {
    const calls = [];
    const res = await seeds.importSeedList([
      { handle: 'plainpub', whyFit: 'a publication, as before' },
      { handle: 'https://substack.com/@ankairos', whyFit: 'philosophy and AI' },
      { handle: 'https://substack.com/@reader' },
      { handle: 'not a handle!' },
      { handle: 'substack.com/@ankairos' },
    ], SCOPE, { fetchJson: fakeFetch(calls), sleep: async () => {} });
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.added, 2);
    assert.equal(res.data.merged, 1, 'the second paste of the same person merges');
    assert.equal(calls.length, 2, 'one lookup per person, however often pasted');
    assert.deepEqual(res.data.resolved.map((r) => [r.index, r.profile, r.handle]), [
      [1, '@ankairos', 'magickalchemyandai'],
      [4, '@ankairos', 'magickalchemyandai'],
    ]);
    assert.deepEqual(res.data.refusals.map((r) => r.index), [2, 3], 'refusals name the line Dane pasted, in order');
    assert.equal(res.data.refused, 2);
    assert.match(res.data.refusals[0].error, /no Substack publication of their own/);

    const list = await miner.listCandidates(50, SCOPE);
    const byHandle = Object.fromEntries(list.data.map((c) => [c.handle, c]));
    assert.ok(byHandle.plainpub);
    const ank = byHandle.magickalchemyandai;
    assert.ok(ank, 'the person is saved under their publication');
    assert.equal(ank.foundVia, 'seed');
    assert.equal(ank.name, 'Philosophy & AI');
    assert.equal(ank.description, 'philosophy and AI');
    assert.equal(ank.publicationUrl, 'https://magickalchemyandai.substack.com');
    assert.equal(byHandle.ankairos, undefined, 'never stored under the person\'s @handle');
  } finally { restore(); }
});

test('a list with no profile links goes straight to the ordinary import', async () => {
  const { seeds, restore } = withDb();
  try {
    const calls = [];
    const res = await seeds.importSeedList([{ handle: 'plainpub' }], SCOPE, { fetchJson: fakeFetch(calls) });
    assert.equal(res.ok, true);
    assert.equal(res.data.added, 1);
    assert.equal(calls.length, 0);
  } finally { restore(); }
});

test('every line a profile nobody can resolve: nothing saved, every line named', async () => {
  const { seeds, restore } = withDb();
  try {
    const res = await seeds.importSeedList([{ handle: 'https://substack.com/@ghost' }], SCOPE, { fetchJson: fakeFetch(), sleep: async () => {} });
    assert.equal(res.ok, true);
    assert.equal(res.data.added, 0);
    assert.deepEqual(res.data.refusals, [{ index: 0, handle: '@ghost', error: 'there is no Substack profile at substack.com/@ghost — check the link' }]);
  } finally { restore(); }
});

test('no project selected: refused before any lookup', async () => {
  const { seeds, restore } = withDb();
  try {
    const calls = [];
    const res = await seeds.importSeedList([{ handle: 'https://substack.com/@ankairos' }], {}, { fetchJson: fakeFetch(calls) });
    assert.equal(res.ok, false);
    assert.equal(calls.length, 0);
  } finally { restore(); }
});

// ── Article and publication links (task 86bcux874) ─────────────────────────
// The page shapes Substack served on 2026-10-29: a custom-domain page carries
// its publication in the preloads-json block; substack.com/home/post/p-N
// redirects to the publication's own address.

const LENNY_HTML = '<html><head><script id="preloads-json" type="application/json">'
  + JSON.stringify({ isEU: false, pub: { subdomain: 'lenny', name: "Lenny's Newsletter", custom_domain: 'www.lennysnewsletter.com' } })
  + '</script></head><body></body></html>';

function fakePages(calls = []) {
  return async (url) => {
    calls.push(url);
    if (url.startsWith('https://www.lennysnewsletter.com/')) return { ok: true, html: LENNY_HTML };
    if (url === 'https://lennysnewsletter.com/') return { ok: true, location: 'https://www.lennysnewsletter.com/' };
    if (url === 'https://substack.com/home/post/p-171478447') return { ok: true, location: 'https://clairdeloony.substack.com/publish/post/171478447' };
    if (url === 'https://example.com/') return { ok: true, html: '<html><body>Not a newsletter</body></html>' };
    if (url === 'https://loop.example/') return { ok: true, location: 'https://loop.example/' };
    return { ok: false, reason: 'answered HTTP 404' };
  };
}

test('linkKind: only links that do not name their publication need a lookup', () => {
  const { linkKind } = require('../../lib/acquire/SubstackLinkResolve.js');
  assert.deepEqual(linkKind('https://open.substack.com/pub/Lenny/p/a-post?r=x'), { kind: 'share', handle: 'lenny' });
  assert.deepEqual(linkKind('www.lennysnewsletter.com/p/a-post'), { kind: 'page', url: 'https://www.lennysnewsletter.com/p/a-post' });
  assert.deepEqual(linkKind('http://substack.com/home/post/p-1'), { kind: 'page', url: 'https://substack.com/home/post/p-1' });
  assert.equal(linkKind('lenny'), null, 'a bare handle is the store\'s, as before');
  assert.equal(linkKind('@lenny'), null);
  assert.equal(linkKind('https://lenny.substack.com/p/a-post'), null, 'name.substack.com is the store\'s, as before');
  assert.equal(linkKind('https://substack.com/@lenny'), null, 'a profile is looked up as a person');
  assert.equal(linkKind('not a handle!'), null);
});

test('publicationForLink: never reads a private address', async () => {
  const { publicationForLink } = require('../../lib/acquire/SubstackLinkResolve.js');
  const calls = [];
  for (const href of ['https://127.0.0.1/x', 'https://localhost/x', 'https://metadata.internal/', 'https://intranet/']) {
    const res = await publicationForLink(href, { fetchPage: fakePages(calls) });
    assert.equal(res.ok, false, href);
    assert.match(res.reason, /not a public web address/);
  }
  const hop = await publicationForLink('https://evil.example/', {
    fetchPage: async (url) => { calls.push(url); return { ok: true, location: 'https://169.254.169.254/latest' }; },
  });
  assert.equal(hop.ok, false, 'a redirect to a private address is not followed');
  assert.deepEqual(calls, ['https://evil.example/']);
});

test('article and publication links are filed under the publication that wrote them', async () => {
  const { miner, seeds, restore } = withDb();
  try {
    const pages = [];
    const res = await seeds.importSeedList([
      { handle: 'https://www.lennysnewsletter.com/p/how-to-tell-if-a-startup-has-a-moat', whyFit: 'product writing' },
      { handle: 'https://open.substack.com/pub/plainpub/p/a-post?r=2x' },
      { handle: 'https://substack.com/home/post/p-171478447' },
      { handle: 'lennysnewsletter.com' },
      { handle: 'https://example.com/' },
      { handle: 'https://www.lennysnewsletter.com/p/how-to-tell-if-a-startup-has-a-moat' },
    ], SCOPE, { fetchPage: fakePages(pages), sleep: async () => {} });
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.added, 3, 'lenny, plainpub, clairdeloony');
    assert.equal(res.data.merged, 2, 'the bare domain and the repeated article are the same writer');
    assert.equal(pages.filter((u) => u.includes('how-to-tell')).length, 1, 'one lookup per link, however often pasted');
    assert.equal(pages.some((u) => u.includes('open.substack.com')), false, 'a share link names its publication — nothing is fetched');
    assert.deepEqual(res.data.resolved.map((r) => [r.index, r.handle]), [[0, 'lenny'], [1, 'plainpub'], [2, 'clairdeloony'], [3, 'lenny'], [5, 'lenny']]);
    assert.equal(res.data.resolved[0].link, 'https://www.lennysnewsletter.com/p/how-to-tell-if-a-startup-has-a-moat');
    assert.equal(res.data.resolved[0].profile, undefined, 'a link is not reported as a profile');
    assert.deepEqual(res.data.refusals, [{ index: 4, handle: 'https://example.com/', error: 'that page is not on Substack, so there is no Substack writer to add' }]);

    const list = await miner.listCandidates(50, SCOPE);
    const byHandle = Object.fromEntries(list.data.map((c) => [c.handle, c]));
    assert.equal(byHandle.lenny.name, "Lenny's Newsletter");
    assert.equal(byHandle.lenny.description, 'product writing');
    assert.equal(byHandle.lenny.foundVia, 'seed');
    assert.ok(byHandle.plainpub);
    assert.ok(byHandle.clairdeloony);
    assert.equal(byHandle.open, undefined, 'a share link never saves a writer called "open"');
  } finally { restore(); }
});

test('a link that redirects forever is refused, not followed forever', async () => {
  const { seeds, restore } = withDb();
  try {
    const res = await seeds.importSeedList([{ handle: 'https://loop.example/' }], SCOPE, { fetchPage: fakePages(), sleep: async () => {} });
    assert.equal(res.ok, true);
    assert.equal(res.data.added, 0);
    assert.match(res.data.refusals[0].error, /redirected more than 5 times/);
  } finally { restore(); }
});

test('past the lookup cap, the remaining lines are refused by name, never dropped', async () => {
  const { seeds, restore } = withDb();
  try {
    const rows = Array.from({ length: seeds.MAX_LOOKUPS + 2 }, (_, i) => ({ handle: `https://www.lennysnewsletter.com/p/post-${i}` }));
    const pages = [];
    const res = await seeds.importSeedList(rows, SCOPE, { fetchPage: fakePages(pages), sleep: async () => {} });
    assert.equal(res.ok, true);
    assert.equal(pages.length, seeds.MAX_LOOKUPS);
    assert.deepEqual(res.data.refusals.map((r) => r.index), [seeds.MAX_LOOKUPS, seeds.MAX_LOOKUPS + 1]);
    assert.match(res.data.refusals[0].error, /second batch/);
  } finally { restore(); }
});
