'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/**
 * Connections 6a of 7 (86bbpz1gv) — staying connected without anyone watching.
 *
 * What this file is defending, in one sentence: every mechanism here writes to
 * a client's stored social grants ON A SCHEDULE, so a bug is not a bad screen —
 * it is a healthy account marked broken at 3am, or a client's posts silently
 * moving to a different Page, with every gate green.
 *
 * Five things are pinned above the rest:
 *
 *   1. THE SWEEP DOES ONE BATCH. Not "usually one batch" — the adapter's own
 *      call count is measured, because a loop that quietly drains everything is
 *      the failure the batch shape exists to prevent, and it looks identical
 *      from outside.
 *   2. THE SWEEP DOES NOT CHANGE WHICH ACCOUNT POSTS. `updated_at` is the
 *      active-account selector, so an ordinary status write would re-elect
 *      whichever row was checked last, and `bumpUpdatedAt: false` is what stops
 *      it. TWO tests hold it, and the order matters: the spy test pins the
 *      option on every write the file makes, and the behavioural test reads the
 *      posting account back afterwards. Only the first is safe from the clock —
 *      the second was green with the guard deleted until it was made to pause
 *      like a real provider call, because two writes in the same millisecond
 *      tie on `updated_at` and the store's `created_at` tie-break then restores
 *      the original order all by itself.
 *   3. A FAILED REVOKE KEEPS THE ROW. Deleting anyway leaves a live grant at
 *      the provider that Starcaster can no longer withdraw — the one outcome
 *      the client discovers months later, in their own Facebook settings.
 *   4. DRIFT NAMES BOTH ACCOUNTS. "This connection drifted" with nobody named
 *      sends whoever reads it to the provider's dashboard to work out what
 *      happened.
 *   5. NOTHING CIRCULAR. The resolver requires the sweep, and the registry
 *      chain leads back to the resolver; the last test loads it in a clean
 *      process and fails on node's own warning.
 *
 * The database underneath is the same SQL-backed fake slices 1, 3 and 4 use,
 * reading its schema from docs/SQL/project_connections_setup.sql, so every row
 * is stored, encrypted and read back through the real store.
 */

const SQL_PATH = path.join(__dirname, '..', '..', 'docs', 'SQL', 'project_connections_setup.sql');
const { parseSchemaFile, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const projectScopePath = require.resolve('../../lib/projectScope.js');
const storePath = require.resolve('../../lib/projectConnectionsStore.js');
const registryPath = require.resolve('../../lib/connections/registry.js');
const sweepPath = require.resolve('../../lib/connections/verifySweep.js');
const resolvePath = require.resolve('../../lib/connections/resolveCredentials.js');
const completeConnectionPath = require.resolve('../../lib/connections/completeConnection.js');
const identityStorePath = require.resolve('../../lib/credentialIdentityStore.js');
const legacyStorePath = require.resolve('../../lib/projectSocialCredentialsStore.js');
const routePath = require.resolve('../../routes/connections.js');

const SCOPE = { projectId: 'proj_a', userId: 'user_1' };
const TEST_KEY = Buffer.alloc(32, 7).toString('base64');

const NOW = Date.parse('2026-09-03T12:00:00.000Z');
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/**
 * A registry with adapters this test wrote, standing in for the real one.
 *
 * Faked rather than driven through the real adapters on purpose: every real
 * `refresh` on this build answers "there is nothing to refresh on this
 * platform" (a Meta Page token does not expire), so testing refresh-before-use
 * against them would test nothing at all. The contract is what matters here,
 * and `scripts/builder/connectionsAdapterContract.test.js` already holds the
 * real adapters to it.
 */
function fakeRegistry(adapters) {
  const entries = Object.entries(adapters).map(([provider, adapter]) => ({
    provider,
    displayName: provider,
    iconKey: provider,
    blurb: `Connect ${provider}.`,
    readiness: adapter ? 'ready' : 'coming_soon',
    authKind: 'app_password',
    adapter: adapter ? { provider, authKind: 'app_password', ...adapter } : null,
  }));
  const byProvider = new Map(entries.map((e) => [e.provider, e]));
  return {
    CATALOGUE: entries,
    listCatalogue: () => entries.map(({ adapter, ...rest }) => ({ ...rest, connectable: Boolean(adapter) })),
    listAdapters: () => entries.filter((e) => e.adapter).map((e) => e.adapter),
    getEntry: (provider) => byProvider.get(String(provider || '').trim()) || null,
    adapterFor: (provider) => byProvider.get(String(provider || '').trim())?.adapter || null,
    getAdapter: (provider) => {
      const entry = byProvider.get(String(provider || '').trim());
      if (!entry) return { ok: false, status: 404, error: `Unknown connection provider "${provider}"`, data: null };
      if (!entry.adapter) return { ok: false, status: 400, error: `${provider} is not connectable yet`, data: null };
      return { ok: true, status: 200, data: entry.adapter };
    },
  };
}

/** An identity memory that is present and works — the migrated case. */
function fakeIdentityStore(seed = {}) {
  const rows = new Map(Object.entries(seed));
  return {
    rows,
    getKnownIdentity: async ({ projectId, provider }) => rows.get(`${projectId}::${provider}`) || null,
    recordVerifiedIdentity: async ({ projectId, provider, identity }) => {
      const key = `${projectId}::${provider}`;
      const previous = rows.get(key) || null;
      const changed = previous
        ? (previous.id && identity.id ? previous.id !== identity.id
          : String(previous.label || '').toLowerCase() !== String(identity.label || '').toLowerCase())
        : false;
      rows.set(key, { id: identity.id, label: identity.label });
      return { changed, previous, tracked: true };
    },
    describeIdentityChange: () => '',
    isMissingTable: () => false,
  };
}

/**
 * Stand the sweep, the resolver and the route up over the REAL store on a fake
 * database, with adapters this test controls.
 */
function withSweep({ adapters = {}, identityStore = null, legacyPage = null } = {}) {
  const schema = parseSchemaFile(SQL_PATH);
  const db = createFakeDb(schema);

  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({
      projectConnections: 'project_connections',
      projectConnectionHandoffs: 'project_connection_handoffs',
    }),
    sbQuery: async (args) => db.sbQuery(args),
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

  const registry = fakeRegistry(adapters);
  const identities = identityStore || fakeIdentityStore();

  const saved = new Map();
  const install = (modulePath, exports) => {
    saved.set(modulePath, require.cache[modulePath]);
    require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports };
  };
  install(supabasePath, fakeSupabase);
  install(legacyStorePath, fakeLegacyStore);
  install(registryPath, registry);
  install(identityStorePath, identities);

  // Every module that holds its own reference to the store or the registry has
  // to be re-required, or it keeps talking to whatever the last test left
  // behind while the code under test talks to the fake.
  const fresh = [projectScopePath, storePath, completeConnectionPath, sweepPath, resolvePath, routePath];
  for (const p of fresh) delete require.cache[p];

  const store = require(storePath);
  const sweep = require(sweepPath);
  const resolver = require(resolvePath);
  const route = require(routePath);

  const hadKey = Object.prototype.hasOwnProperty.call(process.env, 'CHANNELS_ENCRYPTION_KEY');
  const previousKey = process.env.CHANNELS_ENCRYPTION_KEY;
  process.env.CHANNELS_ENCRYPTION_KEY = TEST_KEY;

  function restore() {
    for (const [modulePath, entry] of saved) {
      if (entry) require.cache[modulePath] = entry;
      else delete require.cache[modulePath];
    }
    for (const p of fresh) delete require.cache[p];
    if (hadKey) process.env.CHANNELS_ENCRYPTION_KEY = previousKey;
    else delete process.env.CHANNELS_ENCRYPTION_KEY;
  }

  return { db, store, sweep, resolver, route, registry, identities, legacy, restore };
}

