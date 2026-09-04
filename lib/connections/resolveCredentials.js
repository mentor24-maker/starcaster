'use strict';

/**
 * The one front door to a credential. Connections 3 of 7 (86bbpz1ed).
 *
 * This is the slice the whole epic exists for. Slices 1 and 2 collect a
 * client's permission and store it; without this file Starcaster carries on
 * posting from the platform-wide keys in Vercel — which are Dane's own
 * accounts. A wizard that gathers a grant nobody reads is worse than no wizard,
 * because it tells a client their account is connected while their posts go out
 * under somebody else's name.
 *
 * Two doors, and every publisher uses one of them instead of calling
 * `getProviderValues` itself:
 *
 *   resolveCredentials(provider, projectId)   async. THIS project's stored
 *                                             connection if there is a live
 *                                             one, otherwise the environment.
 *   environmentValues(provider, options)      sync. The environment path,
 *                                             unchanged — what Dane's own
 *                                             posting uses, and what every
 *                                             caller that has no project (a
 *                                             Settings screen, a credential
 *                                             probe, a cron with envOnly) still
 *                                             wants.
 *
 * Both exist on purpose. Making everything async would have meant rewriting
 * synchronous Settings routes that have nothing to do with tenancy, and the
 * point of routing the sync path through here too is that
 * `grep getProviderValues lib/*Client.js` now returns nothing: there is exactly
 * one file to read to find out where a token came from.
 *
 * ── The failure this file is shaped around ─────────────────────────────────
 *
 * Posting to the wrong account looks EXACTLY like success. The provider
 * accepts it, the post appears, the job goes green, and the only person who
 * finds out is the client whose followers never saw it. So the fallback is
 * deliberately narrow:
 *
 *   the table answered, there is no live connection   → environment. Normal —
 *                                                       but only AFTER a row
 *                                                       held back solely by the
 *                                                       clock has been offered a
 *                                                       renewal. See `lapsed`
 *                                                       below: "expired" and
 *                                                       "unrenewed" are not the
 *                                                       same row, and treating
 *                                                       them alike posted a
 *                                                       client's X updates from
 *                                                       Starcaster's own account.
 *   the lookup FAILED (network, a 502 on a cold start,
 *   a token that will not decrypt)                    → REFUSE, do not fall back.
 *   there IS a live connection, but this platform's
 *   credential has a part that cannot be stored yet   → REFUSE, do not complete
 *                                                       it from the environment.
 *   there ARE connections for this provider, none of
 *   them usable right now, and this provider's shared
 *   keys belong to a PERSON rather than to Alphire    → REFUSE, do not borrow
 *                                                       somebody's own account.
 *
 * A failed lookup is not an answer, and treating it as "no connection" is the
 * silent wrong-account post dressed up as a transient blip. Refusing gives a
 * failed post with a retryable 503 on it, which is the loud half of the pair.
 *
 * The third rule is the same instinct one step further in, and it was added
 * after review round 1. Falling back is not the only way to end up posting with
 * the wrong credential: the overlay can MIX one, taking a client's token and
 * quietly completing it from the platform's keys. That is not a partial success,
 * it is a credential belonging to nobody, so it refuses too — 501, because
 * unlike the lookup failure there is nothing to retry.
 *
 * The fourth rule is review round 3's, and it is the first one aimed at a room
 * rather than a door. Rules two and three each close one way of reaching the
 * shared keys wrongly; three rounds of review found three such ways for X, and
 * the fourth was going to exist too. So for a provider whose shared keys are a
 * NAMED HUMAN'S account — X, where they are Dane's own — having a connection at
 * all is enough: if it cannot be used, nothing is sent. 503, retryable, and it
 * names the account and the reason. See `sharedKeysArePersonal`.
 */

const apiSettings = require('../apiSettings');
const projectConnectionsStore = require('../projectConnectionsStore');
const verifySweep = require('./verifySweep');

