'use strict';

/**
 * Keeping a connection alive when nobody is watching. Connections 6a of 7
 * (86bbpz1gv) — the server half; the amber card and the refused-connect
 * sentence are 6b (86bbu50mb).
 *
 * Three jobs, and they are one file because they share the same two dangerous
 * facts about this table:
 *
 *   refreshBeforeUse   a token close to expiry is renewed on the way out of the
 *                      resolver, so a publish never carries one that dies
 *                      mid-request
 *   runVerifySweep     ONE BATCH of connections asked "do you still work, and
 *                      are you still the same account", with what remains
 *                      reported back
 *   revokeConnection   hand the permission back at the provider BEFORE
 *                      forgetting the token here
 *
 * ── Fact one: `updated_at` is the active-account selector ──────────────────
 *
 * It is not bookkeeping. `listConnections` orders by it, the resolver posts
 * with the first live row it returns, and the account picker in
 * routes/connections.js works by touching a row —
 * lib/connections/completeConnection.js says it in as many words: "touching a
 * row is how it is chosen".
 *
 * So a health sweep that writes a status through the ordinary path would
 * RE-ELECT whichever account it happened to check last. A client with two
 * Facebook Pages would find their posts moving between them on a schedule,
 * with every gate green and nothing in any log saying so — the exact
 * wrong-account-post failure this whole epic is shaped around. Every write in
 * this file therefore passes `{ bumpUpdatedAt: false }`.
 *
 * What actually holds that in place is the test
 * "every status write the sweep makes is marked do-not-re-elect"
 * (`scripts/builder/connectionsVerifySweep.test.js`), which spies on the store
 * and pins the options argument of every write. Do not lean on the behavioural
 * test beside it as the guarantee: it reads the account back after a sweep, and
 * in a fake fast enough to land both writes in the same millisecond the
 * `updated_at` values TIE and the store's `created_at` tie-break restores the
 * original order — so it passed for a while with this guard deleted (found by
 * review on PR #556). It buys the millisecond back now with a real pause in the
 * adapter, but the assertion that cannot be defeated by a clock is the spy.
 *
 * The one exception is `refreshBeforeUse`, which writes through
 * `saveConnection` (a new token is a whole-grant write) and so does bump it.
 * That is correct there and not a hole: it only ever runs on the row the
 * resolver has ALREADY chosen, so bumping keeps that same row first.
 *
 * ── Fact two: a serverless function can die mid-loop ───────────────────────
 *
 * `runVerifySweep` does one batch and reports what is left, the shape
 * `lib/builderPublishStore.js` uses and for the same reason — this repo has
 * been bitten twice by a long loop that a platform froze halfway through,
 * leaving half the work done and nothing saying which half. The caller loops;
 * the function does not.
 *
 * The cursor is `last_verified_at`, ascending, and EVERY attempt stamps it —
 * a failed check is still a check. Stamping only successes would put a
 * permanently broken connection at the front of every batch forever and starve
 * every healthy one behind it. What the attempt found is in `status` and
 * `last_error`, which is where an outcome belongs.
 *
 * The queue is what is DUE (`STALE_AFTER_MS`), not everything. That is what
 * makes `remaining` a number worth looping on: over the whole table it would be
 * `total - batchSize` on every call, `done` would never be true, and a caller
 * looping on it would sweep the same rows against a provider's API forever.
 */

const contract = require('./contract');
const projectConnectionsStore = require('../projectConnectionsStore');
const credentialIdentityStore = require('../credentialIdentityStore');

/**
 * The registry, fetched at CALL time and not at load time — and this is load
 * bearing, not a style choice.
 *
 * `lib/connections/resolveCredentials.js` requires this file (refresh-before-use
 * lives here), and the chain from the registry runs
 * registry → adapters/bluesky → lib/blueskyClient.js → resolveCredentials.
 * Requiring the registry at the top of this file closes that ring, and node
 * resolves a ring by handing whoever asked first a HALF-BUILT module: measured,
 * `blueskyClient`'s `const { resolveCredentials } = require(...)` came back
 * `undefined`, which is not a load error — it is a TypeError the first time a
 * client's Bluesky post is resolved, in production, with nothing at startup
 * having said a word.
 *
 * Deferring the require to the moment it is used breaks the ring: nothing is
 * mid-construction by then. `scripts/builder/connectionsVerifySweep.test.js`
 * loads the resolver in a clean process and fails on node's own
 * circular-dependency warning, so re-adding the top-level require fails a test
 * rather than shipping.
 */
