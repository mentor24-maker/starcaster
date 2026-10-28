'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * Outreach wizard 15/19 (task 86bcrmbrf) — YouTube's list of creators: the
 * store, the channel search, the suggestion pass and the routes.
 *
 * The fake database reads its schema FROM docs/SQL/youtube_creators_setup.sql
 * (and the Substack Miner's, whose keywords stand in until the wizard saves
 * its own), so a column dropped from the SQL fails here — including a missing
 * owner_user_id, which would make scopedInsertRow stamp no tenant at all
 * (CLAUDE.md landmine 12).
 */

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'SQL');
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const ALL = [
  '../../lib/projectScope.js', '../../lib/substackMinerStore.js', '../../lib/youtubeCreatorsStore.js',
  '../../lib/acquire/SubstackSuggestRun.js', '../../lib/acquire/YoutubeCreatorsFindRun.js',
  '../../routes/outreach.js',
].map((p) => require.resolve(p));

const SCOPE = { projectId: 'proj_a', userId: 'user_1' };
const OTHER = { projectId: 'proj_b', userId: 'user_2' };
const NOW = Date.parse('2026-10-28T15:00:00Z'); // 8am Pacific (PDT)

function withDb() {
  const sql = ['youtube_creators_setup.sql', 'substack_miner_setup.sql']
    .map((f) => fs.readFileSync(path.join(SQL_DIR, f), 'utf8')).join('\n');
  const db = createFakeDb(parseSchemaText(sql));
  const realSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true,
    exports: {
      isConfigured: () => true,
      tableConfig: () => ({
        youtubeCreators: 'youtube_creators',
        outreachWizardSettings: 'outreach_wizard_settings',
        substackCandidates: 'substack_candidates',
        substackMinerSettings: 'substack_miner_settings',
      }),
      sbQuery: db.sbQuery,
    },
  };
  for (const p of ALL) delete require.cache[p];
  const store = require('../../lib/youtubeCreatorsStore.js');
  const miner = require('../../lib/substackMinerStore.js');
  const find = require('../../lib/acquire/YoutubeCreatorsFindRun.js');
  const suggest = require('../../lib/acquire/SubstackSuggestRun.js');
  const route = require('../../routes/outreach.js');
  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    for (const p of ALL) delete require.cache[p];
  }
  return { db, store, miner, find, suggest, route, restore };
}

/** A YouTube channel id: "UC" and 22 more characters. */
function cid(n) {
  return `UC${String(n).padStart(22, 'x')}`;
}

/**
 * A fake YouTube API: each keyword's search answers `perKeyword` channels
 * (overlapping between keywords, as real searches do), and details and
 * uploads answer for any channel asked about. `quotaAfter` makes every call
 * after that many answer YouTube's real quota refusal.
 */
function fakeYoutube({ perKeyword = 12, quotaAfter = Infinity, calls = [] } = {}) {
  let n = 0;
  return async (endpoint, params) => {
    calls.push({ endpoint, params });
    n += 1;
    if (n > quotaAfter) {
      return { ok: false, status: 403, reason: 'quotaExceeded', error: 'The request cannot be completed because you have exceeded your quota.' };
    }
    if (endpoint === 'search') {
      const start = params.q.length * 7; // a different, overlapping range per keyword
      return { ok: true, data: { items: Array.from({ length: perKeyword }, (_, i) => ({ id: { kind: 'youtube#channel', channelId: cid(start + i) } })) } };
    }
    if (endpoint === 'channels') {
      return {
        ok: true,
        data: {
          items: params.id.split(',').map((id, i) => ({
            id,
            snippet: { title: `Channel ${id.slice(-4)}`, description: 'Talks about minds', thumbnails: { medium: { url: `https://yt3.example.com/${id}.jpg` } } },
            statistics: i === 0 ? { hiddenSubscriberCount: true } : { subscriberCount: String(1000 + i), hiddenSubscriberCount: false },
            contentDetails: { relatedPlaylists: { uploads: `UU${id.slice(2)}` } },
          })),
        },
      };
    }
    if (endpoint === 'playlistItems') {
      return {
        ok: true,
        data: { items: [1, 2, 3].map((k) => ({ snippet: { title: `Video ${k}`, publishedAt: '2026-10-20T00:00:00Z', resourceId: { videoId: `vid${k}${params.playlistId.slice(-7)}`.slice(0, 11).padEnd(11, 'a') } } })) },
      };
    }
    return { ok: false, status: 404, error: `unexpected ${endpoint}` };
  };
}

const CANON = [
  { docKey: 'VOICE', body: 'Plain, warm, direct.' },
  { docKey: 'AIISM-BLOCKLIST', body: '- delve' },
  { docKey: 'THESIS', title: 'Thesis', body: 'Consciousness is the ground of the cosmos.' },
];

