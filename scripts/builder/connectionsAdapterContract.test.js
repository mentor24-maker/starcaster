'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Connections 2 of 7 (86bbpz1e1) — the adapter contract, proven twice.
 *
 * The point of this file is the first test: it walks EVERY adapter the registry
 * knows about, not a list written here, so a seventh platform added next month
 * is tested by code written before it existed. An adapter that forgets `revoke`
 * fails here, at `npm run test:builder`, instead of at a client who wants their
 * permission back.
 *
 * Nothing here reaches the network. Every adapter call below is either given a
 * stubbed `fetch` or is called with input it must refuse before making a
 * request — which is itself part of the contract, because a wizard that has to
 * make an HTTP call to find out it was handed no token is a wizard that hangs.
 */

const contract = require('../../lib/connections/contract.js');
const registry = require('../../lib/connections/registry.js');

const ORIGIN_VARS = [
  'CONNECTIONS_OAUTH_ORIGIN', 'PUBLIC_APP_ORIGIN', 'APP_PUBLIC_ORIGIN', 'PUBLIC_BASE_URL', 'VERCEL_URL',
];

/**
 * Run `fn` with the named env vars set to exactly `values` and nothing else.
 *
 * It waits for an async `fn` before restoring. A plain try/finally does NOT:
 * `finally` fires the instant the promise is created, so the body would run
 * past its first `await` against the ambient environment while still reading
 * as though it controlled it. That is a test that cannot fail, which is worse
 * than no test — and this file is the harness slices 3-7 extend, so the trap
 * would be inherited. `withFetch` below has always had this shape; withEnv
 * now matches it.
 */
function withEnv(values, fn) {
  const saved = new Map();
  const keys = new Set([...ORIGIN_VARS, ...Object.keys(values)]);
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
      return out.then(
        (result) => { restore(); return result; },
        (err) => { restore(); throw err; },
      );
    }
    restore();
    return out;
  } catch (err) {
    restore();
    throw err;
  }
}

/** Swap global.fetch for a queue of canned replies, and record what was asked. */
function withFetch(replies, fn) {
  const calls = [];
  const queue = Array.isArray(replies) ? [...replies] : [replies];
  const realFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', options });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    const body = typeof next.body === 'string' ? next.body : JSON.stringify(next.body ?? {});
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      text: async () => body,
    };
  };
  const done = (result) => { global.fetch = realFetch; return result; };
  try {
    const out = fn(calls);
    if (out && typeof out.then === 'function') return out.then(done, (err) => { global.fetch = realFetch; throw err; });
    return done(out);
  } catch (err) {
    global.fetch = realFetch;
    throw err;
  }
}

/**
 * Input every one of the six can be called with that must NOT touch the
 * network — the contract's "refuse before you dial" rule. Every field a real
 * call would need is deliberately absent.
 */
const EMPTY_INPUT = {};

const BSKY_SESSION = { status: 200, body: { accessJwt: 'jwt-abc', did: 'did:plc:xyz', handle: 'delray.bsky.social' } };
const BSKY_CREDS = { identifier: '@delray.bsky.social', appPassword: 'abcd-efgh-ijkl-mnop' };

/**
 * How to connect each provider without a network: what `exchange` is called
 * with, and the canned replies each of the six gets.
 *
 * A fixture per provider rather than a generic one because "connect" genuinely
 * differs — Facebook takes an OAuth code, Bluesky takes a handle and an app
 * password, and that difference is the reason the contract is proven twice.
 * What is generic is the SWEEP below, which walks the registry: a ready adapter
 * with no fixture here fails by name, so platform seven cannot be added without
 * proving its own account round-trips.
 */
const ROUND_TRIP_FIXTURES = {
  facebook_page: {
    env: { FACEBOOK_APP_ID: 'app-123', FACEBOOK_APP_SECRET: 'secret-123' },
    connect: { code: 'the-code' },
    replies: {
      exchange: [
        { status: 200, body: { access_token: 'short-lived' } },
        { status: 200, body: { access_token: 'long-lived' } },
        { status: 200, body: { data: [{ id: '55', name: 'Delray Tennis', access_token: 'page-token' }] } },
      ],
      verify: [{ status: 200, body: { id: '55', name: 'Delray Tennis' } }],
      listAccounts: [{ status: 200, body: { data: [{ id: '55', name: 'Delray Tennis', access_token: 'page-token' }] } }],
      refresh: [{ status: 200, body: {} }],
      revoke: [{ status: 200, body: { success: true } }],
    },
  },
  bluesky: {
    env: {},
    connect: { ...BSKY_CREDS },
    replies: {
      exchange: [BSKY_SESSION],
      verify: [BSKY_SESSION],
      listAccounts: [BSKY_SESSION],
      refresh: [BSKY_SESSION],
      revoke: [BSKY_SESSION],
    },
  },
};