function defaultRegistry() {
  // eslint-disable-next-line global-require
  return require('./registry');
}

/**
 * Connections per invocation. Small enough that one batch is never the thing
 * that times out: each one is a live HTTP call to a provider.
 */
const VERIFY_BATCH_SIZE = 10;
const MAX_VERIFY_BATCH_SIZE = 50;

/**
 * How much life left counts as "about to expire".
 *
 * Shorter than the shortest token any platform in this epic issues — X's are
 * measured in hours (task 86bbpz1hu) — and long enough that a publish starting
 * inside the window is renewed before it runs. A token with more life than this
 * is handed out as it stands; refreshing every token on every post would spend a
 * provider's rate limit on nothing.
 */
const REFRESH_WINDOW_MS = 30 * 60 * 1000;

/**
 * How many rows one sweep will look at before it stops counting.
 *
 * A project holding more connections than this is not a shape anyone has built
 * for, and the honest answer to hitting the cap is to SAY so — `listCapped` in
 * the report — rather than sweep a silently truncated list and call it a clean
 * pass (CLAUDE.md: no silent caps).
 */
const SWEEP_LIST_LIMIT = 500;

/**
 * How long a check stays good before a connection is due for another.
 *
 * This is what makes `remaining` mean something. Without it the queue is every
 * connection the project has, so `remaining` is `total - batchSize` on every
 * call, `done` is never true, and a caller looping on it — the CLI, a cron —
 * sweeps forever, hammering a provider's API with the same rows. `due` is the
 * rows whose last check is older than this, so the loop empties and stops.
 *
 * Six hours: short enough that a permission withdrawn in the morning is on the
 * card by the afternoon, long enough that an hourly schedule mostly finds
 * nothing to do and costs a provider almost nothing.
 */
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

function safeText(value) {
  return String(value === 0 || value ? value : '').trim();
}

function nowIso(nowMs) {
  return new Date(Number.isFinite(nowMs) ? nowMs : Date.now()).toISOString();
}

/**
 * The key this connection's remembered identity is filed under.
 *
 * `lib/credentialIdentityStore.js` keys on (project, provider), which is right
 * for the app-wide credentials it was written for: one Instagram token per
 * project, in Settings. A tenant connection is finer-grained — one project can
 * hold three Facebook Pages — so filing them all under "facebook_page" would
 * make each one read as drift from the last one checked, three times a sweep,
 * forever.
 *
 * So the account is part of the key. This is deliberately NOT a second identity
 * store (the ticket's Non-goal): the same table, the same reader and writer, the
 * same sentence-builder. Only the identifier is narrower, because what is being
 * remembered is narrower.
 */
function identityKeyFor(provider, accountId) {
  const key = safeText(provider).toLowerCase();
  const account = safeText(accountId);
  return account ? `${key}:${account}` : key;
}

/**
 * Is this token close enough to expiry to renew?
 *
 * A row with no `expires_at` never is — most platforms here issue tokens that
 * do not expire, and treating "no expiry recorded" as "expiring now" would
 * refresh every Facebook Page on every post.
 */
function refreshDue(connection, nowMs, windowMs = REFRESH_WINDOW_MS) {
  const expiresAt = safeText(connection?.expiresAt);
  if (!expiresAt) return { due: false, why: 'this token has no recorded expiry' };
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) return { due: false, why: `its expiry (${expiresAt}) is not a date` };
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  if (expiry <= now) return { due: true, why: `its token expired at ${expiresAt}`, expired: true };
  if (expiry - now <= windowMs) {
    return { due: true, why: `its token expires at ${expiresAt}, inside the refresh window`, expired: false };
  }
  return { due: false, why: `its token is good until ${expiresAt}` };
}

/**
 * The `saveConnection` input that re-stores a whole grant with a new token.
 *
 * Built field by field rather than by spreading the row, because
 * `saveConnection` runs a strict allowlist and a decrypted connection carries
 * six fields it refuses (`projectId`, `keyVersion`, `hasAccessToken`, …). A
 * spread would answer `400 Unknown field` — and, worse, a PARTIAL input would
 * blank the label and the scopes of the grant it was meant to renew, under a
 * 200 (projectConnectionsStore, review round 1, defect 2).
 */
