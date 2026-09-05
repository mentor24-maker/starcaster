'use strict';

/**
 * routes/connections.js
 * The client-facing Connections screen's back end. Connections 4 of 7 (86bbpz1gd).
 *
 *   GET    /api/connections                       the catalogue, each entry carrying
 *                                                 THIS project's current state
 *   POST   /api/connections/:provider/start       begin a connection
 *   POST   /api/connections/:provider/finish      complete one
 *   POST   /api/connections/:provider/account     pick which account is the active one
 *   POST   /api/connections/verify                check ONE BATCH of them (slice 6a)
 *   DELETE /api/connections/:provider             revoke at the platform, then forget
 *
 * ── Why this is a new file and not more of routes/engage.js ────────────────
 *
 * engage.js owns the OPERATOR's own posting — Dane's accounts, connected once,
 * by hand, and its Facebook flow is the working production one that slice 2
 * moved behind the adapter contract without changing a byte of its behaviour.
 * This file is the CLIENT's screen. It knows no platform by name: every card it
 * describes comes out of lib/connections/registry.js, so a seventh platform
 * appears here the day its catalogue entry lands, with nothing in this file
 * edited. That is the acceptance criterion the whole slice turns on, and it is
 * only true while this file contains no provider name at all.
 *
 * The one exception is named and fenced: BRIDGED_LEGACY_PROVIDERS below.
 *
 * ── This is the first writer to project_connections ────────────────────────
 *
 * Slice 1 built the table, slice 3 built the resolver that reads it, and until
 * this file nothing filled it — so every publisher was still falling through to
 * the environment keys. Two consequences worth holding while reading:
 *
 *   1. `saveConnection` is the only way a client's grant ever reaches the
 *      vault, so its failures are reported, never swallowed.
 *   2. The resolver picks the NEWEST-UPDATED live row for a provider
 *      (lib/connections/resolveCredentials.js). That is what makes the
 *      account-picker below a one-line write rather than an "active" column:
 *      touching a row's updated_at IS choosing it.
 */

const { sendOk, sendErr, parseJsonBody, getUrlObj, normalizeApiPathname } = require('./http');
const registry = require('../lib/connections/registry');
const projectConnectionsStore = require('../lib/projectConnectionsStore');
const projectSocialCredentialsStore = require('../lib/projectSocialCredentialsStore');
const { makeActive, storeAccounts } = require('../lib/connections/completeConnection');
const verifySweep = require('../lib/connections/verifySweep');
/**
 * The fitness test for a cause a client will read, and the limit behind it.
 *
 * Both live in lib/connections/clientProse.js because the OTHER half of this
 * slice needs the identical rule on a different path — `connect_error` on the
 * return URL after a refused connect, in routes/engage.js. Round 1 of review
 * caught a raw 502 page reaching a card through the stored cause below; round 2
 * caught the same page reaching a client through the carried one, because the
 * rule had been written here, where the first defect was. One definition, two
 * requires, so tuning either one tunes both.
 */
const { CAUSE_LIMITS, readsAsClientProse } = require('../lib/connections/clientProse');

const PREFIX = '/api/connections';

const manifest = {
  id: 'connections',
  label: 'Connections',
  prefixes: [PREFIX],
};

/**
 * The four states a card can be in. Exactly four, and the screen renders one
 * per card — there is no fifth "loading" or "unknown" state, because a card
 * that cannot say which of these it is has failed to load and the panel says
 * so once, at the top, rather than four times in four ambiguous cards.
 */
const CARD_STATES = Object.freeze(['not_connected', 'connected', 'needs_attention', 'coming_soon']);

/**
 * A stored status that is not `connected` means the card wears the amber
 * "needs attention" face, with this sentence on it.
 *
 * Written for the client, in the client's terms. "Token expired" is our word
 * for it; "Bluesky stopped accepting the connection" is what actually happened
 * from where they are standing. Slice 6 owns detecting these; this file owns
 * how they read.
 */
