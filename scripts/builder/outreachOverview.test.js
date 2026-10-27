'use strict';

// Outreach wizard 1/19 (task 86bcrmb8x): GET /api/outreach/overview.
// Fake stores stand in for the database so every stage's sentence can be
// checked against known counts, and so any ONE store can be made to throw.

const test = require('node:test');
const assert = require('node:assert/strict');
const overview = require('../../lib/outreachOverview');
const route = require('../../routes/outreach');
const { PROJECT_ADMIN_SESSION_DENY_PREFIXES } = require('../../lib/projectAdminApiAuth');

const NOW = Date.parse('2026-10-26T20:00:00Z');
const MIN = 60 * 1000;
const scope = { projectId: 'p1', userId: 'u1' };

function ok(data) { return { ok: true, status: 200, data }; }
function rows(status, n, extra = {}) { return Array.from({ length: n }, () => ({ status, ...extra })); }
function signedIn(name, minutesAgo) {
  return { state: 'signed_in', message: `Signed in to the site as "${name}".`, checkedAt: new Date(NOW - minutesAgo * MIN).toISOString(), signedInAt: null };
}

function fakeDeps(overrides = {}) {
  return {
    youtubeOutreachStore: {
      DEFAULT_ACCOUNT: 'dane_of_earth',
      getSettings: async () => ok({ browserCheck: signedIn('Dane of Earth', 4) }),
      listTargets: async () => ok([...rows('active', 2), ...rows('paused', 1)]),
    },
    youtubeOutreachCommentsStore: {
      listComments: async () => ok([...rows('draft', 1), ...rows('posted', 3)]),
    },
    substackNotesStore: {
      DEFAULT_ACCOUNT: 'dane_of_earth',
      getSettings: async () => ok({ browserCheck: { state: '', message: '', checkedAt: null, signedInAt: null } }),
      listItems: async () => ok([]),
    },
    substackMinerStore: {
      listCandidates: async () => ok([...rows('approved', 17), ...rows('candidate', 70), ...rows('rejected', 8)]),
    },
    redditCommentsStore: {
      getBrowserCheck: async () => ok(signedIn('someone', 4)),
      listItems: async () => ok([]),
    },
    canonStore: {
      listCanon: async () => ok([{ docKey: 'VOICE', syncedAt: '2026-10-12T15:00:00Z' }]),
    },
    ...overrides,
  };
}

function find(result, channel, stageKey) {
  const ch = result.channels.find((c) => c.key === channel);
  assert.ok(ch, `channel ${channel} is missing`);
  const st = ch.stages.find((s) => s.key === stageKey);
  assert.ok(st, `stage ${stageKey} is missing from ${channel}`);
  return st;
}

test('every channel has the five stages, in order, each with a known state and one next step', async () => {
  const result = await overview.buildOverview(scope, { deps: fakeDeps(), now: NOW });
  assert.deepEqual(result.channels.map((c) => c.key), ['youtube', 'substack', 'reddit']);
  for (const ch of result.channels) {
    assert.deepEqual(ch.stages.map((s) => s.key), ['connect', 'creators', 'conversations', 'replies', 'learn']);
    for (const st of ch.stages) {
      assert.ok(overview.STATES.includes(st.state), `${ch.key}/${st.key} state ${st.state}`);
      assert.ok(st.sentence && st.sentence.length > 10, `${ch.key}/${st.key} has no sentence`);
      assert.ok(st.next && st.next.label && Object.values(overview.PAGES).includes(st.next.page), `${ch.key}/${st.key} next ${JSON.stringify(st.next)}`);
    }
  }
});

test('sentences name what they count', async () => {
  const result = await overview.buildOverview(scope, { deps: fakeDeps(), now: NOW });
  const connect = find(result, 'youtube', 'connect');
  assert.equal(connect.state, 'done');
  assert.match(connect.sentence, /Dane of Earth.*checked 4 minutes ago/);

  const creators = find(result, 'substack', 'creators');
  assert.equal(creators.state, 'done');
  assert.match(creators.sentence, /17 writers approved, 70 more waiting/);
  assert.equal(creators.next.page, overview.PAGES.substackMiner);

  const conversations = find(result, 'substack', 'conversations');
  assert.equal(conversations.state, 'not_started');
  assert.equal(conversations.sentence, '17 writers approved, 0 Notes found to reply to yet.');

  const ytConv = find(result, 'youtube', 'conversations');
  assert.equal(ytConv.sentence, '3 videos added, 2 active.');

  const ytReplies = find(result, 'youtube', 'replies');
  assert.equal(ytReplies.state, 'needs_you');
  assert.match(ytReplies.sentence, /1 comment waiting for your approval, 3 comments posted/);

  const rdReplies = find(result, 'reddit', 'replies');
  assert.equal(rdReplies.state, 'not_started');
  assert.match(rdReplies.sentence, /0 drafts.*Written from 1 canon document, copied Oct 12/);
});

