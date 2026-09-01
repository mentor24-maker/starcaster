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
 *   the table answered, there is no live connection   → environment. Normal.
 *   the lookup FAILED (network, a 502 on a cold start,
 *   a token that will not decrypt)                    → REFUSE, do not fall back.
 *
 * A failed lookup is not an answer, and treating it as "no connection" is the
 * silent wrong-account post dressed up as a transient blip. Refusing gives a
 * failed post with a retryable 503 on it, which is the loud half of the pair.
 */

const apiSettings = require('../apiSettings');
const projectConnectionsStore = require('../projectConnectionsStore');

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
 *   fromRaw           extra fields the adapter parked in `raw` — the second
 *                     half of a credential that is a pair
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
    fromRaw: { service_url: 'serviceUrl' },
  },
  x: {
    settingsProvider: 'x',
    token: 'access_token',
    account: null,
    label: 'account_name',
    // OAuth 1.0a signs with a PAIR. Without the secret the signature is invalid
    // and X answers 401 — which reads as a bad token rather than half a one.
    fromRaw: { access_token_secret: 'access_token_secret' },
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
 * after the last sweep, which is most of the time, because nothing sweeps
 * until slice 6. Trusting either alone posts with a dead token.
 */
function liveness(connection, nowMs) {
  const status = safeText(connection?.status) || 'connected';
  if (!LIVE_STATUSES.includes(status)) {
    return { live: false, why: `its status is "${status}"` };
  }
  const expiresAt = safeText(connection?.expiresAt);
  if (expiresAt) {
    const expiry = Date.parse(expiresAt);
    if (Number.isFinite(expiry) && expiry <= nowMs) {
      return { live: false, why: `its token expired at ${expiresAt}` };
    }
  }
  return { live: true, why: '' };
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
  const raw = connection.raw && typeof connection.raw === 'object' ? connection.raw : {};
  for (const [valueKey, rawKey] of Object.entries(mapping.fromRaw || {})) {
    put(valueKey, raw[rawKey]);
  }
  return overlay;
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
  for (const row of forProvider) {
    // A row belonging to another project cannot appear here — listConnections
    // refuses to run an unscoped query at all — but the assertion is cheap and
    // this is the tenant leak the ticket calls out by name.
    if (safeText(row?.projectId) && safeText(row.projectId) !== pid) continue;
    const state = liveness(row, nowMs);
    if (!state.live) {
      skipped.push({ accountId: safeText(row.accountId), accountLabel: safeText(row.accountLabel), why: state.why });
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

  if (!chosen) {
    const why = forProvider.length
      ? `this project's ${forProvider.length} stored ${key} connection(s) are not usable `
        + `(${skipped.map((s) => `${s.accountLabel || s.accountId}: ${s.why}`).join('; ')})`
      : `this project has no stored ${key} connection`;
    return answer(key, pid, env, 'environment', why, { skipped });
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

  const overlay = overlayFrom(full.data, mapping);
  if (!safeText(overlay[mapping.token])) {
    return refuse(key, `the stored connection for ${chosen.accountLabel || chosen.accountId} decrypted to an empty token`, 500);
  }

  return answer(
    key,
    pid,
    { ...env, ...overlay },
    'connection',
    `this project's own ${key} connection for ${full.data.accountLabel || full.data.accountId}`,
    {
      accountId: full.data.accountId,
      accountLabel: full.data.accountLabel,
      status: full.data.status,
      skipped,
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