function reSaveInput(connection, changes = {}) {
  return {
    provider: safeText(connection.provider),
    accountId: safeText(connection.accountId),
    accountLabel: safeText(connection.accountLabel),
    accountAvatarUrl: safeText(connection.accountAvatarUrl),
    scopes: Array.isArray(connection.scopes) ? connection.scopes : [],
    connectedByUserId: safeText(connection.connectedByUserId),
    status: safeText(connection.status) || 'connected',
    expiresAt: safeText(connection.expiresAt),
    lastVerifiedAt: safeText(connection.lastVerifiedAt),
    lastError: safeText(connection.lastError),
    accessToken: safeText(connection.accessToken),
    refreshToken: safeText(connection.refreshToken),
    ...changes,
  };
}

/** The account shape every adapter reads, out of a decrypted stored connection. */
function accountFrom(connection) {
  return contract.account({
    accountId: safeText(connection?.accountId),
    accountLabel: safeText(connection?.accountLabel),
    accountAvatarUrl: safeText(connection?.accountAvatarUrl),
    accessToken: safeText(connection?.accessToken),
    // `raw` is dropped by `contract.storableAccount` on the way into the vault
    // and there is no column for it, so a stored connection can never hand one
    // back. Named here rather than omitted so the next reader does not go
    // hunting for where it went — lib/connections/contract.js documents the gap
    // and which slice closes it.
    raw: null,
  });
}

/**
 * Renew a token that is close to expiry, and store the new one.
 *
 * Returns `{ ok, refreshed, connection, note }`. `ok: false` means the refresh
 * was attempted and failed — the caller is told, the connection has been marked
 * needs-attention, and the token it already holds is still the client's own and
 * still valid for the moments left on it.
 *
 * That last part is the deliberate choice. Refusing outright would take a
 * working account off the air ahead of time; falling back to the platform-wide
 * keys would post as Starcaster instead of the client, which is the failure
 * `resolveCredentials` exists to prevent. Marking it and carrying on is the
 * only option that is both honest and non-destructive.
 */
async function refreshBeforeUse({ connection, scope, nowMs, windowMs = REFRESH_WINDOW_MS, store, registryRef } = {}) {
  const connectionsStore = store || projectConnectionsStore;
  const providers = registryRef || defaultRegistry();
  const provider = safeText(connection?.provider).toLowerCase();

  const due = refreshDue(connection, nowMs, windowMs);
  if (!due.due) return { ok: true, refreshed: false, connection, note: due.why };

  const adapter = providers.adapterFor(provider);
  if (!adapter) {
    return {
      ok: true,
      refreshed: false,
      connection,
      note: `${provider} has no adapter, so there is nothing that could refresh it`,
    };
  }

  let res;
  try {
    res = await adapter.refresh(accountFrom(connection));
  } catch (err) {
    res = contract.fail(502, `${provider} threw while refreshing: ${safeText(err?.message) || err}`);
  }

  if (!res || res.ok !== true) {
    const why = safeText(res?.error) || `${provider} refused the refresh`;
    // `expiring` and not `error`: the grant itself has not been refused, we
    // simply could not renew it, and it is still posting until it lapses. The
    // card goes amber either way (6b) — the difference is the sentence under it.
    await connectionsStore.updateConnectionStatus(
      {
        provider,
        accountId: safeText(connection.accountId),
        status: due.expired ? 'expired' : 'expiring',
        lastError: `Could not renew this connection before it expires: ${why}`,
      },
      scope,
      { bumpUpdatedAt: false }
    );
    return { ok: false, refreshed: false, connection, note: why };
  }

  const nextToken = safeText(res.data?.accessToken) || safeText(connection.accessToken);
  const nextExpiry = safeText(res.data?.expiresAt);
  // An adapter that says "nothing to refresh on this platform" is reporting a
  // fact, not doing work — Facebook and Instagram both answer this way, because
  // a Page token from a long-lived user token does not expire. Storing an
  // unchanged token would bump `updated_at` and re-elect the row for nothing.
  if (res.data?.refreshed !== true || (nextToken === safeText(connection.accessToken) && !nextExpiry)) {
    return {
      ok: true,
      refreshed: false,
      connection,
      note: safeText(res.data?.reason) || `${provider} had nothing to refresh`,
    };
  }

  const saved = await connectionsStore.saveConnection(
    reSaveInput(connection, {
      accessToken: nextToken,
      refreshToken: safeText(res.data?.refreshToken) || safeText(connection.refreshToken),
      expiresAt: nextExpiry || safeText(connection.expiresAt),
      status: 'connected',
      lastError: '',
      lastVerifiedAt: nowIso(nowMs),
    }),
    scope
  );
  if (!saved.ok) {
    // The provider handed over a NEW token and the vault would not take it. The
    // old one may already have been retired at the provider's end, so this is
    // not a nothing-happened: say so rather than returning the stale token as
    // though the refresh had simply not been due.
    return {
      ok: false,
      refreshed: false,
      connection,
      note: `${provider} issued a new token but it could not be stored (${safeText(saved.error) || saved.status})`,
    };
  }

  return {
    ok: true,
    refreshed: true,
    // The stored row, plus the token in hand: `saveConnection` answers with the
    // token-free shape, and the caller is about to post with this.
    connection: { ...connection, ...saved.data, accessToken: nextToken, refreshToken: safeText(res.data?.refreshToken) || safeText(connection.refreshToken) },
    note: `renewed before use — ${due.why}`,
  };
}