const ATTENTION_REASONS = Object.freeze({
  expiring: 'This connection is about to stop working. Reconnect to keep posting.',
  expired: 'This connection has expired. Reconnect to start posting again.',
  revoked: 'Permission was withdrawn on the platform itself. Reconnect to restore it.',
  error: 'The last time we used this connection the platform refused it. Reconnect to fix it.',
});

/**
 * What to DO about it, split from why it happened.
 *
 * The map above answers both questions in one sentence, which is right only
 * when we know nothing else. When the sweep recorded a real cause we want to
 * show that instead — but a cause with no instruction after it leaves a client
 * reading a fault report with no next step, so the instruction is kept and only
 * the cause is replaced.
 */
const ATTENTION_ACTIONS = Object.freeze({
  expiring: 'Reconnect to keep posting.',
  expired: 'Reconnect to start posting again.',
  revoked: 'Reconnect to restore it.',
  error: 'Reconnect to fix it.',
});

/**
 * A stored fragment, turned into a sentence, without rewording it.
 *
 * `last_error` is written as a lower-case fragment on purpose — the sweep
 * composes them ("<why>, and it could not be renewed (<why>)"), so a capital
 * letter in the middle would read wrong. Capitalising the first character and
 * closing the sentence is presentation; changing any other character would be
 * substituting our wording for the platform's, which is the thing acceptance
 * criterion 5 forbids.
 */
function asSentence(text) {
  const trimmed = safeText(text).trim();
  if (!trimmed) return '';
  const opened = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  // A closing bracket or quote may follow the full stop and the sentence is
  // still closed. The sweep composes exactly that shape — "(it was saved as
  // delray.bsky.social.)" — and a naive end-of-string test appends a second
  // full stop outside the bracket. Caught by its own test rather than by a
  // client reading "…bsky.social.). Reconnect to fix it."
  return /[.!?][)\]"'\u201d\u2019]?$/.test(opened) ? opened : `${opened}.`;
}

/**
 * The sentence on an amber card, and where it comes from.
 *
 * The whole point of the verify sweep is that it learns WHY a connection
 * stopped working and writes that down — a drifted Bluesky handle names the
 * account it now signs in as, an unrenewed grant names the deadline it passed.
 * `verifySweep.js` says so where it marks a row expiring: "the card goes amber
 * with the sentence below under it". Until this function existed it did not:
 * the route read only `status` and printed one of four generic lines, so every
 * cause the sweep had gone to the trouble of recording arrived at the client as
 * the same sentence, and `last_error` was written by one slice and read by
 * nobody.
 *
 * Order: a missing token is our own storage being incomplete and outranks
 * whatever a provider last said about it; then the sweep's recorded cause; then
 * the generic line for a row that has a bad status and no recorded reason
 * (which is what a hand-written status change leaves behind).
 */
function attentionSentence(row) {
  if (row?.hasAccessToken === false) {
    return 'The stored permission is incomplete. Reconnect to fix it.';
  }
  const status = safeText(row?.status);
  // The fitness test runs on the STORED text, before asSentence capitalises it
  // and closes it — dressing a 502 page as a sentence first and then measuring
  // the result would be testing our own punctuation, not what was recorded.
  const cause = readsAsClientProse(row?.lastError, 'stored') ? asSentence(row?.lastError) : '';
  if (cause) {
    const action = ATTENTION_ACTIONS[status] || 'Reconnect to fix it.';
    return `${cause} ${action}`;
  }
  return ATTENTION_REASONS[status] || 'This connection is not working. Reconnect to fix it.';
}

/**
 * THE ONE PLACE A PLATFORM IS NAMED IN THIS FILE, and it is a bridge out of an
 * older store rather than a behaviour.
 *
 * Facebook Pages could be connected long before this epic existed, through
 * routes/engage.js, and those grants live in `project_social_credentials`. The
 * redirect URI registered with Meta points at engage.js's callback and cannot
 * be moved without re-registering the app, so a client who presses Connect on
 * THIS screen still completes through that callback and still lands in that
 * table. Reading only `project_connections` would therefore show a freshly
 * connected Page as "not connected" — the screen calling its own successful
 * connection a failure.
 *
 * So the read folds the legacy row in, and the disconnect clears both. What it
 * deliberately does NOT do is copy the token across: `project_connections` is
 * the vault for grants THIS screen collected, and silently duplicating a
 * credential into a second table is how two copies of one secret drift apart.
 *
 * When slice 6 or 7 moves the Meta callback onto the generic path, delete this
 * map and its two call sites; nothing else here knows the word "facebook".
 */