/**
 * A connection that can be posted with right now.
 *
 * `expiring` is live — it means "still works, renew it soon" (slice 6 paints
 * the amber card), and refusing it would take a working account off the air
 * early. `expired`, `revoked` and `error` are skipped, which is the acceptance
 * criterion about not posting with a dead token.
 */
const LIVE_STATUSES = Object.freeze(['connected', 'expiring']);

/**
 * Which stored connection field lands on which environment-settings key, per
 * provider.
 *
 * The merge is an OVERLAY, never a replacement, and that is the load-bearing
 * decision in this file. An OAuth grant gives you one account's token; it does
 * not give you a new app. `app_id`, `app_secret`, `api_key`, `base_url` belong
 * to the Alphire application and must survive from the environment, or a
 * client's connection posts with half its credentials missing and the provider
 * answers with something that names none of this.
 *
 *   settingsProvider  the key `getProviderValues` knows this platform by, which
 *                     is not always the key the connection registry uses
 *                     (`facebook_page` here is `meta` there)
 *   token             where connection.accessToken goes — the durable
 *                     credential, whatever the platform happens to call it
 *   account           where connection.accountId goes, or null if the platform
 *                     has no such field
 *   label             where connection.accountLabel goes, for platforms whose
 *                     credential IS a name (Bluesky signs in with its handle)
 *   unstorableParts   value keys that are part of THIS credential but which a
 *                     stored connection cannot carry today. Their presence
 *                     means a connection for this provider is REFUSED — see
 *                     `missingParts` below for why that is not pedantry.
 *   partDefaults      value keys the connection cannot carry either, but which
 *                     have a safe universal default. The default is used
 *                     INSTEAD of the environment's value, because inheriting
 *                     that one would aim a client's credential at Alphire's
 *                     own server.
 *   clearOnConnection value keys that must be REMOVED from the answer when a
 *                     connection is what answered. For a provider whose client
 *                     credential uses a different scheme from the platform's
 *                     own — X, whose clients sign in over OAuth 2.0 while
 *                     Starcaster posts over OAuth 1.0a — an inherited leftover
 *                     is not a harmless spare value: it is the missing piece
 *                     that lets the WRONG scheme be assembled.
 *   connectionValues  values written only on the connection path, saying what
 *                     the credential IS. `auth_mode` is the one that exists,
 *                     and a publisher reads it rather than guessing from which
 *                     fields are populated.
 *   sharedKeysArePersonal
 *                     the platform-wide keys for this provider belong to a
 *                     NAMED HUMAN rather than to the Alphire application. Set,
 *                     it means: a project that HAS a connection here and cannot
 *                     use it right now is REFUSED, never quietly served from
 *                     the shared keys. See `refuseRatherThanBorrow`.
 *
 * ── Why a credential can have parts, and why half of one is worse than none ──
 *
 * `accessToken` is the only secret a connection can store. Some platforms want
 * two: X's OAuth 1.0a signs with an access token AND an access token secret,
 * and Bluesky's app password is only valid at the PDS that issued it. The
 * adapters do produce those second halves — they park them in the account's
 * `raw` — but `saveConnection` rejects `raw` outright (`400 Unknown field`) and
 * `project_connections` has no column for it, so the second half is dropped on
 * the way in and `getConnection` can never hand one back.
 *
 * Because the merge below is an overlay, a missing half does not come back
 * empty — it comes back filled in from the ENVIRONMENT. A client's X token
 * paired with Alphire's token secret is not a degraded credential, it is a
 * signature belonging to nobody, and the 401 it earns names neither account.
 * So a provider with an unstorable part refuses instead. Loud and precise beats
 * a mixture that looks assembled.
 */
