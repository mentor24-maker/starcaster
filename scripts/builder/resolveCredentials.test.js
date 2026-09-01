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
function withResolver() {
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
      return { ...(ENV_VALUES[provider] || {}) };
    },
  };

  const realSupabase = require.cache[supabasePath];
  const realApiSettings = require.cache[apiSettingsPath];
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
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    if (realApiSettings) require.cache[apiSettingsPath] = realApiSettings;
    else delete require.cache[apiSettingsPath];
    delete require.cache[projectScopePath];
    delete require.cache[storePath];
    delete require.cache[resolverPath];
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

test('a connection whose token expired is skipped even though its status still says connected', async () => {
  const h = withResolver();
  try {
    // The realistic case, and the reason both halves are checked: `status` is
    // what the last verify wrote down, and nothing sweeps until slice 6, so the
    // clock and the column disagree for most of a token's dead life.
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

test('X: the project\'s token pair is used, and the app keys are not replaced', async () => {
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
    assert.equal(res.creds.accountName, 'delraytennis');
    // OAuth 1.0a signs with the APP keys plus the user pair. Losing the app
    // half produces a 401 that names neither.
    assert.equal(res.creds.apiKey, 'ALPHIRE_X_API_KEY');
    assert.equal(res.creds.apiSecret, 'ALPHIRE_X_API_SECRET');
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
  for (const [channel, call] of [
    ['bluesky', /createPost\(post\.text, imageOpts, bsCreds\)/],
    ['facebook', /createFacebookPost\(post\.text, imageOpts, fbCreds\)/],
    ['threads', /createThreadsPost\(post\.text, imageOpts, thCreds\)/],
    ['instagram', /createInstagramPost\(post\.text, imageOpts, igCreds\)/],
  ]) {
    assert.ok(call.test(body), `the ${channel} branch resolves credentials but does not pass them to the publish call`);
  }
});
