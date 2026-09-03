'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

/**
 * Connections 7 of 7 (86bbpz1hu) — X, per-user posting.
 *
 * The adapter conformance sweep (connectionsAdapterContract.test.js) already
 * proves X exports the six, answers in the envelope, and refuses empty input
 * without dialling out. None of that is repeated here.
 *
 * What IS here is the substance of the slice, which is three things that can
 * each fail silently:
 *
 *   1. PKCE with nowhere to keep the verifier. The challenge sent to X and the
 *      verifier produced a browser round trip later must match, and NOTHING in
 *      the flow can check that for us — X answers a mismatch with
 *      `invalid_grant`, which names none of it. So the round trip is asserted
 *      directly, end to end, from the authorize URL to the exchange.
 *   2. The two schemes must never MIX. Starcaster posts to X over OAuth 1.0a
 *      with Dane's own account; a client posts over OAuth 2.0 with a bearer
 *      token. A client's token completed from Alphire's OAuth 1.0a secret is a
 *      signature belonging to nobody, and X answers it with a 401 naming
 *      neither account — a failure that reads exactly like a bad credential.
 *   3. A grant with no refresh token. X access tokens last about two hours, so
 *      one stored without a refresh token works for an afternoon and is then
 *      dead. That is the failure that looks most like success at the moment it
 *      is made.
 *
 * Nothing reaches the network. Every call is either given a stubbed `fetch` or
 * refuses before making a request.
 */

const path = require('node:path');

const contract = require('../../lib/connections/contract.js');
const registry = require('../../lib/connections/registry.js');
const x = require('../../lib/connections/adapters/x.js');
const verifySweep = require('../../lib/connections/verifySweep.js');
const xClient = require('../../lib/xClient.js');
const { verifyOAuthState } = require('../../lib/metaOAuthState.js');

const { parseSchemaFile, createFakeDb } = require('./sqlSchemaFake.js');

const CONNECTIONS_SQL = path.join(__dirname, '..', '..', 'docs', 'SQL', 'project_connections_setup.sql');
const supabasePath = require.resolve('../../lib/supabase.js');
const projectScopePath = require.resolve('../../lib/projectScope.js');
const storePath = require.resolve('../../lib/projectConnectionsStore.js');
const completeConnectionPath = require.resolve('../../lib/connections/completeConnection.js');

const STORE_SCOPE = { projectId: 'proj_a', userId: 'user_1' };
/** A valid AES-256 key: 32 bytes, base64, the shape channelsCipher demands. */
const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

const APP_ENV = {
  X_CLIENT_ID: 'x-client-id',
  X_CLIENT_SECRET: 'x-client-secret',
  META_OAUTH_STATE_SECRET: 'state-secret-for-tests',
  CONNECTIONS_OAUTH_ORIGIN: 'https://starcaster.pro',
};

const ENV_KEYS = [
  'X_CLIENT_ID', 'X_CLIENT_SECRET', 'X_OAUTH_CLIENT_ID', 'X_OAUTH_CLIENT_SECRET',
  'META_OAUTH_STATE_SECRET', 'FACEBOOK_APP_SECRET', 'META_APP_SECRET', 'CHANNELS_ENCRYPTION_KEY',
  'CONNECTIONS_OAUTH_ORIGIN', 'PUBLIC_APP_ORIGIN', 'APP_PUBLIC_ORIGIN', 'PUBLIC_BASE_URL', 'VERCEL_URL',
];

/**
 * Run `fn` with exactly these env vars set. Awaits an async body before
 * restoring — a plain try/finally restores at the first `await`, which makes an
 * async test assert against the ambient environment while reading as though it
 * had pinned one.
 */
function withEnv(values, fn) {
  const saved = new Map();
  const keys = new Set([...ENV_KEYS, ...Object.keys(values)]);
  for (const key of keys) {
    saved.set(key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined);
    if (Object.prototype.hasOwnProperty.call(values, key)) process.env[key] = values[key];
    else delete process.env[key];
  }
  const restore = () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    const out = fn();
    if (out && typeof out.then === 'function') {
      return out.then((r) => { restore(); return r; }, (e) => { restore(); throw e; });
    }
    restore();
    return out;
  } catch (err) {
    restore();
    throw err;
  }
}