/**
 * Has this credential started authenticating as somebody else?
 *
 * Compared against the connection's OWN stored account first, which is the
 * authoritative "who we think this is" and needs no table to have been created.
 * `lib/credentialIdentityStore.js` is then asked as well, because it remembers
 * across sweeps and catches a label-only platform that has no stable id — and
 * because its answer is the one an operator has already seen elsewhere.
 *
 * Both identities are always named. "This connection drifted" with nobody named
 * is a sentence that sends whoever reads it to the provider's dashboard to work
 * out what happened.
 */
function identityDrift({ stored, verified }) {
  const previousId = safeText(stored?.accountId);
  const previousLabel = safeText(stored?.accountLabel) || previousId;
  const currentId = safeText(verified?.accountId);
  const currentLabel = safeText(verified?.accountLabel) || currentId;

  let drifted = false;
  if (previousId && currentId) drifted = previousId !== currentId;
  else if (previousLabel && currentLabel) drifted = previousLabel.toLowerCase() !== currentLabel.toLowerCase();

  return {
    drifted,
    previous: { id: previousId, label: previousLabel },
    current: { id: currentId, label: currentLabel },
    sentence: drifted
      ? `This connection was saved as ${previousLabel || previousId || 'an unnamed account'} and now `
        + `authenticates as ${currentLabel || currentId || 'a different account'}. `
        + 'Until it is connected again, posts would go to the wrong account.'
      : '',
  };
}

/**
 * What the sweep decided about one connection, before anything is written.
 *
 * Split out from the write so a test can pin the decision directly instead of
 * inferring it from a round trip, and so the mapping from "what the provider
 * said" to "which of the five stored statuses" lives in one readable place.
 *
 *   401 / 403        the permission is gone at the provider's end   → revoked
 *   409              the adapter's own identity check refused it    → error
 *   anything else    we could not use it and do not know why        → error
 */
function outcomeFor({ verifyResult, stored, drift }) {
  if (verifyResult?.ok === true) {
    if (drift?.drifted) return { status: 'error', lastError: drift.sentence, healthy: false };
    return { status: 'connected', lastError: '', healthy: true };
  }
  const why = safeText(verifyResult?.error) || 'the platform refused this connection';
  const code = Number(verifyResult?.status) || 0;
  if (code === 401 || code === 403) {
    return { status: 'revoked', lastError: why, healthy: false };
  }
  if (code === 409) {
    // The adapter compared identities itself and refused — Bluesky does, because
    // a handle can move to another DID. Its sentence names the account it now
    // signs in as; the stored one is named here so both ends are on the record.
    const saved = safeText(stored?.accountLabel) || safeText(stored?.accountId) || 'the account it was saved as';
    return { status: 'error', lastError: `${why} (it was saved as ${saved}.)`, healthy: false, drifted: true };
  }
  return { status: 'error', lastError: why, healthy: false };
}

/**
 * Check one stored connection and write down what was found.
 *
 * Never throws: a sweep over ten connections must not lose nine of them because
 * one provider's client library threw.
 */