/** Store a grant through the REAL store, so it is really encrypted and scoped. */
async function grant(store, input, scope = SCOPE) {
  const res = await store.saveConnection(input, scope);
  assert.equal(res.ok, true, `seeding a connection failed: ${res.error || ''}`);
  return res.data;
}

/** A request/response pair the dispatcher would recognise. */
async function call(route, { method = 'GET', path: urlPath = '/api/connections', body = null, scope = SCOPE } = {}) {
  const req = {
    method,
    url: urlPath,
    headers: { host: 'localhost:3001' },
    body: body === null ? undefined : body,
    projectContext: scope.projectId ? { project: { id: scope.projectId } } : null,
    authUser: scope.userId ? { id: scope.userId } : null,
  };
  const written = { status: 0, payload: null };
  const res = {
    set statusCode(value) { written.status = value; },
    get statusCode() { return written.status; },
    setHeader() {},
    end(text) { written.payload = text ? JSON.parse(text) : null; },
  };
  const handled = await route.handle(req, res, urlPath.split('?')[0], method);
  return { handled, ...written };
}

/**
 * A real pause between two writes.
 *
 * Not padding: a live sweep awaits a provider HTTP call and a database read per
 * row, sequentially, so consecutive rows always land in different milliseconds.
 * A fake that answers instantly does not, and `updated_at` then TIES — which is
 * enough on its own to satisfy an ordering assertion whether the guard is there
 * or not. Any test about `updated_at` ordering has to buy that millisecond back
 * or it cannot fail. See "the sweep does not change which account posts".
 */
const tick = (ms = 3) => new Promise((r) => setTimeout(r, ms));

const ok = (data) => ({ ok: true, status: 200, data });
const fail = (status, error) => ({ ok: false, status, error, data: null });

// ── Refresh before use ──────────────────────────────────────────────────────

test('a token inside the refresh window is renewed, and the caller never sees the old one', async (t) => {
  const calls = [];
  const h = withSweep({
    adapters: {
      bluesky: {
        refresh: async (account) => {
          calls.push(account.accessToken);
          return ok({ refreshed: true, accessToken: 'renewed-token', expiresAt: new Date(NOW + 7 * DAY).toISOString() });
        },
        verify: async () => ok({ valid: true }),
        revoke: async () => ok({ revokedAtProvider: true }),
        authorizeUrl: () => ok({}),
        exchange: async () => ok({}),
        listAccounts: async () => ok({}),
      },
    },
  });
  t.after(h.restore);

  await grant(h.store, {
    provider: 'bluesky',
    accountId: 'did:plc:delray',
    accountLabel: 'delray.bsky.social',
    accessToken: 'about-to-die',
    status: 'connected',
    // Ten minutes left: live by `liveness`, and inside the 30-minute window.
    expiresAt: new Date(NOW + 10 * MINUTE).toISOString(),
  });

  const resolved = await h.resolver.resolveCredentials('bluesky', SCOPE.projectId, { nowMs: NOW });
  assert.equal(resolved.ok, true, resolved.error);
  assert.equal(resolved.data.source, 'connection');
  assert.deepEqual(calls, ['about-to-die'], 'the adapter was asked to refresh, with the stored token');
  assert.equal(
    resolved.data.values.app_password,
    'renewed-token',
    'THE point of refresh-before-use: the caller is handed the new token, never the about-to-expire one'
  );
  assert.equal(resolved.data.refresh.refreshed, true);

  // Read the row back rather than trusting the answer — DOCTRINE: the toast
  // proves a write, not the right value.
  const stored = await h.store.getConnection({ provider: 'bluesky', accountId: 'did:plc:delray' }, SCOPE);
  assert.equal(stored.ok, true);
  assert.equal(stored.data.accessToken, 'renewed-token', 'the new token was actually stored');
  assert.equal(stored.data.status, 'connected');
  assert.equal(Date.parse(stored.data.expiresAt), NOW + 7 * DAY, 'the new expiry was stored too');
});