const PROVIDER_VALUE_MAP = Object.freeze({
  facebook_page: { settingsProvider: 'meta', token: 'access_token', account: 'page_id' },
  facebook: { settingsProvider: 'meta', token: 'access_token', account: 'page_id' },
  meta: { settingsProvider: 'meta', token: 'access_token', account: 'page_id' },
  instagram: { settingsProvider: 'instagram', token: 'access_token', account: 'business_account_id' },
  threads: { settingsProvider: 'threads', token: 'access_token', account: 'user_id' },
  bluesky: {
    settingsProvider: 'bluesky',
    // Bluesky's durable credential is an app password, not an OAuth token. The
    // adapter stores it as `accessToken` precisely so a caller need not know
    // that; here is the one place the platform's own word is used again.
    token: 'app_password',
    account: null,
    label: 'identifier',
    // An app password is only valid at the server that minted it. The adapter
    // knows which one (`raw.serviceUrl`) and the store drops it, so a stored
    // connection cannot say. Inheriting the environment's `service_url` would
    // post a CLIENT's app password to whatever PDS Alphire's own settings name
    // — a credential handed to a third party, which is worse than a failure.
    // The public default is where an app password minted in the Bluesky app
    // belongs, so the connection path pins it. A self-hosted PDS needs the
    // slice that gives `raw` a home; until then such a client cannot connect,
    // and gets a plain sign-in failure at bsky.social rather than a leak.
    partDefaults: { service_url: 'https://bsky.social' },
  },
  x: {
    settingsProvider: 'x',
    token: 'access_token',
    account: null,
    label: 'account_name',
    /**
     * ── X changes SCHEME, not just credential. Connections 7 of 7 (86bbpz1hu) ──
     *
     * Until slice 7 this entry carried `unstorableParts: ['access_token_secret']`
     * and every X connection was refused. That was right at the time and the
     * reasoning still holds: OAuth 1.0a signs with a PAIR — the app's key and
     * secret plus the account's token and token SECRET — a stored connection
     * can carry one secret, and completing the other half from the environment
     * produces a signature belonging to nobody.
     *
     * Slice 7 does not find somewhere to put the second half. It makes the
     * second half not exist: a client connects over OAuth 2.0 with PKCE, whose
     * credential is a single bearer token
     * (lib/connections/adapters/x.js). There is nothing left to borrow, so the
     * refusal is lifted.
     *
     * What replaces it is `clearOnConnection`, and it is the more important
     * half. The environment underneath this overlay still holds Alphire's OWN
     * OAuth 1.0a values, and the merge is an overlay — so without this, a
     * client's bearer token would arrive sitting on top of our `api_key`,
     * `api_secret` and `access_token_secret`, and `xClient` would have every
     * value it needs to build a 1.0a signature out of a token that is not a
     * 1.0a token. That is the SAME mixed credential the refusal existed to
     * prevent, reached by the other door, and it would fail with a 401 naming
     * neither account. Deleting the secret makes it unbuildable rather than
     * merely unlikely.
     *
     * `connectionValues` then states the scheme outright, so nothing downstream
     * has to infer it from which fields happen to be present.
     */
    clearOnConnection: ['access_token_secret'],
    connectionValues: { auth_mode: 'oauth2' },
    /**
     * ── The shared X keys are a PERSON'S account. Review round 3 (86bbpz1hu) ──
     *
     * For every other provider in this map, the platform-wide keys are the
     * Alphire application's own — a post that falls back to them is a post from
     * Starcaster, which is wrong but institutional. For X they are Dane's
     * PERSONAL account. A client's post landing there is a named human's
     * timeline carrying somebody else's marketing, and it cannot be recalled.
     *
     * Three review rounds each found a different door into that room:
     *
     *   round 1  the connection went dead two hours in and the card stayed green
     *   round 2  a lapsed token was never offered a renewal, so it fell through
     *   round 3  one 502 at X wrote `expired`, permanently, and it fell through
     *
     * Each door was closed on its own. This is the room. When a project HAS an
     * X connection and it cannot be used right now — for ANY reason, including
     * one nobody has thought of yet — the post is refused rather than sent from
     * the shared keys. A refusal is loud, retryable and visible to the operator;
     * a fallback here is invisible to everyone except the client's followers.
     *
     * It is deliberately narrow. A project with NO X connection is untouched and
     * still posts through the shared keys — that is Dane's own posting, it is an
     * acceptance criterion of this ticket, and it is the expensive thing to
     * break. `forProvider.length` is the whole of the difference.
     */
    sharedKeysArePersonal: true,
  },
  buffer: { settingsProvider: 'buffer', token: 'api_key', account: 'organization_id' },
});