function fakeModel(prompts = []) {
  return async (system, prompt) => {
    prompts.push({ system, prompt });
    return { ok: true, text: '{"action":"approved","reasons":["consciousness"],"confidence":"high","why":"Talks about minds, like his thesis."}' };
  };
}

// ── The store ───────────────────────────────────────────────────────────────

test('a channel found twice is one row; a later find never undoes his decision; tenants are stamped and kept apart', async () => {
  const { db, store, restore } = withDb();
  try {
    const first = await store.upsertCreator({ channelId: cid(1), name: 'Mind TV', keywordsHit: ['consciousness'] }, SCOPE);
    assert.equal(first.status, 201, first.error);
    const decided = await store.decideCreator(first.data.id, { status: 'rejected', decisionReasons: ['Too salesy ', 'too salesy'], note: 'sells courses' }, SCOPE);
    assert.equal(decided.ok, true, decided.error);
    assert.deepEqual(decided.data.decisionReasons, ['Too salesy'], 'one reason, one spelling');

    const again = await store.upsertCreator({ channelId: `https://www.youtube.com/channel/${cid(1)}`, keywordsHit: ['Consciousness', 'idealism'], subscriberCount: 5 }, SCOPE);
    assert.equal(again.status, 200);
    assert.equal(again.data.status, 'rejected', 'a search cannot undo a rejection');
    assert.equal(again.data.note, 'sells courses');
    assert.deepEqual(again.data.keywordsHit, ['consciousness', 'idealism']);
    assert.equal(again.data.subscriberCount, 5);

    const rows = db.tables ? null : null; // (the fake's rows are read through the store below)
    void rows;
    const mine = await store.listCreators(50, SCOPE);
    assert.equal(mine.data.length, 1);
    assert.equal(mine.data[0].projectId, 'proj_a', 'the tenant was stamped');
    assert.equal((await store.listCreators(50, OTHER)).data.length, 0, 'another project sees none of them');
    assert.equal((await store.getCreatorById(first.data.id, OTHER)).status, 404);

    assert.equal((await store.listCreators(SCOPE)).ok, false, 'a scope in the limit\'s place is refused, not read as "every project"');
    assert.match((await store.upsertCreator({ channelId: 'not-a-channel' }, SCOPE)).error, /not a YouTube channel id/);
    assert.match((await store.upsertCreator({ channelId: cid(2) }, {})).error, /No project is selected/);
  } finally { restore(); }
});

test('Approve and Reject save reasons; the path refuses a move it does not allow', async () => {
  const { store, restore } = withDb();
  try {
    const c = (await store.upsertCreator({ channelId: cid(3) }, SCOPE)).data;
    const approved = await store.decideCreator(c.id, { status: 'approved', decisionReasons: ['polymath'], note: 'great' }, SCOPE);
    assert.deepEqual([approved.data.status, approved.data.decisionReasons, approved.data.note], ['approved', ['polymath'], 'great']);
    const back = await store.decideCreator(c.id, { status: 'candidate' }, SCOPE);
    assert.match(back.error, /cannot move from approved to candidate/);
    const rejected = await store.decideCreator(c.id, { status: 'rejected', decisionReasons: ['off topic'] }, SCOPE);
    assert.deepEqual(rejected.data.decisionReasons, ['off topic']);
    assert.match((await store.decideCreator(c.id, { status: 'approved', bogus: 1 }, SCOPE)).error, /bogus/);
  } finally { restore(); }
});

test('keywords: the Substack Miner\'s stand in until the wizard saves its own, and the source says which', async () => {
  const { store, miner, restore } = withDb();
  try {
    assert.equal((await store.getKeywords(SCOPE)).data.source, 'none');
    await miner.saveSettings({ keywords: ['consciousness', 'idealism'] }, SCOPE);
    const seeded = await store.getKeywords(SCOPE);
    assert.deepEqual([seeded.data.source, seeded.data.keywords], ['substack_miner', ['consciousness', 'idealism']]);
    const saved = await store.saveKeywords(['nonduality', ' Nonduality '], SCOPE);
    assert.equal(saved.status, 201, saved.error);
    const read = await store.getKeywords(SCOPE);
    assert.deepEqual([read.data.source, read.data.keywords], ['saved', ['nonduality']]);
    assert.match((await store.saveKeywords([], SCOPE)).error, /at least one/);

    const broken = await store.getKeywords(SCOPE, { minerStore: { getSettings: async () => ({ ok: false, status: 502, error: 'connection reset' }) } });
    assert.equal(broken.ok, true, 'a saved list does not need the Miner');
    const fresh = await store.getKeywords(OTHER, { minerStore: { getSettings: async () => ({ ok: false, status: 502, error: 'connection reset' }) } });
    assert.equal(fresh.ok, false, 'an unreadable Miner list is a refusal, never an empty list');
    assert.match(fresh.error, /could not be read to start from: connection reset/);
  } finally { restore(); }
});

