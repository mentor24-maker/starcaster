'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/**
 * Connections 4 of 7 (86bbpz1gd) — the screen's back end.
 *
 * What this file is for, in one sentence: the Connections screen is the first
 * thing a client of Alphire's ever touches, and every claim it makes is about
 * whether their own social account is working. A card that says "Connected"
 * when nothing is stored, or "Not connected" when something is, is not a
 * cosmetic bug — it is the screen lying about a permission.
 *
 * Two properties are tested here above all others:
 *
 *   1. THE CATALOGUE DRIVES THE SCREEN. The first test adds a platform the
 *      route has never heard of and expects a card for it, with nothing in
 *      routes/connections.js edited. That is the acceptance criterion the
 *      slice turns on, and it is the one a later "just special-case this
 *      provider" change would quietly break.
 *   2. FOUR STATES, DECIDED FROM STORED FACTS. Not from what a route was told
 *      to render — from what is actually in project_connections, through the
 *      real store, over the real schema.
 *
 * The database underneath is the same SQL-backed fake slices 1 and 3 use,
 * reading its schema from docs/SQL/project_connections_setup.sql, so rows here
 * are stored, encrypted and read back through the real store rather than
 * through a mock that agrees with the code by construction.
 */

const SQL_PATH = path.join(__dirname, '..', '..', 'docs', 'SQL', 'project_connections_setup.sql');
const { parseSchemaFile, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const projectScopePath = require.resolve('../../lib/projectScope.js');
const storePath = require.resolve('../../lib/projectConnectionsStore.js');
const routePath = require.resolve('../../routes/connections.js');
const legacyStorePath = require.resolve('../../lib/projectSocialCredentialsStore.js');

const SCOPE = { projectId: 'proj_a', userId: 'user_1' };
const OTHER = { projectId: 'proj_b', userId: 'user_2' };

/** A valid AES-256 key: 32 bytes, base64, the shape channelsCipher demands. */
const TEST_KEY = Buffer.alloc(32, 7).toString('base64');

/**
 * Stand the route up over a real store on a fake database.
 *
 * `legacy` is the Facebook bridge — the older project_social_credentials
 * table, which this route folds into its read because Meta's registered
 * redirect still lands in it. It is stubbed rather than faked from SQL: what
 * matters here is only the two answers the route asks it for.
 */
function withRoute({ legacyPage = null } = {}) {
  const schema = parseSchemaFile(SQL_PATH);
  const db = createFakeDb(schema);

  const fault = { failNextList: false };

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
        return { ok: false, status: 502, error: 'Bad Gateway (simulated cold start)' };
      }
      return db.sbQuery(args);
    },
  };

  const legacy = { deleted: 0, page: legacyPage };
  const fakeLegacyStore = {
    PROVIDER_FACEBOOK_PAGE: 'facebook_page',
    getFacebookPage: async () => legacy.page,
    publicFacebookPageSummary: (cred) => (cred
      ? { connected: true, pageId: cred.pageId, pageName: cred.pageName, connectedAt: '' }
      : { connected: false, pageId: '', pageName: '', connectedAt: '' }),
    deleteFacebookPage: async () => { legacy.deleted += 1; legacy.page = null; return { ok: true, status: 200 }; },
  };

  const realSupabase = require.cache[supabasePath];
  const realLegacy = require.cache[legacyStorePath];
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase,
  };
  require.cache[legacyStorePath] = {
    id: legacyStorePath, filename: legacyStorePath, loaded: true, exports: fakeLegacyStore,
  };
  // projectScope destructures sbQuery at load AND caches its column probe per
  // table, so all three must be re-required or they answer from the last test.
  delete require.cache[projectScopePath];
  delete require.cache[storePath];
  delete require.cache[routePath];

  const store = require(storePath);
  const route = require(routePath);

  const hadKey = Object.prototype.hasOwnProperty.call(process.env, 'CHANNELS_ENCRYPTION_KEY');
  const previousKey = process.env.CHANNELS_ENCRYPTION_KEY;
  process.env.CHANNELS_ENCRYPTION_KEY = TEST_KEY;

  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    if (realLegacy) require.cache[legacyStorePath] = realLegacy;
    else delete require.cache[legacyStorePath];
    delete require.cache[projectScopePath];
    delete require.cache[storePath];
    delete require.cache[routePath];
    if (hadKey) process.env.CHANNELS_ENCRYPTION_KEY = previousKey;
    else delete process.env.CHANNELS_ENCRYPTION_KEY;
  }

  return { db, fault, store, route, legacy, restore };
}