async function verifyConnection({ row, scope, nowMs, store, registryRef, identityStore } = {}) {
  const connectionsStore = store || projectConnectionsStore;
  const providers = registryRef || defaultRegistry();
  const identities = identityStore || credentialIdentityStore;

  const provider = safeText(row?.provider).toLowerCase();
  const accountId = safeText(row?.accountId);
  const base = {
    provider,
    accountId,
    accountLabel: safeText(row?.accountLabel) || accountId,
  };
  const checkedAt = nowIso(nowMs);

  /** One write, one shape, and `bumpUpdatedAt: false` in exactly one place. */
  const record = async (fields) => connectionsStore.updateConnectionStatus(
    { provider, accountId, lastVerifiedAt: checkedAt, ...fields },
    scope,
    { bumpUpdatedAt: false }
  );

  /**
   * A check that could NOT be run — reported as an unknown, never as a pass or
   * a failure (DOCTRINE 3.11), and the cursor stamped anyway.
   *
   * The stamp is the part that is easy to leave out, and leaving it out was a
   * real defect: measured against the local database, a connection for a
   * platform with no adapter kept `last_verified_at` empty, so it stayed
   * permanently due and took a slot out of every batch forever — starving the
   * healthy connections behind it. That is the same starvation the cursor
   * exists to prevent, arriving through the branch that skips it.
   *
   * `status` and `last_error` are deliberately NOT written. We did not learn
   * anything about this grant, and overwriting what the last real check found
   * would be a claim with nothing behind it.
   */
  const cannotCheck = async (reason) => {
    const written = await record({});
    return {
      ...base,
      checked: false,
      healthy: null,
      status: safeText(row?.status),
      reason,
      written: written.ok,
      ...(written.ok ? {} : { writeError: safeText(written.error) || `status ${written.status}` }),
    };
  };

  const expiry = refreshDue(row, nowMs);
  if (expiry.expired) {
    // Already past its expiry: there is nothing for a provider to tell us that
    // the clock has not, and spending a live API call to be told so is waste.
    const written = await record({ status: 'expired', lastError: expiry.why });
    return { ...base, checked: true, healthy: false, status: 'expired', reason: expiry.why, written: written.ok };
  }

  const adapter = providers.adapterFor(provider);
  if (!adapter) {
    return cannotCheck(`${provider} has no adapter on this build, so this connection could not be checked`);
  }

  const full = await connectionsStore.getConnection({ provider, accountId }, scope);
  if (!full.ok) {
    return cannotCheck(`the stored credential could not be read (${safeText(full.error) || full.status})`);
  }

  let verifyResult;
  try {
    verifyResult = await adapter.verify(accountFrom(full.data));
  } catch (err) {
    verifyResult = contract.fail(502, `${provider} threw while verifying: ${safeText(err?.message) || err}`);
  }

  const verified = verifyResult?.ok === true
    ? { accountId: safeText(verifyResult.data?.accountId), accountLabel: safeText(verifyResult.data?.accountLabel) }
    : { accountId: '', accountLabel: '' };

  let drift = identityDrift({ stored: full.data, verified });

  // Remembered across sweeps, in the store that already exists for this. It
  // degrades to `tracked: false` when the table has not been applied, which is
  // why the comparison above is the load-bearing one and this is the second
  // opinion rather than the only one.
  let tracked = false;
  if (verifyResult?.ok === true && (verified.accountId || verified.accountLabel)) {
    const remembered = await identities.recordVerifiedIdentity({
      projectId: safeText(scope?.projectId),
      provider: identityKeyFor(provider, accountId),
      identity: { id: verified.accountId, label: verified.accountLabel },
    }).catch(() => ({ changed: false, previous: null, tracked: false }));
    tracked = Boolean(remembered?.tracked);
    if (remembered?.changed && !drift.drifted) {
      drift = {
        ...drift,
        drifted: true,
        previous: {
          id: safeText(remembered.previous?.id),
          label: safeText(remembered.previous?.label) || safeText(remembered.previous?.id),
        },
        sentence: `This connection last authenticated as `
          + `${safeText(remembered.previous?.label) || safeText(remembered.previous?.id) || 'a different account'} `
          + `and now authenticates as ${verified.accountLabel || verified.accountId || 'a different account'}. `
          + 'Until it is connected again, posts would go to the wrong account.',
      };
    }
  }

  const outcome = outcomeFor({ verifyResult, stored: full.data, drift });
  const drifted = Boolean(outcome.drifted || (outcome.healthy === false && drift.drifted));

  // Healthy, but inside the refresh window — `expiring` is a live status, so it
  // keeps posting; it is what puts the card in the "renew me" state (6b) and
  // what tells the resolver's refresh-before-use path there is work to do.
  const status = outcome.healthy && expiry.due ? 'expiring' : outcome.status;
  const lastError = outcome.healthy && expiry.due ? '' : outcome.lastError;

  const written = await record({ status, lastError });
  return {
    ...base,
    checked: true,
    healthy: outcome.healthy,
    status,
    reason: lastError || (expiry.due ? expiry.why : 'the platform confirmed this connection'),
    drifted,
    ...(drifted ? { previousIdentity: drift.previous, currentIdentity: drift.current } : {}),
    identityTracked: tracked,
    written: written.ok,
    ...(written.ok ? {} : { writeError: safeText(written.error) || `status ${written.status}` }),
  };
}

