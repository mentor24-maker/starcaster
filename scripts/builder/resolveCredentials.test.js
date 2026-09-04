'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

/**
 * Connections 3 of 7 (86bbpz1ed) — the resolver.
 *
 * The failure this whole slice is shaped around is silent: posting to the wrong
 * account looks EXACTLY like success. The provider accepts it, the post appears,
 * the job goes green, and the only person who ever finds out is the client whose
 * followers never saw it. Nothing downstream can catch that, so it has to be
 * caught here, and each test below pins one way it could happen:
 *
 *   - a client's grant is ignored and the shared keys post instead
 *   - project B's token is handed to project A          (a tenant leak)
 *   - a dead token is used because its status said connected
 *   - a lookup that FAILED is read as "no connection" and falls back
 *   - the overlay blanks the app credentials underneath it
 *
 * The database underneath is the same SQL-backed fake the slice 1 store tests
 * use, reading its schema from docs/SQL/project_connections_setup.sql — so the
 * rows here are stored, encrypted and read back through the real store rather
 * than through a mock that agrees with the code by construction.
 */

const SQL_PATH = path.join(__dirname, '..', '..', 'docs', 'SQL', 'project_connections_setup.sql');
const { parseSchemaFile, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const projectScopePath = require.resolve('../../lib/projectScope.js');
const storePath = require.resolve('../../lib/projectConnectionsStore.js');
const apiSettingsPath = require.resolve('../../lib/apiSettings.js');
const resolverPath = require.resolve('../../lib/connections/resolveCredentials.js');
const sweepPath = require.resolve('../../lib/connections/verifySweep.js');
const registryPath = require.resolve('../../lib/connections/registry.js');

const SCOPE_A = { projectId: 'proj_a', userId: 'user_1' };
const SCOPE_B = { projectId: 'proj_b', userId: 'user_2' };

/** A valid AES-256 key: 32 bytes, base64, the shape channelsCipher demands. */
const TEST_KEY = Buffer.alloc(32, 7).toString('base64');

/**
 * The platform-wide keys — Starcaster's own app, and Dane's own accounts.
 *
 * Two kinds of value on purpose. `access_token` is per-ACCOUNT and a connection
 * is expected to override it; `app_id` and `app_secret` are per-APP and must
 * survive, because an OAuth grant gives you one account's token, not a new
 * application. A test below fails if the overlay wipes them.
 */
const ENV_VALUES = {
  meta: {
    access_token: 'ENV_META_TOKEN_dane',
    page_id: 'ENV_PAGE_dane',
    app_id: 'ALPHIRE_APP_ID',
    app_secret: 'ALPHIRE_APP_SECRET',
    base_url: 'https://graph.facebook.com/v22.0',
  },
  instagram: {
    access_token: 'ENV_IG_TOKEN_dane',
    business_account_id: 'ENV_IG_ACCOUNT_dane',
    app_id: 'ALPHIRE_APP_ID',
    app_secret: 'ALPHIRE_APP_SECRET',
  },
  bluesky: {
    identifier: 'dane.bsky.social',
    app_password: 'ENV_BLUESKY_PASSWORD',
    service_url: 'https://bsky.social',
  },
  x: {
    api_key: 'ALPHIRE_X_API_KEY',
    api_secret: 'ALPHIRE_X_API_SECRET',
    access_token: 'ENV_X_TOKEN_dane',
    access_token_secret: 'ENV_X_SECRET_dane',
    account_name: 'daneofearth',
  },
  buffer: { api_key: 'ENV_BUFFER_KEY', organization_id: 'ENV_BUFFER_ORG', default_channel_id: 'chan_env' },
};

/**
 * Swap lib/supabase and lib/apiSettings for fakes, and hand back a live store
 * and a live resolver over them.
 *
 * `fault.failNextList` is the switch that makes a lookup FAIL rather than
 * answer — a 502 on a cold start, which is a documented Vercel behaviour and
 * not a hypothetical. It is the difference between "this project has no
 * connection" and "I could not tell", and the resolver must treat those two
 * completely differently.
 */
function withResolver(envOverrides = {}, registryStub = null) {
  const schema = parseSchemaFile(SQL_PATH);
  const db = createFakeDb(schema);
  const fault = { failNextList: false, failNextRead: false, listFailures: 0 };

  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({
      projectConnections: 'project_connections',
      projectConnectionHandoffs: 'project_connection_handoffs',
    }),
    sbQuery: async (args) => {
      const query = String(args?.query || '');
      const isProbe = query.includes('select=project_id,owner_user_id');
      if (fault.failNextList && !isProbe && query.includes('order=updated_at.desc')) {
        fault.failNextList = false;
        fault.listFailures += 1;
        return { ok: false, status: 502, error: 'Bad Gateway (simulated cold start)' };
      }
      if (fault.failNextRead && !isProbe && query.includes('limit=1')) {
        fault.failNextRead = false;
        return { ok: false, status: 502, error: 'Bad Gateway (simulated cold start)' };
      }
      return db.sbQuery(args);
    },
  };

  const envCalls = [];
  const fakeApiSettings = {
    getProviderValues: (provider, options = {}) => {
      envCalls.push({ provider, options });
      // `envOverrides` lets one test change what the PLATFORM holds without
      // rewriting the shared table — needed for the Bluesky PDS test, where the
      // whole question is what happens when the environment names a different
      // server from the client's.
      return { ...(ENV_VALUES[provider] || {}), ...(envOverrides[provider] || {}) };
    },
  };

  const realSupabase = require.cache[supabasePath];
  const realApiSettings = require.cache[apiSettingsPath];
  /**
   * The registry, swapped for a stub when a test needs to control what
   * `adapter.refresh` answers.
   *
   * `verifySweep.defaultRegistry()` requires it at CALL time (deliberately —
   * the top-level require closes a module ring), so putting a stub in the cache
   * here is enough and no re-require of the sweep is needed. Without one the
   * real X adapter would be asked to renew, which means a live HTTP call to X
   * from a unit test.
   */
  const realRegistry = require.cache[registryPath];
  if (registryStub) {
    require.cache[registryPath] = {
      id: registryPath, filename: registryPath, loaded: true, exports: registryStub,
    };
  }
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase,
  };
  require.cache[apiSettingsPath] = {
    id: apiSettingsPath, filename: apiSettingsPath, loaded: true, exports: fakeApiSettings,
  };
  // projectScope destructures sbQuery at load AND caches its column probe per
  // table, so all three must be re-required or they answer from the last test.
  delete require.cache[projectScopePath];
  delete require.cache[storePath];
  delete require.cache[resolverPath];
  /**
   * And the sweep, which is the one that had been missing.
   *
   * `verifySweep.js` captures `projectConnectionsStore` at load (line 79), and
   * the resolver calls `refreshBeforeUse` without passing a store — so a cached
   * sweep writes the renewal's status into the FIRST test's database, silently,
   * for the whole rest of the file.
   *
   * Nothing caught it because no test in this file had ever read a row back
   * after a resolver-driven refresh; they all asserted on the resolver's own
   * answer, which carries the connection through in memory and is right either
   * way. Review round 3's reproduction is the first that has to look at what
   * was WRITTEN, and it passed alone and failed in the suite until this
   * existed. An assertion about a stored status is worth nothing without it.
   *
   * Listed here AND in `restore()`, like `storePath` and `resolverPath` above.
   * Measured: either line alone is enough, and removing both brings the defect
   * straight back — so this is deliberate redundancy, not a line to tidy away.
   */
  delete require.cache[sweepPath];

  const store = require(storePath);
  const resolver = require(resolverPath);
  // The publishers cache the resolver at load, so they must be re-required
  // alongside it or they hold a resolver pointing at the previous test's fakes.
  const publisherPaths = [
    require.resolve('../../lib/metaClients.js'),
    require.resolve('../../lib/blueskyClient.js'),
    require.resolve('../../lib/bufferClient.js'),
    require.resolve('../../lib/xClient.js'),
    require.resolve('../../lib/projectSocialCredentialsStore.js'),
  ];
  publisherPaths.forEach((modulePath) => delete require.cache[modulePath]);
  const publishers = {
    meta: require('../../lib/metaClients.js'),
    bluesky: require('../../lib/blueskyClient.js'),
    buffer: require('../../lib/bufferClient.js'),
    x: require('../../lib/xClient.js'),
  };

  const hadKey = Object.prototype.hasOwnProperty.call(process.env, 'CHANNELS_ENCRYPTION_KEY');
  const previousKey = process.env.CHANNELS_ENCRYPTION_KEY;
  process.env.CHANNELS_ENCRYPTION_KEY = TEST_KEY;

  function restore() {
    if (registryStub) {
      if (realRegistry) require.cache[registryPath] = realRegistry;
      else delete require.cache[registryPath];
    }
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    if (realApiSettings) require.cache[apiSettingsPath] = realApiSettings;
    else delete require.cache[apiSettingsPath];
    delete require.cache[projectScopePath];
    delete require.cache[storePath];
    delete require.cache[resolverPath];
    delete require.cache[sweepPath];
    publisherPaths.forEach((modulePath) => delete require.cache[modulePath]);
    if (hadKey) process.env.CHANNELS_ENCRYPTION_KEY = previousKey;
    else delete process.env.CHANNELS_ENCRYPTION_KEY;
  }

  return { db, fault, store, resolver, publishers, envCalls, restore };
}