const BRIDGED_LEGACY_PROVIDERS = Object.freeze({
  facebook_page: {
    read: async (projectId) => {
      const cred = await projectSocialCredentialsStore.getFacebookPage(projectId);
      const summary = projectSocialCredentialsStore.publicFacebookPageSummary(cred);
      if (!summary || !summary.connected) return null;
      return {
        accountId: safeText(summary.pageId),
        accountLabel: safeText(summary.pageName) || safeText(summary.pageId),
        accountAvatarUrl: '',
        status: 'connected',
        legacy: true,
      };
    },
    forget: (projectId) => projectSocialCredentialsStore.deleteFacebookPage(projectId),
  },
});

function safeText(value) {
  return String(value === 0 || value ? value : '').trim();
}

function scopeFromRequest(req) {
  return {
    projectId: safeText(req?.projectContext?.project?.id),
    userId: safeText(req?.authUser?.id),
  };
}

/**
 * What a client is asked for when a platform has no consent screen.
 *
 * Read the Non-goal it sits under carefully, because the two look alike and are
 * opposites. What must never appear on this screen is a field for a PLATFORM
 * credential — an access token, an app id, a page id: our secrets, which used
 * to be pasted into Vercel and which a client has no way to obtain and no
 * business holding. An app password is the other thing entirely: it is the
 * client's own per-account credential, minted by them, in their own account
 * settings, revocable by them, and it is Bluesky's actual equivalent of the
 * consent screen Meta shows. `authKind: 'app_password'` exists in the contract
 * precisely so this screen knows to show this form (lib/connections/contract.js,
 * AUTH_KINDS), and the ticket's own test script asks for it by name.
 *
 * Keyed by authKind and not by provider, so the second app-password platform
 * inherits the form instead of adding a branch here.
 */
const AUTH_KIND_FIELDS = Object.freeze({
  app_password: [
    {
      name: 'identifier',
      label: 'Your handle',
      type: 'text',
      placeholder: 'you.bsky.social',
      help: 'The handle you sign in with, without the @.',
    },
    {
      name: 'appPassword',
      label: 'App password',
      type: 'password',
      placeholder: 'xxxx-xxxx-xxxx-xxxx',
      help: 'Create one in your account settings under App Passwords. Never your account password.',
    },
  ],
});

/**
 * Every field this route will forward to an adapter's `exchange`, and nothing
 * else. An allow-list rather than a pass-through: `exchange` hands whatever it
 * is given to a provider, and a body spread straight into it is a way for a
 * caller to reach adapter internals that were never meant to be reachable from
 * a browser.
 *
 * `state` and `nonce` are on the list because a PKCE adapter cannot finish
 * without them — `lib/connections/adapters/x.js` derives its code verifier from
 * the nonce, so an X sign-in through this route refused every time with "the
 * PKCE verifier it was begun with cannot be reproduced" (86bbpz1hu, review
 * round 2). The live screen goes through the `routes/engage.js` callback, which
 * passes both, so nothing visible was broken — but a route that looks like it
 * works and cannot is worse than one that is missing, because the next reader
 * believes it. Adding them widens nothing: `exchange` reads them to reproduce a
 * value it minted itself, and a caller supplying a state it did not begin is
 * refused by the state check inside the adapter.
 */
const EXCHANGE_FIELDS = Object.freeze(['code', 'redirectUri', 'identifier', 'appPassword', 'state', 'nonce']);

function exchangeInputFrom(body) {
  const input = {};
  for (const field of EXCHANGE_FIELDS) {
    const value = safeText(body?.[field]);
    if (value) input[field] = value;
  }
  return input;
}

