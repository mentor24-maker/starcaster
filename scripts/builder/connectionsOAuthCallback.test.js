'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * The Meta callback's fork in the road. Connections 5 of 7 (86bbpz1gk).
 *
 * Round 1 of review found this file missing, and the gap was the sharp kind:
 * `completeConnectionsOAuth` and the `statedProvider !== 'facebook_page'`
 * branch it hangs off are the ONLY path that can create an Instagram
 * connection in production. `POST /api/connections/:provider/finish` cannot be
 * used for it — Meta's code is spent by the time the browser could POST it —
 * so every real Instagram connection is made here, by a redirect nobody was
 * testing. It was exercised by hand against a running server, which is not
 * coverage: it proves the code worked once, on one machine, that afternoon.
 *
 * The branch is also the guard standing in FRONT of the live Facebook Page
 * flow, which has clients on it today. So two properties are asserted, and the
 * second matters at least as much as the first:
 *
 *   1. An `instagram` state reaches the Instagram adapter, stores through the
 *      shared module, and lands the browser back on the CONNECTIONS screen.
 *   2. A `facebook_page` state — and a legacy state written before the provider
 *      field existed — still goes down the Facebook path to the APIs screen,
 *      untouched.
 *
 * Nothing reaches the network and nothing reaches a database: `fetch` is a
 * queue of canned Meta replies, and the two stores are stubs that record what
 * they were asked to write. The adapter and the route are the real ones.
 */

const enginePath = require.resolve('../../routes/engage.js');
const completeConnectionPath = require.resolve('../../lib/connections/completeConnection.js');
const legacyStorePath = require.resolve('../../lib/projectSocialCredentialsStore.js');
const connectionOpsPath = require.resolve('../../lib/connectionOpsStore.js');

const { signOAuthState, buildOAuthState } = require('../../lib/metaOAuthState.js');
const instagram = require('../../lib/connections/adapters/instagram.js');
const { readsAsClientProse, CAUSE_LIMITS } = require('../../lib/connections/clientProse.js');

const SCOPE = { projectId: 'proj_a', userId: 'user_1' };

/**
 * The signing secret has to be pinned, because `buildOAuthState` and the route
 * both read it out of the environment — and if the ambient environment carries
 * a real `FACEBOOK_APP_SECRET`, a state signed here would still verify there by
 * luck rather than by construction.
 */
const ENV = {
  FACEBOOK_APP_ID: 'app-123',
  FACEBOOK_APP_SECRET: 'secret-123',
  META_OAUTH_STATE_SECRET: 'state-secret-for-the-test',
  CONNECTIONS_OAUTH_ORIGIN: 'https://app.starcaster.pro',
};
const ENV_KEYS = [
  ...Object.keys(ENV),
  'META_APP_ID', 'META_APP_SECRET',
  'PUBLIC_APP_ORIGIN', 'APP_PUBLIC_ORIGIN', 'PUBLIC_BASE_URL', 'VERCEL_URL',
];

const PAGE_BUSINESS = {
  id: '55',
  name: 'Delray Tennis',
  access_token: 'page-token',
  instagram_business_account: {
    id: '17841400000000000',
    username: 'delraytennis',
    name: 'Delray Beach Tennis Center',
    profile_picture_url: 'https://example.test/avatar.jpg',
  },
};
const PAGE_PERSONAL = {
  id: '56',
  name: "Rich's Page",
  access_token: 'page-token-2',
  connected_instagram_account: { id: '17999999999999999', username: 'richpersonal' },
};

/** The three calls the Instagram exchange makes, in order. */
function metaReplies(pages) {
  return [
    { status: 200, body: { access_token: 'short-lived' } },
    { status: 200, body: { access_token: 'long-lived' } },
    { status: 200, body: { data: pages } },
  ];
}

/**
 * Stand the route up with both stores stubbed, the environment pinned, and
 * `fetch` answering from a queue. Returns what was written and where the
 * browser was sent.
 *
 * `completeConnection` is stubbed rather than faked over SQL because what is
 * under test here is the DISPATCH — which adapter the state chose, and whether
 * its result reached the store at all. The storing itself has its own coverage
 * in connectionsRoute.test.js over a real store on a fake database, and
 * duplicating that here would mean this test failing for reasons that have
 * nothing to do with the branch it exists to pin.
 */
