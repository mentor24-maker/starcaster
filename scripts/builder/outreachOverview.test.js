'use strict';

// Outreach wizard 1/19 (task 86bcrmb8x): GET /api/outreach/overview.
// Fake stores stand in for the database so every stage's sentence can be
// checked against known counts, and so any ONE store can be made to throw.

const test = require('node:test');
const assert = require('node:assert/strict');
const overview = require('../../lib/outreachOverview');
const route = require('../../routes/outreach');
const accounts = require('../../lib/outreachAccounts');
const { PROJECT_ADMIN_SESSION_DENY_PREFIXES } = require('../../lib/projectAdminApiAuth');

const NOW = Date.parse('2026-10-26T20:00:00Z');
const MIN = 60 * 1000;
const scope = { projectId: 'p1', userId: 'u1' };

function ok(data) { return { ok: true, status: 200, data }; }
function rows(status, n, extra = {}) { return Array.from({ length: n }, () => ({ status, ...extra })); }
function signedIn(name, minutesAgo) {
  return { state: 'signed_in', message: `Signed in to the site as "${name}".`, checkedAt: new Date(NOW - minutesAgo * MIN).toISOString(), signedInAt: null };
}

const ACCOUNTS = {
  youtube: { expected_account: 'Dane of Earth', browser_account: 'Dane of Earth' },
  substack: { expected_account: 'Dane of Earth', browser_account: '' },
  reddit: { expected_account: '', browser_account: 'Exotic-Break-7850' },
};
function account(site, row) {
  return accounts.rowToAccount(site, row);
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
    youtubeCreatorsStore: {
      listCreators: async () => ok([...rows('approved', 3), ...rows('candidate', 4), ...rows('candidate', 2, { suggestion: { action: 'approved' } }), ...rows('rejected', 1)]),
    },
    // Outreach wizard 16/19: five comments worth replying to across two videos.
    youtubeConversations: {
      listYoutubeConversations: async () => ok({
        videos: [{ comments: [{}, {}, {}] }, { comments: [{}, {}] }, { comments: [] }],
        newCount: 5,
        reading: { state: 'current', sentence: 'All 3 approved channels were read in the last 12 hours.' },
      }),
    },
    redditCommentsStore: {
      getBrowserCheck: async () => ok(signedIn('someone', 4)),
      listItems: async () => ok([]),
    },
    canonStore: {
      listCanon: async () => ok([{ docKey: 'VOICE', syncedAt: '2026-10-12T15:00:00Z' }]),
    },
    // Outreach wizard 2/19: YouTube and Substack have a chosen account;
    // Reddit has none yet, and the Mini has seen who it is signed in as.
    outreachAccounts: {
      getAccount: async (site) => ok(account(site, ACCOUNTS[site])),
    },
    // Outreach wizard 13/19: two lessons on and one off on every channel.
    outreachLessons: {
      REFRESH_EVERY: 5,
      learnView: async (channel) => ok({
        channel,
        lessons: [{ enabled: true }, { enabled: true }, { enabled: false }],
        score: { unedited: 6, counted: 20, window: 20, sentence: 'Approved without edits, last 20: 6 of 20.' },
        scoreError: '',
      }),
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
      // A stage worked on this screen says so (Learn's controls are on the wizard
      // itself, 13/19); every other one names the screen to open.
      if (st.inline || st.key === 'learn') assert.equal(st.next, null, `${ch.key}/${st.key} is worked here but names a screen ${JSON.stringify(st.next)}`);
      else assert.ok(st.next && st.next.label && Object.values(overview.PAGES).includes(st.next.page), `${ch.key}/${st.key} next ${JSON.stringify(st.next)}`);
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
  assert.equal(ytConv.state, 'needs_you');
  assert.equal(ytConv.sentence, '5 comments worth replying to on 2 videos, best first.');
  assert.equal(ytConv.inline, true);

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

  const stale = overview.connectStage('YouTube', signedIn('Dane of Earth', 8 * 60), { label: 'x', page: overview.PAGES.youtube }, NOW);
  assert.equal(stale.state, 'waiting_mini');
  assert.match(stale.sentence, /8 hours ago/);

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

// ── Outreach wizard 2/19 (86bcrmba0): which account each channel posts as ──

test('CONNECT ASKS THE ACCOUNT FIRST: with none chosen it is Dane\'s, names who the Mini sees, and says nothing posts', async () => {
  const result = await overview.buildOverview(scope, { deps: fakeDeps(), now: NOW });
  const reddit = find(result, 'reddit', 'connect');
  assert.equal(reddit.state, 'needs_you');
  assert.equal(reddit.sentence, 'The Mini is signed in to Reddit as Exotic-Break-7850. Choose the account to post as — nothing posts on Reddit until you do.');
  const ch = result.channels.find((c) => c.key === 'reddit');
  assert.equal(ch.account.observedAccount, 'Exotic-Break-7850');
  assert.equal(ch.account.expectedAccount, '');
  assert.deepEqual(ch.account.pace, { maxCommentsPerDay: 3, minMinutesBetween: 20 });
  // Even a signed-in browser does not make Connect done without a choice.
  const deps = fakeDeps({ outreachAccounts: { getAccount: async (site) => ok(account(site, { browser_account: '' })) } });
  const yt = find(await overview.buildOverview(scope, { deps, now: NOW }), 'youtube', 'connect');
  assert.equal(yt.state, 'needs_you');
  assert.match(yt.sentence, /has not yet read which account.*Choose the account to post as/);
});

test('an account read that fails makes Connect "cannot tell", never done', async () => {
  const deps = fakeDeps({ outreachAccounts: { getAccount: async () => ({ ok: false, status: 502, error: 'no row for you' }) } });
  const result = await overview.buildOverview(scope, { deps, now: NOW });
  const yt = find(result, 'youtube', 'connect');
  assert.equal(yt.state, 'cannot_tell');
  assert.match(yt.sentence, /The YouTube account to post as could not be read: no row for you/);
});

test('the account routes: choose, check now and Reddit pace reach the store with the request\'s scope', async () => {
  const seen = [];
  const fake = {
    SITES: accounts.SITES,
    chooseAccount: async (site, name, sc) => { seen.push(['choose', site, name, sc]); return ok({}); },
    requestCheck: async (site, sc) => { seen.push(['check', site, sc]); return ok({}); },
    saveRedditPace: async (body, sc) => { seen.push(['pace', body, sc]); return ok({}); },
  };
  function fakeRes() {
    const res = { statusCode: 0, body: '', headers: {} };
    res.setHeader = (k, v) => { res.headers[k] = v; };
    res.writeHead = (st, h) => { res.statusCode = st; Object.assign(res.headers, h || {}); };
    res.end = (b) => { res.body = String(b || ''); };
    return res;
  }
  const { Readable } = require('node:stream');
  function req(body) {
    const r = Readable.from([Buffer.from(JSON.stringify(body || {}))]);
    Object.assign(r, { projectContext: { project: { id: 'p1' } }, authUser: { id: 'u1' }, headers: { 'content-type': 'application/json' } });
    return r;
  }
  const r1 = fakeRes();
  await route.handle(req({ account: 'Dane Christensen' }), r1, '/api/outreach/accounts/substack/choose', 'POST', { accounts: fake });
  assert.equal(r1.statusCode, 200, r1.body);
  const r2 = fakeRes();
  await route.handle(req(), r2, '/api/outreach/accounts/reddit/check', 'POST', { accounts: fake });
  assert.equal(r2.statusCode, 200, r2.body);
  const r3 = fakeRes();
  await route.handle(req({ maxCommentsPerDay: 4 }), r3, '/api/outreach/accounts/reddit/pace', 'POST', { accounts: fake });
  assert.equal(r3.statusCode, 200, r3.body);
  assert.deepEqual(seen, [
    ['choose', 'substack', 'Dane Christensen', scope],
    ['check', 'reddit', scope],
    ['pace', { maxCommentsPerDay: 4 }, scope],
  ]);
  // Pace is Reddit's alone; an unknown site is not an endpoint; GET is refused.
  const r4 = fakeRes();
  await route.handle(req(), r4, '/api/outreach/accounts/youtube/pace', 'POST', { accounts: fake });
  assert.equal(r4.statusCode, 404);
  const r5 = fakeRes();
  await route.handle(req(), r5, '/api/outreach/accounts/myspace/choose', 'POST', { accounts: fake });
  assert.equal(r5.statusCode, 404);
  const r6 = fakeRes();
  await route.handle(req(), r6, '/api/outreach/accounts/reddit/check', 'GET', { accounts: fake });
  assert.equal(r6.statusCode, 405);
});

test('YouTube Find creators counts the channel list, and is worked on this screen (Outreach wizard 15/19)', async () => {
  const result = await overview.buildOverview(scope, { deps: fakeDeps(), now: NOW });
  const creators = find(result, 'youtube', 'creators');
  assert.equal(creators.state, 'needs_you');
  assert.equal(creators.inline, true);
  assert.equal(creators.next, null);
  assert.match(creators.sentence, /6 channels waiting for your decision \(2 with a suggestion\); 3 approved, 1 rejected\./);

  assert.equal(overview.youtubeCreatorsStage([]).state, 'not_started');
  assert.equal(overview.youtubeCreatorsStage(rows('approved', 2)).state, 'done');
  assert.equal(overview.youtubeCreatorsStage(rows('rejected', 2)).state, 'needs_you', 'all rejected is not done');

  const broken = await overview.buildOverview(scope, {
    deps: fakeDeps({ youtubeCreatorsStore: { listCreators: async () => ({ ok: false, status: 503, error: 'The youtube_creators table is not available' }) } }),
    now: NOW,
  });
  const unknown = find(broken, 'youtube', 'creators');
  assert.equal(unknown.state, 'cannot_tell', 'a failed read is never drawn as not started');
  assert.match(unknown.sentence, /Cannot tell\. The YouTube creator list could not be read: The youtube_creators table is not available\./);
});

// ── Outreach wizard 13/19 (86bcrmbpm): the Learn stage ─────────────────────

function learnWith(view) {
  return fakeDeps({ outreachLessons: { REFRESH_EVERY: 5, learnView: async (channel) => view(channel) } });
}

test('Learn: lessons on is done, and says how many are on, how many are off, and the score', async () => {
  const result = await overview.buildOverview(scope, { deps: fakeDeps(), now: NOW });
  const learn = find(result, 'reddit', 'learn');
  assert.equal(learn.state, 'done');
  assert.equal(learn.sentence, 'Drafts are written with 2 lessons (1 switched off). Approved without edits, last 20: 6 of 20.');
});

test('Learn: no lessons and fewer than five decisions is not started, naming the count', async () => {
  const deps = learnWith(() => ok({ lessons: [], score: { unedited: 1, counted: 3, window: 20, sentence: 'x' }, scoreError: '' }));
  const learn = find(await overview.buildOverview(scope, { deps, now: NOW }), 'youtube', 'learn');
  assert.equal(learn.state, 'not_started');
  assert.match(learn.sentence, /No lessons yet\. 3 decisions recorded; lessons are suggested after every 5/);
});

test('Learn: decisions enough to learn from and no lesson on needs Dane, and names the off ones', async () => {
  const deps = learnWith(() => ok({
    lessons: [{ enabled: false }],
    score: { unedited: 2, counted: 9, window: 20, sentence: 'Approved without edits, last 9 (all there are so far): 2 of 9.' },
    scoreError: '',
  }));
  const learn = find(await overview.buildOverview(scope, { deps, now: NOW }), 'substack', 'learn');
  assert.equal(learn.state, 'needs_you');
  assert.match(learn.sentence, /No lessons are on\. 1 lesson is switched off\. Approved without edits, last 9 \(all there are so far\): 2 of 9\. Click Refresh lessons/);
});

test('Learn: lessons that cannot be read are Cannot tell, never done', async () => {
  const deps = learnWith(() => ({ ok: false, status: 500, error: 'relation outreach_lessons does not exist — run docs/SQL/outreach_lessons_setup.sql' }));
  const learn = find(await overview.buildOverview(scope, { deps, now: NOW }), 'reddit', 'learn');
  assert.equal(learn.state, 'cannot_tell');
  assert.match(learn.sentence, /^Cannot tell\. The lessons could not be read: .*outreach_lessons_setup\.sql/);
});