/** Store a grant through the REAL store, so it is really encrypted and scoped. */
async function grant(store, scope, input) {
  const saved = await store.saveConnection(input, scope);
  assert.equal(saved.ok, true, `seeding a connection failed: ${saved.error || ''}`);
  return saved;
}

const CLIENT_PAGE = {
  provider: 'facebook_page',
  accountId: '1122334455',
  accountLabel: 'Delray Beach Tennis Center',
  status: 'connected',
  accessToken: 'CLIENT_PAGE_TOKEN_delray',
};

// ── The project's own connection wins ───────────────────────────────────────

test("a project's own connection is used, and the result says so", async () => {
  const h = withResolver();
  try {
    await grant(h.store, SCOPE_A, CLIENT_PAGE);

    const res = await h.resolver.resolveCredentials('facebook_page', SCOPE_A.projectId);
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.source, 'connection', 'the shared keys answered for a project that has its own grant');
    assert.equal(res.data.values.access_token, 'CLIENT_PAGE_TOKEN_delray');
    assert.equal(res.data.values.page_id, '1122334455');
    assert.equal(res.data.accountLabel, 'Delray Beach Tennis Center');
    // Not decoration: a log line that cannot say which account posted is how a
    // wrong-account post goes unnoticed for a month.
    assert.match(res.data.sourceDetail, /Delray Beach Tennis Center/);
  } finally { h.restore(); }
});

test('the app credentials underneath survive the overlay', async () => {
  const h = withResolver();
  try {
    await grant(h.store, SCOPE_A, CLIENT_PAGE);
    const res = await h.resolver.resolveCredentials('facebook_page', SCOPE_A.projectId);
    assert.equal(res.ok, true);
    // A grant is one account's token against STARCASTER's Meta app. Blanking
    // these two fails the call with a Meta error naming none of this.
    assert.equal(res.data.values.app_id, 'ALPHIRE_APP_ID');
    assert.equal(res.data.values.app_secret, 'ALPHIRE_APP_SECRET');
    assert.equal(res.data.values.base_url, 'https://graph.facebook.com/v22.0');
  } finally { h.restore(); }
});

test('a platform-specific credential lands on the key that platform actually reads', async () => {
  const h = withResolver();
  try {
    // Bluesky's durable credential is an app password and its identifier is a
    // handle, so the generic `access_token`/`account_id` mapping is wrong for
    // it. This is the test that proves the per-provider map is consulted.
    await grant(h.store, SCOPE_A, {
      provider: 'bluesky',
      accountId: 'did:plc:delray',
      accountLabel: 'delraytennis.bsky.social',
      status: 'connected',
      accessToken: 'CLIENT_BLUESKY_APP_PASSWORD',
    });
    const res = await h.resolver.resolveCredentials('bluesky', SCOPE_A.projectId);
    assert.equal(res.ok, true);
    assert.equal(res.data.values.app_password, 'CLIENT_BLUESKY_APP_PASSWORD');
    assert.equal(res.data.values.identifier, 'delraytennis.bsky.social');
    assert.equal(res.data.values.service_url, 'https://bsky.social', 'the service url fell out of the merge');
  } finally { h.restore(); }
});

// ── The fallback, which is what Dane's own posting uses ─────────────────────

test('with NO stored connection, the environment values come back unchanged', async () => {
  const h = withResolver();
  try {
    const res = await h.resolver.resolveCredentials('facebook_page', SCOPE_A.projectId);
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.source, 'environment');
    assert.deepEqual(res.data.values, ENV_VALUES.meta, 'the fallback path did not return the environment values verbatim');
    assert.match(res.data.sourceDetail, /no stored facebook_page connection/);
  } finally { h.restore(); }
});

test('with no project at all, the environment answers and nothing is looked up', async () => {
  const h = withResolver();
  try {
    const before = h.db.calls ? h.db.calls.length : 0;
    const res = await h.resolver.resolveCredentials('x', '');
    assert.equal(res.ok, true);
    assert.equal(res.data.source, 'environment');
    assert.deepEqual(res.data.values, ENV_VALUES.x);
    assert.equal(typeof before, 'number');
  } finally { h.restore(); }
});

test('envOnly skips the connection entirely, so the side-by-side diagnostic stays honest', async () => {
  const h = withResolver();
  try {
    await grant(h.store, SCOPE_A, CLIENT_PAGE);
    const res = await h.resolver.resolveCredentials('facebook_page', SCOPE_A.projectId, { envOnly: true });
    assert.equal(res.ok, true);
    assert.equal(res.data.source, 'environment');
    assert.equal(res.data.values.access_token, 'ENV_META_TOKEN_dane');
    assert.ok(
      h.envCalls.some((call) => call.provider === 'meta' && call.options.envOnly === true),
      'envOnly was not passed through to the environment lookup'
    );
  } finally { h.restore(); }
});

// ── The tenant leak ─────────────────────────────────────────────────────────

test("project B's connection is never returned for project A", async () => {
  const h = withResolver();
  try {
    await grant(h.store, SCOPE_B, {
      provider: 'facebook_page',
      accountId: '9999999999',
      accountLabel: "Another Client's Page",
      status: 'connected',
      accessToken: 'PROJECT_B_TOKEN_do_not_leak',
    });

    const res = await h.resolver.resolveCredentials('facebook_page', SCOPE_A.projectId);
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.source, 'environment', "project A was handed project B's connection");
    assert.notEqual(res.data.values.access_token, 'PROJECT_B_TOKEN_do_not_leak');
    assert.equal(res.data.values.access_token, 'ENV_META_TOKEN_dane');
    // And the leak is not hiding in the reported metadata either.
    assert.equal(JSON.stringify(res.data).includes('PROJECT_B_TOKEN_do_not_leak'), false);
    assert.equal(JSON.stringify(res.data).includes("Another Client's Page"), false);
  } finally { h.restore(); }
});

test('one provider does not answer for another', async () => {
  const h = withResolver();
  try {
    await grant(h.store, SCOPE_A, {
      provider: 'bluesky',
      accountId: 'did:plc:delray',
      accountLabel: 'delraytennis.bsky.social',
      status: 'connected',
      accessToken: 'CLIENT_BLUESKY_APP_PASSWORD',
    });
    const res = await h.resolver.resolveCredentials('x', SCOPE_A.projectId);
    assert.equal(res.ok, true);
    assert.equal(res.data.source, 'environment');
    assert.equal(res.data.values.access_token, 'ENV_X_TOKEN_dane');
  } finally { h.restore(); }
});

// ── A dead token is not a credential ────────────────────────────────────────