function safeText(value) {
  return String(value === 0 || value ? value : '').trim();
}

/** The map entry, or a pass-through for a provider nobody has mapped yet. */
function mappingFor(provider) {
  const key = safeText(provider).toLowerCase();
  return PROVIDER_VALUE_MAP[key] || { settingsProvider: key, token: 'access_token', account: null };
}

/**
 * The key `getProviderValues` knows this provider by. Exported because
 * lib/metaClients.js resolves `facebook_page` and reads `meta` settings, and a
 * second copy of that fact is a second thing to get wrong.
 */
function settingsProviderFor(provider) {
  return mappingFor(provider).settingsProvider;
}

/**
 * The environment path, exactly as it has always behaved.
 *
 * A thin pass-through on purpose: this is the fallback every publisher used
 * directly until this slice, and changing what it returns while moving it would
 * make any regression impossible to attribute. `options` (notably
 * `{ envOnly: true }`, which the cron publish path sets) goes straight through.
 */
function environmentValues(provider, options = {}) {
  return apiSettings.getProviderValues(settingsProviderFor(provider), options) || {};
}

/**
 * Is this connection one we may post with?
 *
 * Both halves are checked. `status` is what the last verify wrote down, and
 * `expiresAt` is what the clock says — they disagree whenever a token lapsed
 * after the last sweep, which is most of the time. Trusting either alone posts
 * with a dead token.
 *
 * `lapsed` is the difference between the two refusals, and it is load bearing.
 * A row refused for its STATUS has been judged — revoked at the provider, or
 * errored — and nothing here may overrule that. A row refused only by the CLOCK
 * has not been judged at all: it was fine until a deadline passed, and if it
 * still holds a refresh token it is unrenewed rather than dead. Collapsing the
 * two is what sent a client's X posts to Starcaster's own account two hours
 * after they connected (86bbpz1hu, review round 2).
 */
function liveness(connection, nowMs) {
  const status = safeText(connection?.status) || 'connected';
  if (!LIVE_STATUSES.includes(status)) {
    return { live: false, lapsed: false, why: `its status is "${status}"` };
  }
  const expiresAt = safeText(connection?.expiresAt);
  if (expiresAt) {
    const expiry = Date.parse(expiresAt);
    if (Number.isFinite(expiry) && expiry <= nowMs) {
      return { live: false, lapsed: true, why: `its token expired at ${expiresAt}` };
    }
  }
  return { live: true, lapsed: false, why: '' };
}

/**
 * The stored connection's fields, in the environment's vocabulary. Empty values
 * are dropped rather than written as '' — an empty overlay key would blank the
 * environment value underneath it, which is how a connection carrying only a
 * token would delete the app secret it needs.
 */
function overlayFrom(connection, mapping) {
  const overlay = {};
  const put = (key, value) => {
    const text = safeText(value);
    if (key && text) overlay[key] = text;
  };
  put(mapping.token, connection.accessToken);
  put(mapping.account, connection.accountId);
  put(mapping.label, connection.accountLabel);
  // A part default is written even though the connection did not supply it —
  // the one place this function deliberately does NOT let the environment show
  // through. See `partDefaults` in the map above: the environment's value here
  // belongs to Alphire's own account, and a client's credential must not be
  // aimed at it.
  for (const [key, value] of Object.entries(mapping.partDefaults || {})) {
    put(key, value);
  }
  return overlay;
}