/** Swap global.fetch for a queue of canned replies, and record every request. */
function withFetch(replies, fn) {
  const calls = [];
  const queue = Array.isArray(replies) ? [...replies] : [replies];
  const realFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      method: options.method || 'GET',
      headers: options.headers || {},
      body: typeof options.body === 'string' ? options.body : '',
    });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      statusText: next.statusText || '',
      json: async () => next.body,
    };
  };
  const done = (r) => { global.fetch = realFetch; return r; };
  try {
    const out = fn(calls);
    if (out && typeof out.then === 'function') return out.then(done, (e) => { global.fetch = realFetch; throw e; });
    return done(out);
  } catch (err) {
    global.fetch = realFetch;
    throw err;
  }
}

/**
 * The real store, over the real `project_connections` schema, on a fake
 * database — and `completeConnection` re-required so it holds THIS store.
 *
 * A stub store cannot see the defect these tests exist for. The field that went
 * missing did so between the account shape and the row, so anything that skips
 * the actual column list agrees with whatever it is handed. `sqlSchemaFake`
 * parses docs/SQL and refuses a field the table does not have, which makes the
 * round trip a real one.
 *
 * `completeConnection` has to be re-required with the store because it captured
 * its own reference at load — the same stale-require trap connectionsRoute's
 * harness documents, which reads as "Connection not found" on a row the test
 * just wrote.
 */
function withStore() {
  const schema = parseSchemaFile(CONNECTIONS_SQL);
  const db = createFakeDb(schema);
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({ projectConnections: 'project_connections' }),
    sbQuery: async (args) => db.sbQuery(args),
  };

  const realSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase,
  };
  // projectScope destructures sbQuery at load and caches its per-table column
  // probe, so it goes too or it answers from whatever ran last.
  delete require.cache[projectScopePath];
  delete require.cache[storePath];
  delete require.cache[completeConnectionPath];

  const store = require(storePath);
  const completeConnection = require(completeConnectionPath);

  const hadKey = Object.prototype.hasOwnProperty.call(process.env, 'CHANNELS_ENCRYPTION_KEY');
  const previousKey = process.env.CHANNELS_ENCRYPTION_KEY;
  process.env.CHANNELS_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;

  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    delete require.cache[projectScopePath];
    delete require.cache[storePath];
    delete require.cache[completeConnectionPath];
    if (hadKey) process.env.CHANNELS_ENCRYPTION_KEY = previousKey;
    else delete process.env.CHANNELS_ENCRYPTION_KEY;
  }

  return { db, store, completeConnection, restore };
}

const TOKENS = {
  access_token: 'CLIENT_BEARER_TOKEN',
  refresh_token: 'CLIENT_REFRESH_TOKEN',
  expires_in: 7200,
  scope: 'tweet.read tweet.write users.read media.write offline.access',
};

const ME = { data: { id: '4455', username: 'delraytennis', name: 'Delray Tennis', profile_image_url: 'https://x/a.jpg' } };

// ---------------------------------------------------------------------------
// 1. PKCE — the round trip nothing else can check
// ---------------------------------------------------------------------------

/**
 * THE test of this slice.
 *
 * It walks the real flow: build the authorize URL, take the state out of it
 * exactly as X will hand it back, and complete the exchange from that state
 * alone. Then it asserts the `code_verifier` the token request actually sent
 * hashes to the `code_challenge` the authorize URL actually showed.
 *
 * Asserting the two functions agree with each other would prove nothing — they
 * are one HMAC apart and would agree whatever the flow did with them. What can
 * really go wrong is the flow: a nonce generated twice, a state rebuilt on the
 * way back, a challenge computed from something other than the verifier. All of
 * those pass a unit test of the pair and fail here.
 */
test('PKCE: the verifier sent at the exchange hashes to the challenge shown at authorize', async () => {
  await withEnv(APP_ENV, async () => {
    const started = x.authorizeUrl({ projectId: 'proj-a', userId: 'user-1' });
    assert.equal(started.ok, true, started.error);

    const authUrl = new URL(started.data.url);
    const challenge = authUrl.searchParams.get('code_challenge');
    const state = authUrl.searchParams.get('state');
    assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(challenge, 'no code_challenge was sent to X');

    const verified = verifyOAuthState(state);
    assert.equal(verified.ok, true, 'the state X will hand back does not verify');

    await withFetch([{ status: 200, body: TOKENS }, { status: 200, body: ME }], async (calls) => {
      const res = await x.exchange({ code: 'the-code', state });
      assert.equal(res.ok, true, res.error);

      const sentVerifier = new URLSearchParams(calls[0].body).get('code_verifier');
      assert.ok(sentVerifier, 'the token request carried no code_verifier');
      assert.equal(
        crypto.createHash('sha256').update(sentVerifier).digest('base64url'),
        challenge,
        'the verifier sent at the exchange does not hash to the challenge shown at authorize — '
        + 'X answers this with `invalid_grant` and names none of it'
      );
    });
  });
});