/** The four that are called WITH an account `exchange` handed back. */
const ROUND_TRIP_FUNCTIONS = ['verify', 'listAccounts', 'refresh', 'revoke'];

test('a connected account round-trips: every adapter accepts the account it just produced', async () => {
  // The test this slice was sent back twice for. `exchange` used to hand back
  // `{ id, label }` while the other five read `{ accountId, accountLabel }`, so
  // an adapter refused its own account — Bluesky on three of the four with
  // "Bluesky needs a handle and an app password", which reads as a broken
  // connection, and Facebook on verify and revoke. Every existing test passed:
  // the conformance sweep only ever passed EMPTY_INPUT and asserted a refusal,
  // and the per-provider tests passed hand-written credentials. Nothing fed an
  // adapter its own output, so the gap had no test that could fail.
  const entries = registry.CATALOGUE.filter((entry) => entry.adapter);
  assert.ok(entries.length >= 2, 'a round trip proven on one platform is not proven');

  for (const entry of entries) {
    const fixture = ROUND_TRIP_FIXTURES[entry.provider];
    assert.ok(
      fixture,
      `"${entry.provider}" is a ready adapter with no entry in ROUND_TRIP_FIXTURES. `
      + 'Add one — what `exchange` is called with, and a canned reply for each of the six — '
      + 'so this sweep proves your account can be handed back to your own verify/refresh/revoke.'
    );

    await withEnv(fixture.env || {}, async () => {
      const account = await withFetch(fixture.replies.exchange, async () => {
        const res = await entry.adapter.exchange(fixture.connect);
        assert.equal(res.ok, true, `${entry.provider}.exchange refused its own fixture: ${res.error}`);
        const accounts = res.data?.accounts;
        assert.ok(Array.isArray(accounts) && accounts.length, `${entry.provider}.exchange returned no accounts`);
        const problems = contract.accountProblems(accounts[0], `${entry.provider}.exchange account`);
        assert.deepEqual(problems, [], problems.join('\n'));
        return accounts[0];
      });

      for (const fnName of ROUND_TRIP_FUNCTIONS) {
        // The account exactly as it came back — a copy, so a mutating adapter
        // cannot make the next call in this loop pass on leftovers.
        const res = await withFetch(fixture.replies[fnName], () => entry.adapter[fnName]({ ...account }));
        assert.equal(contract.envelopeProblem(res), null, `${entry.provider}.${fnName} did not return the envelope`);
        assert.equal(
          res.ok,
          true,
          `${entry.provider}.${fnName} refused the account ${entry.provider}.exchange just produced `
          + `(${res.status}: ${res.error}). The account carries ${Object.keys(account).join(', ')}.`
        );
      }

      // listAccounts hands accounts back too, so its accounts must round-trip
      // as well — otherwise slice 6's health sweep, which lists then verifies,
      // would hit the same wall from the other side.
      const listed = await withFetch(fixture.replies.listAccounts, () => entry.adapter.listAccounts({ ...account }));
      const problems = contract.accountProblems(listed.data?.accounts?.[0], `${entry.provider}.listAccounts account`);
      assert.deepEqual(problems, [], problems.join('\n'));
    });
  }
});

test('the round-trip check FAILS an account in the old two-vocabulary shape', () => {
  // The break-on-purpose half: every adapter passes the sweep above, so the
  // only way to watch the check object is to hand it what used to be emitted.
  const wasEmitted = { id: '55', label: 'Delray Tennis', avatarUrl: '', accessToken: 'page-token', raw: {} };
  const problems = contract.accountProblems(wasEmitted, 'legacy');
  assert.match(problems.join('\n'), /carries `id`.*Use `accountId`/s);
  assert.match(problems.join('\n'), /carries `label`.*Use `accountLabel`/s);
  assert.match(problems.join('\n'), /missing `accountId`/);
  assert.match(problems.join('\n'), /missing `accountLabel`/);

  assert.deepEqual(contract.accountProblems(contract.account(wasEmitted), 'converted'), []);
  assert.match(contract.accountProblems(null).join(''), /expected an account object, got null/);
  assert.match(
    contract.accountProblems({ accountId: '1', accountLabel: 'x' }).join(''),
    /missing `accessToken`/
  );
});