/**
 * The parts of this provider's credential a stored connection cannot supply.
 *
 * Empty for every provider whose credential is one secret, which is most of
 * them. Non-empty means the overlay would be completed from the environment,
 * and that mixture is the thing this file exists to prevent — so the caller
 * refuses rather than assembling it.
 */
function missingParts(mapping) {
  return Array.isArray(mapping.unstorableParts) ? mapping.unstorableParts : [];
}

/** The answer, in the envelope, with `source` always named. */
function answer(provider, projectId, values, source, detail, extra = null) {
  return {
    ok: true,
    status: 200,
    data: {
      provider: safeText(provider).toLowerCase(),
      settingsProvider: settingsProviderFor(provider),
      projectId: safeText(projectId),
      values: { ...values },
      /** 'connection' — this client's own grant. 'environment' — the shared keys. */
      source,
      /** One sentence a log line can print, saying WHY that source answered. */
      sourceDetail: detail,
      accountId: safeText(extra?.accountId),
      accountLabel: safeText(extra?.accountLabel),
      connectionStatus: safeText(extra?.status),
      ...(extra?.skipped?.length ? { skipped: extra.skipped } : {}),
      /**
       * What refresh-before-use did on the way out, when it did anything.
       * `refreshed: false` with a `refreshError` is the case worth reading: the
       * token being handed over is the client's own and still valid, but it is
       * inside its expiry window and could not be renewed, and the connection
       * has been marked so the card can say so.
       */
      ...(extra?.refresh ? { refresh: extra.refresh } : {}),
    },
  };
}

/**
 * Refuse, rather than fall back.
 *
 * Reached only when the lookup could not answer — never when it answered "no
 * connection here". 503 because it is retryable: the caller should try again,
 * not quietly post as somebody else.
 */
function refuse(provider, reason, status = 503) {
  return {
    ok: false,
    status: Number(status) || 503,
    error: `Could not tell whether this project has its own ${safeText(provider)} connection, `
      + `so nothing was sent: ${reason}. Retry — publishing with the shared keys here would `
      + "post to Starcaster's own account instead of the client's, which looks exactly like success.",
    code: 'CONNECTION_LOOKUP_FAILED',
    data: null,
  };
}

/**
 * Refuse because the shared keys are not ours to borrow.
 *
 * A third refusal, and it must not borrow either of the others' words. `refuse`
 * means "the lookup did not answer". `refuseIncomplete` means "the answer is
 * half a credential". This one means the lookup answered perfectly, the answer
 * was a connection that cannot be used right now, and for THIS provider the
 * thing underneath is a person's own account rather than the application's.
 *
 * 503 and retryable, because the ordinary cause is temporary — a lapsed token
 * whose renewal could not reach X, which the next attempt renews. Where it is
 * not temporary (a revoked grant) the sentence says which account and why, so
 * the operator is told to reconnect rather than to keep retrying.
 *
 * See `sharedKeysArePersonal` in the value map above for the three rounds of
 * silent wrong-account posting this exists to end.
 */
function refuseRatherThanBorrow(provider, reason, skipped) {
  const key = safeText(provider);
  return {
    ok: false,
    status: 503,
    error: `This project has its own ${key} connection, but it cannot be used right now, `
      + `so nothing was sent: ${reason}. The platform-wide ${key} keys were NOT used instead — `
      + 'they belong to a person\'s own account, not to Starcaster, and a client\'s post landing '
      + 'there looks exactly like success to everyone except that client\'s followers. '
      + `Retry if this was momentary; reconnect ${key} on the Connections screen if it was not.`,
    code: 'CONNECTION_UNUSABLE',
    data: null,
    /** The same per-account sentences the fallback answer carries, so the card can still be painted. */
    skipped: Array.isArray(skipped) && skipped.length ? skipped : undefined,
  };
}