/**
 * A stored row as the screen sees it — the account, never the credential.
 *
 * `hasAccessToken` is deliberately not forwarded either. It is true of every
 * healthy row and false only of a broken one, and a card that reported it would
 * be inviting a client to reason about our storage rather than about their
 * account. A row with no token reads as "needs attention" like any other
 * unusable grant.
 */
function publicAccount(row) {
  if (!row) return null;
  return {
    accountId: safeText(row.accountId),
    accountLabel: safeText(row.accountLabel) || safeText(row.accountId),
    accountAvatarUrl: safeText(row.accountAvatarUrl),
  };
}

/**
 * Which of the four faces this provider wears, and why.
 *
 * The order of the tests is the whole of the logic:
 *   coming_soon wins over everything (there is nothing to be connected to);
 *   a live row makes it connected;
 *   any other row makes it need attention, WITH the reason;
 *   nothing at all makes it not connected.
 *
 * A row that exists but carries no access token is `needs_attention` rather
 * than `connected`: the resolver skips exactly those rows, so a card calling
 * one connected would promise posting that silently will not happen.
 */
function cardStateFor(entry, rows) {
  if (entry.readiness === 'coming_soon') {
    return { cardState: 'coming_soon', account: null, reason: '' };
  }

  const live = rows.find((row) => safeText(row.status) === 'connected' && row.hasAccessToken !== false);
  if (live) return { cardState: 'connected', account: publicAccount(live), reason: '' };

  const troubled = rows[0];
  if (troubled) {
    return {
      cardState: 'needs_attention',
      account: publicAccount(troubled),
      reason: attentionSentence(troubled),
    };
  }

  return { cardState: 'not_connected', account: null, reason: '' };
}

/**
 * Every card, in catalogue order.
 *
 * One `listConnections` for the whole screen rather than one per provider: the
 * store returns the project's grants newest-updated first, which is the same
 * order the resolver picks in, so "the first row for this provider" here and
 * "the row that will actually post" there are the same row by construction
 * rather than by coincidence.
 */
async function buildCards(scope) {
  const listed = await projectConnectionsStore.listConnections(200, scope);
  if (!listed.ok) return listed;

  const rows = Array.isArray(listed.data) ? listed.data : [];
  const byProvider = new Map();
  for (const row of rows) {
    const key = safeText(row?.provider).toLowerCase();
    if (!key) continue;
    if (!byProvider.has(key)) byProvider.set(key, []);
    byProvider.get(key).push(row);
  }

  const cards = [];
  for (const entry of registry.listCatalogue()) {
    let providerRows = byProvider.get(entry.provider) || [];

    // The legacy bridge, and only when this screen's own store has nothing —
    // a grant collected here always outranks the older table.
    const bridge = BRIDGED_LEGACY_PROVIDERS[entry.provider];
    if (!providerRows.length && bridge && scope.projectId) {
      const legacy = await bridge.read(scope.projectId).catch(() => null);
      if (legacy) providerRows = [legacy];
    }

    const state = cardStateFor(entry, providerRows);
    cards.push({
      provider: entry.provider,
      displayName: entry.displayName,
      iconKey: entry.iconKey,
      blurb: entry.blurb,
      readiness: entry.readiness,
      authKind: entry.authKind,
      connectable: entry.connectable,
      ...state,
      // Every account this project holds on this platform, so the screen can
      // offer a choice when a grant covered several. Empty for a card in any
      // state but connected or needs-attention.
      accounts: providerRows.map(publicAccount).filter(Boolean),
    });
  }
  return { ok: true, status: 200, data: cards };
}

/** The provider key out of `/api/connections/<provider>/<action>`, or ''. */
function routeParts(pathname) {
  const rest = normalizeApiPathname(pathname).slice(PREFIX.length).replace(/^\/+/, '');
  if (!rest) return { provider: '', action: '' };
  const [provider, action = ''] = rest.split('/');
  return { provider: decodeURIComponent(provider || '').trim(), action: action.trim() };
}