test('accountRef reads an account whichever vocabulary it arrives in', () => {
  // Strict on the way out, tolerant on the way in: a provider's own row or an
  // older stored shape still resolves, so the fix cannot be undone by a caller
  // that hands over something it read from somewhere else.
  assert.deepEqual(contract.accountRef({ id: '55', label: 'Delray', avatarUrl: '/a.png', accessToken: 't' }), {
    accountId: '55', accountLabel: 'Delray', accountAvatarUrl: '/a.png', accessToken: 't', raw: null,
  });
  assert.deepEqual(contract.accountRef({ accountId: '55', accountLabel: 'Delray', accessToken: 't' }), {
    accountId: '55', accountLabel: 'Delray', accountAvatarUrl: '', accessToken: 't', raw: null,
  });
  // The canonical name wins when both are somehow present.
  assert.equal(contract.accountRef({ accountId: 'right', id: 'wrong' }).accountId, 'right');
  assert.deepEqual(contract.accountRef(), {
    accountId: '', accountLabel: '', accountAvatarUrl: '', accessToken: '', raw: null,
  });
});

test('every registered adapter exports all six contract functions', () => {
  const adapters = registry.listAdapters();
  assert.ok(adapters.length >= 2, 'the contract is only proven if at least two platforms implement it');
  for (const adapter of adapters) {
    const problems = contract.adapterProblems(adapter, adapter.provider || 'unnamed adapter');
    assert.deepEqual(problems, [], problems.join('\n'));
  }
});

test('every registered adapter answers in the envelope, without dialling out', async () => {
  const adapters = registry.listAdapters();
  for (const adapter of adapters) {
    for (const fnName of contract.ADAPTER_FUNCTIONS) {
      // No fetch at all: any adapter that reaches the network on empty input
      // throws here rather than quietly hanging a wizard on a 30s timeout.
      const realFetch = global.fetch;
      global.fetch = async () => { throw new Error(`${adapter.provider}.${fnName} called the network on empty input`); };
      let result;
      try {
        result = await adapter[fnName](EMPTY_INPUT);
      } finally {
        global.fetch = realFetch;
      }
      const problem = contract.envelopeProblem(result);
      assert.equal(problem, null, `${adapter.provider}.${fnName} did not return the envelope: ${problem}`);
      assert.equal(result.ok, false, `${adapter.provider}.${fnName} should refuse empty input, not accept it`);
    }
  }
});

test('the conformance check FAILS an adapter that is missing one of the six', () => {
  // The break-on-purpose half. A test that walks every adapter is worthless if
  // it cannot object, and every adapter in the registry passes — so the only
  // way to see it fail is to hand it one that should.
  const broken = { ...require('../../lib/connections/adapters/bluesky.js') };
  delete broken.revoke;
  const problems = contract.adapterProblems(broken, 'broken');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /missing `revoke`/);

  const wrongKind = { ...require('../../lib/connections/adapters/bluesky.js'), authKind: 'telepathy' };
  assert.match(contract.adapterProblems(wrongKind, 'wrongKind').join(''), /authKind/);

  assert.match(contract.adapterProblems(null, 'nothing').join(''), /expected an adapter object, got null/);
});

test('the envelope check rejects the near-misses the wrapped libraries return', () => {
  assert.equal(contract.isEnvelope({ ok: true, status: 200, data: null }), true);
  assert.equal(contract.isEnvelope({ ok: false, status: 400, data: null, error: 'no' }), true);
  assert.match(contract.envelopeProblem({ ok: true, status: 200 }), /`data` must be present/);
  assert.match(contract.envelopeProblem({ ok: false, status: 400, data: null }), /non-empty `error`/);
  assert.match(contract.envelopeProblem({ ok: 'yes', status: 200, data: 1 }), /`ok` must be a boolean/);
  assert.match(contract.envelopeProblem({ ok: true, status: 'fine', data: 1 }), /`status` must be a number/);
  assert.match(contract.envelopeProblem('nope'), /expected an object/);
});