/** A request and a response the dispatcher would recognise, and the body it wrote. */
async function call(route, { method = 'GET', path: urlPath = '/api/connections', body = null, scope = SCOPE } = {}) {
  const req = {
    method,
    url: urlPath,
    headers: { host: 'localhost:3001' },
    body: body === null ? undefined : body,
    projectContext: scope.projectId ? { project: { id: scope.projectId } } : null,
    authUser: scope.userId ? { id: scope.userId } : null,
  };
  const written = { status: 0, payload: null, ended: false };
  const res = {
    set statusCode(value) { written.status = value; },
    get statusCode() { return written.status; },
    setHeader() {},
    end(text) { written.ended = true; written.payload = text ? JSON.parse(text) : null; },
  };
  const handled = await route.handle(req, res, urlPath.split('?')[0], method);
  return { handled, ...written };
}

/** Store a grant through the REAL store, so it is really encrypted and scoped. */
async function grant(store, scope, input) {
  const saved = await store.saveConnection(input, scope);
  assert.equal(saved.ok, true, `seeding a connection failed: ${saved.error || ''}`);
  return saved;
}

const BLUESKY_GRANT = {
  provider: 'bluesky',
  accountId: 'did:plc:delray',
  accountLabel: 'delray.bsky.social',
  accessToken: 'client-app-password',
  status: 'connected',
};

test('the card list is generated from the catalogue, not from a list in the route', async (t) => {
  const h = withRoute();
  t.after(h.restore);

  const registry = require('../../lib/connections/registry.js');
  const catalogue = registry.listCatalogue();

  const res = await call(h.route);
  assert.equal(res.handled, true);
  assert.equal(res.status, 200);

  const cards = res.payload.connections;
  assert.equal(cards.length, catalogue.length,
    'one card per catalogue entry — no more, and none dropped');
  assert.deepEqual(
    cards.map((card) => card.provider),
    catalogue.map((entry) => entry.provider),
    'cards come back in catalogue order'
  );

  /**
   * The real assertion of this test, and the reason it is first.
   *
   * A platform the route has never heard of gets a card anyway, because the
   * route reads the catalogue rather than a list of its own. If this ever
   * fails, someone has special-cased a provider inside routes/connections.js
   * and the "adding a registry entry is enough" promise is gone.
   */
  const invented = {
    provider: 'mastodon',
    displayName: 'Mastodon',
    iconKey: 'mastodon',
    blurb: 'Post to your Mastodon account.',
    readiness: 'coming_soon',
    authKind: 'redirect',
    adapter: null,
  };
  const original = registry.CATALOGUE.slice();
  registry.CATALOGUE.push(invented);
  try {
    const withNew = await call(h.route);
    const card = withNew.payload.connections.find((entry) => entry.provider === 'mastodon');
    assert.ok(card, 'a new catalogue entry produced a card with no edit to the route');
    assert.equal(card.displayName, 'Mastodon');
    assert.equal(card.blurb, 'Post to your Mastodon account.');
    assert.equal(card.cardState, 'coming_soon');
  } finally {
    registry.CATALOGUE.length = 0;
    registry.CATALOGUE.push(...original);
  }
});

test('the four card states are decided from what is actually stored', async (t) => {
  const h = withRoute();
  t.after(h.restore);

  const byProvider = async () => {
    const res = await call(h.route);
    return new Map(res.payload.connections.map((card) => [card.provider, card]));
  };

  // Nothing stored at all.
  let cards = await byProvider();
  assert.equal(cards.get('bluesky').cardState, 'not_connected');
  assert.equal(cards.get('bluesky').account, null);
  assert.equal(cards.get('bluesky').reason, '', 'a healthy card carries no reason');

  // A platform with no adapter is greyed, whatever else is true of it.
  assert.equal(cards.get('x').cardState, 'coming_soon');
  assert.equal(cards.get('instagram').cardState, 'coming_soon');

  // A live grant.
  await grant(h.store, SCOPE, BLUESKY_GRANT);
  cards = await byProvider();
  assert.equal(cards.get('bluesky').cardState, 'connected');
  assert.equal(cards.get('bluesky').account.accountLabel, 'delray.bsky.social');

  // The same grant, gone bad. The reason is a sentence a client can act on,
  // not a status word — "expired" is our vocabulary, not theirs.
  const expired = await h.store.updateConnectionStatus(
    { provider: 'bluesky', accountId: BLUESKY_GRANT.accountId, status: 'expired' },
    SCOPE
  );
  assert.equal(expired.ok, true, expired.error || '');
  cards = await byProvider();
  assert.equal(cards.get('bluesky').cardState, 'needs_attention');
  assert.match(cards.get('bluesky').reason, /expired/i);
  assert.ok(cards.get('bluesky').reason.length > 20, 'the reason is a sentence, not a status word');
});