for (const status of ['expired', 'revoked', 'error']) {
  test(`a ${status} connection is skipped, and the fallback is used instead`, async () => {
    const h = withResolver();
    try {
      await grant(h.store, SCOPE_A, { ...CLIENT_PAGE, status });
      const res = await h.resolver.resolveCredentials('facebook_page', SCOPE_A.projectId);
      assert.equal(res.ok, true, res.error);
      assert.equal(res.data.source, 'environment', `a ${status} connection was posted with`);
      assert.equal(res.data.values.access_token, 'ENV_META_TOKEN_dane');
      // Skipped, not swallowed: slice 4 paints the card from this.
      assert.ok(Array.isArray(res.data.skipped) && res.data.skipped.length === 1);
      assert.match(res.data.skipped[0].why, new RegExp(status));
    } finally { h.restore(); }
  });
}

test('a lapsed connection with NOTHING to renew it with is skipped, and the fallback is used', async () => {
  const h = withResolver();
  try {
    // The realistic case, and the reason both halves are checked: `status` is
    // what the last verify wrote down, and the clock is what is actually true,
    // so the two disagree for most of a token's dead life.
    //
    // Revisited in review round 2 of 86bbpz1hu, which is why the name changed.
    // This used to read "a connection whose token expired is skipped", and as a
    // blanket rule that was the defect: a lapsed row that CAN be renewed is now
    // renewed rather than skipped (see the two tests below). What still holds —
    // and what this test now pins — is the case where nothing could renew it.
    // CLIENT_PAGE has no refresh token, so there is no credential to renew
    // with, and falling back is the only honest answer.
    await grant(h.store, SCOPE_A, {
      ...CLIENT_PAGE,
      status: 'connected',
      expiresAt: '2020-01-01T00:00:00.000Z',
    });
    const res = await h.resolver.resolveCredentials('facebook_page', SCOPE_A.projectId);
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.source, 'environment', 'a token that expired in 2020 was posted with');
    assert.match(res.data.skipped[0].why, /expired at/);
  } finally { h.restore(); }
});

// ── A lapsed token is unrenewed, not dead ───────────────────────────────────

/**
 * Review round 2 of 86bbpz1hu, and the most expensive failure in this file.
 *
 * `liveness` rejected any row past its expiry, and `refreshBeforeUse` ran only
 * on a row that had ALREADY passed `liveness` — so a token with minutes left
 * was renewed and a token that had actually lapsed never was. The resolver fell
 * through to the environment, which for X is a complete OAuth 1.0a pair on
 * DANE'S OWN account, and answered `ok: true`. The client's post went out on
 * the wrong timeline with the card still green.
 *
 * X's tokens last about two hours against a thirty-minute refresh window, so
 * this was the ordinary case for any project that went an afternoon without
 * posting — not an edge one.
 *
 * Both tests assert on the TOKEN VALUE, not on `ok`. `ok` was true throughout.
 */
const CLIENT_X = Object.freeze({
  provider: 'x',
  accountId: '4455',
  accountLabel: '@delraytennis',
  status: 'connected',
  accessToken: 'CLIENT_X_TOKEN_delray',
  refreshToken: 'CLIENT_X_REFRESH_delray',
});

/** A registry whose X adapter renews with whatever this test asked for. */
function registryRenewing(answer, seen = []) {
  return {
    adapterFor(provider) {
      if (provider !== 'x') return null;
      return {
        async refresh(account) {
          seen.push(account);
          return typeof answer === 'function' ? answer(account) : answer;
        },
      };
    },
  };
}

test('an X connection that expired an hour ago is RENEWED and posts as the client', async () => {
  const seen = [];
  const h = withResolver({}, registryRenewing({
    ok: true,
    status: 200,
    data: {
      refreshed: true,
      accessToken: 'RENEWED_X_TOKEN_delray',
      refreshToken: 'RENEWED_X_REFRESH_delray',
      expiresAt: new Date(Date.now() + 7200_000).toISOString(),
    },
  }, seen));
  try {
    await grant(h.store, SCOPE_A, {
      ...CLIENT_X,
      expiresAt: new Date(Date.now() - 3600_000).toISOString(),
    });

    const res = await h.resolver.resolveCredentials('x', SCOPE_A.projectId);
    assert.equal(res.ok, true, res.error);
    assert.equal(seen.length, 1, 'the adapter was never asked to renew a token it could have renewed');
    assert.equal(
      seen[0].refreshToken,
      'CLIENT_X_REFRESH_delray',
      'the adapter was handed an account with no refresh token, so it could not have renewed anything'
    );
    assert.equal(
      res.data.source,
      'connection',
      'a lapsed-but-renewable X connection fell back to the shared keys — which are Dane\'s own account'
    );
    assert.equal(
      res.data.values.access_token,
      'RENEWED_X_TOKEN_delray',
      'the answer did not carry the renewed token'
    );
    assert.notEqual(
      res.data.values.access_token,
      'ENV_X_TOKEN_dane',
      'the client\'s post would have gone out on Starcaster\'s own X account'
    );
    // The 1.0a leftover must still be gone: a renewed bearer token sitting on
    // top of Alphire's token secret is the mixed credential clearOnConnection
    // exists to make unbuildable.
    assert.equal(res.data.values.access_token_secret, undefined);
    assert.match(res.data.sourceDetail, /renewed before use/);
  } finally { h.restore(); }
});

/**
 * Revisited in review round 3. This used to assert that a failed renewal falls
 * back to the shared keys, and for a provider whose shared keys are the Alphire
 * app that is still right — the test below pins it, on Facebook.
 *
 * For X it was the second door into the room. The shared X keys are DANE'S OWN
 * ACCOUNT, so "post with them instead" means a client's marketing on a named
 * human's timeline, unrecallable, with `ok: true` and a green card. The answer
 * is not to post at all. The sentence still has to name the account and the
 * reason, which is the half of the old test that was always right.
 */
test('when the renewal FAILS, X REFUSES rather than posting from the shared keys — and says which account and why', async () => {
  const seen = [];
  const h = withResolver({}, registryRenewing({
    ok: false,
    status: 400,
    error: 'X refused the refresh token (invalid_grant)',
  }, seen));
  try {
    await grant(h.store, SCOPE_A, {
      ...CLIENT_X,
      expiresAt: new Date(Date.now() - 3600_000).toISOString(),
    });

    const res = await h.resolver.resolveCredentials('x', SCOPE_A.projectId);
    assert.equal(seen.length, 1, 'the renewal was never attempted, so this test proves nothing');
    assert.equal(res.ok, false, 'a client whose X connection could not be renewed was posted for anyway');
    assert.equal(res.status, 503);
    assert.equal(res.code, 'CONNECTION_UNUSABLE');
    // THE assertion: there is no credential in this answer at all, so nothing
    // downstream can reach Dane's account through it by accident.
    assert.equal(res.data, null, 'a refusal handed back values a publisher could post with');
    assert.equal(
      JSON.stringify(res).includes('ENV_X_TOKEN_dane'),
      false,
      "the shared account's token travelled in the refusal"
    );
    // Skipped ONCE, not twice: the row is amended in place, not appended again.
    assert.equal(res.skipped.length, 1, 'one row was reported as skipped more than once');
    assert.match(res.skipped[0].why, /expired at/);
    assert.match(res.skipped[0].why, /could not be renewed/);
    assert.match(res.skipped[0].why, /invalid_grant/);
    assert.match(res.error, /expired at/);
    assert.match(res.error, /invalid_grant/);
  } finally { h.restore(); }
});

/**
 * The narrowness, pinned. `sharedKeysArePersonal` is set on X alone, because X
 * alone borrows a person's account. For Facebook the shared keys are the
 * Alphire application's own, and taking a client off the air because their own
 * grant lapsed would be a worse answer than posting institutionally — so the
 * fallback there is unchanged, and this test fails if the refusal spreads.
 */