// ---------------------------------------------------------------------------
// The pinned callback origin.
// ---------------------------------------------------------------------------

test('the OAuth callback origin never falls through to VERCEL_URL', () => {
  withEnv({ VERCEL_URL: 'starcaster-git-some-preview-alphire.vercel.app' }, () => {
    const { origin, source } = contract.oauthCallbackOrigin();
    assert.equal(origin, contract.PRODUCTION_ORIGIN);
    assert.equal(source, 'pinned');
    assert.ok(!origin.includes('vercel.app'), 'a preview hostname is not registered with any provider');
  });
});

test('the callback origin prefers an explicit pin, then the configured origin', () => {
  withEnv({ CONNECTIONS_OAUTH_ORIGIN: 'https://pinned.example/', PUBLIC_APP_ORIGIN: 'http://localhost:3001' }, () => {
    assert.deepEqual(contract.oauthCallbackOrigin(), { origin: 'https://pinned.example', source: 'CONNECTIONS_OAUTH_ORIGIN' });
  });
  withEnv({ PUBLIC_APP_ORIGIN: 'http://localhost:3001', VERCEL_URL: 'preview.vercel.app' }, () => {
    assert.deepEqual(contract.oauthCallbackOrigin(), { origin: 'http://localhost:3001', source: 'PUBLIC_APP_ORIGIN' });
  });
  // `source` must name the variable that ACTUALLY answered. It used to say
  // PUBLIC_APP_ORIGIN for all three, which sends whoever is debugging a rejected
  // redirect to edit a setting nobody set.
  for (const name of ['PUBLIC_APP_ORIGIN', 'APP_PUBLIC_ORIGIN', 'PUBLIC_BASE_URL']) {
    withEnv({ [name]: 'https://configured.example/' }, () => {
      assert.deepEqual(
        contract.oauthCallbackOrigin(),
        { origin: 'https://configured.example', source: name },
        `oauthCallbackOrigin() must report ${name} as its source when ${name} is what answered`,
      );
    });
  }
  withEnv({}, () => {
    assert.deepEqual(contract.oauthCallbackOrigin(), { origin: contract.PRODUCTION_ORIGIN, source: 'pinned' });
  });
});

test('withEnv still controls the environment after an await — the harness slices 3-7 inherit', async () => {
  // This is a test OF the helper, not of the product. It is here because
  // `withEnv` is how every later slice will pin VERCEL_URL, and the failure it
  // guards against is silent: a try/finally restores at the first `await`, so an
  // async body asserts against the ambient environment while reading as though
  // it had pinned one. Such a test passes whatever the code does.
  await withEnv({ VERCEL_URL: 'starcaster-git-some-preview-alphire.vercel.app' }, async () => {
    assert.equal(process.env.VERCEL_URL, 'starcaster-git-some-preview-alphire.vercel.app');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      process.env.VERCEL_URL,
      'starcaster-git-some-preview-alphire.vercel.app',
      'withEnv restored the environment before its async body finished',
    );
    assert.deepEqual(contract.oauthCallbackOrigin(), { origin: contract.PRODUCTION_ORIGIN, source: 'pinned' });
  });
});

test('withEnv restores the environment when its async body rejects', async () => {
  const before = process.env.VERCEL_URL;
  await assert.rejects(
    () => withEnv({ VERCEL_URL: 'preview.vercel.app' }, async () => {
      await new Promise((resolve) => setImmediate(resolve));
      throw new Error('boom');
    }),
    /boom/,
  );
  assert.equal(process.env.VERCEL_URL, before);
});

test('facebookPage.authorizeUrl builds its redirect from the pinned origin, not the request', () => {
  withEnv({
    VERCEL_URL: 'starcaster-git-some-preview-alphire.vercel.app',
    FACEBOOK_APP_ID: 'app-123',
    FACEBOOK_APP_SECRET: 'secret-123',
  }, () => {
    const adapter = registry.adapterFor('facebook_page');
    // An origin is passed in the shape the old caller used, to prove it is ignored.
    const res = adapter.authorizeUrl({ projectId: 'proj_a', userId: 'user_1', origin: 'https://preview.vercel.app' });
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.redirectUri, `${contract.PRODUCTION_ORIGIN}/api/promote/social/facebook/oauth/callback`);
    const dialog = new URL(res.data.url);
    assert.equal(dialog.searchParams.get('redirect_uri'), res.data.redirectUri);
    assert.ok(!res.data.url.includes('vercel.app'));
  });
});