test('a token with plenty of life left is handed over untouched', async (t) => {
  let refreshes = 0;
  const h = withSweep({
    adapters: {
      bluesky: {
        refresh: async () => { refreshes += 1; return ok({ refreshed: true, accessToken: 'should-not-happen' }); },
        verify: async () => ok({ valid: true }),
        revoke: async () => ok({ revokedAtProvider: true }),
        authorizeUrl: () => ok({}), exchange: async () => ok({}), listAccounts: async () => ok({}),
      },
    },
  });
  t.after(h.restore);

  await grant(h.store, {
    provider: 'bluesky',
    accountId: 'did:plc:delray',
    accountLabel: 'delray.bsky.social',
    accessToken: 'perfectly-good',
    status: 'connected',
    expiresAt: new Date(NOW + 30 * DAY).toISOString(),
  });

  const resolved = await h.resolver.resolveCredentials('bluesky', SCOPE.projectId, { nowMs: NOW });
  assert.equal(resolved.ok, true);
  assert.equal(refreshes, 0, 'refreshing every token on every post would spend a provider rate limit on nothing');
  assert.equal(resolved.data.values.app_password, 'perfectly-good');
});

test('a refresh that fails marks the connection needs-attention rather than throwing', async (t) => {
  const h = withSweep({
    adapters: {
      bluesky: {
        refresh: async () => fail(502, 'Bluesky is not answering'),
        verify: async () => ok({ valid: true }),
        revoke: async () => ok({ revokedAtProvider: true }),
        authorizeUrl: () => ok({}), exchange: async () => ok({}), listAccounts: async () => ok({}),
      },
    },
  });
  t.after(h.restore);

  await grant(h.store, {
    provider: 'bluesky',
    accountId: 'did:plc:delray',
    accountLabel: 'delray.bsky.social',
    accessToken: 'still-valid-for-now',
    status: 'connected',
    expiresAt: new Date(NOW + 10 * MINUTE).toISOString(),
  });

  const resolved = await h.resolver.resolveCredentials('bluesky', SCOPE.projectId, { nowMs: NOW });
  assert.equal(resolved.ok, true, 'a failed refresh must not take a still-working account off the air');
  assert.equal(
    resolved.data.values.app_password,
    'still-valid-for-now',
    "the client's own token is still valid right now — falling back to the shared keys would post as Starcaster"
  );
  assert.match(resolved.data.refresh.refreshError, /not answering/);

  const stored = await h.store.getConnection({ provider: 'bluesky', accountId: 'did:plc:delray' }, SCOPE);
  assert.equal(stored.data.status, 'expiring', 'the stored status is what makes the card amber (6b)');
  assert.match(stored.data.lastError, /Could not renew this connection/);
});

// ── One batch, and what remains ─────────────────────────────────────────────

test('the sweep does ONE batch and reports what is left — it does not loop over everything', async (t) => {
  let verifies = 0;
  const h = withSweep({
    adapters: {
      bluesky: {
        verify: async (account) => { verifies += 1; return ok({ valid: true, accountId: account.accountId, accountLabel: account.accountLabel }); },
        refresh: async () => ok({ refreshed: false }),
        revoke: async () => ok({ revokedAtProvider: true }),
        authorizeUrl: () => ok({}), exchange: async () => ok({}), listAccounts: async () => ok({}),
      },
    },
  });
  t.after(h.restore);

  for (let i = 0; i < 25; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await grant(h.store, {
      provider: 'bluesky',
      accountId: `did:plc:acct${String(i).padStart(2, '0')}`,
      accountLabel: `acct${i}.bsky.social`,
      accessToken: `token-${i}`,
      status: 'connected',
    });
  }

  const first = await h.sweep.runVerifySweep({ scope: SCOPE, nowMs: NOW });
  assert.equal(first.ok, true, first.error);
  assert.equal(first.data.total, 25, 'every connection the project holds');
  assert.equal(first.data.due, 25, 'none of them has ever been checked');
  assert.equal(first.data.seen, 10, 'one batch is the default ten');
  assert.equal(first.data.remaining, 15);
  assert.equal(first.data.done, false);
  assert.equal(first.data.results.length, 10);
  assert.equal(
    verifies,
    10,
    'THE assertion: the adapter was called ten times, not twenty-five. A pass that quietly drained '
    + 'everything would look identical from the outside and would be frozen halfway through on Vercel.'
  );

  const seenFirst = new Set(first.data.results.map((r) => r.accountId));
  const second = await h.sweep.runVerifySweep({ scope: SCOPE, nowMs: NOW + MINUTE });
  assert.equal(second.data.seen, 10);
  assert.equal(second.data.remaining, 5, 'the cursor moved — the second call is not the first ten again');
  for (const r of second.data.results) {
    assert.equal(seenFirst.has(r.accountId), false, `${r.accountId} was checked twice`);
  }

  const third = await h.sweep.runVerifySweep({ scope: SCOPE, nowMs: NOW + 2 * MINUTE });
  assert.equal(third.data.seen, 5);
  assert.equal(third.data.remaining, 0);
  assert.equal(third.data.done, true);
  assert.equal(verifies, 25, 'three batches covered all 25 exactly once');

  const fourth = await h.sweep.runVerifySweep({ scope: SCOPE, nowMs: NOW + 3 * MINUTE });
  assert.equal(fourth.data.due, 0, 'nothing is due again yet');
  assert.equal(fourth.data.seen, 0);
  assert.equal(fourth.data.done, true);
  assert.equal(
    verifies,
    25,
    'a caller looping on `remaining` must terminate — over the whole table it never would, and the same '
    + "rows would be swept against a provider's API forever"
  );
});