async function callCallback({ state, replies = [], code = 'the-code' }) {
  const saved = process.env;
  const restoreEnv = {};
  for (const key of ENV_KEYS) {
    restoreEnv[key] = Object.prototype.hasOwnProperty.call(saved, key) ? saved[key] : undefined;
    if (Object.prototype.hasOwnProperty.call(ENV, key)) process.env[key] = ENV[key];
    else delete process.env[key];
  }

  const stored = [];
  const legacy = [];
  const realComplete = require.cache[completeConnectionPath];
  const realLegacy = require.cache[legacyStorePath];
  const realOps = require.cache[connectionOpsPath];
  const realEngage = require.cache[enginePath];
  const realFetch = global.fetch;

  const queue = [...replies];
  const fetched = [];
  global.fetch = async (url, options = {}) => {
    fetched.push(String(url));
    const next = queue.length > 1 ? queue.shift() : (queue[0] || { status: 500, body: { error: { message: 'no reply queued' } } });
    const body = typeof next.body === 'string' ? next.body : JSON.stringify(next.body ?? {});
    return { ok: next.status >= 200 && next.status < 300, status: next.status, text: async () => body };
  };

  require.cache[completeConnectionPath] = {
    id: completeConnectionPath,
    filename: completeConnectionPath,
    loaded: true,
    exports: {
      makeActive: async () => ({ ok: true, status: 200, data: {} }),
      storeAccounts: async ({ provider, accounts }) => {
        stored.push({ provider, accounts });
        return {
          ok: true,
          status: 200,
          data: {
            saved: accounts,
            activeAccountId: String(accounts?.[accounts.length - 1]?.accountId || ''),
            needsAccountChoice: (accounts || []).length > 1,
          },
        };
      },
    },
  };
  require.cache[legacyStorePath] = {
    id: legacyStorePath,
    filename: legacyStorePath,
    loaded: true,
    exports: {
      PROVIDER_FACEBOOK_PAGE: 'facebook_page',
      saveFacebookPage: async (projectId, page) => { legacy.push(page); return { ok: true, status: 200 }; },
      getFacebookPage: async () => null,
      deleteFacebookPage: async () => ({ ok: true, status: 200 }),
      publicFacebookPageSummary: () => ({ connected: false }),
    },
  };
  require.cache[connectionOpsPath] = {
    id: connectionOpsPath,
    filename: connectionOpsPath,
    loaded: true,
    exports: { updateGate: async () => ({ ok: true, status: 200 }) },
  };
  delete require.cache[enginePath];
  const route = require(enginePath);

  const urlPath = '/api/promote/social/facebook/oauth/callback';
  const query = new URLSearchParams({ code, state });
  const req = { method: 'GET', url: `${urlPath}?${query.toString()}`, headers: { host: 'localhost:3001' } };
  const written = { status: 0, location: '', ended: false };
  const res = {
    set statusCode(value) { written.status = value; },
    get statusCode() { return written.status; },
    setHeader(name, value) { if (String(name).toLowerCase() === 'location') written.location = String(value); },
    end() { written.ended = true; },
  };

  try {
    const handled = await route.handle(req, res, urlPath, 'GET');
    return { handled, ...written, stored, legacy, fetched };
  } finally {
    global.fetch = realFetch;
    if (realComplete) require.cache[completeConnectionPath] = realComplete;
    else delete require.cache[completeConnectionPath];
    if (realLegacy) require.cache[legacyStorePath] = realLegacy;
    else delete require.cache[legacyStorePath];
    if (realOps) require.cache[connectionOpsPath] = realOps;
    else delete require.cache[connectionOpsPath];
    if (realEngage) require.cache[enginePath] = realEngage;
    else delete require.cache[enginePath];
    for (const key of ENV_KEYS) {
      if (restoreEnv[key] === undefined) delete process.env[key];
      else process.env[key] = restoreEnv[key];
    }
  }
}

/** A signed state, built the way the adapter builds it. */
function stateFor(provider) {
  const previous = Object.prototype.hasOwnProperty.call(process.env, 'META_OAUTH_STATE_SECRET')
    ? process.env.META_OAUTH_STATE_SECRET : undefined;
  process.env.META_OAUTH_STATE_SECRET = ENV.META_OAUTH_STATE_SECRET;
  try {
    const res = buildOAuthState({ ...SCOPE, provider });
    assert.equal(res.ok, true, res.error);
    return res.data;
  } finally {
    if (previous === undefined) delete process.env.META_OAUTH_STATE_SECRET;
    else process.env.META_OAUTH_STATE_SECRET = previous;
  }
}