test('facebookPage.authorizeUrl refuses in the envelope when the Meta app is not configured', () => {
  withEnv({ FACEBOOK_APP_ID: '', FACEBOOK_APP_SECRET: '', META_APP_ID: '', META_APP_SECRET: '' }, () => {
    const res = registry.adapterFor('facebook_page').authorizeUrl({ projectId: 'proj_a', userId: 'user_1' });
    assert.equal(res.ok, false);
    assert.equal(res.status, 400);
    assert.match(res.error, /app_id and app_secret are required/);
    assert.equal(contract.envelopeProblem(res), null);
  });
});

// ---------------------------------------------------------------------------
// Facebook Pages: the ported flow, unchanged.
// ---------------------------------------------------------------------------

test('facebookPage.exchange returns the same Page rows the route already stores', async () => {
  await withEnv({ FACEBOOK_APP_ID: 'app-123', FACEBOOK_APP_SECRET: 'secret-123' }, () => withFetch([
    { status: 200, body: { access_token: 'short-lived' } },
    { status: 200, body: { access_token: 'long-lived' } },
    { status: 200, body: { data: [{ id: '55', name: 'Delray Tennis', access_token: 'page-token' }] } },
  ], async (calls) => {
    const res = await registry.adapterFor('facebook_page').exchange({ code: 'the-code' });
    assert.equal(res.ok, true, res.error);
    // The shape routes/engage.js reads, byte for byte — this is what the page
    // selection handoff and projectSocialCredentialsStore.saveFacebookPage take.
    assert.deepEqual(res.data.pages, [{ id: '55', name: 'Delray Tennis', access_token: 'page-token' }]);
    // And the shape a provider-agnostic caller reads.
    assert.deepEqual(res.data.accounts, [{
      accountId: '55',
      accountLabel: 'Delray Tennis',
      accountAvatarUrl: '',
      accessToken: 'page-token',
      raw: { id: '55', name: 'Delray Tennis', access_token: 'page-token' },
    }]);
    assert.ok(calls[0].url.includes('/oauth/access_token'), 'the code is exchanged first');
    assert.ok(calls[2].url.includes('/me/accounts'), 'then the Pages are listed');
  }));
});

test('facebookPage.exchange keeps the no-Pages message a client can act on', async () => {
  await withEnv({ FACEBOOK_APP_ID: 'app-123', FACEBOOK_APP_SECRET: 'secret-123' }, () => withFetch([
    { status: 200, body: { access_token: 'short-lived' } },
    { status: 200, body: { access_token: 'long-lived' } },
    { status: 200, body: { data: [] } },
  ], async () => {
    const res = await registry.adapterFor('facebook_page').exchange({ code: 'the-code' });
    assert.equal(res.ok, false);
    assert.equal(res.status, 400);
    assert.match(res.error, /No Facebook Pages found for this account/);
  }));
});

test('facebookPage verify and revoke answer in the envelope', async () => {
  const adapter = registry.adapterFor('facebook_page');
  await withFetch({ status: 200, body: { id: '55', name: 'Delray Tennis' } }, async () => {
    const res = await adapter.verify({ accountId: '55', accessToken: 'page-token' });
    assert.equal(res.ok, true, res.error);
    assert.deepEqual(res.data, { valid: true, accountId: '55', accountLabel: 'Delray Tennis' });
  });
  await withFetch({ status: 200, body: { success: true } }, async (calls) => {
    const res = await adapter.revoke({ accountId: '55', accessToken: 'page-token' });
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.revokedAtProvider, true);
    assert.equal(calls[0].method, 'DELETE');
    assert.ok(calls[0].url.includes('/55/permissions'));
  });
  // A dead token is still a revoke as far as the client is concerned — but it
  // says so rather than claiming Meta confirmed something Meta refused.
  await withFetch({ status: 400, body: { error: { message: 'Invalid OAuth access token' } } }, async () => {
    const res = await adapter.revoke({ accountId: '55', accessToken: 'stale' });
    assert.equal(res.ok, true);
    assert.equal(res.data.revokedAtProvider, false);
    assert.match(res.data.reason, /Invalid OAuth access token/);
  });
});