/**
 * Refuse because the credential cannot be ASSEMBLED — a different thing from
 * `refuse` above, and it must not borrow its words.
 *
 * `refuse` means "the lookup did not answer, try again". This means "the lookup
 * answered perfectly and the answer is half a credential". Retrying cannot help
 * and telling a caller to retry would hide a permanent gap behind a transient
 * one, so this says what is actually missing and who fixes it. 501, because it
 * is a capability this build does not have yet, not a fault.
 */
function refuseIncomplete(provider, accountName, parts) {
  const missing = parts.join(' and ');
  return {
    ok: false,
    status: 501,
    error: `This project has its own ${safeText(provider)} connection (${accountName}), but a `
      + `${safeText(provider)} credential is made of more than one part and only one of them can be `
      + `stored today — ${missing} has nowhere to live. Nothing was sent. The missing part was NOT `
      + `taken from the platform-wide keys: that would sign with one account's token and another `
      + "account's secret, which authenticates as neither and returns an error naming neither. "
      + `Connecting ${safeText(provider)} needs the slice that gives the second part a home.`,
    code: 'CONNECTION_INCOMPLETE',
    data: null,
  };
}

/**
 * This project's connection if there is a live one, otherwise the environment.
 *
 * `provider` is the connection-registry key (`facebook_page`, `bluesky`, `x`).
 * `projectId` may be empty, and empty is not an error: an unscoped caller —
 * Dane's own posting, a Settings probe — gets the environment values and a
 * `source` saying so.
 *
 * `options` goes to the environment path unchanged, so `{ envOnly: true }`
 * still means "the shared keys, ignore what is saved in Settings". It also
 * SHORT-CIRCUITS the connection lookup: envOnly means the caller is deliberately
 * asking for the platform-wide credential (the cron publish path, and the
 * side-by-side diagnostic on the Settings screen), and answering it with a
 * client's grant would make that comparison a lie.
 */