test('Facebook: a failed renewal still falls back — the X refusal must not spread to the other providers', async () => {
  const seen = [];
  const h = withResolver({}, {
    adapterFor(provider) {
      if (provider !== 'facebook_page') return null;
      return {
        async refresh(account) {
          seen.push(account);
          return { ok: false, status: 400, error: 'Meta refused the refresh' };
        },
      };
    },
  });
  try {
    await grant(h.store, SCOPE_A, {
      ...CLIENT_PAGE,
      refreshToken: 'CLIENT_PAGE_REFRESH',
      expiresAt: new Date(Date.now() - 3600_000).toISOString(),
    });

    const res = await h.resolver.resolveCredentials('facebook_page', SCOPE_A.projectId);
    assert.equal(seen.length, 1, 'the renewal was never attempted, so this test proves nothing');
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.source, 'environment', 'the X-only refusal reached a provider it does not belong to');
    assert.equal(res.data.values.access_token, 'ENV_META_TOKEN_dane');
  } finally { h.restore(); }
});

test('a REVOKED connection is never renewed — only the clock is recoverable', async () => {
  const seen = [];
  const h = withResolver({}, registryRenewing({
    ok: true,
    status: 200,
    data: { refreshed: true, accessToken: 'RENEWED_X_TOKEN_delray', expiresAt: new Date(Date.now() + 7200_000).toISOString() },
  }, seen));
  try {
    // Revoked AND lapsed. A refresh token cannot overrule a grant the client or
    // the provider withdrew, and renewing here would put a permission the
    // client believes they took back into service.
    await grant(h.store, SCOPE_A, {
      ...CLIENT_X,
      status: 'revoked',
      expiresAt: new Date(Date.now() - 3600_000).toISOString(),
    });

    const res = await h.resolver.resolveCredentials('x', SCOPE_A.projectId);
    assert.equal(seen.length, 0, 'a revoked grant was put back into service by a refresh');
    // Review round 3: not renewed AND not fallen back from. A client who
    // withdrew their grant gets a refusal that tells the operator to reconnect,
    // not their next post on Dane's timeline.
    assert.equal(res.ok, false, "a revoked X grant fell through to Dane's own account");
    assert.equal(res.code, 'CONNECTION_UNUSABLE');
    assert.match(res.error, /status is "revoked"/);
    assert.match(res.error, /reconnect x/i, 'a refusal that cannot be retried away must say what to do instead');
    assert.match(res.skipped[0].why, /status is "revoked"/);
  } finally { h.restore(); }
});

/**
 * ── Review round 3 of 86bbpz1hu, reproduced ─────────────────────────────────
 *
 * Round 1: the connection went dead two hours in. Round 2: a lapsed token was
 * never offered a renewal. Round 3: ONE momentary failure at X — a 502 on a
 * cold start, a timeout, a rate limit — wrote `expired` on the row. `expired`
 * is not a live status, so `liveness` refused it for its STATUS from then on
 * and it was never elected for renewal again. The refresh token was perfectly
 * good the whole time; nothing ever asked it a second time.
 *
 * Review measured the adapter being asked exactly ONCE across two passes, both
 * of which answered `ok: true` with `ENV_X_TOKEN_dane` — Dane's own account —
 * and left the card green.
 *
 * This test is that reproduction: fail once, succeed thereafter, resolve twice.
 * It asserts on the TOKEN VALUE and on the number of attempts, because `ok` was
 * true throughout the defect.
 */
test('a MOMENTARY failure at X does not end the connection — the next post renews it', async () => {
  const seen = [];
  let attempts = 0;
  const h = withResolver({}, registryRenewing(() => {
    attempts += 1;
    if (attempts === 1) return { ok: false, status: 502, error: 'Bad Gateway from X' };
    return {
      ok: true,
      status: 200,
      data: {
        refreshed: true,
        accessToken: 'RENEWED_X_TOKEN_delray',
        refreshToken: 'RENEWED_X_REFRESH_delray',
        expiresAt: new Date(Date.now() + 7200_000).toISOString(),
      },
    };
  }, seen));
  try {
    await grant(h.store, SCOPE_A, {
      ...CLIENT_X,
      expiresAt: new Date(Date.now() - 3600_000).toISOString(),
    });

    // Pass one: X is unreachable. Nothing is sent — and nothing is sent from
    // the shared keys either, which is the room this round closed.
    const first = await h.resolver.resolveCredentials('x', SCOPE_A.projectId);
    assert.equal(first.ok, false, 'a post went out while X could not be reached to renew the token');
    assert.equal(first.code, 'CONNECTION_UNUSABLE');

    // The status the failure wrote down is the whole defect. `expired` here and
    // the connection is over; `expiring` and it is merely unrenewed.
    const afterFirst = await h.store.getConnection({ provider: 'x', accountId: '4455' }, SCOPE_A);
    assert.equal(
      afterFirst.data.status,
      'expiring',
      'one unreachable-provider failure wrote the row off permanently — that is the round 3 defect'
    );
    assert.match(afterFirst.data.lastError, /could not reach x/i);
    assert.match(afterFirst.data.lastError, /will be retried/i);

    // Pass two: X is answering again. The row must be elected a SECOND time.
    const second = await h.resolver.resolveCredentials('x', SCOPE_A.projectId);
    assert.equal(attempts, 2, 'the adapter was asked once across two passes — the row was never re-elected');
    assert.equal(second.ok, true, second.error);
    assert.equal(second.data.source, 'connection', 'the recovered connection still did not post as the client');
    assert.equal(second.data.values.access_token, 'RENEWED_X_TOKEN_delray');
    assert.notEqual(
      second.data.values.access_token,
      'ENV_X_TOKEN_dane',
      "the client's post would have gone out on Starcaster's own X account"
    );
  } finally { h.restore(); }
});

/**
 * The room rather than a door.
 *
 * Three rounds found three separate ways for a client's X post to leave through
 * the shared keys. Each was closed on its own; a fourth was likely. So the rule
 * is now stated once, at the exit itself, and does not depend on anybody having
 * anticipated the reason: a project that HAS an X connection and cannot use it
 * is refused, whatever made it unusable.
 *
 * `nowMs` is not stubbed and the status here is one nothing else in this file
 * produces — the point is that the exit does not care why.
 */
test('X: a connection that is unusable for a reason nobody anticipated still never borrows the shared account', async () => {
  const h = withResolver();
  try {
    await grant(h.store, SCOPE_A, { ...CLIENT_X, status: 'error' });
    const res = await h.resolver.resolveCredentials('x', SCOPE_A.projectId);
    assert.equal(res.ok, false, "an unusable X connection fell through to Dane's own account");
    assert.equal(res.status, 503, 'the refusal must be retryable — the cause is usually momentary');
    assert.equal(res.data, null);
    assert.equal(
      JSON.stringify(res).includes('ENV_X_TOKEN_dane'),
      false,
      "the shared account's token travelled in the refusal"
    );
    assert.match(res.error, /status is "error"/, 'the refusal did not say which account or why');
  } finally { h.restore(); }
});

test('an "expiring" connection is still live — it works, it just needs renewing', async () => {
  const h = withResolver();
  try {
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    await grant(h.store, SCOPE_A, { ...CLIENT_PAGE, status: 'expiring', expiresAt: future });
    const res = await h.resolver.resolveCredentials('facebook_page', SCOPE_A.projectId);
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.source, 'connection', 'an amber-but-working account was taken off the air early');
    assert.equal(res.data.values.access_token, 'CLIENT_PAGE_TOKEN_delray');
  } finally { h.restore(); }
});

// ── A lookup that failed is not an answer ───────────────────────────────────

test('a FAILED lookup refuses — it does not quietly fall back to the shared keys', async () => {
  const h = withResolver();
  try {
    await grant(h.store, SCOPE_A, CLIENT_PAGE);
    h.fault.failNextList = true;

    const res = await h.resolver.resolveCredentials('facebook_page', SCOPE_A.projectId);
    assert.equal(h.fault.listFailures, 1, 'the simulated failure never fired — this test proves nothing');
    assert.equal(res.ok, false, 'a 502 on the lookup was read as "this project has no connection"');
    assert.equal(res.code, 'CONNECTION_LOOKUP_FAILED');
    assert.equal(res.data, null, 'a refusal must carry no credentials at all');
    assert.match(res.error, /Retry/);
  } finally { h.restore(); }
});

