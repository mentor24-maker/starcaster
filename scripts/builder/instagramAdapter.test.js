'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Connections 5 of 7 (86bbpz1gk) — Instagram, and the two checks that stop an
 * unhelpful Meta error.
 *
 * The adapter conformance sweep (connectionsAdapterContract.test.js) already
 * proves Instagram exports the six, answers in the envelope, refuses empty
 * input without dialling out, and hands back an account its own verify /
 * refresh / revoke accept. None of that is repeated here.
 *
 * What IS here is the substance of the slice: the two pre-flight checks, and
 * the sentences they produce. Those sentences are the deliverable — the whole
 * ticket exists because Meta's own answer to a personal Instagram account is
 * either an `OAuthException` with a subcode or a cheerful 200 that does not
 * mention Instagram at all, and a client reading either has no idea what to
 * change. So they are asserted as STRINGS a client reads, not as codes.
 *
 * Nothing reaches the network. Every call is either given a stubbed `fetch` or
 * refuses before making a request.
 */

const contract = require('../../lib/connections/contract.js');
const registry = require('../../lib/connections/registry.js');
const instagram = require('../../lib/connections/adapters/instagram.js');
const facebookPage = require('../../lib/connections/adapters/facebookPage.js');
const { CODES } = require('../../lib/credentialErrors.js');
const { buildOAuthState, verifyOAuthState } = require('../../lib/metaOAuthState.js');

const META_ENV = { FACEBOOK_APP_ID: 'app-123', FACEBOOK_APP_SECRET: 'secret-123' };
const ENV_KEYS = [
  'FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET', 'META_APP_ID', 'META_APP_SECRET',
  'CONNECTIONS_OAUTH_ORIGIN', 'PUBLIC_APP_ORIGIN', 'APP_PUBLIC_ORIGIN', 'PUBLIC_BASE_URL', 'VERCEL_URL',
];