/**
 * A state from BEFORE Instagram existed — no `provider` key at all, signed by
 * hand because `buildOAuthState` cannot produce one any more. This is not a
 * hypothetical: a state is live for fifteen minutes, so a client part-way
 * through connecting when the deploy landed came back carrying exactly this.
 */
function legacyState() {
  const previous = Object.prototype.hasOwnProperty.call(process.env, 'META_OAUTH_STATE_SECRET')
    ? process.env.META_OAUTH_STATE_SECRET : undefined;
  process.env.META_OAUTH_STATE_SECRET = ENV.META_OAUTH_STATE_SECRET;
  try {
    return signOAuthState({ ...SCOPE, exp: Date.now() + 600_000, n: 'legacy' });
  } finally {
    if (previous === undefined) delete process.env.META_OAUTH_STATE_SECRET;
    else process.env.META_OAUTH_STATE_SECRET = previous;
  }
}

/**
 * The redirect's parameters. They live after the `#`, because the admin app is
 * a single page and `#page=...` is how it is navigated — so `new URL(...)
 * .searchParams` reads NOTHING here, which is the trap: a helper that quietly
 * returned an empty bag would make every assertion below pass against null.
 * `page` is one of the parameters, and the tests assert on it.
 */
function params(location) {
  return new URLSearchParams(String(location).split('#')[1] || '');
}

// ---------------------------------------------------------------------------
// 1. An instagram state reaches the Instagram adapter.
// ---------------------------------------------------------------------------

test('an instagram state is dispatched to the Instagram adapter and lands on the Connections screen', async () => {
  const res = await callCallback({ state: stateFor('instagram'), replies: metaReplies([PAGE_BUSINESS]) });

  assert.equal(res.handled, true);
  assert.equal(res.status, 302);
  const q = params(res.location);
  assert.equal(q.get('page'), 'settingsConnectionsPage',
    `a client who pressed Connect must come back to the Connections screen, not ${res.location}`);
  assert.equal(q.get('connect_oauth'), 'connected');
  assert.equal(q.get('connect_provider'), 'instagram');
  assert.equal(q.get('connect_account'), '17841400000000000',
    'the account named is the INSTAGRAM user id, not the Page id');

  // It really went through the Instagram adapter, not merely somewhere that
  // said "instagram": the Graph request carries the Instagram-only fields.
  const graph = res.fetched.find((url) => url.includes('/me/accounts'));
  assert.ok(graph, 'the adapter never asked Meta for the Pages');
  assert.ok(graph.includes('instagram_business_account'), graph);
  assert.ok(graph.includes('connected_instagram_account'), graph);

  // And it stored through the shared module, under the right provider.
  assert.equal(res.stored.length, 1);
  assert.equal(res.stored[0].provider, 'instagram');
  assert.deepEqual(res.stored[0].accounts.map((a) => a.accountLabel), ['@delraytennis']);
  assert.equal(res.legacy.length, 0, 'an Instagram grant must not touch the legacy Facebook table');
});

test('a refused Instagram account is carried back verbatim, and nothing is stored', async () => {
  // The sentence is the deliverable of the whole slice, and this is the only
  // path a client can actually receive it on. If it is ever replaced by a code
  // on the way through the redirect, this fails.
  const res = await callCallback({ state: stateFor('instagram'), replies: metaReplies([PAGE_PERSONAL]) });

  assert.equal(res.status, 302);
  assert.ok(res.location.includes('#page=settingsConnectionsPage'), res.location);

  const q = params(res.location);
  assert.equal(q.get('connect_oauth'), 'error');
  assert.equal(q.get('connect_provider'), 'instagram');
  assert.ok(q.get('connect_error').startsWith(instagram.MESSAGES.personal),
    `the adapter's own sentence must survive the redirect: ${q.get('connect_error')}`);
  assert.ok(!/OAuthException|subcode|accessToken/i.test(q.get('connect_error')),
    'Meta jargon, or ours, reached the client');

  assert.deepEqual(res.stored, [], 'a refusal must store nothing at all');
});

/**
 * The other direction, and it is the one that sent this ticket back twice.
 *
 * Round 1 of review found a raw 502 HTML page rendering on an amber card and it
 * was fixed on the STORED path. Round 2 measured the identical page arriving on
 * the CONNECT path, in a real browser, on the Facebook Page card:
 *
 *     text:  "<!DOCTYPE html>\n<html>\n<head><title>502 Bad Gateway</title>…"
 *     color: rgb(180,83,9) on rgb(254,243,199)
 *
 * because `fetchJson` falls back to the whole response body when it will not
 * parse as JSON, and nothing between there and the browser asked whether the
 * result was a sentence. The page measured 165 characters — INSIDE the limit on
 * either path — so the length half of the test would have let it through and
 * the markup half is what catches it. That is asserted below rather than
 * described, because it is the reason both halves exist.
 */