/**
 * THE guard, asserted directly: every write the sweep makes says
 * "do not re-elect this row".
 *
 * This test exists because the behavioural one below could not fail. It was
 * green with `{ bumpUpdatedAt: false }` deleted from
 * `lib/connections/verifySweep.js` — in the fake, both status writes landed in
 * the same millisecond, `updated_at` tied, and the store's `created_at`
 * tie-break restored the original order. The assertion was being satisfied by
 * the clock's resolution rather than by the guard (found by loop-review on
 * PR #556, 2026-09-03).
 *
 * So the write is pinned at the call itself. No clock is involved, nothing
 * about it can tie, and deleting the option from either write site in
 * verifySweep.js fails HERE regardless of how fast the database answers.
 */
test('every status write the sweep makes is marked do-not-re-elect', async (t) => {
  const h = withSweep({
    adapters: {
      bluesky: {
        verify: async (account) => ok({ valid: true, accountId: account.accountId, accountLabel: account.accountLabel }),
        // Refuses, so the refresh-failure write (verifySweep.js:279) is exercised
        // too — it is the OTHER place a status reaches the store from this file.
        refresh: async () => fail(502, 'bluesky refused the refresh'),
        revoke: async () => ok({ revokedAtProvider: true }),
        authorizeUrl: () => ok({}), exchange: async () => ok({}), listAccounts: async () => ok({}),
      },
    },
  });
  t.after(h.restore);

  await grant(h.store, {
    provider: 'bluesky', accountId: 'did:plc:pinned', accountLabel: 'pinned.bsky.social',
    accessToken: 'token-pinned', status: 'connected',
    expiresAt: new Date(NOW + 20 * MINUTE).toISOString(),
  });

  // A spy in front of the REAL store: the write still happens, and we keep the
  // options argument the sweep passed with it.
  const writes = [];
  const spied = {
    ...h.store,
    updateConnectionStatus: async (fields, scope, options) => {
      writes.push({ fields, options });
      return h.store.updateConnectionStatus(fields, scope, options);
    },
  };

  const swept = await h.sweep.runVerifySweep({ scope: SCOPE, nowMs: NOW, store: spied });
  assert.equal(swept.ok, true);
  assert.equal(swept.data.seen, 1);

  const stored = (await h.store.listConnections(10, SCOPE)).data[0];
  const refresh = await h.sweep.refreshBeforeUse({ connection: stored, scope: SCOPE, nowMs: NOW, store: spied });
  assert.equal(refresh.refreshed, false, 'the refresh was refused, so the failure write ran');

  assert.ok(writes.length >= 2, `expected the sweep and the refused refresh to both write, saw ${writes.length}`);
  for (const [i, write] of writes.entries()) {
    assert.equal(
      write.options?.bumpUpdatedAt,
      false,
      'THE guard: `updated_at` is the active-account selector, so every status write from this file must '
      + `pass { bumpUpdatedAt: false } or it re-elects the row it just checked (write ${i + 1} of ${writes.length}, `
      + `fields: ${JSON.stringify(write.fields)})`
    );
  }
});

/**
 * The same guard, from the outside: does the account that posts actually stay
 * put across a sweep?
 *
 * Worth keeping beside the assertion above because it is the thing a client
 * would notice, but it is only evidence if the two writes land in DIFFERENT
 * milliseconds — see `tick`. `verify` therefore pauses the way a real provider
 * call does. Break-tested by deleting `{ bumpUpdatedAt: false }` from
 * verifySweep.js and watching this fail, which it did not before that pause
 * existed.
 */