/**
 * Run `fn` with exactly these env vars set. Awaits an async body before
 * restoring — a plain try/finally restores at the first `await`, which makes an
 * async test assert against the ambient environment while reading as though it
 * had pinned one. Same shape as the sweep's helper, and for the same reason.
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

/** Swap global.fetch for a queue of canned replies, and record what was asked. */
function withFetch(replies, fn) {
  const calls = [];
  const queue = Array.isArray(replies) ? [...replies] : [replies];
  const realFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET' });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    const body = typeof next.body === 'string' ? next.body : JSON.stringify(next.body ?? {});
    return { ok: next.status >= 200 && next.status < 300, status: next.status, text: async () => body };
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

// The three Page shapes Meta actually returns, which is the entire input to the
// two checks. `instagram_business_account` appears only for a Business or
// Creator account; `connected_instagram_account` appears for a linked account
// of ANY type. That difference is what tells "personal" from "not linked".
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
const PAGE_NO_INSTAGRAM = { id: '57', name: 'Empty Page', access_token: 'page-token-3' };
// The fourth shape, and the one round 1 of review found. Meta lists a Page in
// `/me/accounts` whether or not the grant covers POSTING to it, so a Page can
// arrive with a perfectly good Business Instagram account behind it and no
// `access_token` at all. There is then nothing to authenticate a post with.
const PAGE_NO_TOKEN = {
  id: '59',
  name: 'Second Account',
  instagram_business_account: { id: '17841400000000002', username: 'secondaccount' },
};

const TOKEN_REPLIES = [
  { status: 200, body: { access_token: 'short-lived' } },
  { status: 200, body: { access_token: 'long-lived' } },
];

/** The three calls `exchange` makes, ending with whatever /me/accounts returns. */
function exchangeReplies(pages) {
  return [...TOKEN_REPLIES, { status: 200, body: { data: pages } }];
}

function connect(pages) {
  return withEnv(META_ENV, () => withFetch(exchangeReplies(pages), (calls) => instagram
    .exchange({ code: 'the-code' })
    .then((res) => ({ res, calls }))));
}

// ---------------------------------------------------------------------------
// Check 1: Business or Creator.
// ---------------------------------------------------------------------------

test('a personal Instagram account is refused with plain English, not a Meta error code', async () => {
  const { res } = await connect([PAGE_PERSONAL]);

  assert.equal(res.ok, false, 'a personal account must not connect');
  assert.equal(contract.envelopeProblem(res), null);

  // The sentence the ticket asks for, verbatim and first — it is what the
  // client acts on, so it leads rather than trailing an explanation.
  assert.ok(
    res.error.startsWith(instagram.MESSAGES.personal),
    `the refusal must lead with the plain-English sentence, got: ${res.error}`
  );
  assert.match(res.error, /personal account/);
  assert.match(res.error, /Business or Creator/);
  assert.match(res.error, /Settings, Account type and tools/);

  // ...and it names WHICH account, so a client managing several knows where to go.
  assert.match(res.error, /@richpersonal/);
  assert.match(res.error, /Rich's Page/);

  // The failure this ticket exists to prevent. If any of these ever appear in
  // the message, Meta's vocabulary has leaked through to a client.
  for (const jargon of ['OAuthException', 'error_subcode', 'code:', '#100', 'GraphMethodException']) {
    assert.ok(!res.error.includes(jargon), `Meta's own vocabulary leaked into the client's message: ${jargon}`);
  }

  assert.equal(res.code, CODES.ACCOUNT_INELIGIBLE, 'the credentials are fine; the ACCOUNT is not');
  assert.equal(res.check, 'business_or_creator');
});

test('the refusal carries no account, so nothing can be half-saved', async () => {
  // routes/connections.js and the Meta callback both store only when the
  // envelope is ok. Proving the envelope is a refusal — with no `accounts` on
  // it at all — is what makes "refused rather than half-saved" a property of
  // the shape rather than of a caller remembering to check.
  const { res } = await connect([PAGE_PERSONAL]);
  assert.equal(res.ok, false);
  assert.equal(res.data, null, 'a refusal must carry no accounts for a caller to store by accident');
});

// ---------------------------------------------------------------------------
// Check 3, added in round 2 of review: the Page has to carry a token.
//
// This is the defect that sent the slice back. A grant covering one good Page
// and one the client has no posting permission on produced TWO accounts, the
// second with an empty `accessToken`. `storeAccounts` walked the list, wrote
// the good one, then refused on the bad one — so the client saw the word
// `accessToken` in an error while their card sat green with nothing behind it.
// ---------------------------------------------------------------------------

test('a mixed grant connects the good account and stores NOTHING partial', async () => {
  const { res } = await connect([PAGE_BUSINESS, PAGE_NO_TOKEN]);

  assert.equal(res.ok, true, res.error);
  assert.equal(res.data.accounts.length, 1,
    'the tokenless Page must not become an account — it has no credential to post with');
  assert.deepEqual(res.data.accounts.map((a) => a.accountLabel), ['@delraytennis']);

  // The property that matters, asserted where it is decided rather than
  // inferred from the count: EVERY account handed up is storable. The old
  // failure was a list whose second entry was not, and a caller that only found
  // out half way through writing it.
  for (const account of res.data.accounts) {
    assert.deepEqual(contract.accountProblems(account, 'instagram'), [],
      'an account with a problem must never leave the adapter — that is the half-save');
  }
});

test('storeAccounts refuses a mixed list BEFORE writing any of it', async () => {
  // The other half of the same defect, one layer down. Even with the adapter
  // fixed, the shared store used to check and write in one pass — so the next
  // adapter to hand up a mixed list would half-save exactly as this one did.
  // Driven with the accounts directly, so nothing here depends on Instagram.
  const writes = [];
  const { storeAccounts } = require('../../lib/connections/completeConnection.js');
  const storePath = require.resolve('../../lib/projectConnectionsStore.js');
  const real = require.cache[storePath];
  require.cache[storePath] = {
    id: storePath,
    filename: storePath,
    loaded: true,
    exports: {
      saveConnection: async (row) => { writes.push(row.accountId); return { ok: true, status: 200, data: row }; },
      listConnections: async () => ({ ok: true, status: 200, data: [] }),
    },
  };
  try {
    const good = contract.account({ accountId: 'ig1', accountLabel: '@good', accessToken: 'page-token' });
    const bad = contract.account({ accountId: 'ig2', accountLabel: '@bad', accessToken: '' });
    const res = await storeAccounts({
      provider: 'instagram',
      displayName: 'Instagram',
      accounts: [good, bad],
      scope: { projectId: 'proj_a', userId: 'user_1' },
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'BAD_ACCOUNT');
    assert.deepEqual(writes, [],
      'a refused grant must write NOTHING — one row already stored is the half-save');
  } finally {
    if (real) require.cache[storePath] = real;
    else delete require.cache[storePath];
  }
});

test('a tokenless Page ALONE says the Page permission is missing, not that no Page exists', async () => {
  // The reason the check is a verdict rather than a filter one layer out. Drop
  // the Page in `listPagesWithInstagram` and this client — whose Instagram is
  // set up perfectly — is told "you do not manage any Facebook Page yet", which
  // they cannot act on and which is not true.
  const { res } = await connect([PAGE_NO_TOKEN]);

  assert.equal(res.ok, false);
  assert.equal(res.data, null, 'a refusal must carry no accounts for a caller to store by accident');
  assert.ok(res.error.startsWith(instagram.MESSAGES.noPageToken), res.error);
  assert.match(res.error, /Second Account/, 'it names the Page it looked at');
  assert.equal(res.check, 'page_permission');
  assert.equal(res.code, CODES.ACCOUNT_INELIGIBLE);

  // It must not be mistaken for either of the other two, nor for "no Pages".
  assert.ok(!res.error.includes('do not manage any Facebook Page'));
  assert.ok(!res.error.includes('personal account'));
  assert.ok(!res.error.includes('not linked to a Facebook Page'));

  // And it must not leak the internal field name the old failure showed a client.
  assert.ok(!/accessToken/i.test(res.error), 'internal jargon reached the client');
});

test('a tokenless Page is ranked ABOVE a personal one, because it is the account they meant', () => {
  // Both are failures; which sentence a client reads decides where they go. The
  // tokenless Page holds a Business account that would work, so sending them to
  // change an account type on an unrelated personal account is the confidently
  // wrong answer.
  const refusal = instagram.preflight(instagram.inspectPages([PAGE_PERSONAL, PAGE_NO_TOKEN]));
  assert.ok(refusal);
  assert.equal(refusal.check, 'page_permission');
});

// ---------------------------------------------------------------------------
// Check 2: linked to a Facebook Page.
// ---------------------------------------------------------------------------

test('an account not linked to a Page gets its OWN distinct sentence', async () => {
  const { res } = await connect([PAGE_NO_INSTAGRAM]);

  assert.equal(res.ok, false);
  assert.ok(res.error.startsWith(instagram.MESSAGES.notLinked), res.error);
  assert.match(res.error, /not linked to a Facebook Page/);
  assert.match(res.error, /Empty Page/, 'it names the Page it looked at');
  assert.equal(res.check, 'linked_to_page');

  // Distinct is the requirement, and it is easy to lose: two checks whose
  // messages differ only in a trailing clause read as one message to a client.
  assert.notEqual(instagram.MESSAGES.notLinked, instagram.MESSAGES.personal);
  assert.ok(!res.error.includes('personal account'), 'the two checks must not blur into one sentence');
});

test('a client who manages no Page at all is told THAT, not that nothing is linked', async () => {
  // A third face of check 2, and worth its own sentence: "link your account to
  // a Page" is unfollowable advice for someone who has no Page to link it to.
  const { res } = await connect([]);
  assert.equal(res.ok, false);
  assert.equal(res.error, instagram.MESSAGES.noPages);
  assert.match(res.error, /do not manage any Facebook Page/);
  assert.equal(res.check, 'linked_to_page');
});

// ---------------------------------------------------------------------------
// The happy path.
// ---------------------------------------------------------------------------

test('a Business account connects, and the account is labelled with the HANDLE', async () => {
  const { res, calls } = await connect([PAGE_BUSINESS]);
  assert.equal(res.ok, true, res.error);

  const account = res.data.accounts[0];
  assert.deepEqual(contract.accountProblems(account, 'instagram'), []);

  // Acceptance criterion 1: the handle, not the Page name. A client recognises
  // @delraytennis; they do not recognise the Page the post travels through.
  assert.equal(account.accountLabel, '@delraytennis');
  assert.notEqual(account.accountLabel, 'Delray Tennis');

  // The id is the INSTAGRAM user id, because that is what every Instagram Graph
  // call is addressed to — including verify below and slice 6's publish.
  assert.equal(account.accountId, '17841400000000000');
  assert.notEqual(account.accountId, '55', 'the Page id is not the account id');

  // The token is the PAGE token: Instagram publishing authenticates with it.
  assert.equal(account.accessToken, 'page-token');
  assert.equal(account.accountAvatarUrl, 'https://example.test/avatar.jpg');
  assert.equal(account.raw.page_id, '55', 'the Page id rides on raw so revoke can reach it');

  // The one request that answers both checks asked for BOTH Instagram fields.
  // Asking for only instagram_business_account is the documented-but-wrong way,
  // and it makes a personal account and an unlinked one indistinguishable.
  const accountsCall = calls[calls.length - 1];
  assert.match(decodeURIComponent(accountsCall.url), /instagram_business_account\{/);
  assert.match(decodeURIComponent(accountsCall.url), /connected_instagram_account\{/);
});

test('a grant covering several Instagram accounts hands back all of them, and skips the ineligible', async () => {
  // Acceptance criterion 4: the picker only exists if exchange returns more
  // than one. And a client with one good account and one personal one must NOT
  // be told they have a problem — reporting only the failures is how that
  // happens.
  const second = {
    id: '58',
    name: 'Delray Pro Shop',
    access_token: 'page-token-4',
    instagram_business_account: { id: '17841400000000001', username: 'delrayproshop' },
  };
  const { res } = await connect([PAGE_BUSINESS, PAGE_PERSONAL, second]);
  assert.equal(res.ok, true, res.error);
  assert.equal(res.data.accounts.length, 2);
  assert.deepEqual(res.data.accounts.map((a) => a.accountLabel), ['@delraytennis', '@delrayproshop']);
});

// ---------------------------------------------------------------------------
// The checks as pure functions — pinned directly, and shown to be able to fail.
// ---------------------------------------------------------------------------

test('inspectPages gives one of exactly four verdicts, from the two Graph fields and the Page token', () => {
  const verdicts = instagram.inspectPages([PAGE_BUSINESS, PAGE_PERSONAL, PAGE_NO_INSTAGRAM, PAGE_NO_TOKEN])
    .map((row) => row.verdict);
  assert.deepEqual(verdicts, ['eligible', 'personal', 'not_linked', 'no_page_token']);

  // `eligible` is the only verdict that becomes an account, so the token is
  // part of what the word MEANS. Take the token off the good Page and it stops
  // being eligible — take the id off and it stops too, because a Page we cannot
  // address is unpostable in exactly the same way.
  const { access_token: _token, ...noToken } = PAGE_BUSINESS;
  assert.equal(instagram.inspectPages([noToken])[0].verdict, 'no_page_token');
  assert.equal(instagram.inspectPages([{ ...PAGE_BUSINESS, id: '' }])[0].verdict, 'no_page_token');

  // But ONLY where a Business account was found: a tokenless Page whose account
  // is personal or unlinked still reports that, because the missing permission
  // is not what the client has to fix first.
  const { access_token: _t2, ...personalNoToken } = PAGE_PERSONAL;
  assert.equal(instagram.inspectPages([personalNoToken])[0].verdict, 'personal');

  // The discriminator, isolated: the SAME Page with the business field removed
  // reads as personal, and with both removed reads as not linked. If Meta ever
  // stops returning connected_instagram_account, this is the test that says so
  // rather than the checks quietly collapsing into one.
  const { instagram_business_account: _business, ...withoutBusiness } = PAGE_BUSINESS;
  assert.equal(instagram.inspectPages([{ ...withoutBusiness, connected_instagram_account: { id: '1', username: 'x' } }])[0].verdict, 'personal');
  assert.equal(instagram.inspectPages([withoutBusiness])[0].verdict, 'not_linked');
  assert.deepEqual(instagram.inspectPages(null), []);
});

test('preflight passes ONLY when something is actually postable — shown by making it fail', () => {
  const eligible = instagram.inspectPages([PAGE_BUSINESS]);
  assert.equal(instagram.preflight(eligible), null, 'a Business account must not be refused');

  // The break-on-purpose half. A gate that cannot object is not a gate, and the
  // happy path above is the only thing exercising it — so here it is handed
  // each failing shape and must produce a distinct, non-empty sentence.
  const seen = new Set();
  for (const pages of [[PAGE_PERSONAL], [PAGE_NO_INSTAGRAM], [PAGE_NO_TOKEN], []]) {
    const refusal = instagram.preflight(instagram.inspectPages(pages));
    assert.ok(refusal, 'preflight let an unpostable grant through');
    assert.equal(refusal.ok, false);
    assert.equal(contract.envelopeProblem(refusal), null);
    assert.equal(refusal.code, CODES.ACCOUNT_INELIGIBLE);
    assert.ok(refusal.error.length > 40, 'a refusal a client cannot act on is not a refusal');
    seen.add(refusal.error);
  }
  assert.equal(seen.size, 4, 'the four failures must read differently — a shared sentence tells nobody what to change');

  // One good account beside a bad one is a pass, not a warning.
  assert.equal(instagram.preflight(instagram.inspectPages([PAGE_PERSONAL, PAGE_BUSINESS])), null);
});

// ---------------------------------------------------------------------------
// The sign-in: scopes, and the pinned callback the Meta app has registered.
// ---------------------------------------------------------------------------

test('authorizeUrl asks for the Instagram publishing scopes on top of the Page ones', () => {
  withEnv({ ...META_ENV, VERCEL_URL: 'starcaster-git-some-preview-alphire.vercel.app' }, () => {
    const res = registry.adapterFor('instagram').authorizeUrl({ projectId: 'proj_a', userId: 'user_1' });
    assert.equal(res.ok, true, res.error);
    const dialog = new URL(res.data.url);
    const scopes = String(dialog.searchParams.get('scope')).split(',');

    assert.ok(scopes.includes('instagram_basic'), 'without instagram_basic the checks cannot read the account');
    assert.ok(scopes.includes('instagram_content_publish'), 'without this the grant cannot post');
    // Every Page scope too: one consent screen covers both, and dropping one
    // here would silently narrow the Facebook grant a client already gave.
    for (const scope of facebookPage.DEFAULT_SCOPES.split(',')) {
      assert.ok(scopes.includes(scope), `the Instagram grant must keep the Page scope ${scope}`);
    }

    // Constraint 3 of the epic: never a preview hostname. Meta rejects any
    // redirect_uri it was not registered with, and a preview URL is different
    // on every single deployment.
    assert.equal(dialog.searchParams.get('redirect_uri'), `${contract.PRODUCTION_ORIGIN}${facebookPage.callbackPath}`);
    assert.ok(!res.data.url.includes('vercel.app'));
  });
});

test('Instagram and Facebook share ONE registered redirect_uri, told apart by the signed state', () => {
  withEnv(META_ENV, () => {
    // Sharing the URL is the point: exactly one is registered with the Meta
    // app, so inventing a second path here would fail at Meta's end for every
    // client with an error naming none of this.
    assert.equal(instagram.callbackUrl(), facebookPage.callbackUrl());

    const igState = new URL(instagram.authorizeUrl({ projectId: 'p', userId: 'u' }).data.url)
      .searchParams.get('state');
    const fbState = new URL(facebookPage.authorizeUrl({ projectId: 'p', userId: 'u' }).data.url)
      .searchParams.get('state');

    // ...which means the state is the ONLY thing that tells the shared callback
    // which adapter to finish with. If this ever stops differing, pressing
    // Connect on Instagram silently connects a Facebook Page instead.
    assert.equal(verifyOAuthState(igState).data.provider, 'instagram');
    assert.equal(verifyOAuthState(fbState).data.provider, 'facebook_page');
  });
});

test('a state written before Instagram existed still resolves, as Facebook', () => {
  // A state is live for fifteen minutes. A client part-way through connecting
  // when this deploys must not come back to "invalid OAuth state" — and the
  // only thing it can have been is the flow that was the only one there.
  withEnv(META_ENV, () => {
    const legacy = buildOAuthState({ projectId: 'p', userId: 'u' });
    assert.equal(verifyOAuthState(legacy.data).data.provider, 'facebook_page');
  });
});

// ---------------------------------------------------------------------------
// The rest of the six, where Instagram differs from Facebook.
// ---------------------------------------------------------------------------

test('verify asks the INSTAGRAM account, and reports the handle', async () => {
  await withEnv(META_ENV, () => withFetch(
    [{ status: 200, body: { id: '17841400000000000', username: 'delraytennis' } }],
    async (calls) => {
      const res = await instagram.verify({ accountId: '17841400000000000', accessToken: 'page-token' });
      assert.equal(res.ok, true, res.error);
      assert.equal(res.data.valid, true);
      assert.equal(res.data.accountLabel, '@delraytennis');
      assert.match(calls[0].url, /17841400000000000/, 'verify must ask about the Instagram account, not the Page');
    }
  ));
});

test('refresh is honest that there is nothing to refresh, rather than failing', async () => {
  // A Page token from a long-lived user token does not expire. That is a fact
  // about Meta, not an error — and slice 6 sweeps every platform without
  // knowing which ones have refresh tokens, so this must answer ok.
  const res = await instagram.refresh({ accountId: '178', accessToken: 'page-token' });
  assert.equal(res.ok, true);
  assert.equal(res.data.refreshed, false);
  assert.match(res.data.reason, /does not expire/);
});

test('revoke reaches the Page that holds the permission, and says so when it cannot', async () => {
  await withEnv(META_ENV, () => withFetch([{ status: 200, body: { success: true } }], async (calls) => {
    const res = await instagram.revoke({
      accountId: '17841400000000000',
      accessToken: 'page-token',
      raw: { page_id: '55' },
    });
    assert.equal(res.ok, true);
    assert.equal(res.data.revokedAtProvider, true);
    assert.equal(calls[0].method, 'DELETE');
    assert.match(calls[0].url, /\/55\/permissions/, 'the permission lives on the Page, not the Instagram account');
  }));

  // `raw` is dropped by contract.storableAccount on the way into the vault, so
  // an account read back out has no Page id. That is the known two-part
  // credential gap, and it must produce an instruction a client can follow —
  // not a 400 that reads like a broken connection.
  const withoutPage = await instagram.revoke({ accountId: '17841400000000000', accessToken: 'page-token' });
  assert.equal(withoutPage.ok, true);
  assert.equal(withoutPage.data.revokedAtProvider, false);
  assert.match(withoutPage.data.reason, /Business Integrations/);
});

test('a Meta failure during exchange comes back as an envelope, not a throw', async () => {
  const { res } = await withEnv(META_ENV, () => withFetch(
    [{ status: 400, body: { error: { message: 'This authorization code has been used.' } } }],
    () => instagram.exchange({ code: 'spent' }).then((r) => ({ res: r }))
  ));
  assert.equal(res.ok, false);
  assert.equal(contract.envelopeProblem(res), null);
  assert.match(res.error, /authorization code has been used/);
  // Not an ineligibility: this one IS a credential/flow problem, and labelling
  // it ACCOUNT_INELIGIBLE would send the client to change an account that is fine.
  assert.notEqual(res.code, CODES.ACCOUNT_INELIGIBLE);
});