test('a gateway error page never reaches the client — the generic line goes instead', async () => {
  const gatewayPage = '<!DOCTYPE html>\n<html>\n<head><title>502 Bad Gateway</title></head>\n'
    + '<body>\n<center><h1>502 Bad Gateway</h1></center>\n<hr><center>nginx/1.18.0</center>\n'
    + '</body>\n</html>';
  assert.ok(gatewayPage.length < CAUSE_LIMITS.connect,
    'the fixture has to be SHORT, or this passes for the wrong reason — length, not markup');

  const res = await callCallback({
    state: stateFor('instagram'),
    replies: [{ status: 502, body: gatewayPage }],
  });

  assert.equal(res.status, 302);
  assert.ok(res.location.includes('#page=settingsConnectionsPage'), res.location);

  const q = params(res.location);
  assert.equal(q.get('connect_oauth'), 'error');
  const shown = q.get('connect_error') || '';
  assert.ok(!/<[a-zA-Z!/]/.test(shown), `markup reached the client: ${shown}`);
  assert.ok(!/502|nginx|Bad Gateway|DOCTYPE/i.test(shown),
    `the gateway's own page reached the client: ${shown}`);
  assert.equal(shown, 'Instagram refused the connection',
    'the fallback names the platform the client pressed Connect on');

  // The URL itself, not only the parsed value — the gate is at the producer
  // precisely so the page never enters the address bar or a redirect log.
  assert.ok(!res.location.includes('DOCTYPE'), 'the page travelled in the URL');

  assert.deepEqual(res.stored, [], 'a refusal must store nothing at all');
});

/**
 * Round 3 of review: the limit that closed round 2 was measured on the WRONG PATH.
 *
 * Round 2 fixed the gateway page by putting `readsAsClientProse` in front of
 * every `connect_error`. The predicate it reused carried one length limit, 300,
 * and that 300 was honestly measured — against the verify SWEEP's longest
 * sentence (189 characters). Nobody re-measured it against the CONNECT path,
 * where `instagram.js` composes a fixed message and then appends the client's
 * OWN account and Page names to it. Ordinary names push it past 300, so the
 * sentence the whole slice exists to deliver was replaced by "Instagram refused
 * the connection" — acceptance criterion 5 broken by the fix for criterion 5.
 *
 * Every case below is driven through the real callback route, and every fixture
 * uses a real client's names at ordinary length rather than the short ones the
 * older tests happen to use ("@richpersonal" on "Rich's Page" composes to 261
 * and squeaks under 300, which is exactly why nothing caught this).
 *
 * Each asserts TWO things, and the first is what makes the test able to fail:
 * that the composed sentence really is longer than the old shared limit, and
 * that it survives to the client verbatim anyway.
 */
const OLD_SHARED_LIMIT = 300;

/** A real client's names, at the length real names run to. */
const REAL_HANDLE = 'delraybeachtennisctr';                                  // 20 chars
const REAL_PAGE = 'Delray Beach Tennis Center & Swim and Racquet Club';      // 49 chars
const OTHER_PAGE = 'Brandon Marinoff Photography';