test('the sweep does not change which account posts', async (t) => {
  const h = withSweep({
    adapters: {
      bluesky: {
        verify: async (account) => {
          // A live provider call takes longer than a millisecond. Without this
          // the two status writes tie on `updated_at` and the assertion below
          // passes on the tie-break alone.
          await tick();
          return ok({ valid: true, accountId: account.accountId, accountLabel: account.accountLabel });
        },
        refresh: async () => ok({ refreshed: false }),
        revoke: async () => ok({ revokedAtProvider: true }),
        authorizeUrl: () => ok({}), exchange: async () => ok({}), listAccounts: async () => ok({}),
      },
    },
  });
  t.after(h.restore);

  await grant(h.store, {
    provider: 'bluesky', accountId: 'did:plc:first', accountLabel: 'first.bsky.social',
    accessToken: 'token-first', status: 'connected',
  });
  await tick();
  await grant(h.store, {
    provider: 'bluesky', accountId: 'did:plc:second', accountLabel: 'second.bsky.social',
    accessToken: 'token-second', status: 'connected',
  });

  const before = await h.resolver.resolveCredentials('bluesky', SCOPE.projectId, { nowMs: NOW });
  assert.equal(before.data.accountId, 'did:plc:second', 'the newest-stored account posts');

  const swept = await h.sweep.runVerifySweep({ scope: SCOPE, nowMs: NOW });
  assert.equal(swept.data.seen, 2);
  assert.equal(swept.data.healthy, 2);

  // The sweep checks the ACTIVE row first and the other one last, so an
  // unguarded write would hand the election to `did:plc:first`. Stated here
  // because it is what makes the assertion below capable of failing.
  assert.deepEqual(
    swept.data.results.map((r) => r.accountId),
    ['did:plc:second', 'did:plc:first'],
    'the row checked LAST is the one an unguarded write would re-elect'
  );

  const stamps = (await h.store.listConnections(10, SCOPE)).data.map((r) => Date.parse(r.updatedAt));
  assert.notEqual(
    stamps[0],
    stamps[1],
    'the two rows must carry different `updated_at` values, or the ordering assertion below is decided by the '
    + 'store\'s created_at tie-break and cannot fail — that is exactly how this test passed with the guard removed'
  );

  const after = await h.resolver.resolveCredentials('bluesky', SCOPE.projectId, { nowMs: NOW });
  assert.equal(
    after.data.accountId,
    'did:plc:second',
    'THE guard: `updated_at` is the active-account selector, so a sweep that wrote through the ordinary '
    + 'path would re-elect whichever row it checked last and move a client\'s posts to another account'
  );
});

test('a stored grant for a platform with no adapter is a could-not-check, never a pass', async (t) => {
  const h = withSweep({ adapters: { bluesky: null } });
  t.after(h.restore);

  await grant(h.store, {
    provider: 'bluesky', accountId: 'did:plc:orphan', accountLabel: 'orphan.bsky.social',
    accessToken: 'token', status: 'connected',
  });

  const swept = await h.sweep.runVerifySweep({ scope: SCOPE, nowMs: NOW });
  assert.equal(swept.data.couldNotCheck, 1);
  assert.equal(swept.data.healthy, 0, 'a check that could not run must never be graded as a pass (DOCTRINE 3.11)');
  assert.equal(swept.data.unhealthy, 0, 'and it is not a failure either — it is an unknown');
  assert.equal(swept.data.results[0].healthy, null);
  assert.match(swept.data.results[0].reason, /no adapter/);

  /**
   * And it does not starve the queue. Found by reading real rows after a live
   * run: the could-not-check branch returned without stamping the cursor, so
   * the row stayed permanently due and took a slot out of every batch forever
   * — the exact starvation the cursor exists to prevent, arriving through the
   * branch that skipped it.
   */
  const again = await h.sweep.runVerifySweep({ scope: SCOPE, nowMs: NOW + MINUTE });
  assert.equal(again.data.due, 0, 'a connection nobody can check must not re-claim a batch slot forever');

  const stored = await h.store.listConnections(10, SCOPE);
  assert.equal(
    stored.data[0].status,
    'connected',
    'and the stamp must not carry a verdict with it — nothing was learned about this grant, so what the '
    + 'last real check found stands'
  );
  assert.equal(stored.data[0].lastVerifiedAt !== '', true, 'the cursor moved');
});

test('a token already past its expiry is marked expired without spending a provider call', async (t) => {
  let verifies = 0;
  const h = withSweep({
    adapters: {
      bluesky: {
        verify: async () => { verifies += 1; return ok({ valid: true }); },
        refresh: async () => ok({ refreshed: false }),
        revoke: async () => ok({ revokedAtProvider: true }),
        authorizeUrl: () => ok({}), exchange: async () => ok({}), listAccounts: async () => ok({}),
      },
    },
  });
  t.after(h.restore);

  await grant(h.store, {
    provider: 'bluesky', accountId: 'did:plc:lapsed', accountLabel: 'lapsed.bsky.social',
    accessToken: 'token', status: 'connected',
    expiresAt: new Date(NOW - DAY).toISOString(),
  });

  const swept = await h.sweep.runVerifySweep({ scope: SCOPE, nowMs: NOW });
  assert.equal(verifies, 0, 'the clock already answered; a live API call could add nothing');
  assert.equal(swept.data.results[0].status, 'expired');
  const stored = await h.store.getConnection({ provider: 'bluesky', accountId: 'did:plc:lapsed' }, SCOPE);
  assert.equal(stored.data.status, 'expired');
});

// ── Identity drift ─────────────────────────────────────────────────────────