/**
 * ONE batch of this project's connections, checked, with what remains reported.
 *
 * Not a loop over everything: a serverless invocation that dies partway leaves
 * half the work done and nothing recording which half. The caller loops on
 * `remaining`, which is what `scripts/connections_verify_sweep.mjs` and the
 * `POST /api/connections/verify` endpoint both do.
 */
async function runVerifySweep({ scope, limit, nowMs, staleAfterMs, store, registryRef, identityStore } = {}) {
  const connectionsStore = store || projectConnectionsStore;
  const projectId = safeText(scope?.projectId);
  if (!projectId) {
    return { ok: false, status: 400, error: 'A project scope is required to verify connections', data: null };
  }

  const batchSize = Math.max(
    1,
    Math.min(Number(limit) || VERIFY_BATCH_SIZE, MAX_VERIFY_BATCH_SIZE)
  );

  const listed = await connectionsStore.listConnections(SWEEP_LIST_LIMIT, scope);
  if (!listed.ok) return { ok: false, status: listed.status || 500, error: listed.error, data: null };
  const rows = Array.isArray(listed.data) ? listed.data : [];

  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const staleAfter = Number.isFinite(staleAfterMs) ? staleAfterMs : STALE_AFTER_MS;

  // DUE first, least recently CHECKED first inside that, never-checked before
  // everything. Two properties are being bought here, and both have bitten:
  //
  //   the cursor is `last_verified_at`, NOT `updated_at` — see the header, that
  //   column decides which account posts;
  //   the queue is what is DUE, not everything — otherwise `remaining` is
  //   `total - batchSize` on every call, `done` is never true, and a caller
  //   looping on it sweeps the same rows forever.
  const queue = rows
    .map((row, index) => ({ row, index, at: Date.parse(safeText(row?.lastVerifiedAt)) }))
    .map((entry) => ({ ...entry, at: Number.isFinite(entry.at) ? entry.at : 0 }))
    .filter((entry) => now - entry.at >= staleAfter)
    // The list order breaks ties, so a batch is reproducible rather than
    // whatever the sort happened to do with equal keys.
    .sort((a, b) => (a.at === b.at ? a.index - b.index : a.at - b.at))
    .map((entry) => entry.row);

  const batch = queue.slice(0, batchSize);
  const results = [];
  for (const row of batch) {
    // Sequential on purpose: these are live calls to a provider's API, and a
    // burst of ten is how a rate limit turns one broken connection into ten.
    // eslint-disable-next-line no-await-in-loop
    results.push(await verifyConnection({ row, scope, nowMs, store: connectionsStore, registryRef, identityStore }));
  }

  const remaining = Math.max(0, queue.length - batch.length);
  return {
    ok: true,
    status: 200,
    data: {
      projectId,
      checked: results.filter((r) => r.checked).length,
      /** Rows the sweep looked at, including the ones it could not check. */
      seen: batch.length,
      /** Still due after this batch. Zero means nothing is outstanding. */
      remaining,
      /** How many were due when this call started — `seen` + `remaining`. */
      due: queue.length,
      /** Every connection this project holds, due or not. */
      total: rows.length,
      done: remaining === 0,
      batchSize,
      healthy: results.filter((r) => r.healthy === true).length,
      unhealthy: results.filter((r) => r.healthy === false).length,
      /** Never graded as a pass. DOCTRINE 3.11: say what could not be checked. */
      couldNotCheck: results.filter((r) => r.healthy === null).length,
      drifted: results.filter((r) => r.drifted).length,
      /**
       * True when the project holds more connections than one sweep will even
       * count, so `total` and `remaining` are floors rather than the number.
       */
      listCapped: rows.length >= SWEEP_LIST_LIMIT,
      results,
    },
  };
}