test('an ordinary Instagram refusal reaches the client whole — it is longer than the sweep ever composes', async () => {
  const cases = [
    {
      what: 'a personal account, named with the Page it hangs off',
      pages: [{
        id: '90',
        name: REAL_PAGE,
        access_token: 'page-token',
        connected_instagram_account: { id: '17900000000000001', username: REAL_HANDLE },
      }],
      expected: `${instagram.MESSAGES.personal} The account we found is `
        + `@${REAL_HANDLE} on your Page "${REAL_PAGE}".`,
      // The one sentence routes/engage.js calls the point of the slice: it names
      // the account type as the thing to change, in the Instagram app.
      mustSay: /Settings, Account type and tools/,
    },
    {
      what: 'no Page linked, listing the Pages we looked at',
      pages: [
        { id: '91', name: REAL_PAGE, access_token: 'page-token' },
        { id: '92', name: OTHER_PAGE, access_token: 'page-token-2' },
      ],
      expected: `${instagram.MESSAGES.notLinked} We looked at your Pages `
        + `"${REAL_PAGE}", "${OTHER_PAGE}".`,
      mustSay: /Sharing to other apps/,
    },
    {
      // Worse than either of the two above and missed by round 3's own report:
      // noPageToken is 281 characters BEFORE the locator, so it went over 300
      // for every client whose Page has a name at all — even a one-letter one.
      what: 'a Page whose permission is missing, named',
      pages: [{
        id: '',
        name: REAL_PAGE,
        access_token: '',
        instagram_business_account: { id: '17841400000000009', username: 'delraytennis' },
      }],
      expected: `${instagram.MESSAGES.noPageToken} The Page we found is "${REAL_PAGE}".`,
      mustSay: /leave every Facebook Page permission ticked/,
    },
  ];

  for (const c of cases) {
    assert.ok(
      c.expected.length > OLD_SHARED_LIMIT,
      `${c.what}: the fixture must exceed the old shared limit or this test cannot fail `
      + `(${c.expected.length} chars)`
    );
    assert.ok(
      c.expected.length <= CAUSE_LIMITS.connect,
      `${c.what}: ${c.expected.length} chars is over the connect limit — re-measure it`
    );

    const res = await callCallback({
      state: stateFor('instagram'),
      replies: metaReplies(c.pages),
    });

    assert.equal(res.status, 302, c.what);
    const q = params(res.location);
    assert.equal(q.get('connect_oauth'), 'error', c.what);

    const shown = q.get('connect_error') || '';
    assert.equal(shown, c.expected, `${c.what}: the adapter's own sentence must arrive whole`);
    assert.notEqual(
      shown,
      'Instagram refused the connection',
      `${c.what}: the generic fallback replaced the sentence — the limit is measured on the wrong path`
    );
    assert.match(shown, c.mustSay, `${c.what}: the actionable half was lost`);

    // Still a refusal, and still not a failure: nothing is stored, so the card
    // stays not-connected with Connect offered.
    assert.deepEqual(res.stored, [], `${c.what}: a refusal must store nothing at all`);
  }
});

/**
 * The connect path's limit is a decision with a stated worst case, not a sample.
 *
 * Round 3 asked for the worst case to be recorded the way the sweep's 189 is.
 * `instagram.js` notLinked has no fixed ceiling — it lists EVERY Page a client
 * manages — so what is pinned here is the stated design ceiling and what it
 * buys, in the same shape as the comment in lib/connections/clientProse.js.
 * If someone lowers `connect` towards the old 300, this says which real
 * sentences that would start dropping.
 */
test('the connect limit clears what the adapters can actually compose', () => {
  const bounded = [
    // The longest sentence with a FIXED ceiling anywhere on the connect path.
    ['x.js notConfigured', 470],
    ['instagram noPageToken + a 75-char Page name', 381],
    ['instagram personal + a 30-char handle and a 75-char Page', 343],
  ];
  for (const [what, measured] of bounded) {
    assert.ok(
      CAUSE_LIMITS.connect >= measured,
      `${what} composes to ${measured} and the connect limit is ${CAUSE_LIMITS.connect}`
    );
  }

  // The unbounded branch, stated rather than proved: notLinked grows 79
  // characters per Page at Facebook's 75-character name limit.
  const notLinkedAt = (pageCount, nameLength) => {
    const names = Array.from({ length: pageCount }, () => 'p'.repeat(nameLength));
    const where = ` We looked at ${pageCount === 1 ? 'your Page' : 'your Pages'} `
      + `${names.map((n) => `"${n}"`).join(', ')}.`;
    return `${instagram.MESSAGES.notLinked}${where}`.length;
  };
  assert.equal(notLinkedAt(9, 75), 958, 'nine Pages at Facebook maximum');
  assert.ok(readsAsClientProse('a'.repeat(notLinkedAt(9, 75)), 'connect'),
    'nine Pages at Facebook maximum must still reach the client');
  assert.equal(notLinkedAt(10, 75), 1037, 'ten Pages at Facebook maximum');
  assert.ok(!readsAsClientProse('a'.repeat(notLinkedAt(10, 75)), 'connect'),
    'past the stated ceiling it falls back — documented, not silent');
  assert.ok(readsAsClientProse('a'.repeat(notLinkedAt(20, 25)), 'connect'),
    'twenty Pages at a realistic name length is well inside it');

  // The sweep's own limit did not move: nothing about that path changed, and
  // widening it would weaken a backstop nothing needed widened.
  assert.equal(CAUSE_LIMITS.stored, 300, 'the sweep path was re-measured by nobody, so it holds');
});