test('a token that now authenticates as a different account is flagged, with both accounts named', async (t) => {
  const h = withSweep({
    adapters: {
      bluesky: {
        verify: async () => ok({ valid: true, accountId: 'did:plc:somebody-else', accountLabel: 'somebodyelse.bsky.social' }),
        refresh: async () => ok({ refreshed: false }),
        revoke: async () => ok({ revokedAtProvider: true }),
        authorizeUrl: () => ok({}), exchange: async () => ok({}), listAccounts: async () => ok({}),
      },
    },
  });
  t.after(h.restore);

  await grant(h.store, {
    provider: 'bluesky', accountId: 'did:plc:delray', accountLabel: 'delray.bsky.social',
    accessToken: 'token', status: 'connected',
  });

  const swept = await h.sweep.runVerifySweep({ scope: SCOPE, nowMs: NOW });
  const result = swept.data.results[0];
  assert.equal(swept.data.drifted, 1);
  assert.equal(result.drifted, true);
  assert.equal(result.previousIdentity.label, 'delray.bsky.social');
  assert.equal(result.currentIdentity.label, 'somebodyelse.bsky.social');

  const stored = await h.store.getConnection({ provider: 'bluesky', accountId: 'did:plc:delray' }, SCOPE);
  assert.equal(stored.data.status, 'error');
  assert.match(stored.data.lastError, /delray\.bsky\.social/, 'the account it was saved as is named');
  assert.match(stored.data.lastError, /somebodyelse\.bsky\.social/, 'and the account it is now');
});

test("the remembered identity is filed per ACCOUNT, so two accounts on one platform are not each other's drift", async (t) => {
  const identities = fakeIdentityStore();
  const h = withSweep({
    adapters: {
      bluesky: {
        verify: async (account) => ok({ valid: true, accountId: account.accountId, accountLabel: account.accountLabel }),
        refresh: async () => ok({ refreshed: false }),
        revoke: async () => ok({ revokedAtProvider: true }),
        authorizeUrl: () => ok({}), exchange: async () => ok({}), listAccounts: async () => ok({}),
      },
    },
    identityStore: identities,
  });
  t.after(h.restore);

  await grant(h.store, {
    provider: 'bluesky', accountId: 'did:plc:one', accountLabel: 'one.bsky.social',
    accessToken: 'token-one', status: 'connected',
  });
  await grant(h.store, {
    provider: 'bluesky', accountId: 'did:plc:two', accountLabel: 'two.bsky.social',
    accessToken: 'token-two', status: 'connected',
  });

  const swept = await h.sweep.runVerifySweep({ scope: SCOPE, nowMs: NOW });
  assert.equal(
    swept.data.drifted,
    0,
    'filed under the provider alone, each account would read as drift from the last one checked, every sweep, forever'
  );
  assert.equal(swept.data.healthy, 2);
  assert.deepEqual(
    [...identities.rows.keys()].sort(),
    ['proj_a::bluesky:did:plc:one', 'proj_a::bluesky:did:plc:two'],
    'one remembered identity per connection, not per platform'
  );
});

test('the remembered identity catches drift the stored account id cannot', async (t) => {
  // A platform whose verify reports a LABEL and no id: the stored account id
  // and the verified one cannot be compared, so the memory is the only witness.
  const identities = fakeIdentityStore({ 'proj_a::mastodon:acct-1': { id: '', label: '@delray@mastodon.social' } });
  const h = withSweep({
    adapters: {
      mastodon: {
        verify: async () => ok({ valid: true, accountLabel: '@somebodyelse@mastodon.social' }),
        refresh: async () => ok({ refreshed: false }),
        revoke: async () => ok({ revokedAtProvider: true }),
        authorizeUrl: () => ok({}), exchange: async () => ok({}), listAccounts: async () => ok({}),
      },
    },
    identityStore: identities,
  });
  t.after(h.restore);

  await grant(h.store, {
    provider: 'mastodon', accountId: 'acct-1', accountLabel: '@delray@mastodon.social',
    accessToken: 'token', status: 'connected',
  });

  const swept = await h.sweep.runVerifySweep({ scope: SCOPE, nowMs: NOW });
  assert.equal(swept.data.results[0].drifted, true);
  assert.equal(swept.data.results[0].identityTracked, true);
  const stored = await h.store.getConnection({ provider: 'mastodon', accountId: 'acct-1' }, SCOPE);
  assert.match(stored.data.lastError, /@delray@mastodon\.social/);
  assert.match(stored.data.lastError, /@somebodyelse@mastodon\.social/);
});

test("an adapter's own 409 identity refusal is drift, and names the account we saved", async (t) => {
  const h = withSweep({
    adapters: {
      bluesky: {
        // This is exactly what the real Bluesky adapter answers: a handle can
        // move to another DID, so it refuses before returning an account.
        verify: async () => fail(409, 'This app password now signs in as newowner.bsky.social, not the account it was saved for.'),
        refresh: async () => ok({ refreshed: false }),
        revoke: async () => ok({ revokedAtProvider: true }),
        authorizeUrl: () => ok({}), exchange: async () => ok({}), listAccounts: async () => ok({}),
      },
    },
  });
  t.after(h.restore);

  await grant(h.store, {
    provider: 'bluesky', accountId: 'did:plc:delray', accountLabel: 'delray.bsky.social',
    accessToken: 'token', status: 'connected',
  });

  const swept = await h.sweep.runVerifySweep({ scope: SCOPE, nowMs: NOW });
  assert.equal(swept.data.drifted, 1);
  const stored = await h.store.getConnection({ provider: 'bluesky', accountId: 'did:plc:delray' }, SCOPE);
  assert.equal(stored.data.status, 'error');
  assert.match(stored.data.lastError, /newowner\.bsky\.social/, "the adapter's own sentence carries the new account");
  assert.match(stored.data.lastError, /saved as delray\.bsky\.social/, 'and the stored one is added, so both ends are on the record');
});