test('PKCE: the verifier itself never travels — only its hash reaches X', async () => {
  await withEnv(APP_ENV, async () => {
    const started = x.authorizeUrl({ projectId: 'proj-a', userId: 'user-1' });
    const authUrl = new URL(started.data.url);
    const state = authUrl.searchParams.get('state');
    const verifier = x.pkceVerifier(verifyOAuthState(state).data.nonce);

    assert.ok(verifier, 'no verifier could be derived from the state');
    assert.doesNotMatch(started.data.url, new RegExp(verifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      'the PKCE verifier appears in the URL the browser carries to X');
    // The state is signed, not encrypted — anyone can read its payload — so the
    // verifier must not be recoverable from it either.
    const payload = Buffer.from(state.split('.')[0], 'base64url').toString('utf8');
    assert.doesNotMatch(payload, new RegExp(verifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      'the PKCE verifier is readable inside the signed state');
  });
});

test('PKCE: a fresh verifier per attempt, and none of them is guessable without the secret', async () => {
  await withEnv(APP_ENV, () => {
    const a = new URL(x.authorizeUrl({ projectId: 'p', userId: 'u' }).data.url);
    const b = new URL(x.authorizeUrl({ projectId: 'p', userId: 'u' }).data.url);
    assert.notEqual(a.searchParams.get('code_challenge'), b.searchParams.get('code_challenge'),
      'two sign-in attempts reused one PKCE challenge');

    const nonce = verifyOAuthState(a.searchParams.get('state')).data.nonce;
    const mine = x.pkceVerifier(nonce);
    // Same nonce, different signing secret → a different verifier. This is what
    // makes deriving-rather-than-storing safe: the nonce is public, the secret
    // is not.
    const theirs = withEnv({ ...APP_ENV, META_OAUTH_STATE_SECRET: 'a-different-secret' }, () => x.pkceVerifier(nonce));
    assert.notEqual(mine, theirs);
    assert.ok(mine.length >= 43 && mine.length <= 128, 'the verifier is outside RFC 7636\'s length range');
  });
});

test('a sign-in that lost its state is refused, not completed with a blank verifier', async () => {
  await withEnv(APP_ENV, async () => {
    const res = await x.exchange({ code: 'the-code' });
    assert.equal(res.ok, false);
    assert.match(res.error, /start connecting x again/i);
  });
});

// ---------------------------------------------------------------------------
// 2. offline.access — the connection that works for one afternoon
// ---------------------------------------------------------------------------

test('offline.access is requested, because without it X issues no refresh token', () => {
  assert.ok(x.DEFAULT_SCOPES.includes('offline.access'));
  withEnv(APP_ENV, () => {
    const url = new URL(x.authorizeUrl({ projectId: 'p', userId: 'u' }).data.url);
    assert.match(url.searchParams.get('scope'), /offline\.access/);
    assert.match(url.searchParams.get('scope'), /tweet\.write/);
  });
});

test('a grant with no refresh token is REFUSED rather than stored', async () => {
  await withEnv(APP_ENV, async () => {
    const started = x.authorizeUrl({ projectId: 'p', userId: 'u' });
    const state = new URL(started.data.url).searchParams.get('state');
    const noRefresh = { ...TOKENS };
    delete noRefresh.refresh_token;

    await withFetch([{ status: 200, body: noRefresh }, { status: 200, body: ME }], async () => {
      const res = await x.exchange({ code: 'c', state });
      assert.equal(res.ok, false, 'a connection with no way to renew itself was accepted');
      assert.equal(res.code, 'NO_REFRESH_TOKEN');
      // The sentence is the deliverable: the client has to know to press the
      // button again with every permission ticked.
      assert.match(res.error, /two hours/);
      assert.match(res.error, /Connect X again/);
    });
  });
});

test('the stored account carries the refresh token — the field that did not exist before this slice', async () => {
  await withEnv(APP_ENV, async () => {
    const state = new URL(x.authorizeUrl({ projectId: 'p', userId: 'u' }).data.url).searchParams.get('state');
    await withFetch([{ status: 200, body: TOKENS }, { status: 200, body: ME }], async () => {
      const res = await x.exchange({ code: 'c', state });
      const account = res.data.accounts[0];
      assert.deepEqual(contract.accountProblems(account, 'x account'), []);
      assert.equal(account.accountLabel, '@delraytennis', 'the card must show the handle');
      assert.equal(account.refreshToken, 'CLIENT_REFRESH_TOKEN');
      // And it survives the trip into the vault. `storableAccount` dropped it
      // before this slice, so the renewal path had nothing to renew with.
      assert.equal(contract.storableAccount(account).refreshToken, 'CLIENT_REFRESH_TOKEN');
    });
  });
});

/**
 * THE test of review round 1, and the one the ticket's third acceptance
 * criterion actually turns on.
 *
 * The defect it pins: `exchange` computed the expiry carefully — `expiryFrom`
 * even falls back to two hours rather than to "never", with a comment saying
 * why — and then nothing carried it. The account vocabulary had no `expiresAt`
 * and `contract.storableAccount` did not write one, so `expires_at` was NULL on
 * every X row a grant created. `verifySweep.refreshDue` opens with
 * `if (!expiresAt) return { due: false, why: 'this token has no recorded
 * expiry' }`, so the renewal built in slice 6 never fired once. The connection
 * worked for about two hours and was then dead, with `refreshBeforeUse` still
 * answering `ok: true` and the card still green.
 *
 * Why this test and not the one above it: the existing "hands its refresh token
 * BACK" test hands `refreshBeforeUse` a connection with `expiresAt` ALREADY
 * set, so it is structurally blind to a store that never wrote one. The only
 * thing that can see this is the whole round trip — exchange, into the real
 * store over the real schema, back out, and asked whether renewal is due.
 *
 * It runs against the SQL-schema fake rather than a stub store on purpose. A
 * stub would have to be told that `expires_at` is a column, which is precisely
 * the fact in dispute; the fake parses docs/SQL and refuses a field the table
 * does not have.
 */
test('round trip: an exchanged grant lands with its expiry, and refreshDue says it is DUE', async (t) => {
  const h = withStore();
  t.after(h.restore);

  // CHANNELS_ENCRYPTION_KEY is pinned alongside the app credentials because
  // `withEnv` clears every key it knows about, and the vault needs this one to
  // encrypt the token it is being handed.
  await withEnv({ ...APP_ENV, CHANNELS_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY }, async () => {
    const state = new URL(x.authorizeUrl({ projectId: 'p', userId: 'u' }).data.url).searchParams.get('state');
    // Three hours ago, against X's two-hour lifetime — so the token is an hour
    // past its deadline by the time the sweep looks at it. That is the live
    // case: nobody publishes in the first two hours after connecting, so the
    // first post a client ever makes is already on an expired token.
    const issuedAt = Date.now() - 3 * 3600_000;

    const exchanged = await withFetch(
      [{ status: 200, body: TOKENS }, { status: 200, body: ME }],
      () => x.exchange({ code: 'c', state, nowMs: issuedAt })
    );
    assert.equal(exchanged.ok, true, exchanged.error);

    const stored = await h.completeConnection.storeAccounts({
      provider: 'x',
      displayName: 'X',
      accounts: exchanged.data.accounts,
      scope: STORE_SCOPE,
    });
    assert.equal(stored.ok, true, stored.error);

    // The ROW, read back out of the store — not the object handed to it.
    const row = await h.store.getConnection({ provider: 'x', accountId: '4455' }, STORE_SCOPE);
    assert.equal(row.ok, true, row.error);
    assert.ok(
      row.data.expiresAt,
      'expires_at is empty on the stored row — the adapter worked out when this token dies and '
      + 'nothing carried it to the vault, so nothing will ever renew it'
    );
    assert.equal(
      row.data.expiresAt,
      new Date(issuedAt + 7200_000).toISOString(),
      'the stored expiry is not the one X issued'
    );

    const due = verifySweep.refreshDue(row.data, Date.now());
    assert.equal(
      due.due,
      true,
      `the sweep will not renew this connection: ${due.why}. "this token has no recorded expiry" `
      + 'is the failure — an expired token that reads as healthy for ever.'
    );
    assert.equal(due.expired, true);
  });
});

/**
 * The same round trip, on the one second in every sixty that used to fail.
 *
 * The test above stamps its token with the wall clock, so it exercises whatever
 * second the suite happens to run in — and there is one it could not survive.
 * `new Date().toISOString()` always emits milliseconds, and the shared timestamp
 * validator read `59.096` as a second greater than 59 and refused it as a time
 * "which does not exist" (lib/storeInput.js `calendarError`). `saveConnection`
 * returns that refusal rather than warning past it, so the WHOLE grant was
 * rejected.
 *
 * That is not a test-only defect and it is this slice that exposed it: before
 * `expiresAt` was carried into the vault, X wrote no timestamp here at all, so
 * nothing on this path ever met the validator. Now every connect writes one, and
 * a client pressing Connect during the 59th second of any minute would have been
 * told their X account could not be saved because of a second that does not
 * exist. It reached CI first, as a 1-in-60 flake in resolveCredentials.
 *
 * So the second is PINNED here rather than left to the clock — a regression
 * test that only fails one run in sixty is not a regression test.
 */
test('a grant issued on the 59th second of a minute still saves — the second exists', async (t) => {
  const h = withStore();
  t.after(h.restore);

  await withEnv({ ...APP_ENV, CHANNELS_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY }, async () => {
    const state = new URL(x.authorizeUrl({ projectId: 'p', userId: 'u' }).data.url).searchParams.get('state');

    // Three hours ago as before, then snapped onto second 59 with a fraction.
    // Adding X's whole-numbered two-hour lifetime preserves both, so the expiry
    // the store is asked to keep is exactly the shape that was refused.
    const issued = new Date(Date.now() - 3 * 3600_000);
    issued.setUTCSeconds(59, 96);
    const issuedAt = issued.getTime();

    const expectedExpiry = new Date(issuedAt + 7200_000).toISOString();
    assert.match(
      expectedExpiry,
      /:59\.\d{3}Z$/,
      'this test is not exercising what it claims to — the expiry must land on a fractional 59th second'
    );

    const exchanged = await withFetch(
      [{ status: 200, body: TOKENS }, { status: 200, body: ME }],
      () => x.exchange({ code: 'c', state, nowMs: issuedAt })
    );
    assert.equal(exchanged.ok, true, exchanged.error);

    const stored = await h.completeConnection.storeAccounts({
      provider: 'x',
      displayName: 'X',
      accounts: exchanged.data.accounts,
      scope: STORE_SCOPE,
    });
    assert.equal(
      stored.ok,
      true,
      `the grant was refused on the 59th second: ${stored.error || ''} — a client who pressed `
      + 'Connect one second before a minute rolled over could not connect X at all'
    );

    const row = await h.store.getConnection({ provider: 'x', accountId: '4455' }, STORE_SCOPE);
    assert.equal(row.ok, true, row.error);
    assert.equal(row.data.expiresAt, expectedExpiry, 'the stored expiry is not the one X issued');
    assert.equal(verifySweep.refreshDue(row.data, Date.now()).due, true);
  });
});

/**
 * The same join, from the other end: a platform whose tokens do NOT expire must
 * still come out saying so, rather than inheriting a deadline from nowhere.
 *
 * This is the guard on the fix rather than on the defect. `storableAccount` now
 * writes `expiresAt` unconditionally, and writing a WRONG one would be worse
 * than writing none — the sweep would spend a refresh token on a Page token
 * that never needed renewing, and X's rotation makes a needless refresh a real
 * cost rather than a wasted call.
 */
test('a platform with no expiry stores none, and refreshDue correctly says nothing is due', async (t) => {
  const h = withStore();
  t.after(h.restore);

  const stored = await h.completeConnection.storeAccounts({
    provider: 'bluesky',
    displayName: 'Bluesky',
    accounts: [contract.account({
      accountId: 'did:plc:delray',
      accountLabel: 'delray.bsky.social',
      accessToken: 'client-app-password',
    })],
    scope: STORE_SCOPE,
  });
  assert.equal(stored.ok, true, stored.error);

  const row = await h.store.getConnection({ provider: 'bluesky', accountId: 'did:plc:delray' }, STORE_SCOPE);
  assert.equal(row.ok, true, row.error);
  assert.equal(row.data.expiresAt, '', 'an app password was given a deadline it does not have');
  assert.equal(verifySweep.refreshDue(row.data, Date.now()).due, false);
});

/**
 * The gap this slice inherited, pinned at the join.
 *
 * Slice 6 built refresh-before-use on top of an account shape with no
 * `refreshToken` in it, so `accountFrom` handed every adapter an account whose
 * renewal credential was missing. Facebook and Instagram never noticed — a Page
 * token does not expire — and X is the first platform where it is the whole
 * point. A `storableAccount` that drops it, or an `accountFrom` that omits it,
 * both fail here.
 */
test('a stored connection hands its refresh token BACK to the adapter, and the rotated one is stored', async () => {
  const seen = [];
  const saved = [];
  // The real renewal path, with only the vault and the registry stubbed — so
  // this fails if `accountFrom` omits the field, if `storableAccount` drops it,
  // or if the adapter's answer is not written back.
  const renewed = await verifySweep.refreshBeforeUse({
    connection: {
      provider: 'x',
      accountId: '4455',
      accountLabel: '@delraytennis',
      accessToken: 'STORED_ACCESS',
      refreshToken: 'STORED_REFRESH',
      scopes: [],
      status: 'connected',
      // Inside the refresh window, so renewal is actually due.
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    scope: { projectId: 'proj-a', userId: 'user-1' },
    nowMs: Date.now(),
    store: {
      async saveConnection(input) { saved.push(input); return { ok: true, status: 200, data: { ...input } }; },
      async updateConnectionStatus() { return { ok: true, status: 200, data: {} }; },
    },
    registryRef: {
      adapterFor() {
        return {
          async refresh(account) {
            seen.push(account);
            return contract.ok(200, {
              refreshed: true,
              accessToken: 'NEW_ACCESS',
              refreshToken: 'NEW_REFRESH',
              expiresAt: new Date(Date.now() + 7200_000).toISOString(),
            });
          },
        };
      },
    },
  });

  assert.equal(seen.length, 1, 'the adapter was never asked to refresh');
  assert.equal(seen[0].refreshToken, 'STORED_REFRESH',
    'the sweep handed the adapter an account it could not renew with — the gap this slice closed');
  assert.equal(renewed.ok, true, renewed.note);
  assert.equal(renewed.refreshed, true);
  assert.equal(saved[0].refreshToken, 'NEW_REFRESH', 'the rotated refresh token was not stored');
  assert.equal(renewed.connection.accessToken, 'NEW_ACCESS');
});

// ---------------------------------------------------------------------------
// 3. refresh and revoke
// ---------------------------------------------------------------------------

test('refresh renews with the REFRESH token and returns the rotated one', async () => {
  await withEnv(APP_ENV, async () => {
    const rotated = { access_token: 'NEW_ACCESS', refresh_token: 'NEW_REFRESH', expires_in: 7200 };
    await withFetch({ status: 200, body: rotated }, async (calls) => {
      const res = await x.refresh({ accessToken: 'OLD_ACCESS', refreshToken: 'OLD_REFRESH' });
      assert.equal(res.ok, true, res.error);
      assert.equal(res.data.refreshed, true);
      assert.equal(res.data.accessToken, 'NEW_ACCESS');
      // X rotates this. Returning the OLD one renews exactly once more and then
      // never again — a connection that dies a day later for no visible reason.
      assert.equal(res.data.refreshToken, 'NEW_REFRESH');
      assert.ok(Date.parse(res.data.expiresAt) > Date.now(), 'no future expiry was recorded');

      const form = new URLSearchParams(calls[0].body);
      assert.equal(form.get('grant_type'), 'refresh_token');
      assert.equal(form.get('refresh_token'), 'OLD_REFRESH');
      // A confidential client authenticates in the header. Sending the secret in
      // the body earns `unauthorized_client`, which names nothing useful.
      assert.match(String(calls[0].headers.Authorization), /^Basic /);
      assert.equal(form.get('client_secret'), null);
    });
  });
});

test('refresh refuses loudly when there is nothing to renew with', async () => {
  await withEnv(APP_ENV, async () => {
    const res = await x.refresh({ accessToken: 'ONLY_ACCESS' });
    assert.equal(res.ok, false, 'X reported a renewal it could not have performed');
    assert.equal(res.code, 'NO_REFRESH_TOKEN');
    // Deliberately NOT the "nothing to refresh on this platform" answer Facebook
    // and Instagram give: on X that is a broken connection, not a fact about the
    // platform, and reporting it as ok would leave the card green.
  });
});

test('revoke hands back the REFRESH token, not just the access token', async () => {
  await withEnv(APP_ENV, async () => {
    await withFetch({ status: 200, body: { revoked: true } }, async (calls) => {
      const res = await x.revoke({ accountId: '4455', accessToken: 'A', refreshToken: 'R' });
      assert.equal(res.ok, true);
      assert.equal(res.data.revokedAtProvider, true);
      const form = new URLSearchParams(calls[0].body);
      // Revoking the access token alone leaves the refresh token able to mint a
      // new one — a permission the client believes they withdrew, still usable.
      assert.equal(form.get('token'), 'R');
      assert.equal(form.get('token_type_hint'), 'refresh_token');
    });
  });
});

test('revoke never reports a withdrawal X did not confirm', async () => {
  await withEnv(APP_ENV, async () => {
    await withFetch({ status: 400, body: { error: 'invalid_request' } }, async () => {
      const res = await x.revoke({ accountId: '4455', accessToken: 'A', refreshToken: 'R' });
      assert.equal(res.ok, true, 'the caller must still be able to forget the row');
      assert.equal(res.data.revokedAtProvider, false);
      assert.match(res.data.reason, /Connected apps/);
    });
  });
});

test('verify reports WHICH account the token now answers as', async () => {
  await withEnv(APP_ENV, async () => {
    await withFetch({ status: 200, body: { data: { id: '9999', username: 'somebodyelse' } } }, async () => {
      const res = await x.verify({ accountId: '4455', accessToken: 'A' });
      assert.equal(res.ok, true);
      // The sweep compares this against the stored id. A token that has started
      // answering as a different account is live, and would post to the wrong
      // place — the failure that looks exactly like success.
      assert.equal(res.data.accountId, '9999');
    });
  });
});

// ---------------------------------------------------------------------------
// 4. The two schemes must never mix
// ---------------------------------------------------------------------------

test('a client connection posts with a Bearer token, never an OAuth 1.0a signature', async () => {
  await withFetch({ status: 201, body: { data: { id: '1', text: 'hi' } } }, async (calls) => {
    const res = await xClient.createPost('hi', {
      credentials: {
        // Exactly what the resolver hands over on the connection path: the
        // client's token, the app's 1.0a key/secret still underneath from the
        // environment, and NO access_token_secret.
        auth_mode: 'oauth2',
        access_token: 'CLIENT_BEARER_TOKEN',
        api_key: 'ALPHIRE_KEY',
        api_secret: 'ALPHIRE_SECRET',
      },
    });
    assert.equal(res.ok, true, res.error);
    const auth = String(calls[0].headers.Authorization);
    assert.equal(auth, 'Bearer CLIENT_BEARER_TOKEN');
    // The negative is the one that matters. An OAuth header here would mean the
    // client's bearer token had been signed with Alphire's secret — a signature
    // belonging to nobody, which X answers with a 401 naming neither account.
    assert.doesNotMatch(auth, /^OAuth /);
    assert.doesNotMatch(auth, /ALPHIRE_SECRET/);
  });
});

test("the environment path still signs OAuth 1.0a — this is Dane's own live posting", async () => {
  await withFetch({ status: 201, body: { data: { id: '1', text: 'hi' } } }, async (calls) => {
    const res = await xClient.createPost('hi', {
      credentials: {
        api_key: 'ALPHIRE_KEY',
        api_secret: 'ALPHIRE_SECRET',
        access_token: 'DANE_TOKEN',
        access_token_secret: 'DANE_SECRET',
      },
    });
    assert.equal(res.ok, true, res.error);
    const auth = String(calls[0].headers.Authorization);
    // No auth_mode at all in that bag, and it must behave exactly as it did
    // before this slice existed.
    assert.match(auth, /^OAuth /);
    assert.match(auth, /oauth_consumer_key="ALPHIRE_KEY"/);
    assert.match(auth, /oauth_signature=/);
  });
});

test('a bearer credential is complete without the 1.0a pair, and an incomplete one says the right thing', () => {
  const bearer = xClient.shapeXCredentials({ auth_mode: 'oauth2', access_token: 'T' });
  assert.equal(bearer.authMode, 'oauth2');
  assert.equal(xClient.hasUsableCredentials(bearer), true,
    'a client connection was judged incomplete for lacking values it does not use');

  // Idempotent shaping still holds with the new field — routes/engage.js shapes
  // its own output (round 2 of 86bbpz1ed), and a mode lost on the second pass
  // would silently downgrade a client post to the 1.0a path.
  assert.deepEqual(xClient.shapeXCredentials(bearer, bearer.source), bearer);

  const envCreds = xClient.shapeXCredentials({ api_key: 'k', api_secret: 's', access_token: 't' });
  assert.equal(envCreds.authMode, 'oauth1', 'a credential with no stated mode must default to 1.0a');
  assert.equal(xClient.hasUsableCredentials(envCreds), false, 'an incomplete 1.0a pair was judged usable');
});

test('a client whose connection went stale is not sent to a Settings screen they cannot reach', async () => {
  const res = await xClient.createPost('hi', { credentials: { auth_mode: 'oauth2', access_token: '' } });
  assert.equal(res.ok, false);
  assert.match(res.error, /Connections screen/);
  assert.doesNotMatch(res.error, /Save API Key/);
});

/**
 * A 403 on a client's connection must not describe Alphire's credential.
 *
 * 403 means "signed in, not allowed to post", and it is the single most likely
 * failure on a per-user grant — the client ticked fewer permissions than X
 * offered. The branch that handles it sat ABOVE the one that knows a bearer
 * token from an OAuth 1.0a pair, so the answer was "Set App permissions to Read
 * and Write at developer.x.com, then regenerate the Access Token and Secret":
 * Starcaster's own key pair, on a screen the client cannot open, and changing
 * it would not have helped anybody (86bbpz1hu, review round 1).
 *
 * Both directions are asserted. The OAuth 1.0a wording is Dane's own posting
 * and is exactly right for it, so this pins that it did not move.
 */
test('a 403 names the credential that is actually short — the client\'s grant, or Alphire\'s pair', async () => {
  const forbidden = { status: 403, statusText: 'Forbidden', body: { detail: 'not permitted' } };

  const client = await withFetch(forbidden, () => xClient.checkAuth({
    credentials: { auth_mode: 'oauth2', access_token: 'CLIENT_BEARER_TOKEN' },
  }));
  assert.equal(client.ok, false);
  assert.equal(client.code, 'insufficient_scope');
  assert.match(client.error, /Connections screen/,
    'a client\'s under-scoped grant must be fixed by reconnecting, which is the only door they have');
  assert.doesNotMatch(client.error, /developer\.x\.com/,
    'the client was sent to Alphire\'s developer portal to regenerate a credential that is not theirs');
  assert.doesNotMatch(client.error, /Access Token and Secret/,
    'this names the OAuth 1.0a pair — a different credential from the one that just failed');

  const platform = await withFetch(forbidden, () => xClient.checkAuth({
    credentials: {
      api_key: 'ALPHIRE_KEY',
      api_secret: 'ALPHIRE_SECRET',
      access_token: 'DANE_TOKEN',
      access_token_secret: 'DANE_SECRET',
    },
  }));
  assert.equal(platform.ok, false);
  assert.equal(platform.code, 'insufficient_scope');
  assert.match(platform.error, /developer\.x\.com/,
    'Dane\'s own 403 IS a permissions setting on the app, and that instruction is right');
});

// ---------------------------------------------------------------------------
// 5. Catalogue and setup
// ---------------------------------------------------------------------------

test('X is a ready, connectable card wired to this adapter', () => {
  const entry = registry.getEntry('x');
  assert.equal(entry.readiness, 'ready');
  assert.equal(entry.authKind, 'redirect');
  assert.equal(entry.adapter, x);
  assert.equal(registry.getAdapter('x').ok, true);
  assert.equal(registry.listCatalogue().find((c) => c.provider === 'x').connectable, true);
});

test('the callback hangs off the PINNED origin, never a preview deployment', () => {
  withEnv({ ...APP_ENV, CONNECTIONS_OAUTH_ORIGIN: '', VERCEL_URL: 'some-preview-xyz.vercel.app' }, () => {
    // A provider refuses any redirect_uri it was not registered with, and
    // VERCEL_URL is a different hostname on every preview deployment.
    assert.equal(x.callbackUrl(), 'https://starcaster.pro/api/promote/social/x/oauth/callback');
    assert.doesNotMatch(x.callbackUrl(), /vercel\.app/);
  });
});

test('without OAuth 2.0 app credentials it refuses and names the right pair', () => {
  withEnv({ ...APP_ENV, X_CLIENT_ID: '', X_CLIENT_SECRET: '' }, () => {
    const res = x.authorizeUrl({ projectId: 'p', userId: 'u' });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'APP_NOT_CONFIGURED');
    // The likeliest wrong turn is pasting the OAuth 1.0a API Key here, so the
    // message says outright that they are different values.
    assert.match(res.error, /NOT the API Key and API Secret/);
    assert.match(res.error, /x\/oauth\/callback/);
  });
});

test('a token with no stated lifetime is recorded as expiring, never as permanent', () => {
  const at = Date.parse('2026-09-03T12:00:00.000Z');
  // A missing expires_in recorded as "never" is a token nothing will ever
  // renew; it simply stops working mid-afternoon.
  assert.equal(x.expiryFrom({}, at), new Date(at + 7200 * 1000).toISOString());
  assert.equal(x.expiryFrom({ expires_in: 60 }, at), new Date(at + 60 * 1000).toISOString());
});