/**
 * The limit cannot be inherited by accident again.
 *
 * This is the structural half of round 3's fix. The defect was not that 300 was
 * small; it was that a value measured for one path silently applied to another.
 * A default parameter would be that same mistake written as a language feature,
 * so there is none — a caller that does not name its path gets a loud throw on
 * the first run rather than a quietly wrong limit in front of a client.
 */
test('a caller must say which path it is on — no limit is inherited by default', () => {
  assert.throws(() => readsAsClientProse('an ordinary sentence'), /which path it is on/,
    'a missing path fell back to a limit instead of refusing');
  assert.throws(() => readsAsClientProse('an ordinary sentence', 'sweep'), /which path it is on/,
    'a misspelled path fell back to a limit instead of refusing');

  // And the two paths really are different numbers, or none of the above bites.
  assert.notEqual(CAUSE_LIMITS.connect, CAUSE_LIMITS.stored,
    'the two paths share one number again — round 3 is back');
  const betweenTheTwo = 'a'.repeat(CAUSE_LIMITS.stored + 1);
  assert.equal(readsAsClientProse(betweenTheTwo, 'stored'), false);
  assert.equal(readsAsClientProse(betweenTheTwo, 'connect'), true);
});

/**
 * The predicate is ONE definition, not two that agree today.
 *
 * The rule was written inside routes/connections.js for round 1 and the second
 * caller needed it for round 2. A copy would pass every test in the repo on the
 * day it was made and drift the first time either side was tuned — which is the
 * shape of the original defect, one path fixed and one not. This pins that both
 * callers hold the same function object.
 */
test('both halves of the slice share one fitness test, not a copy of it', () => {
  const route = require('../../routes/connections.js');
  assert.equal(route.readsAsClientProse, readsAsClientProse,
    'routes/connections.js has its own copy of the predicate again');
  assert.equal(route.CAUSE_LIMITS, CAUSE_LIMITS,
    'the two halves disagree about how long a sentence may be');
});

// ---------------------------------------------------------------------------
// 2. The live Facebook Page flow is untouched — the half that has clients on it.
// ---------------------------------------------------------------------------

test('a facebook_page state still goes down the Facebook path, to the APIs screen', async () => {
  const res = await callCallback({
    state: stateFor('facebook_page'),
    replies: [{ status: 200, body: { access_token: 'short-lived' } },
      { status: 200, body: { access_token: 'long-lived' } },
      { status: 200, body: { data: [{ id: '55', name: 'Delray Tennis', access_token: 'page-token' }] } }],
  });

  assert.equal(res.handled, true);
  assert.ok(res.location.includes('#page=settingsApisPage'),
    `the operator's Facebook flow returns to the APIs screen, not ${res.location}`);
  assert.ok(!res.location.includes('settingsConnectionsPage'));
  assert.equal(res.stored.length, 0, 'the Facebook flow must not route through the Connections store');
  assert.deepEqual(res.legacy.map((p) => p.pageId), ['55'],
    'it wrote the Page to the legacy table, which is what that flow does');
});

test('a state written before the provider field existed is still treated as Facebook', async () => {
  const res = await callCallback({
    state: legacyState(),
    replies: [{ status: 200, body: { access_token: 'short-lived' } },
      { status: 200, body: { access_token: 'long-lived' } },
      { status: 200, body: { data: [{ id: '55', name: 'Delray Tennis', access_token: 'page-token' }] } }],
  });

  assert.ok(res.location.includes('#page=settingsApisPage'),
    `a client mid-connect when the deploy landed must not be stranded: ${res.location}`);
  assert.equal(res.stored.length, 0);
  assert.deepEqual(res.legacy.map((p) => p.pageId), ['55']);
});

// ---------------------------------------------------------------------------
// 3. The branch cannot be steered from outside the signature.
// ---------------------------------------------------------------------------

test('the provider comes from the SIGNED state, not from a query parameter', async () => {
  // The whole reason the provider lives in the state: a query parameter would
  // let a caller point one Meta grant at whichever adapter it fancied.
  const state = stateFor('facebook_page');
  const res = await callCallback({
    state: `${state}&provider=instagram`,
    replies: metaReplies([PAGE_BUSINESS]),
  });

  // A tampered state does not verify at all, which is the correct answer.
  assert.ok(res.location.includes('#page=settingsApisPage'), res.location);
  assert.match(res.location, /fb_oauth=error/);
  assert.equal(res.stored.length, 0);
  assert.equal(res.legacy.length, 0);
});