test('a 401 from verify is recorded as revoked, not as a generic error', async (t) => {
  const h = withSweep({
    adapters: {
      bluesky: {
        verify: async () => fail(401, 'The client withdrew this permission'),
        refresh: async () => ok({ refreshed: false }),
        revoke: async () => ok({ revokedAtProvider: true }),
        authorizeUrl: () => ok({}), exchange: async () => ok({}), listAccounts: async () => ok({}),
      },
    },
  });
  t.after(h.restore);

  await grant(h.store, {
    provider: 'bluesky', accountId: 'did:plc:gone', accountLabel: 'gone.bsky.social',
    accessToken: 'token', status: 'connected',
  });

  const swept = await h.sweep.runVerifySweep({ scope: SCOPE, nowMs: NOW });
  assert.equal(swept.data.results[0].status, 'revoked');
  const stored = await h.store.getConnection({ provider: 'bluesky', accountId: 'did:plc:gone' }, SCOPE);
  assert.equal(stored.data.status, 'revoked', 'the card can then say "permission was withdrawn", not "something went wrong"');
});

// ── Disconnect: revoke first, then forget ──────────────────────────────────

test('disconnect calls revoke BEFORE deleting, and reports the revoke', async (t) => {
  const order = [];
  const h = withSweep({
    adapters: {
      bluesky: {
        revoke: async () => { order.push('revoke'); return ok({ revokedAtProvider: true }); },
        verify: async () => ok({ valid: true }),
        refresh: async () => ok({ refreshed: false }),
        authorizeUrl: () => ok({}), exchange: async () => ok({}), listAccounts: async () => ok({}),
      },
    },
  });
  t.after(h.restore);

  await grant(h.store, {
    provider: 'bluesky', accountId: 'did:plc:delray', accountLabel: 'delray.bsky.social',
    accessToken: 'token', status: 'connected',
  });

  const realDelete = h.store.deleteConnection;
  h.store.deleteConnection = async (...args) => { order.push('delete'); return realDelete(...args); };
  t.after(() => { h.store.deleteConnection = realDelete; });

  const res = await call(h.route, { method: 'DELETE', path: '/api/connections/bluesky' });
  assert.equal(res.status, 200, JSON.stringify(res.payload));
  assert.deepEqual(order, ['revoke', 'delete'], 'delete-then-revoke leaves a live grant nobody can withdraw');
  assert.equal(res.payload.data.revokedAtProvider, true);
  assert.equal(res.payload.data.removed, 1);

  const gone = await h.store.getConnection({ provider: 'bluesky', accountId: 'did:plc:delray' }, SCOPE);
  assert.equal(gone.ok, false, 'and the row really is gone');
});

test('when revoke FAILS the row is kept and the caller is told — no silent success', async (t) => {
  let deletes = 0;
  const h = withSweep({
    adapters: {
      bluesky: {
        revoke: async () => fail(502, 'Bluesky is not answering'),
        verify: async () => ok({ valid: true }),
        refresh: async () => ok({ refreshed: false }),
        authorizeUrl: () => ok({}), exchange: async () => ok({}), listAccounts: async () => ok({}),
      },
    },
  });
  t.after(h.restore);

  await grant(h.store, {
    provider: 'bluesky', accountId: 'did:plc:delray', accountLabel: 'delray.bsky.social',
    accessToken: 'token', status: 'connected',
  });

  const realDelete = h.store.deleteConnection;
  h.store.deleteConnection = async (...args) => { deletes += 1; return realDelete(...args); };
  t.after(() => { h.store.deleteConnection = realDelete; });

  const res = await call(h.route, { method: 'DELETE', path: '/api/connections/bluesky' });
  assert.equal(res.payload.ok, false, 'a disconnect that did not disconnect must not answer 200');
  assert.equal(res.payload.error.code, 'REVOKE_FAILED');
  assert.match(res.payload.error.message, /not answering/);
  assert.equal(deletes, 0, 'nothing was deleted');

  const still = await h.store.getConnection({ provider: 'bluesky', accountId: 'did:plc:delray' }, SCOPE);
  assert.equal(
    still.ok,
    true,
    'THE assertion: the row is kept. Deleting it would leave a grant live at the provider that '
    + 'Starcaster no longer holds a token for and can never withdraw — the client finds it months later.'
  );
});

test('a forced disconnect deletes anyway, and says the grant may still be live', async (t) => {
  const h = withSweep({
    adapters: {
      bluesky: {
        revoke: async () => fail(502, 'Bluesky is not answering'),
        verify: async () => ok({ valid: true }),
        refresh: async () => ok({ refreshed: false }),
        authorizeUrl: () => ok({}), exchange: async () => ok({}), listAccounts: async () => ok({}),
      },
    },
  });
  t.after(h.restore);

  await grant(h.store, {
    provider: 'bluesky', accountId: 'did:plc:delray', accountLabel: 'delray.bsky.social',
    accessToken: 'token', status: 'connected',
  });

  const res = await call(h.route, { method: 'DELETE', path: '/api/connections/bluesky?force=1' });
  assert.equal(res.status, 200);
  assert.equal(res.payload.data.forced, true);
  assert.equal(res.payload.data.revokedAtProvider, false, 'forced is not revoked');
  assert.match(res.payload.data.notRevoked[0].reason, /may still be live/);

  const gone = await h.store.getConnection({ provider: 'bluesky', accountId: 'did:plc:delray' }, SCOPE);
  assert.equal(gone.ok, false);
});