test('a card never carries a token, and never describes one', async (t) => {
  const h = withRoute();
  t.after(h.restore);
  await grant(h.store, SCOPE, BLUESKY_GRANT);

  const res = await call(h.route);
  const body = JSON.stringify(res.payload);
  assert.ok(!body.includes('client-app-password'), 'the stored credential never reaches the browser');
  assert.ok(!body.includes('accessToken'), 'not even the field name');
  assert.ok(!body.includes('hasAccessToken'),
    'nor whether one exists — that is our storage, not the client\'s account');
});

test('one project cannot see, switch or disconnect another project\'s grants', async (t) => {
  const h = withRoute();
  t.after(h.restore);
  await grant(h.store, SCOPE, BLUESKY_GRANT);

  const theirs = await call(h.route, { scope: OTHER });
  const bluesky = theirs.payload.connections.find((card) => card.provider === 'bluesky');
  assert.equal(bluesky.cardState, 'not_connected', 'another project\'s grant is invisible here');

  const disconnect = await call(h.route, { method: 'DELETE', path: '/api/connections/bluesky', scope: OTHER });
  assert.equal(disconnect.status, 200);
  assert.equal(disconnect.payload.removed, 0, 'and it removed nothing');

  const mine = await call(h.route);
  assert.equal(
    mine.payload.connections.find((card) => card.provider === 'bluesky').cardState,
    'connected',
    'the owning project still has it'
  );
});

test('a lookup that FAILED is reported, never rendered as "not connected"', async (t) => {
  const h = withRoute();
  t.after(h.restore);
  await grant(h.store, SCOPE, BLUESKY_GRANT);

  h.fault.failNextList = true;
  const res = await call(h.route);
  assert.equal(res.status, 502);
  assert.equal(res.payload.ok, false);
  /**
   * The point: the client HAS a live connection. Answering "not connected"
   * because the database blinked invites them to reconnect an account that was
   * never broken, and a screen that does that on every cold start teaches them
   * to distrust the one it does on for real.
   */
});

test('starting a connection asks the adapter, and never invents a credential field', async (t) => {
  const h = withRoute();
  t.after(h.restore);

  const started = await call(h.route, { method: 'POST', path: '/api/connections/bluesky/start' });
  assert.equal(started.status, 200);
  assert.equal(started.payload.authKind, 'app_password');
  const names = started.payload.fields.map((field) => field.name).sort();
  assert.deepEqual(names, ['appPassword', 'identifier'],
    'the client\'s own credential — never a token, an app id or a page id');
  for (const field of started.payload.fields) {
    assert.ok(field.label, 'every field has a label a client can read');
    assert.ok(field.help, 'and a line saying where to get it');
  }

  // A platform with no adapter refuses with the registry's own sentence, and
  // the two refusals are different facts: not finished, versus no such thing.
  const comingSoon = await call(h.route, { method: 'POST', path: '/api/connections/x/start' });
  assert.equal(comingSoon.status, 400);
  assert.match(comingSoon.payload.error.message, /not connectable yet/i);

  const unknown = await call(h.route, { method: 'POST', path: '/api/connections/friendster/start' });
  assert.equal(unknown.status, 404);
  assert.match(unknown.payload.error.message, /unknown/i);
});

test('picking an account makes it the one that will actually post', async (t) => {
  const h = withRoute();
  t.after(h.restore);

  await grant(h.store, SCOPE, { ...BLUESKY_GRANT, accountId: 'did:plc:one', accountLabel: 'one.bsky.social' });
  await grant(h.store, SCOPE, { ...BLUESKY_GRANT, accountId: 'did:plc:two', accountLabel: 'two.bsky.social' });

  const cardsNow = await call(h.route);
  const both = cardsNow.payload.connections.find((card) => card.provider === 'bluesky');
  assert.equal(both.accounts.length, 2, 'the card offers the choice');

  /**
   * Both directions, and the second one is the test that matters.
   *
   * These two grants were seeded back to back and carry the SAME updated_at to
   * the millisecond, so a pick that merely stamps the row is a no-op — the
   * database is free to keep returning the other one first, and the route
   * would report a switch that never happened. Asserting only the first
   * direction would pass on exactly that bug, because one of the two is
   * already first by luck.
   */
  for (const chosen of ['did:plc:one', 'did:plc:two', 'did:plc:one']) {
    const picked = await call(h.route, {
      method: 'POST',
      path: '/api/connections/bluesky/account',
      body: { accountId: chosen },
    });
    assert.equal(picked.status, 200, `picking ${chosen}: ${picked.payload?.error?.message || ''}`);
    assert.equal(picked.payload.activeAccountId, chosen);

    const cards = await call(h.route);
    const bluesky = cards.payload.connections.find((card) => card.provider === 'bluesky');
    assert.equal(bluesky.account.accountId, chosen, `the card shows ${chosen} as the active account`);

    // And the resolver — the thing that actually posts — agrees. This is the
    // whole point: the card and the publisher read the same row, not two rows
    // that happen to match today.
    const listed = await h.store.listConnections(200, SCOPE);
    const firstBluesky = listed.data.find((row) => row.provider === 'bluesky');
    assert.equal(firstBluesky.accountId, chosen,
      'the store\'s own newest-first order puts the chosen account where the resolver looks');
  }
});