// ── Finding channels ────────────────────────────────────────────────────────

test('one run finds at least 20 channels for his keywords, with details and the newest three videos', async () => {
  const { store, find, restore } = withDb();
  try {
    await store.saveKeywords(['consciousness', 'idealism', 'nondual awareness'], SCOPE);
    const calls = [];
    const res = await find.findYoutubeCreators(SCOPE, {}, {
      apiKey: 'test', ytFetch: fakeYoutube({ calls }), now: () => NOW,
      listVideos: async () => ({ ok: true, data: [{ channel_url: `https://www.youtube.com/channel/${cid(900)}` }, { channel_url: 'https://www.youtube.com/@handle' }] }),
    });
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.cannotTell, '');
    assert.ok(res.data.added >= 20, `added ${res.data.added}`);
    assert.equal(res.data.fromAcquire, 1, "the channel behind an Acquire video is included");
    assert.deepEqual(res.data.keywordsSearched, ['consciousness', 'idealism', 'nondual awareness']);

    const list = (await store.listCreators(500, SCOPE)).data;
    assert.equal(list.length, res.data.added);
    const one = list.find((c) => c.channelId === cid(98)); // 'consciousness' (13 chars) × 7 = 91..102
    assert.equal(one.latestVideos.length, 3);
    assert.match(one.avatarUrl, /^https:\/\/yt3\.example\.com\//);
    assert.ok(list.some((c) => c.subscriberCount === null), 'a hidden count is stored as unknown, never as 0');
    assert.equal(list.find((c) => c.channelId === cid(900)).foundVia, 'acquire_results');
    // Searches are the expensive call: one per keyword, no more.
    assert.equal(calls.filter((c) => c.endpoint === 'search').length, 3);
  } finally { restore(); }
});

test('quota used up: the run stops, keeps what it saved, and says "cannot tell" with the time it comes back', async () => {
  const { store, find, restore } = withDb();
  try {
    await store.saveKeywords(['consciousness', 'idealism'], SCOPE);
    const res = await find.findYoutubeCreators(SCOPE, {}, {
      apiKey: 'test', ytFetch: fakeYoutube({ quotaAfter: 1 }), now: () => NOW, listVideos: async () => ({ ok: true, data: [] }),
    });
    assert.equal(res.ok, true);
    assert.equal(res.data.quota.exhausted, true);
    assert.equal(res.data.quota.resetsAt, '2026-10-29T07:00:00.000Z', 'midnight Pacific (PDT) the next day');
    assert.equal(res.data.cannotTell, 'Cannot tell — YouTube quota used up until Oct 29, 3:00 AM Eastern (midnight Pacific).');
    assert.equal(res.data.added, 0, 'nothing is claimed as found when the details could not be read');

    // In winter Pacific is UTC-8.
    assert.equal(find.nextPacificMidnight(Date.parse('2026-12-10T20:00:00Z')), '2026-12-11T08:00:00.000Z');
    assert.equal(find.isQuotaExhausted({ ok: false, status: 403, reason: 'dailyLimitExceeded' }), true);
    assert.equal(find.isQuotaExhausted({ ok: false, status: 403, reason: 'forbidden', error: 'Comments disabled' }), false);
  } finally { restore(); }
});

test('no API key or no keywords is a refusal naming the fix, before any quota is spent', async () => {
  const { store, find, restore } = withDb();
  try {
    const calls = [];
    const noKey = await find.findYoutubeCreators(SCOPE, {}, { apiKey: '', ytFetch: fakeYoutube({ calls }) });
    assert.equal(noKey.status, 503);
    assert.match(noKey.error, /YOUTUBE_API_KEY/);
    const noWords = await find.findYoutubeCreators(SCOPE, {}, { apiKey: 'k', ytFetch: fakeYoutube({ calls }) });
    assert.equal(noWords.status, 409);
    assert.match(noWords.error, /no keywords/);
    assert.equal(calls.length, 0);
    void store;
  } finally { restore(); }
});

// ── Suggestions ─────────────────────────────────────────────────────────────