test('a platform that CANNOT be revoked is not a failure — it deletes, and passes the instruction on', async (t) => {
  const h = withSweep({
    adapters: {
      bluesky: {
        // The real Bluesky adapter's answer: there is no endpoint for a third
        // party to retire an app password, so it says so rather than claiming one.
        revoke: async () => ok({
          revokedAtProvider: false,
          reason: 'Bluesky has no way for Starcaster to retire an app password. Delete it at Bluesky > Settings > App Passwords.',
        }),
        verify: async () => ok({ valid: true }),
        refresh: async () => ok({ refreshed: false }),
        authorizeUrl: () => ok({}), exchange: async () => ok({}), listAccounts: async () => ok({}),
      },
    },
  });
  t.after(h.restore);

  await grant(h.store, {
    provider: 'bluesky', accountId: 'did:plc:delray', accountLabel: 'delray.bsky.social',
    accessToken: 'token', status: 'connected',
  });

  const res = await call(h.route, { method: 'DELETE', path: '/api/connections/bluesky' });
  assert.equal(res.status, 200, 'a platform with no revoke endpoint must not read as a broken disconnect');
  assert.equal(res.payload.data.removed, 1);
  assert.equal(res.payload.data.revokedAtProvider, false, 'and it must not claim a revoke either');
  assert.match(res.payload.data.notRevoked[0].reason, /App Passwords/);
});

test('a legacy Facebook row removed through the bridge never counts as revoked', async (t) => {
  const h = withSweep({
    adapters: { facebook_page: null },
    legacyPage: { pageId: '123', pageName: 'Delray Tennis' },
  });
  t.after(h.restore);

  const res = await call(h.route, { method: 'DELETE', path: '/api/connections/facebook_page' });
  assert.equal(res.status, 200);
  assert.equal(res.payload.data.removed, 1);
  assert.equal(
    res.payload.data.revokedAtProvider,
    false,
    'nothing was said to Meta — counting it would make the answer claim a revoke that did not happen'
  );
  assert.match(res.payload.data.notRevoked[0].reason, /Business Integrations/);
});

// ── The endpoint ───────────────────────────────────────────────────────────

test('POST /api/connections/verify runs a batch — and is not read as a provider called "verify"', async (t) => {
  const h = withSweep({
    adapters: {
      bluesky: {
        verify: async (account) => ok({ valid: true, accountId: account.accountId, accountLabel: account.accountLabel }),
        refresh: async () => ok({ refreshed: false }),
        revoke: async () => ok({ revokedAtProvider: true }),
        authorizeUrl: () => ok({}), exchange: async () => ok({}), listAccounts: async () => ok({}),
      },
    },
  });
  t.after(h.restore);

  for (let i = 0; i < 12; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await grant(h.store, {
      provider: 'bluesky', accountId: `did:plc:a${i}`, accountLabel: `a${i}.bsky.social`,
      accessToken: `t${i}`, status: 'connected',
    });
  }

  const res = await call(h.route, { method: 'POST', path: '/api/connections/verify', body: {} });
  assert.equal(res.handled, true);
  assert.equal(res.status, 200, JSON.stringify(res.payload));
  assert.equal(res.payload.data.seen, 10);
  assert.equal(res.payload.data.remaining, 2);
  assert.equal(res.payload.data.done, false);
  assert.equal(
    /Unknown connection provider/.test(JSON.stringify(res.payload)),
    false,
    'placed before routeParts, or "verify" is read as a platform name and answered with a 404 about a typo'
  );
});

// ── The load-order trap ────────────────────────────────────────────────────

test('nothing in the connections chain is circular, from any entry point', () => {
  /**
   * The resolver requires the sweep; the sweep needs the registry; the registry
   * loads the Bluesky adapter, which loads lib/blueskyClient.js, which requires
   * the resolver. A top-level require of the registry closes that ring, and node
   * resolves a ring by handing back a HALF-BUILT module — measured,
   * `blueskyClient`'s destructured `resolveCredentials` came back `undefined`.
   * That is not a load error: it is a TypeError the first time a client's
   * Bluesky post is resolved, in production, with nothing at startup saying a
   * word.
   *
   * Each entry point is loaded in its OWN clean process, because a ring only
   * shows itself to whoever asks first.
   */
  const repoRoot = path.join(__dirname, '..', '..');
  const entries = [
    './lib/connections/resolveCredentials.js',
    './lib/connections/verifySweep.js',
    './lib/connections/registry.js',
    './lib/blueskyClient.js',
    './routes/connections.js',
  ];
  for (const entry of entries) {
    // The warning goes to STDERR and the process still exits 0, so a clean exit
    // proves nothing here — stderr is what has to be read.
    const result = spawnSync(process.execPath, ['-e', `require('${entry}')`], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${entry} failed to load: ${result.stderr}`);
    assert.doesNotMatch(
      result.stderr,
      /circular dependency/i,
      `${entry} loads a half-built module. node's warning names the property that came back undefined; `
      + 'defer that require into the function that uses it.'
    );
  }
});