test('disconnecting removes the grant, and says it did not revoke at the provider', async (t) => {
  const h = withRoute();
  t.after(h.restore);
  await grant(h.store, SCOPE, BLUESKY_GRANT);

  const gone = await call(h.route, { method: 'DELETE', path: '/api/connections/bluesky' });
  assert.equal(gone.status, 200);
  assert.equal(gone.payload.removed, 1);
  /**
   * Slice 6 (86bbpz1gv) owns telling the platform. Until it lands, Starcaster
   * forgets the token while the permission is still granted at Bluesky, and
   * the answer says so rather than letting a caller read "disconnected" as
   * "revoked" — which is the difference between a client's account being safe
   * and their believing it is.
   */
  assert.equal(gone.payload.revokedAtProvider, false);

  const cards = await call(h.route);
  assert.equal(
    cards.payload.connections.find((card) => card.provider === 'bluesky').cardState,
    'not_connected'
  );
});

test('a Facebook Page connected the old way still reads as connected, and disconnect clears both', async (t) => {
  const h = withRoute({ legacyPage: { pageId: '1122', pageName: 'Delray Beach Tennis Center' } });
  t.after(h.restore);

  /**
   * The bridge, and why it exists: Meta's registered redirect URI points at
   * routes/engage.js's callback and cannot move without re-registering the
   * app, so a client who presses Connect on THIS screen still completes into
   * the older table. Reading only project_connections would show a Page that
   * was just connected successfully as "not connected" — the screen calling
   * its own success a failure.
   */
  let cards = await call(h.route);
  let facebook = cards.payload.connections.find((card) => card.provider === 'facebook_page');
  assert.equal(facebook.cardState, 'connected');
  assert.equal(facebook.account.accountLabel, 'Delray Beach Tennis Center');

  const gone = await call(h.route, { method: 'DELETE', path: '/api/connections/facebook_page' });
  assert.equal(gone.status, 200);
  assert.equal(h.legacy.deleted, 1, 'the older row went too');
  assert.equal(gone.payload.removed, 1);

  cards = await call(h.route);
  facebook = cards.payload.connections.find((card) => card.provider === 'facebook_page');
  assert.equal(facebook.cardState, 'not_connected',
    'or Disconnect would appear to do nothing — the card would come straight back');
});

test('disconnecting a provider that was never connected reports removing nothing', async (t) => {
  const h = withRoute();
  t.after(h.restore);

  const gone = await call(h.route, { method: 'DELETE', path: '/api/connections/facebook_page' });
  assert.equal(gone.status, 200);
  assert.equal(gone.payload.removed, 0,
    'deleteFacebookPage answers ok on a project that never had one — counting that as a removal '
    + 'would be the screen telling a client it undid something it did not');
  assert.equal(h.legacy.deleted, 0, 'and it did not even ask the older store to delete');
});

test('every endpoint refuses before it acts when no workspace is chosen', async (t) => {
  const h = withRoute();
  t.after(h.restore);

  for (const [method, urlPath] of [
    ['GET', '/api/connections'],
    ['POST', '/api/connections/bluesky/start'],
    ['POST', '/api/connections/bluesky/finish'],
    ['DELETE', '/api/connections/bluesky'],
  ]) {
    const res = await call(h.route, { method, path: urlPath, scope: { projectId: '', userId: 'user_1' } });
    assert.equal(res.status, 400, `${method} ${urlPath}`);
    assert.equal(res.payload.error.code, 'PROJECT_REQUIRED', `${method} ${urlPath}`);
  }
});

test('the route ignores paths that are not its own', async (t) => {
  const h = withRoute();
  t.after(h.restore);

  const res = await call(h.route, { path: '/api/connections-elsewhere' });
  assert.equal(res.handled, false, 'a prefix that merely starts with the same letters is not ours');
  assert.equal(res.ended, false);
});