test('lib/metaOAuth.js still exports everything it did, now from the adapter', () => {
  const metaOAuth = require('../../lib/metaOAuth.js');
  for (const name of ['DEFAULT_SCOPES', 'getMetaAppCredentials', 'isMetaAppConfigured',
    'buildRedirectUri', 'buildOAuthStartUrl', 'completeOAuthCodeExchange', 'listManagedPages']) {
    assert.ok(name in metaOAuth, `lib/metaOAuth.js no longer exports ${name} — an existing caller breaks`);
  }
  withEnv({ VERCEL_URL: 'preview.vercel.app' }, () => {
    // The one deliberate change in the move: the origin argument is ignored,
    // because it is the thing that made the redirect unregisterable.
    assert.equal(
      metaOAuth.buildRedirectUri('https://preview.vercel.app'),
      `${contract.PRODUCTION_ORIGIN}/api/promote/social/facebook/oauth/callback`
    );
  });
});

// ---------------------------------------------------------------------------
// Bluesky: the same contract, with no browser anywhere in it.
// ---------------------------------------------------------------------------


test('bluesky refuses authorizeUrl in the envelope — it has no browser step', () => {
  const res = registry.adapterFor('bluesky').authorizeUrl({ projectId: 'proj_a', userId: 'user_1' });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'NOT_SUPPORTED');
  assert.match(res.error, /app password/);
  assert.equal(contract.envelopeProblem(res), null);
  // And the catalogue says so up front, so slice 4 renders a form rather than a
  // Connect button and never calls this at all.
  assert.equal(registry.getEntry('bluesky').authKind, 'app_password');
});

test('bluesky connects, lists, verifies and revokes through the same contract', async () => {
  const adapter = registry.adapterFor('bluesky');

  await withFetch(BSKY_SESSION, async (calls) => {
    const res = await adapter.exchange(BSKY_CREDS);
    assert.equal(res.ok, true, res.error);
    assert.deepEqual(res.data.accounts, [{
      accountId: 'did:plc:xyz',
      accountLabel: 'delray.bsky.social',
      accountAvatarUrl: '',
      // The app password, not the two-hour session token — see the adapter.
      accessToken: 'abcd-efgh-ijkl-mnop',
      raw: { did: 'did:plc:xyz', handle: 'delray.bsky.social', serviceUrl: 'https://bsky.social' },
    }]);
    const sent = JSON.parse(calls[0].options.body);
    assert.equal(sent.identifier, 'delray.bsky.social', 'the leading @ is stripped, which is the usual 401');
  });

  await withFetch(BSKY_SESSION, async () => {
    const res = await adapter.listAccounts({ accountId: 'did:plc:xyz', ...BSKY_CREDS });
    assert.deepEqual(contract.accountProblems(res.data?.accounts?.[0], 'bluesky.listAccounts account'), []);
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.accounts.length, 1);
  });

  await withFetch(BSKY_SESSION, async () => {
    const res = await adapter.verify({ accountId: 'did:plc:xyz', accessToken: BSKY_CREDS.appPassword, identifier: 'delray.bsky.social' });
    assert.equal(res.ok, true, res.error);
    assert.deepEqual(res.data, { valid: true, accountId: 'did:plc:xyz', accountLabel: 'delray.bsky.social' });
  });

  const res = await adapter.revoke({ accountId: 'did:plc:xyz', accessToken: BSKY_CREDS.appPassword });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.data.revokedAtProvider, false, 'claiming otherwise would be a claim with nothing behind it');
  assert.match(res.data.reason, /App Passwords/);
});

test('bluesky verify catches an app password that now signs in as someone else', async () => {
  const adapter = registry.adapterFor('bluesky');
  // Driven through the account `exchange` actually produced, then with its
  // saved DID changed — the shape slice 6's sweep will use. Round 2's version
  // hand-wrote `{ accountId, identifier }`, which no adapter ever emitted, so
  // the 409 was only ever proven in a vocabulary nothing spoke: on a real
  // round trip `input.accountId` was absent and the check could not fire.
  const connected = await withFetch(BSKY_SESSION, async () => {
    const res = await adapter.exchange(BSKY_CREDS);
    return res.data.accounts[0];
  });
  assert.equal(connected.accountId, 'did:plc:xyz');

  await withFetch(BSKY_SESSION, async () => {
    const res = await adapter.verify({ ...connected, accountId: 'did:plc:someone-else' });
    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.match(res.error, /not the account it was saved for/);
    // Named by handle, which is what the client recognises — the DID is not
    // something anybody could match against their own account.
    assert.match(res.error, /delray\.bsky\.social/);
  });
});

