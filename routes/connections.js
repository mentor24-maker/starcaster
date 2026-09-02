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
 *   DELETE /api/connections/:provider             forget the grant
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
const contract = require('../lib/connections/contract');
const projectConnectionsStore = require('../lib/projectConnectionsStore');
const projectSocialCredentialsStore = require('../lib/projectSocialCredentialsStore');

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
 */
const EXCHANGE_FIELDS = Object.freeze(['code', 'redirectUri', 'identifier', 'appPassword']);

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
    const status = safeText(troubled.status);
    const reason = troubled.hasAccessToken === false
      ? 'The stored permission is incomplete. Reconnect to fix it.'
      : (ATTENTION_REASONS[status] || 'This connection is not working. Reconnect to fix it.');
    return { cardState: 'needs_attention', account: publicAccount(troubled), reason };
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
 * Make one account the one that will actually post, and PROVE it rather than
 * assume it.
 *
 * The resolver takes the first live row `listConnections` returns, which is
 * ordered `updated_at DESC, created_at DESC` — so touching a row is how it is
 * chosen (lib/connections/resolveCredentials.js). That works until two rows
 * carry the SAME instant, which is not hypothetical: finishing one Facebook
 * grant saves every Page it covers inside a single request, and several
 * millisecond-resolution timestamps land identical. The order between them is
 * then whatever the database feels like, so a card reporting "posting to Page
 * A" while the publisher picks Page B is a client's post appearing on the
 * wrong Page with every gate green.
 *
 * So this touches, reads back through the store's OWN ordering, and touches
 * again if the clock has not moved on yet. What it returns is what the
 * publisher will pick, measured — never what the caller intended.
 *
 * The wait is deliberately tiny and bounded. If it still cannot separate them
 * the caller is told, because reporting an active account we have not
 * confirmed is precisely the failure this exists to prevent.
 */
async function makeActive(provider, accountId, scope, attempts = 4) {
  let last = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const touched = await projectConnectionsStore.updateConnectionStatus(
      { provider, accountId, status: 'connected', lastError: '' },
      scope
    );
    if (!touched.ok) return touched;
    last = touched;

    const listed = await projectConnectionsStore.listConnections(200, scope);
    if (!listed.ok) return listed;
    const first = (Array.isArray(listed.data) ? listed.data : [])
      .find((row) => safeText(row?.provider).toLowerCase() === provider);
    if (first && safeText(first.accountId) === safeText(accountId)) {
      return { ok: true, status: 200, data: first };
    }
    // The stored timestamps are identical to the millisecond. Let the clock
    // move and stamp it again, rather than reporting a choice that did not take.
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  return {
    ok: false,
    status: 409,
    error: 'Two of these accounts were stored at the same instant and cannot be told apart. '
      + 'Disconnect this platform and connect it again to choose one.',
    data: last?.data || null,
  };
}

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

    const accounts = Array.isArray(exchanged.data?.accounts) ? exchanged.data.accounts : [];
    if (!accounts.length) {
      // The provider said yes and named nobody. Storing nothing and reporting
      // success would leave a card that says connected with no account behind
      // it — the exact shape of a connection that silently posts as us.
      return sendErr(res, 502, `${entry.displayName} accepted the sign-in but returned no account`, {
        code: 'NO_ACCOUNTS',
      }), true;
    }

    /**
     * Every account the grant covers is stored, not only the one that ends up
     * active.
     *
     * That is what the client authorised — one consent screen, all their Pages
     * — and it is the only way the account picker below can work without a
     * second table to park unchosen tokens in for the minute between finishing
     * and choosing. Slice 6's revoke removes them together.
     *
     * They are saved OLDEST-LAST on purpose: `saveConnection` stamps
     * updated_at, `listConnections` orders by it, and the resolver takes the
     * first live row — so the last one written is the active one, and the
     * screen is told which that is rather than inferring it.
     */
    const saved = [];
    for (const account of accounts) {
      const problems = contract.accountProblems(account, `${provider} account`);
      if (problems.length) {
        return sendErr(res, 502, `${entry.displayName} returned an account we cannot store: ${problems.join('; ')}`, {
          code: 'BAD_ACCOUNT',
        }), true;
      }
      const write = await projectConnectionsStore.saveConnection({
        ...contract.storableAccount(account),
        provider,
        status: 'connected',
        connectedByUserId: scope.userId,
        lastVerifiedAt: new Date().toISOString(),
        lastError: '',
      }, scope);
      if (!write.ok) {
        return sendErr(res, write.status || 500, write.error || 'Could not store the connection', {
          code: 'SAVE_FAILED',
        }), true;
      }
      saved.push(write.data);
    }

    // Which one posts is READ BACK, never inferred from the write order — see
    // makeActive. With one account this is a formality; with several it is the
    // difference between a card that agrees with the publisher and one that
    // merely looks like it does.
    const intended = safeText(saved[saved.length - 1]?.accountId);
    const active = await makeActive(provider, intended, scope);
    if (!active.ok) {
      return sendErr(res, active.status || 500, active.error || 'Could not settle which account posts', {
        code: 'ACTIVE_ACCOUNT_UNSETTLED',
      }), true;
    }

    const payload = {
      provider,
      displayName: entry.displayName,
      accounts: saved.map(publicAccount).filter(Boolean),
      activeAccountId: safeText(active.data?.accountId),
      needsAccountChoice: saved.length > 1,
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
  if (!action && method === 'DELETE') {
    const requestedAccountId = safeText(getUrlObj(req).searchParams.get('accountId'));

    const listed = await projectConnectionsStore.listConnections(200, scope);
    if (!listed.ok) return sendErr(res, listed.status || 500, listed.error), true;
    const mine = (Array.isArray(listed.data) ? listed.data : [])
      .filter((row) => safeText(row?.provider).toLowerCase() === provider)
      .filter((row) => !requestedAccountId || safeText(row.accountId) === requestedAccountId);

    let removed = 0;
    for (const row of mine) {
      const gone = await projectConnectionsStore.deleteConnection(
        { provider, accountId: safeText(row.accountId) },
        scope
      );
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
      }
    }

    /**
     * Note what has NOT happened: the platform has not been told.
     *
     * Revoking at the provider's end is slice 6 (86bbpz1gv), and
     * projectConnectionsStore.deleteConnection says the same thing at its own
     * end. Until then Starcaster forgets the token while the permission stays
     * granted at Meta or Bluesky, so the answer says `revokedAtProvider: false`
     * rather than letting a caller read "disconnected" as "revoked".
     */
    const payload = { provider, disconnected: true, removed, revokedAtProvider: false };
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
  cardStateFor,
  buildCards,
};