/**
 * Hand the permission back at the provider, THEN forget the token here.
 *
 * That order is the whole point. Deleting first and revoking after means a
 * failure leaves a live grant at Meta or Bluesky that this app can no longer
 * see, no longer has a token for, and cannot ever retire — it shows up in the
 * client's own Facebook settings as an app they thought they removed.
 *
 * Three different things are carefully not confused:
 *
 *   the adapter FAILED (`ok: false`)          we do not know what happened at the
 *                                             provider's end. The row is KEPT and
 *                                             the caller is told, because trying
 *                                             again is the only thing that can
 *                                             fix it. `force` overrides, loudly.
 *   the adapter says it CANNOT revoke         a fact about the platform, not a
 *   (`ok`, `revokedAtProvider: false`)        failure — Bluesky has no endpoint
 *                                             for it. Delete, and pass the
 *                                             adapter's own instruction on.
 *   the credential cannot be READ             retrying cannot help, so keeping
 *                                             the row would make the connection
 *                                             permanently undeletable. Delete,
 *                                             and say the grant may survive.
 */
async function revokeConnection({ provider, accountId, scope, force = false, store, registryRef } = {}) {
  const connectionsStore = store || projectConnectionsStore;
  const providers = registryRef || defaultRegistry();
  const key = safeText(provider).toLowerCase();
  const account = safeText(accountId);

  const answer = (fields) => ({ provider: key, accountId: account, ...fields });

  const adapter = providers.adapterFor(key);
  if (!adapter) {
    return answer({
      ok: true,
      revokedAtProvider: false,
      mayDelete: true,
      reason: `Starcaster has no way to talk to ${key}, so the permission could not be withdrawn here. `
        + 'Remove Starcaster in that platform\'s own app settings to withdraw it.',
    });
  }

  const full = await connectionsStore.getConnection({ provider: key, accountId: account }, scope);
  if (!full.ok) {
    return answer({
      ok: true,
      revokedAtProvider: false,
      mayDelete: true,
      reason: `The stored credential could not be read (${safeText(full.error) || full.status}), so the `
        + 'permission could not be withdrawn at the platform. Remove Starcaster in that platform\'s own '
        + 'app settings — retrying here cannot help.',
    });
  }

  let res;
  try {
    res = await adapter.revoke(accountFrom(full.data));
  } catch (err) {
    res = contract.fail(502, `${key} threw while revoking: ${safeText(err?.message) || err}`);
  }

  if (!res || res.ok !== true) {
    const why = safeText(res?.error) || `${key} refused the revoke`;
    return answer({
      ok: Boolean(force),
      revokedAtProvider: false,
      mayDelete: Boolean(force),
      forced: Boolean(force),
      status: Number(res?.status) || 502,
      reason: force
        ? `The permission was NOT withdrawn at ${key} (${why}) and the stored credential was removed anyway `
          + 'because this disconnect was forced. The grant may still be live on the platform — remove '
          + 'Starcaster in its own app settings.'
        : `The permission could not be withdrawn at ${key} (${why}), so nothing was removed here. `
          + 'Try again: deleting the stored credential now would leave a live grant on the platform that '
          + 'Starcaster can no longer withdraw.',
    });
  }

  const revoked = res.data?.revokedAtProvider === true;
  return answer({
    ok: true,
    revokedAtProvider: revoked,
    mayDelete: true,
    reason: revoked ? '' : (safeText(res.data?.reason) || `${key} could not confirm the permission was withdrawn.`),
  });
}

module.exports = {
  VERIFY_BATCH_SIZE,
  MAX_VERIFY_BATCH_SIZE,
  REFRESH_WINDOW_MS,
  SWEEP_LIST_LIMIT,
  STALE_AFTER_MS,
  identityKeyFor,
  refreshDue,
  identityDrift,
  outcomeFor,
  refreshBeforeUse,
  verifyConnection,
  runVerifySweep,
  revokeConnection,
};