test('with no YouTube decisions yet, it suggests from his canon, every one marked low confidence', async () => {
  const { store, suggest, restore } = withDb();
  try {
    await store.saveKeywords(['consciousness'], SCOPE);
    for (let i = 0; i < 3; i += 1) {
      await store.upsertCreator({ channelId: cid(i), name: `Chan ${i}`, latestVideos: [{ videoId: `abcdefghij${i}`, title: `On awareness ${i}` }] }, SCOPE);
    }
    const prompts = [];
    const res = await suggest.runYoutubeSuggestions(SCOPE, {}, { canonDocs: CANON, generate: fakeModel(prompts), now: () => NOW });
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.suggested.length, 3);
    assert.equal(res.data.fromCanonOnly, true);
    for (const c of (await store.listCreators(50, SCOPE)).data) {
      assert.equal(c.status, 'candidate', 'a suggestion decides nothing');
      assert.equal(c.suggestion.confidence, 'low', 'a guess from the canon alone is not a guess from his judgement');
      assert.deepEqual(c.suggestion.reasons, ['consciousness']);
      assert.match(c.suggestion.why, /thesis/);
    }
    assert.match(prompts[0].system, /YouTube channels/);
    assert.match(prompts[0].system, /Consciousness is the ground of the cosmos/);
    assert.match(prompts[0].prompt, /What he searches YouTube for: consciousness/);
    assert.match(prompts[0].prompt, /Newest videos:\n {2}- On awareness/);
  } finally { restore(); }
});

test('with enough YouTube decisions, his own confidence stands and his decisions are the examples', async () => {
  const { store, suggest, restore } = withDb();
  try {
    await store.saveKeywords(['consciousness'], SCOPE);
    for (let i = 0; i < 5; i += 1) {
      const c = (await store.upsertCreator({ channelId: cid(i), name: `Old ${i}` }, SCOPE)).data;
      await store.decideCreator(c.id, { status: i < 3 ? 'approved' : 'rejected', decisionReasons: [i < 3 ? 'deep' : 'hype'] }, SCOPE);
    }
    await store.upsertCreator({ channelId: cid(50), name: 'Fresh' }, SCOPE);
    const prompts = [];
    const res = await suggest.runYoutubeSuggestions(SCOPE, {}, { canonDocs: CANON, generate: fakeModel(prompts) });
    assert.equal(res.data.fromCanonOnly, false);
    assert.equal(res.data.suggested[0].confidence, 'high');
    assert.match(prompts[0].prompt, /APPROVED: Old/);
    assert.match(prompts[0].prompt, /hype \(rejecting, used 2×\)/);
  } finally { restore(); }
});

test('with neither decisions nor canon it refuses, naming both', async () => {
  const { store, suggest, restore } = withDb();
  try {
    await store.upsertCreator({ channelId: cid(1) }, SCOPE);
    const res = await suggest.runYoutubeSuggestions(SCOPE, {}, { canonDocs: [], generate: fakeModel() });
    assert.equal(res.status, 409);
    assert.match(res.error, /0 approved and 0 rejected YouTube channels, and your canon is not available \(no canon copied yet/);
  } finally { restore(); }
});

// ── Routes ──────────────────────────────────────────────────────────────────

function fakeRes() {
  return {
    statusCode: 0, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    writeHead(code, headers) { this.statusCode = code; Object.assign(this.headers, headers || {}); },
    end(text) { this.body = text ? JSON.parse(text) : null; },
  };
}

function req(method, body) {
  const { Readable } = require('stream');
  const r = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
  r.method = method;
  r.headers = { 'content-type': 'application/json' };
  r.projectContext = { project: { id: SCOPE.projectId } };
  r.authUser = { id: SCOPE.userId };
  r.socket = { remoteAddress: '127.0.0.1' };
  return r;
}

test('routes: list, decide, and a quota-exhausted find comes back as an answer with cannotTell, not as an error', async () => {
  const { store, route, restore } = withDb();
  try {
    const c = (await store.upsertCreator({ channelId: cid(7), name: 'Seven' }, SCOPE)).data;
    let res = fakeRes();
    await route.handle(req('GET'), res, '/api/outreach/youtube/creators', 'GET');
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.creators.length, 1);
    assert.equal(res.body.data.keywords.source, 'none');

    res = fakeRes();
    await route.handle(req('POST', { status: 'approved', decisionReasons: ['deep'] }), res, `/api/outreach/youtube/creators/${c.id}/decide`, 'POST');
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.data.decisionReasons, ['deep']);

    res = fakeRes();
    const creators = {
      store: () => store,
      find: async () => ({ ok: true, status: 200, data: { added: 2, cannotTell: 'Cannot tell — YouTube quota used up until Oct 29, 3:00 AM Eastern (midnight Pacific).', quota: { exhausted: true } } }),
      suggest: async () => ({ ok: true, data: {} }),
    };
    await route.handle(req('POST', {}), res, '/api/outreach/youtube/creators/find', 'POST', { creators });
    assert.equal(res.statusCode, 200);
    assert.match(res.body.data.cannotTell, /^Cannot tell — YouTube quota used up until/);

    res = fakeRes();
    await route.handle(req('PUT', { keywords: ['consciousness'] }), res, '/api/outreach/keywords', 'PUT');
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  } finally { restore(); }
});