test('a Mini that never checked, or stopped checking, is waiting on the Mini — never done', async () => {
  const result = await overview.buildOverview(scope, { deps: fakeDeps(), now: NOW });
  const never = find(result, 'substack', 'connect');
  assert.equal(never.state, 'waiting_mini');
  assert.match(never.sentence, /never checked/);

  const stale = overview.connectStage('YouTube', signedIn('Dane of Earth', 5 * 60), { label: 'x', page: overview.PAGES.youtube }, NOW);
  assert.equal(stale.state, 'waiting_mini');
  assert.match(stale.sentence, /5 hours ago/);

  const out = overview.connectStage('YouTube', { state: 'signed_out', message: 'The browser is SIGNED OUT of YouTube.', checkedAt: new Date(NOW - MIN * 10).toISOString() }, { label: 'x', page: 'p' }, NOW);
  assert.equal(out.state, 'needs_you');
});

test('BREAK TEST: a store that throws makes ITS stage "cannot tell" with the reason, and leaves the rest alone', async () => {
  const deps = fakeDeps({
    substackMinerStore: { listCandidates: async () => { throw new Error('connection reset'); } },
  });
  const result = await overview.buildOverview(scope, { deps, now: NOW });
  const creators = find(result, 'substack', 'creators');
  assert.equal(creators.state, 'cannot_tell');
  assert.match(creators.sentence, /Cannot tell\. The Substack Miner writer list could not be read: connection reset\./);
  assert.notEqual(find(result, 'substack', 'connect').state, 'cannot_tell');
  assert.equal(find(result, 'youtube', 'connect').state, 'done');
  // The writer count is unknown, so the next stage must not invent one.
  assert.doesNotMatch(find(result, 'substack', 'conversations').sentence, /writers approved/);
});

test('a refused read ({ ok: false }) is "cannot tell" too, never done', async () => {
  const deps = fakeDeps({
    youtubeOutreachCommentsStore: { listComments: async () => ({ ok: false, status: 502, error: 'PostgREST said no' }) },
  });
  const result = await overview.buildOverview(scope, { deps, now: NOW });
  const replies = find(result, 'youtube', 'replies');
  assert.equal(replies.state, 'cannot_tell');
  assert.match(replies.sentence, /PostgREST said no/);
});

test('a channel builder that blows up blanks only that channel, every stage "cannot tell"', async () => {
  const deps = fakeDeps({ youtubeOutreachStore: null });
  const result = await overview.buildOverview(scope, { deps, now: NOW });
  const youtube = result.channels.find((c) => c.key === 'youtube');
  assert.equal(youtube.stages.length, 5);
  assert.ok(youtube.stages.every((s) => s.state === 'cannot_tell'), JSON.stringify(youtube.stages.map((s) => s.state)));
  assert.match(youtube.stages[0].sentence, /The YouTube overview could not be put together/);
  assert.equal(find(result, 'substack', 'creators').state, 'done');
});

test('replies: anything of his outranks the Mini, and the Mini outranks done', () => {
  const next = { label: 'x', page: 'p' };
  const words = { one: 'comment', many: 'comments' };
  assert.equal(overview.repliesStage({ draft: 1, posted: 4 }, 5, words, next).state, 'needs_you');
  assert.equal(overview.repliesStage({ approved: 1, posted: 4 }, 5, words, next).state, 'waiting_mini');
  assert.equal(overview.repliesStage({ posted: 4 }, 4, words, next).state, 'done');
  const rejectedOnly = overview.repliesStage({ rejected: 2 }, 2, words, next);
  assert.equal(rejectedOnly.state, 'not_started');
  assert.match(rejectedOnly.sentence, /2 rejected/);
});

test('the route answers GET only, needs a project, and is closed to a client site admin', async () => {
  assert.ok(PROJECT_ADMIN_SESSION_DENY_PREFIXES.includes('/api/outreach'));
  function fakeRes() {
    const res = { statusCode: 0, body: '', headers: {} };
    res.setHeader = (k, v) => { res.headers[k] = v; };
    res.writeHead = (s, h) => { res.statusCode = s; Object.assign(res.headers, h || {}); };
    res.end = (b) => { res.body = String(b || ''); };
    return res;
  }
  const build = async () => ({ channels: [] });
  const req = { projectContext: { project: { id: 'p1' } }, authUser: { id: 'u1' }, headers: {} };
  assert.equal(await route.handle(req, fakeRes(), '/api/engage/x', 'GET', { build }), false);

  const okRes = fakeRes();
  assert.equal(await route.handle(req, okRes, '/api/outreach/overview', 'GET', { build }), true);
  assert.equal(okRes.statusCode, 200);
  assert.deepEqual(JSON.parse(okRes.body).data, { channels: [] });

  const post = fakeRes();
  await route.handle(req, post, '/api/outreach/overview', 'POST', { build });
  assert.equal(post.statusCode, 405);

  const noProject = fakeRes();
  await route.handle({ headers: {} }, noProject, '/api/outreach/overview', 'GET', { build });
  assert.equal(noProject.statusCode, 400);
});