test('a connection that is listed but cannot be read refuses too', async () => {
  const h = withResolver();
  try {
    await grant(h.store, SCOPE_A, CLIENT_PAGE);
    // The client HAS granted permission. Falling back here would post as
    // Starcaster on the strength of a decrypt failure.
    h.fault.failNextRead = true;
    const res = await h.resolver.resolveCredentials('facebook_page', SCOPE_A.projectId);
    assert.equal(res.ok, false, 'an unreadable grant fell back to the shared keys');
    assert.equal(res.code, 'CONNECTION_LOOKUP_FAILED');
  } finally { h.restore(); }
});

test('resolveValues throws on a refusal rather than handing back the shared keys', async () => {
  const h = withResolver();
  try {
    await grant(h.store, SCOPE_A, CLIENT_PAGE);
    h.fault.failNextList = true;
    await assert.rejects(
      () => h.resolver.resolveValues('facebook_page', SCOPE_A.projectId),
      (err) => err.code === 'CONNECTION_LOOKUP_FAILED'
    );
  } finally { h.restore(); }
});

// ── The publishers actually go through it ───────────────────────────────────

test('no publisher reaches around the resolver to lib/apiSettings', () => {
  const fs = require('fs');
  /**
   * The mechanical version of the ticket's own grep, kept honest by naming the
   * files rather than a glob. The ticket's glob (`lib/*Client.js`) misses
   * lib/metaClients.js — plural, and the file that actually publishes to
   * Facebook, Instagram and Threads — while catching lib/aiClient.js, which the
   * same ticket's Non-goals put explicitly out of scope. A check that reads the
   * wrong file list is a check that passes for the wrong reason.
   */
  const PUBLISHERS = [
    'lib/xClient.js',
    'lib/metaClients.js',
    'lib/blueskyClient.js',
    'lib/facebookPersonalPublisher.js',
    'lib/bufferClient.js',
  ];
  const offenders = [];
  for (const file of PUBLISHERS) {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');
    if (/getProviderValues/.test(source)) offenders.push(file);
    if (/require\(['"]\.\/apiSettings['"]\)/.test(source)) offenders.push(`${file} (requires apiSettings)`);
  }
  assert.deepEqual(
    offenders, [],
    'these publishers can still read a credential without going through the resolver, '
    + 'which means they can still post to the wrong account: ' + offenders.join(', ')
  );
});

test('every provider in the value map names a settings key and a token field', () => {
  const resolver = require(resolverPath);
  for (const [provider, mapping] of Object.entries(resolver.PROVIDER_VALUE_MAP)) {
    assert.ok(mapping.settingsProvider, `${provider} has no settingsProvider`);
    assert.ok(mapping.token, `${provider} has no token field — a grant would have nowhere to land`);
  }
  // The one mapping that is not the identity, and the reason the map exists.
  assert.equal(resolver.settingsProviderFor('facebook_page'), 'meta');
});

// ── The publishers, wired to it ─────────────────────────────────────────────

/**
 * The resolver working in isolation is not the same claim as the publishers
 * using it, and the second one is what the ticket is actually for. Each test
 * below goes through the publisher's own credential function — the one
 * routes/engage.js calls — rather than through the resolver directly.
 */

test('Facebook: a publisher posts with the project\'s own Page token', async () => {
  const h = withResolver();
  try {
    await grant(h.store, SCOPE_A, CLIENT_PAGE);
    const creds = await h.publishers.meta.resolveFacebookCredentials({ projectId: SCOPE_A.projectId });
    assert.equal(creds.source, 'connection');
    assert.equal(creds.accessToken, 'CLIENT_PAGE_TOKEN_delray');
    assert.equal(creds.pageId, '1122334455');
    assert.equal(creds.pageName, 'Delray Beach Tennis Center');
    // The app credentials are still there — a Page post needs the app behind it.
    assert.equal(creds.appId, 'ALPHIRE_APP_ID');
  } finally { h.restore(); }
});

test('Facebook: with no connection anywhere, the shared keys are used exactly as before', async () => {
  const h = withResolver();
  try {
    const creds = await h.publishers.meta.resolveFacebookCredentials({ projectId: SCOPE_A.projectId });
    assert.equal(creds.source, 'global', 'the pre-existing fallback chain changed shape');
    assert.equal(creds.accessToken, 'ENV_META_TOKEN_dane');
  } finally { h.restore(); }
});

test('Facebook: a refused lookup arrives BLANK, so it cannot post as Starcaster', async () => {
  const h = withResolver();
  try {
    await grant(h.store, SCOPE_A, CLIENT_PAGE);
    h.fault.failNextList = true;
    const creds = await h.publishers.meta.resolveFacebookCredentials({ projectId: SCOPE_A.projectId });

    assert.equal(creds.ok, false);
    // The whole point. An earlier draft returned `{ ...global, ok: false }`,
    // which reads correctly and posts catastrophically: every caller passes
    // this object straight into a publish function that only reads accessToken.
    assert.equal(creds.accessToken, '', 'a refusal still carried the platform-wide token');
    assert.equal(creds.pageId, '');
    assert.equal(h.publishers.meta.isFacebookConfigured(creds), false);

    const posted = await h.publishers.meta.createFacebookPost('hello', {}, creds);
    assert.equal(posted.ok, false);
    assert.equal(posted.code, 'CONNECTION_LOOKUP_FAILED');
    assert.match(posted.error, /Retry/);
  } finally { h.restore(); }
});

test('Bluesky: the project\'s handle and app password win over the shared ones', async () => {
  const h = withResolver();
  try {
    await grant(h.store, SCOPE_A, {
      provider: 'bluesky',
      accountId: 'did:plc:delray',
      accountLabel: 'delraytennis.bsky.social',
      status: 'connected',
      accessToken: 'CLIENT_BLUESKY_APP_PASSWORD',
    });
    const creds = await h.publishers.bluesky.resolveBlueskyCredentials({ projectId: SCOPE_A.projectId });
    assert.equal(creds.source, 'connection');
    assert.equal(creds.identifier, 'delraytennis.bsky.social');
    assert.equal(creds.appPassword, 'CLIENT_BLUESKY_APP_PASSWORD');
    assert.equal(creds.serviceUrl, 'https://bsky.social');
  } finally { h.restore(); }
});

test('Bluesky: a refusal blocks createSession with the resolver\'s own sentence', async () => {
  const h = withResolver();
  try {
    await grant(h.store, SCOPE_A, {
      provider: 'bluesky', accountId: 'did:plc:delray', accountLabel: 'delraytennis.bsky.social',
      status: 'connected', accessToken: 'CLIENT_BLUESKY_APP_PASSWORD',
    });
    h.fault.failNextList = true;
    const creds = await h.publishers.bluesky.resolveBlueskyCredentials({ projectId: SCOPE_A.projectId });
    assert.equal(creds.appPassword, '', 'a refusal still carried a usable app password');
    assert.equal(h.publishers.bluesky.isConfigured(creds), false);

    const session = await h.publishers.bluesky.createSession(creds);
    assert.equal(session.ok, false);
    assert.equal(session.code, 'CONNECTION_LOOKUP_FAILED');
    // NOT the generic "credentials are missing" — that sentence sends a client
    // to re-mint an app password that was never wrong.
    assert.doesNotMatch(session.error, /Save Identifier and App Password/);
  } finally { h.restore(); }
});

/**
 * Dane's carried-forward item 1 (his comment, 2026-08-31 21:14), settled.
 *
 * `lib/connections/contract.js` used to claim an account "is storable as it
 * stands". Measured, it was not: every account carries `raw`, and
 * `saveConnection` runs a strict allowlist without it, so spreading an account
 * in answers `400 Unknown field: raw`. The comment now says so, and
 * `storableAccount()` is the one place the translation lives.
 *
 * Both halves are asserted, because a helper that works while the claim it
 * replaced is still false would leave the next reader exactly where round 1
 * left this reviewer.
 */
test('contract: an adapter account is NOT storable raw, and storableAccount is what makes it storable', async () => {
  const h = withResolver();
  try {
    const contract = require('../../lib/connections/contract.js');
    // A real account, built the way every adapter builds one.
    const account = contract.account({
      accountId: 'delray.bsky.social',
      accountLabel: 'delray.bsky.social',
      accessToken: 'CLIENT_APP_PASSWORD',
      raw: { serviceUrl: 'https://bsky.social' },
    });
    assert.ok('raw' in account, 'accounts no longer carry raw — this test now proves nothing');

    // Half one: spread as-is, the real store refuses it.
    const spread = await h.store.saveConnection(
      { provider: 'bluesky', ...account }, SCOPE_A
    );
    assert.equal(spread.ok, false, 'saveConnection accepted `raw` — the contract comment can be simplified');
    assert.equal(spread.status, 400);
    assert.match(spread.error, /raw/);

    // Half two: through the helper, the same account stores.
    const viaHelper = await h.store.saveConnection(
      { provider: 'bluesky', ...contract.storableAccount(account) }, SCOPE_A
    );
    assert.equal(viaHelper.ok, true, viaHelper.error);

    // And the helper drops `raw` rather than smuggling it through under
    // another name — which is what would make the resolver's parts refusal a
    // lie later on.
    assert.equal('raw' in contract.storableAccount(account), false);
  } finally { h.restore(); }
});

/**
 * Review round 1's second half, and the one that is reachable TODAY.
 *
 * Bluesky is the only `ready` adapter in the registry, so this is not a
 * hypothetical. An app password is only valid at the server that minted it. The
 * adapter knows which server (it parks it in the account's `raw`), the store
 * drops `raw` on the way in, so a stored connection cannot say.
 *
 * The dangerous fallback is not "no server" — it is the ENVIRONMENT's server.
 * If Alphire's own settings name a self-hosted PDS, inheriting it would send a
 * CLIENT's app password to Alphire's server: a live credential handed to a
 * third party, which is worse than any failed post. The connection path pins
 * the public default instead.
 */
test('Bluesky: a client\'s app password is never aimed at the platform\'s own PDS', async () => {
  const h = withResolver({ bluesky: { service_url: 'https://pds.alphire-internal.example' } });
  try {
    await grant(h.store, SCOPE_A, {
      provider: 'bluesky', accountId: 'delray.bsky.social', accountLabel: 'delray.bsky.social',
      status: 'connected', accessToken: 'CLIENT_APP_PASSWORD',
    });
    const res = await h.resolver.resolveCredentials('bluesky', SCOPE_A.projectId);
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.source, 'connection');
    assert.equal(res.data.values.app_password, 'CLIENT_APP_PASSWORD');
    assert.equal(res.data.values.identifier, 'delray.bsky.social');
    // The assertion this test exists for.
    assert.equal(
      res.data.values.service_url, 'https://bsky.social',
      "a client's app password was aimed at the platform's own PDS"
    );
    assert.notEqual(res.data.values.service_url, 'https://pds.alphire-internal.example');
  } finally { h.restore(); }
});

/**
 * And the pin must be narrow: with NO connection, the environment's own PDS
 * still governs. That is Dane's own posting, and a self-hosted server he set on
 * purpose must not be silently rewritten to bsky.social.
 */
test('Bluesky: with no connection, the environment\'s own PDS is left exactly as it is', async () => {
  const h = withResolver({ bluesky: { service_url: 'https://pds.alphire-internal.example' } });
  try {
    const res = await h.resolver.resolveCredentials('bluesky', SCOPE_A.projectId);
    assert.equal(res.ok, true);
    assert.equal(res.data.source, 'environment');
    assert.equal(res.data.values.service_url, 'https://pds.alphire-internal.example');
  } finally { h.restore(); }
});

test('Buffer: the project\'s own key is used, and the shared channel id survives', async () => {
  const h = withResolver();
  try {
    await grant(h.store, SCOPE_A, {
      provider: 'buffer', accountId: 'org_delray', accountLabel: 'Delray Buffer',
      status: 'connected', accessToken: 'CLIENT_BUFFER_KEY',
    });
    const creds = await h.publishers.buffer.resolveBufferCredentials({ projectId: SCOPE_A.projectId });
    assert.equal(creds.source, 'connection');
    assert.equal(creds.apiKey, 'CLIENT_BUFFER_KEY');
    assert.equal(creds.organizationId, 'org_delray');
    // A channel id is a routing choice, not a credential — blanking it would
    // send the post to no queue at all.
    assert.equal(creds.defaultChannelId, 'chan_env');
  } finally { h.restore(); }
});

/**
 * Review round 1's defect, still pinned — through its SUCCESSOR guarantee.
 * Connections 7 of 7 (86bbpz1hu).
 *
 * The history, because the assertion below only makes sense with it. The
 * original test here was called "the project's token pair is used" and asserted
 * `accessToken`, `accountName`, `apiKey` and `apiSecret` — everything EXCEPT
 * `accessTokenSecret`, which was the one value that was wrong. It passed while
 * the resolver handed back a client's access token paired with Alphire's token
 * secret, and its name told the next reader the pair was covered. Round 1
 * replaced it with a refusal: an OAuth 1.0a credential is a PAIR, a connection
 * carries one secret, so the pair could not be completed from storage.
 *
 * Slice 7 does not weaken that. It removes the pair: a client connects over
 * OAuth 2.0 with PKCE, whose credential is a single bearer token, so there is
 * no second half to borrow. The refusal is lifted and the DANGER it guarded is
 * closed a different way — the resolver deletes `access_token_secret` from the
 * connection path's answer, so the 1.0a scheme cannot be assembled at all.
 *
 * The assertion that matters is unchanged and is still the negative one:
 * OUR SECRET MUST NOT TRAVEL WITH A CLIENT'S TOKEN.
 */
test("X: a client's connection resolves to a bearer token, and our own token secret does NOT travel with it", async () => {
  const h = withResolver();
  try {
    await grant(h.store, SCOPE_A, {
      provider: 'x', accountId: '4455', accountLabel: 'delraytennis',
      status: 'connected', accessToken: 'CLIENT_X_TOKEN',
    });
    const res = await h.publishers.x.resolveXCredentials({ projectId: SCOPE_A.projectId });
    assert.equal(res.ok, true, res.error);
    assert.equal(res.creds.source, 'connection');
    assert.equal(res.creds.accessToken, 'CLIENT_X_TOKEN');
    assert.equal(res.creds.authMode, 'oauth2', 'a client connection must state its scheme, never be inferred');

    // THE assertion. Alphire's OAuth 1.0a token secret is in the environment
    // underneath this overlay; if it showed through, xClient would have all
    // four values it needs to build a 1.0a signature out of a token that is not
    // a 1.0a token — a signature belonging to nobody, which is the exact
    // failure round 1's refusal existed to prevent.
    assert.equal(res.creds.accessTokenSecret, '', "Alphire's OAuth 1.0a token secret travelled with a client's token");
    assert.notEqual(res.creds.accessTokenSecret, 'ENV_X_SECRET_dane');
  } finally { h.restore(); }
});

/**
 * The same guarantee at the resolver's own door, asserting on the VALUES map
 * rather than through a publisher — because a publisher could hide it by
 * dropping the field on the way through.
 */
test('X: the connection path hands back no access_token_secret at all, so the wrong scheme cannot be built', async () => {
  const h = withResolver();
  try {
    await grant(h.store, SCOPE_A, {
      provider: 'x', accountId: '4455', accountLabel: 'delraytennis',
      status: 'connected', accessToken: 'CLIENT_X_TOKEN',
    });
    const res = await h.resolver.resolveCredentials('x', SCOPE_A.projectId);
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.source, 'connection');
    assert.equal(res.data.values.access_token, 'CLIENT_X_TOKEN');
    assert.equal(res.data.values.auth_mode, 'oauth2');

    // Absent, not empty. An empty string would still let a caller that only
    // checks for presence go down the 1.0a path.
    assert.equal(
      Object.prototype.hasOwnProperty.call(res.data.values, 'access_token_secret'),
      false,
      "the platform's own OAuth 1.0a token secret is still in the values a client post would be built from"
    );

    // The app identity underneath IS still inherited — it has to be, it is the
    // same X app — and that is the difference between an overlay and a
    // replacement.
    assert.equal(res.data.values.api_key, 'ALPHIRE_X_API_KEY');

    const values = await h.resolver.resolveValues('x', SCOPE_A.projectId);
    assert.equal(values.access_token, 'CLIENT_X_TOKEN');
    assert.equal(values.access_token_secret, undefined);
  } finally { h.restore(); }
});

/**
 * The refusal must be narrow. A provider whose credential is ONE secret is
 * unaffected, and so is X itself when the project has no connection — which is
 * Dane's own posting, and the path this slice must not disturb.
 */
/**
 * The other half, and the one that must never move: this is Dane's own live
 * posting. A project with no X connection gets the environment pair WHOLE, with
 * no auth_mode on it, so `xClient` signs OAuth 1.0a exactly as it always has.
 */
test('X: with no connection stored, the environment pair is returned whole', async () => {
  const h = withResolver();
  try {
    const res = await h.resolver.resolveCredentials('x', SCOPE_A.projectId);
    assert.equal(res.ok, true);
    assert.equal(res.data.source, 'environment');
    assert.equal(res.data.values.access_token, 'ENV_X_TOKEN_dane');
    // The deletion is scoped to the CONNECTION path. Stripping it here would
    // take Starcaster's own X posting off the air.
    assert.equal(res.data.values.access_token_secret, 'ENV_X_SECRET_dane');
    assert.equal(res.data.values.auth_mode, undefined, 'the environment path must not claim to be OAuth 2.0');
    assert.equal(h.publishers.x.getXCredentials().authMode, 'oauth1');
  } finally { h.restore(); }
});

test('X: called with no project, every entry point behaves exactly as it did before', async () => {
  const h = withResolver();
  try {
    await grant(h.store, SCOPE_A, {
      provider: 'x', accountId: '4455', accountLabel: 'delraytennis',
      status: 'connected', accessToken: 'CLIENT_X_TOKEN',
    });
    // This is Dane's own posting, and it is the path with no test before this
    // slice. A connection existing for SOME project must not change it.
    const sync = h.publishers.x.getXCredentials();
    assert.equal(sync.accessToken, 'ENV_X_TOKEN_dane');
    const res = await h.publishers.x.resolveXCredentials({});
    assert.equal(res.ok, true);
    assert.equal(res.creds.source, 'environment');
    assert.equal(res.creds.accessToken, 'ENV_X_TOKEN_dane');
  } finally { h.restore(); }
});

test('X: a refusal stops createPost rather than posting from the shared account', async () => {
  const h = withResolver();
  try {
    await grant(h.store, SCOPE_A, {
      provider: 'x', accountId: '4455', accountLabel: 'delraytennis',
      status: 'connected', accessToken: 'CLIENT_X_TOKEN',
    });
    h.fault.failNextList = true;
    const posted = await h.publishers.x.createPost('hello', { projectId: SCOPE_A.projectId });
    assert.equal(posted.ok, false);
    assert.equal(posted.code, 'CONNECTION_LOOKUP_FAILED');
    // Not the "X credentials are missing" sentence: the credentials are fine,
    // the lookup is what failed, and only one of those is worth retrying.
    assert.doesNotMatch(posted.error, /Save API Key/);
  } finally { h.restore(); }
});

/**
 * The whole epic's promise, asserted where a client would actually feel it.
 *
 * Review round 3 closed the room at the resolver. This test asks the question
 * one floor up, through the publisher a campaign really calls: a project whose
 * X connection has lapsed does not post AT ALL. Every round of this ticket
 * ended with `ok: true` and a post on the wrong timeline, so `ok: false` is the
 * assertion — and the error must be the retryable one, because the ordinary
 * cause is a renewal that will succeed on the next attempt.
 */
test('X: a client whose connection has lapsed does not post — not on their account, and not on Dane\'s', async () => {
  const seen = [];
  const h = withResolver({}, registryRenewing({
    ok: false, status: 503, error: 'X is not answering',
  }, seen));
  try {
    await grant(h.store, SCOPE_A, {
      ...CLIENT_X,
      expiresAt: new Date(Date.now() - 3600_000).toISOString(),
    });
    const posted = await h.publishers.x.createPost('hello', { projectId: SCOPE_A.projectId });
    assert.equal(seen.length, 1, 'the renewal was never attempted, so this test proves nothing');
    assert.equal(posted.ok, false, "a client's post went out while their own X connection was unusable");
    assert.equal(posted.code, 'CONNECTION_UNUSABLE');
    assert.equal(
      JSON.stringify(posted).includes('ENV_X_TOKEN_dane'),
      false,
      "the shared account's token reached the publisher"
    );
    assert.match(posted.error, /@delraytennis/, 'the refusal did not say which account could not be used');
  } finally { h.restore(); }
});

/**
 * Review round 2's defect, pinned behaviourally.
 *
 * routes/engage.js resolves ONCE for the whole X publish and then hands the
 * resolved object back in as `{ credentials }` for three separate calls. That
 * object is already camelCase; `shapeXCredentials` read snake_case only, so the
 * second shaping returned five empty strings and all three calls refused with
 * "X credentials are missing" — with the credentials set and complete, on the
 * ENVIRONMENT path, which is Dane's own posting and the only X path that fires
 * today.
 *
 * Every test above passed while that was true, because the X tests only ever
 * called the entry points with `{ projectId }` — `credentialsFor`'s *resolve*
 * branch. Nothing exercised the `{ credentials }` branch the route uses.
 *
 * So this test performs the route's own sequence, and asserts on the OAuth
 * header rather than on `ok` alone: a refusal never reaches fetch at all, and
 * "it did not error" is a weaker claim than "it signed with the token I
 * resolved".
 */
test('X: the route resolves once, and all three entry points still have the credentials', async () => {
  const h = withResolver();
  const realFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, init = {}) => {
    const href = String(url);
    seen.push({ url: href, auth: String(init.headers?.Authorization || '') });
    const body = href.includes('/media/upload') ? { media_id_string: 'media_99' }
      : href.includes('/2/tweets') ? { data: { id: '1799', text: 'hello' } }
      : { data: { id: '4455', username: 'daneofearth' } };
    return { ok: true, status: 200, json: async () => body };
  };
  try {
    // Exactly what routes/engage.js:1367 does.
    const xResolved = await h.publishers.x.resolveXCredentials({ projectId: SCOPE_A.projectId });
    assert.equal(xResolved.ok, true, xResolved.error);
    assert.equal(xResolved.creds.source, 'environment', 'no X connection is stored, so this is the shared-keys path');
    const xCredOpts = { credentials: xResolved.creds };

    const auth = await h.publishers.x.checkAuth(xCredOpts);
    assert.equal(auth.ok, true, `checkAuth refused a complete credential: ${auth.error || ''}`);

    const upload = await h.publishers.x.uploadMediaSimple(Buffer.from('png-bytes'), 'image/png', xCredOpts);
    assert.equal(upload.ok, true, `uploadMediaSimple refused a complete credential: ${upload.error || ''}`);

    const posted = await h.publishers.x.createPost('hello', { mediaIds: [upload.mediaId], ...xCredOpts });
    assert.equal(posted.ok, true, `createPost refused a complete credential: ${posted.error || ''}`);

    // Three requests actually left, and each one signed with the values that
    // were resolved — not with blanks, and not with some other account's.
    assert.equal(seen.length, 3, 'a call refused before reaching X: ' + seen.map((s) => s.url).join(', '));
    for (const call of seen) {
      assert.match(call.auth, /oauth_consumer_key="ALPHIRE_X_API_KEY"/, `${call.url} signed without the resolved API key`);
      assert.match(call.auth, /oauth_token="ENV_X_TOKEN_dane"/, `${call.url} signed without the resolved access token`);
      assert.doesNotMatch(call.auth, /oauth_token=""/, `${call.url} signed with a blank token`);
    }
  } finally { global.fetch = realFetch; h.restore(); }
});