async function resolveCredentials(provider, projectId, options = {}) {
  const key = safeText(provider).toLowerCase();
  if (!key) {
    return { ok: false, status: 400, error: 'A provider is required to resolve credentials', data: null };
  }
  const mapping = mappingFor(key);
  const pid = safeText(projectId);
  const env = environmentValues(key, options);

  if (options.envOnly === true) {
    return answer(key, pid, env, 'environment', 'the caller asked for the shared keys only (envOnly)');
  }
  if (!pid) {
    return answer(key, pid, env, 'environment', 'no project scope was supplied');
  }

  const scope = { projectId: pid, userId: safeText(options.userId) };

  const listed = await projectConnectionsStore.listConnections(200, scope);
  if (!listed.ok) {
    return refuse(key, safeText(listed.error) || `the connections lookup returned ${listed.status}`, listed.status);
  }

  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const forProvider = (Array.isArray(listed.data) ? listed.data : [])
    .filter((row) => safeText(row?.provider).toLowerCase() === key);

  const skipped = [];
  let chosen = null;
  /**
   * The newest row that is live in every way EXCEPT the clock, and still holds
   * the credential that could renew it. See the fallback below — this is the
   * candidate for renewal, not a skip.
   */
  let lapsed = null;
  for (const row of forProvider) {
    // A row belonging to another project cannot appear here — listConnections
    // refuses to run an unscoped query at all — but the assertion is cheap and
    // this is the tenant leak the ticket calls out by name.
    if (safeText(row?.projectId) && safeText(row.projectId) !== pid) continue;
    const state = liveness(row, nowMs);
    if (!state.live) {
      skipped.push({ accountId: safeText(row.accountId), accountLabel: safeText(row.accountLabel), why: state.why });
      if (state.lapsed && row.hasAccessToken && row.hasRefreshToken && !lapsed) {
        // `skipped.length - 1` because the entry is amended in place if the
        // renewal below fails — one row must never appear in that list twice,
        // and slice 4 paints the card from these sentences.
        lapsed = { row, why: state.why, skippedIndex: skipped.length - 1 };
      }
      continue;
    }
    if (!row.hasAccessToken) {
      skipped.push({
        accountId: safeText(row.accountId),
        accountLabel: safeText(row.accountLabel),
        why: 'it has no stored access token',
      });
      continue;
    }
    // listConnections orders newest-updated first, so the first live row is the
    // most recently touched. Slice 4 gives a client an explicit choice when
    // one project holds several accounts on one platform; until then, newest
    // wins, and every skipped row is reported rather than swallowed.
    chosen = row;
    break;
  }

  /** The one sentence that explains a fallback, built the same way from both exits. */
  const noneUsable = () => (forProvider.length
    ? `this project's ${forProvider.length} stored ${key} connection(s) are not usable `
      + `(${skipped.map((s) => `${s.accountLabel || s.accountId}: ${s.why}`).join('; ')})`
    : `this project has no stored ${key} connection`);

  /**
   * RENEW BEFORE WRITING A ROW OFF. Review round 2 of 86bbpz1hu.
   *
   * Nothing live, but one row is merely past its deadline and still holds the
   * refresh token that can fix that. Electing it here sends it down the
   * ordinary path below, whose `refreshBeforeUse` call already knows how to
   * renew an expired token — `refreshDue` returns `due: true, expired: true`
   * for exactly this row. Nothing had ever asked it.
   *
   * The order used to be the other way round: renewal ran only on a row that
   * had ALREADY passed `liveness`, so a token with minutes left was renewed
   * and a token that had actually lapsed never was. X's tokens last about two
   * hours against a thirty-minute refresh window, so any project that went an
   * afternoon without posting fell through to the shared keys — and the shared
   * keys are Dane's own X account. `ok: true`, card still green, the post on
   * the wrong timeline, and only the client's followers ever knowing.
   *
   * A row refused for its STATUS is not eligible and must not become so: a
   * revoked grant is a decision the client or the provider made, and no amount
   * of refresh token overrules it. Only the clock is recoverable.
   */
  let renewing = null;
  if (!chosen && lapsed) {
    chosen = lapsed.row;
    renewing = lapsed;
  }

  if (!chosen) {
    // The room, not the door. See `sharedKeysArePersonal` in the value map: for
    // X the thing underneath this fallback is a person's own account, so a
    // project that HAS a connection and cannot use it is refused rather than
    // served from it — whatever the reason turns out to be. A project with no
    // connection at all falls through exactly as it always has.
    if (forProvider.length && mapping.sharedKeysArePersonal) {
      return refuseRatherThanBorrow(key, noneUsable(), skipped);
    }
    return answer(key, pid, env, 'environment', noneUsable(), { skipped });
  }

  const unstorable = missingParts(mapping);
  if (unstorable.length) {
    // Reached only when this project HAS a live connection for the provider.
    // With no connection the environment path above is untouched, complete, and
    // is what Dane's own posting uses — so this refusal cannot reach it.
    return refuseIncomplete(key, chosen.accountLabel || chosen.accountId, unstorable);
  }

  const full = await projectConnectionsStore.getConnection(
    { provider: key, accountId: chosen.accountId },
    scope
  );
  if (!full.ok) {
    // A row we just listed and now cannot read is not "no connection" — it is a
    // decrypt failure or a probe that went down between the two calls. Both
    // mean the client HAS granted permission, so falling back to the shared
    // keys would post as Starcaster on the strength of an error.
    return refuse(
      key,
      `the stored connection for ${chosen.accountLabel || chosen.accountId} could not be read `
        + `(${safeText(full.error) || full.status})`,
      full.status
    );
  }

  /**
   * REFRESH ON THE WAY OUT. Slice 6a (86bbpz1gv).
   *
   * A token with minutes left on it passes `liveness` above and then dies
   * halfway through the post it was fetched for — and X's tokens are measured
   * in hours, so the window between "still live" and "dead" is the ordinary
   * case, not an edge one. Renewing here rather than on a schedule is what makes
   * the promise keepable without anyone watching: the last thing that happens
   * before a credential is handed out is a check that it will still be good
   * when it is used.
   *
   * A failure does NOT stop the post. The token in hand is the client's own and
   * is still valid right now; `refreshBeforeUse` has already marked the
   * connection so the card can say it needs attention, and the note rides along
   * on the answer. Refusing here would take a working account off the air ahead
   * of time, and falling back to the shared keys would post as Starcaster —
   * which is the one thing this file exists to prevent.
   */
  const renewed = await verifySweep.refreshBeforeUse({
    connection: full.data,
    scope,
    nowMs,
  });
  const connection = renewed.connection || full.data;

  /**
   * The renewal was the ONLY thing standing between this row and the fallback,
   * and it did not happen. Unlike the paragraph above — where the token in hand
   * is still valid and a failed refresh costs nothing yet — this token is
   * already dead, so carrying on would post with a credential the provider has
   * stopped accepting. Fall back, and say in the same breath which account
   * could not be renewed and why.
   *
   * `refreshBeforeUse` has already marked the row `expired` on its way out, so
   * the card is amber before this returns.
   */
  if (renewing && renewed.refreshed !== true) {
    skipped[renewing.skippedIndex] = {
      ...skipped[renewing.skippedIndex],
      why: `${renewing.why}, and it could not be renewed (${safeText(renewed.note) || 'no reason given'})`,
    };
    // The second door into the same room, and it needs the same answer as the
    // first — this is the exit review round 2 measured a client's post leaving
    // through, on Dane's timeline, with `ok: true`.
    if (mapping.sharedKeysArePersonal) {
      return refuseRatherThanBorrow(key, noneUsable(), skipped);
    }
    return answer(key, pid, env, 'environment', noneUsable(), { skipped });
  }

  const overlay = overlayFrom(connection, mapping);
  if (!safeText(overlay[mapping.token])) {
    return refuse(key, `the stored connection for ${chosen.accountLabel || chosen.accountId} decrypted to an empty token`, 500);
  }

  /**
   * The connection path's values: the environment underneath, this client's
   * grant on top, then the platform's own leftovers REMOVED.
   *
   * The deletion is last and it is not tidiness. See `clearOnConnection` in the
   * map above: for X it is what makes a mixed-scheme credential impossible to
   * build rather than merely unlikely to be built.
   */
  const values = { ...env, ...overlay, ...(mapping.connectionValues || {}) };
  for (const part of mapping.clearOnConnection || []) {
    delete values[part];
  }

  return answer(
    key,
    pid,
    values,
    'connection',
    `this project's own ${key} connection for ${connection.accountLabel || connection.accountId}`
      + (renewed.refreshed ? ', renewed before use' : ''),
    {
      accountId: connection.accountId,
      accountLabel: connection.accountLabel,
      status: connection.status,
      skipped,
      refresh: {
        due: Boolean(verifySweep.refreshDue(full.data, nowMs).due),
        refreshed: Boolean(renewed.refreshed),
        note: safeText(renewed.note),
        ...(renewed.ok === false ? { refreshError: safeText(renewed.note) } : {}),
      },
    }
  );
}

/**
 * The values alone, for a caller that cannot use an envelope.
 *
 * Deliberately NOT the default door: it throws away `source`, and `source` is
 * the difference between "posted for the client" and "posted as us" in a log
 * line. A refusal still throws rather than returning the environment values,
 * because the whole point of the refusal is that it must not be silent.
 */
async function resolveValues(provider, projectId, options = {}) {
  const res = await resolveCredentials(provider, projectId, options);
  if (!res.ok) {
    const err = new Error(res.error);
    err.status = res.status;
    err.code = res.code;
    throw err;
  }
  return res.data.values;
}

module.exports = {
  LIVE_STATUSES,
  PROVIDER_VALUE_MAP,
  settingsProviderFor,
  environmentValues,
  resolveCredentials,
  resolveValues,
};
