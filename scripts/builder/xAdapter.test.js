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

const contract = require('../../lib/connections/contract.js');
const registry = require('../../lib/connections/registry.js');
const x = require('../../lib/connections/adapters/x.js');
const verifySweep = require('../../lib/connections/verifySweep.js');
const xClient = require('../../lib/xClient.js');
const { verifyOAuthState } = require('../../lib/metaOAuthState.js');

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