/**
 * `makeActive` and the store-every-account loop that used to live here are now
 * lib/connections/completeConnection.js. Connections 5 of 7 (86bbpz1gk) added a
 * second caller — Meta's shared OAuth callback, which must finish a connection
 * itself because the code Meta issues can only be exchanged once — and two
 * copies of a sequence this easy to get subtly wrong is how one of them gets a
 * fix and the other keeps the bug. A move, not a rewrite: the behaviour below
 * is unchanged.
 */

async function handle(req, res, pathname, method) {
  const normalizedPath = normalizeApiPathname(pathname);
  if (normalizedPath !== PREFIX && !normalizedPath.startsWith(`${PREFIX}/`)) return false;

  const scope = scopeFromRequest(req);
  if (!scope.projectId) {
    return sendErr(res, 400, 'Choose a workspace before connecting an account', { code: 'PROJECT_REQUIRED' }), true;
  }

  if (normalizedPath === PREFIX && method === 'GET') {
    const built = await buildCards(scope);
    if (!built.ok) return sendErr(res, built.status || 500, built.error), true;
    const connections = built.data;
    return sendOk(res, 200, connections, { connections }, { total: connections.length }), true;
  }

  /**
   * ── The health sweep ────────────────────────────────────────────────────
   *
   * Placed here on purpose: `routeParts` below would read "verify" as a
   * PROVIDER name and answer `Unknown connection provider "verify"`, which is
   * a 404 that sends whoever hit it looking for a typo in the catalogue.
   *
   * ONE BATCH per call, with what remains in the answer — never a loop over
   * everything, because a serverless invocation that is frozen mid-loop leaves
   * half the work done and nothing recording which half. The caller repeats
   * while `remaining` is above zero.
   *
   * Nothing schedules this. Wiring it to a timer is a separate operator step
   * (`scripts/connections_verify_sweep.mjs` is the same pass on the command
   * line), and it is deliberately not in this ticket: a cron added in the same
   * change as the thing it runs is a cron nobody has watched run by hand first.
   */
  if (normalizedPath === `${PREFIX}/verify` && method === 'POST') {
    const body = await parseJsonBody(req);
    const swept = await verifySweep.runVerifySweep({ scope, limit: body?.limit });
    if (!swept.ok) {
      return sendErr(res, swept.status || 500, swept.error, { code: 'VERIFY_SWEEP_FAILED' }), true;
    }
    return sendOk(res, 200, swept.data, swept.data), true;
  }

  const { provider, action } = routeParts(normalizedPath);
  if (!provider) return false;

  const entry = registry.getEntry(provider);
  if (!entry) {
    return sendErr(res, 404, `Unknown connection provider "${provider}"`, { code: 'UNKNOWN_PROVIDER' }), true;
  }

  // ── Start ───────────────────────────────────────────────────────────────
  if (action === 'start' && method === 'POST') {
    const adapterRes = registry.getAdapter(provider);
    // A coming-soon card has no button, so reaching here means a hand-written
    // request. Answer with the registry's own sentence rather than inventing
    // one — "not connectable yet" and "no such platform" are different facts.
    if (!adapterRes.ok) {
      return sendErr(res, adapterRes.status || 400, adapterRes.error, { code: adapterRes.code || 'NOT_CONNECTABLE' }), true;
    }
    const adapter = adapterRes.data;

    if (entry.authKind === 'app_password') {
      const payload = {
        provider,
        authKind: entry.authKind,
        displayName: entry.displayName,
        fields: AUTH_KIND_FIELDS.app_password,
      };
      return sendOk(res, 200, payload, payload), true;
    }

    const started = adapter.authorizeUrl({ projectId: scope.projectId, userId: scope.userId });
    if (!started.ok) {
      return sendErr(res, started.status || 400, started.error || `Could not start connecting ${entry.displayName}`, {
        code: 'CONNECT_START_FAILED',
      }), true;
    }
    // The adapter's own payload, plus the two facts the screen needs to decide
    // what to do with it. `authorizeUrl` is named explicitly rather than left
    // for the panel to find, because adapters return their provider's shape.
    const authorizeUrl = safeText(started.data?.authorizeUrl || started.data?.url || started.data);
    if (!authorizeUrl) {
      return sendErr(res, 502, `${entry.displayName} did not return a sign-in link`, { code: 'NO_AUTHORIZE_URL' }), true;
    }
    const payload = { provider, authKind: entry.authKind, displayName: entry.displayName, authorizeUrl };
    return sendOk(res, 200, payload, payload), true;
  }

  // ── Finish ──────────────────────────────────────────────────────────────
  if (action === 'finish' && method === 'POST') {
    const adapterRes = registry.getAdapter(provider);
    if (!adapterRes.ok) {
      return sendErr(res, adapterRes.status || 400, adapterRes.error, { code: adapterRes.code || 'NOT_CONNECTABLE' }), true;
    }
    const adapter = adapterRes.data;

    const body = await parseJsonBody(req);
    const exchanged = await adapter.exchange(exchangeInputFrom(body));
    if (!exchanged.ok) {
      return sendErr(res, exchanged.status || 502, exchanged.error || `${entry.displayName} refused the connection`, {
        code: 'EXCHANGE_FAILED',
      }), true;
    }

    const stored = await storeAccounts({
      provider,
      displayName: entry.displayName,
      accounts: exchanged.data?.accounts,
      scope,
    });
    if (!stored.ok) {
      return sendErr(res, stored.status || 500, stored.error, { code: stored.code || 'SAVE_FAILED' }), true;
    }

    const payload = {
      provider,
      displayName: entry.displayName,
      accounts: stored.data.saved.map(publicAccount).filter(Boolean),
      activeAccountId: stored.data.activeAccountId,
      needsAccountChoice: stored.data.needsAccountChoice,
    };
    return sendOk(res, 200, payload, payload), true;
  }

  // ── Pick which account posts ────────────────────────────────────────────
  if (action === 'account' && method === 'POST') {
    const body = await parseJsonBody(req);
    const accountId = safeText(body?.accountId);
    if (!accountId) {
      return sendErr(res, 400, 'accountId is required', { code: 'VALIDATION_ERROR' }), true;
    }
    // Touching the row IS the choice: updateConnectionStatus always stamps
    // updated_at, listConnections orders by it, and the resolver takes the
    // first live row. No "active" column to keep in step with anything — but
    // the choice is confirmed by reading it back, because a timestamp tie
    // makes the touch silently ineffective (makeActive).
    const touched = await makeActive(provider, accountId, scope);
    if (!touched.ok) {
      return sendErr(res, touched.status || 500, touched.error || 'Could not switch accounts', {
        code: 'ACCOUNT_SWITCH_FAILED',
      }), true;
    }
    const payload = { provider, activeAccountId: safeText(touched.data?.accountId) };
    return sendOk(res, 200, payload, payload), true;
  }

  // ── Disconnect ──────────────────────────────────────────────────────────
  /**
   * REVOKE FIRST, THEN FORGET. Slice 6a (86bbpz1gv).
   *
   * The order is the whole of it. Deleting the row first and telling the
   * platform after means any failure leaves a live grant at Meta or Bluesky
   * that this app can no longer see, no longer holds a token for, and can
   * never retire — and the client finds it months later in their own Facebook
   * settings, as an app they are certain they removed.
   *
   * So a HARD failure to revoke keeps the row and answers with an error: the
   * only thing that can fix it is trying again, and trying again needs the
   * credential. `?force=1` overrides that for a client who would rather be rid
   * of it, and says plainly that the grant may survive.
   *
   * A platform that simply CANNOT be revoked from here is a different answer
   * and must not read as a failure — Bluesky has no such endpoint, and
   * `lib/connections/verifySweep.js` sorts the three cases apart.
   */
  if (!action && method === 'DELETE') {
    const params = getUrlObj(req).searchParams;
    const requestedAccountId = safeText(params.get('accountId'));
    const force = ['1', 'true', 'yes'].includes(safeText(params.get('force')).toLowerCase());

    const listed = await projectConnectionsStore.listConnections(200, scope);
    if (!listed.ok) return sendErr(res, listed.status || 500, listed.error), true;
    const mine = (Array.isArray(listed.data) ? listed.data : [])
      .filter((row) => safeText(row?.provider).toLowerCase() === provider)
      .filter((row) => !requestedAccountId || safeText(row.accountId) === requestedAccountId);

    let removed = 0;
    let revokedCount = 0;
    const notRevoked = [];
    for (const row of mine) {
      const accountId = safeText(row.accountId);
      const handedBack = await verifySweep.revokeConnection({ provider, accountId, scope, force });
      if (!handedBack.mayDelete) {
        // Nothing has been deleted for this account, and anything deleted
        // before it in this loop is reported so the answer is not silent about
        // a half-finished disconnect.
        return sendErr(res, handedBack.status || 502, handedBack.reason, {
          code: 'REVOKE_FAILED',
          provider,
          accountId,
          removed,
          revokedAtProvider: false,
        }), true;
      }
      if (handedBack.revokedAtProvider) revokedCount += 1;
      else notRevoked.push({ accountId, reason: handedBack.reason });

      const gone = await projectConnectionsStore.deleteConnection({ provider, accountId }, scope);
      if (!gone.ok) {
        return sendErr(res, gone.status || 500, gone.error || 'Could not disconnect', { code: 'DELETE_FAILED' }), true;
      }
      removed += 1;
    }

    // The older table too, or Disconnect appears to do nothing: the card would
    // come straight back as connected through the bridge above.
    const bridge = BRIDGED_LEGACY_PROVIDERS[provider];
    if (bridge && !requestedAccountId) {
      // Asked first, so `removed` counts grants that existed rather than
      // deletes that were attempted — deleteFacebookPage answers ok on a
      // project that never had one, and reporting "removed 1" there would be
      // this screen telling a client it undid something it did not.
      const legacy = await bridge.read(scope.projectId).catch(() => null);
      if (legacy) {
        const legacyGone = await bridge.forget(scope.projectId);
        if (!legacyGone || legacyGone.ok === false) {
          return sendErr(res, legacyGone?.status || 500, legacyGone?.error || 'Could not disconnect', {
            code: 'DELETE_FAILED',
          }), true;
        }
        removed += 1;
        // Counted as NOT revoked, deliberately. It came out of the older table,
        // this route never held an adapter account for it, and nothing was said
        // to Meta — so letting it satisfy `revokedAtProvider` below would make
        // the answer claim a revoke that did not happen, on the one path where
        // it is easiest to miss.
        notRevoked.push({
          accountId: safeText(legacy.accountId),
          reason: 'This Page was connected through the older path, so Starcaster had no credential to '
            + "withdraw the permission with. Remove Starcaster under Facebook Settings > Business Integrations.",
        });
      }
    }

    /**
     * `revokedAtProvider` is measured now, not hard-coded false — but it is
     * true ONLY when something was actually handed back and nothing was left
     * behind. A partial revoke reads as false, with `notRevoked` naming which
     * accounts and why: "disconnected" and "revoked" are different claims, and
     * the client acts on the second one.
     */
    const payload = {
      provider,
      disconnected: true,
      removed,
      revokedAtProvider: revokedCount > 0 && notRevoked.length === 0,
      ...(notRevoked.length ? { notRevoked } : {}),
      ...(force ? { forced: true } : {}),
    };
    return sendOk(res, 200, payload, payload), true;
  }

  return false;
}

module.exports = {
  handle,
  manifest,
  // Exported for the tests, which pin the four states and the reason sentences
  // directly rather than inferring them from a whole round trip.
  CARD_STATES,
  ATTENTION_REASONS,
  AUTH_KIND_FIELDS,
  CAUSE_LIMITS,
  cardStateFor,
  readsAsClientProse,
  attentionSentence,
  buildCards,
};