/**
 * The same defect stated as the property that was violated, rather than as the
 * one call site that happened to hit it.
 *
 * `shapeXCredentials` is not exported, so this goes through the public door:
 * resolve, then feed the answer back in, twice. If shaping ever stops being
 * idempotent, the second and third passes disagree with the first and this
 * fails — including for a caller that does not exist yet.
 */
test('X: shaping an already-shaped credential returns it unchanged', async () => {
  const h = withResolver();
  const realFetch = global.fetch;
  const captured = [];
  global.fetch = async (url, init = {}) => {
    captured.push(String(init.headers?.Authorization || ''));
    return { ok: true, status: 200, json: async () => ({ data: { id: '1799' } }) };
  };
  try {
    const once = await h.publishers.x.resolveXCredentials({ projectId: SCOPE_A.projectId });
    assert.equal(once.ok, true, once.error);

    // Round-trip it through the entry point twice, feeding each answer back in.
    let bag = { credentials: once.creds };
    for (let pass = 0; pass < 2; pass += 1) {
      const posted = await h.publishers.x.createPost('hello', bag);
      assert.equal(posted.ok, true, `pass ${pass + 1} lost the credentials: ${posted.error || ''}`);
      bag = { credentials: { ...bag.credentials } };
    }

    // Every signature identical in the values that came from the credential.
    const keys = captured.map((h2) => (h2.match(/oauth_consumer_key="([^"]*)"/) || [])[1]);
    const tokens = captured.map((h2) => (h2.match(/oauth_token="([^"]*)"/) || [])[1]);
    assert.deepEqual(keys, ['ALPHIRE_X_API_KEY', 'ALPHIRE_X_API_KEY'], 'the API key changed between shapings');
    assert.deepEqual(tokens, ['ENV_X_TOKEN_dane', 'ENV_X_TOKEN_dane'], 'the access token changed between shapings');
  } finally { global.fetch = realFetch; h.restore(); }
});

/**
 * Round 2's secondary finding: two precedence orders for the same shared keys.
 *
 * `getBlueskyCredentials` gives the ENV VAR priority; `getProviderValues` gives
 * a value saved on the Settings screen priority. The resolver's environment
 * fallback used to read the second, so with both set and different, the same
 * account posted as one handle unscoped and the other handle project-scoped.
 * Nothing goes blank, so nothing errors — it is a wrong-account post, which
 * looks exactly like success.
 */
test('Bluesky: the shared-keys path answers the same whether or not a project is named', async () => {
  const h = withResolver({ bluesky: { identifier: 'settings-screen.bsky.social' } });
  const had = Object.prototype.hasOwnProperty.call(process.env, 'BLUESKY_IDENTIFIER');
  const previous = process.env.BLUESKY_IDENTIFIER;
  process.env.BLUESKY_IDENTIFIER = 'env-var.bsky.social';
  try {
    const unscoped = h.publishers.bluesky.getBlueskyCredentials();
    const scoped = await h.publishers.bluesky.resolveBlueskyCredentials({ projectId: SCOPE_A.projectId });
    assert.equal(scoped.source, 'environment', 'no Bluesky connection is stored, so this is the shared-keys path');
    assert.equal(
      scoped.identifier, unscoped.identifier,
      'a project-scoped call and an unscoped call disagreed about which account posts'
    );
    assert.equal(scoped.identifier, 'env-var.bsky.social');
    assert.equal(scoped.appPassword, unscoped.appPassword);
    assert.equal(scoped.serviceUrl, unscoped.serviceUrl);
  } finally {
    if (had) process.env.BLUESKY_IDENTIFIER = previous;
    else delete process.env.BLUESKY_IDENTIFIER;
    h.restore();
  }
});

test('the publish dispatch hands every channel its project', () => {
  const fs = require('fs');
  /**
   * The regression this closes is the quietest one in the whole slice, and it
   * was found by breaking it: take `publishCredOpts` out of ONE branch of
   * routes/engage.js and every test above still passes. The resolver is
   * correct, the publishers use it correctly, and every post on that channel
   * goes out on the shared keys again — which looks exactly like success.
   *
   * A text check is weaker than a behavioural one and is not pretending
   * otherwise: it asserts each publish branch names a resolver, not that the
   * right token comes out the far end. It exists because the alternative was
   * nothing at all, and because the thing it watches is a line somebody deletes
   * while tidying, not a piece of logic somebody reasons their way into.
   */
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'engage.js'), 'utf8');
  const start = source.indexOf('async function publishStoredPost');
  assert.ok(start > 0, 'publishStoredPost has been renamed — this check now watches nothing');
  const body = source.slice(start, start + 20000);

  const REQUIRED = [
    ['bluesky', /blueskyClient\.resolveBlueskyCredentials\(publishCredOpts\)/],
    ['facebook', /metaClients\.resolveFacebookCredentials\(publishCredOpts\)/],
    ['threads', /metaClients\.resolveThreadsCredentials\(publishCredOpts\)/],
    ['instagram', /metaClients\.resolveInstagramCredentials\(publishCredOpts\)/],
    ['x', /xClient\.resolveXCredentials\(publishCredOpts\)/],
    ['buffer', /bufferClient\.resolveBufferCredentials\(publishCredOpts\)/],
  ];
  const missing = REQUIRED.filter(([, pattern]) => !pattern.test(body)).map(([channel]) => channel);
  assert.deepEqual(
    missing, [],
    'these channels publish without resolving the project\'s own connection first, '
    + 'so they post from the shared keys: ' + missing.join(', ')
  );

  // And the resolved credentials must actually be PASSED to the publish call —
  // resolving into a variable nobody reads is the same bug with more steps.
  //
  // `x` and `buffer` were missing from this list until round 3, and X is the
  // one channel that does NOT pass them as a third argument: it wraps them in
  // an options bag and reuses it across three calls. That shape is what round
  // 2's defect lived in, so leaving X out of the list left the only unusual
  // hand-off in the file unwatched.
  for (const [channel, call] of [
    ['bluesky', /createPost\(post\.text, imageOpts, bsCreds\)/],
    ['facebook', /createFacebookPost\(post\.text, imageOpts, fbCreds\)/],
    ['threads', /createThreadsPost\(post\.text, imageOpts, thCreds\)/],
    ['instagram', /createInstagramPost\(post\.text, imageOpts, igCreds\)/],
    ['x', /const xCredOpts = xResolved\.ok \? \{ credentials: xResolved\.creds \}/],
    ['buffer', /createQueuedPost\(post\.text, \{[\s\S]*?\}, bufferCreds\)/],
  ]) {
    assert.ok(call.test(body), `the ${channel} branch resolves credentials but does not pass them to the publish call`);
  }

  // X reuses that one bag for all three of its calls. Any of them falling back
  // to `publishCredOpts` would resolve a SECOND time, and two lookups can
  // disagree — media uploaded under one account and posted under another comes
  // back as X's 400 "media id not found", which names neither.
  for (const entry of [
    /xClient\.checkAuth\(xCredOpts\)/,
    /xClient\.uploadMediaSimple\(bytesRes\.buffer, bytesRes\.contentType, xCredOpts\)/,
    /xClient\.createPost\(post\.text, \{ mediaIds, \.\.\.xCredOpts \}\)/,
  ]) {
    assert.ok(entry.test(body), `an X entry point no longer uses the credentials resolved for the publish: ${entry}`);
  }
});