test('bluesky passes a failed sign-in through as the envelope, message intact', async () => {
  await withFetch({ status: 401, body: { message: 'Invalid identifier or password' } }, async () => {
    const res = await registry.adapterFor('bluesky').exchange(BSKY_CREDS);
    assert.equal(res.ok, false);
    assert.equal(res.status, 401);
    // lib/blueskyClient.js adds the sentence that actually fixes it. Losing it
    // in the port would leave a client staring at "Invalid identifier".
    assert.match(res.error, /full handle\/email for Identifier/);
  });
});

// ---------------------------------------------------------------------------
// The catalogue.
// ---------------------------------------------------------------------------

test('every catalogue entry carries a readiness flag and the text a card needs', () => {
  const entries = registry.listCatalogue();
  assert.ok(entries.length >= 2);
  for (const entry of entries) {
    assert.ok(contract.READINESS_FLAGS.includes(entry.readiness), `${entry.provider} has no readiness flag`);
    assert.ok(contract.AUTH_KINDS.includes(entry.authKind), `${entry.provider} has no authKind`);
    for (const field of ['displayName', 'iconKey', 'blurb']) {
      assert.ok(String(entry[field] || '').trim(), `${entry.provider} is missing ${field}`);
    }
    assert.equal('adapter' in entry, false, 'the catalogue a screen reads must not carry live adapters');
    assert.equal(entry.connectable, entry.readiness === 'ready');
  }
});

test('nothing in the catalogue names YouTube or LinkedIn, and nothing can', () => {
  const text = JSON.stringify(registry.listCatalogue()).toLowerCase();
  assert.ok(!text.includes('youtube'), 'YouTube needs a business identity Alphire does not have');
  assert.ok(!text.includes('linkedin'), 'LinkedIn needs a business identity Alphire does not have');
  assert.throws(
    () => registry.validateCatalogue([{
      provider: 'youtube', displayName: 'YouTube', iconKey: 'youtube', blurb: 'no', readiness: 'coming_soon', authKind: 'redirect', adapter: null,
    }]),
    /out of scope for this epic/
  );
});

test('the registry refuses a catalogue that lies about itself', () => {
  const bluesky = require('../../lib/connections/adapters/bluesky.js');
  const base = {
    provider: 'bluesky', displayName: 'Bluesky', iconKey: 'bluesky', blurb: 'x',
    readiness: 'ready', authKind: 'app_password', adapter: bluesky,
  };
  assert.doesNotThrow(() => registry.validateCatalogue([base]));
  assert.throws(() => registry.validateCatalogue([{ ...base, readiness: 'coming_soon' }]), /has an adapter/);
  assert.throws(() => registry.validateCatalogue([{ ...base, adapter: null }]), /marked ready but has no adapter/);
  assert.throws(() => registry.validateCatalogue([{ ...base, adapter: { ...bluesky, revoke: undefined } }]), /missing `revoke`/);
  assert.throws(() => registry.validateCatalogue([{ ...base, provider: 'bsky' }]), /calls itself/);
  assert.throws(() => registry.validateCatalogue([{ ...base, authKind: 'redirect' }]), /slice 4 renders the wrong control/);
  assert.throws(() => registry.validateCatalogue([base, base]), /registered twice/);
  assert.throws(() => registry.validateCatalogue([{ ...base, blurb: '' }]), /missing blurb/);
});

test('an unknown provider and an unfinished one are different answers', () => {
  const unknown = registry.getAdapter('myspace');
  assert.equal(unknown.ok, false);
  assert.equal(unknown.status, 404);
  assert.equal(unknown.code, 'UNKNOWN_PROVIDER');

  const soon = registry.getAdapter('instagram');
  assert.equal(soon.ok, false);
  assert.equal(soon.status, 400);
  assert.equal(soon.code, 'COMING_SOON');
  assert.match(soon.error, /not connectable yet/);

  const ready = registry.getAdapter('facebook_page');
  assert.equal(ready.ok, true);
  assert.equal(ready.data.provider, 'facebook_page');
});
