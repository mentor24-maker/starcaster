'use strict';

/**
 * Bluesky, behind the same contract. Connections 2 of 7 (86bbpz1e1).
 *
 * Written fresh, and written SECOND on purpose. Bluesky has no browser sign-in,
 * no authorization code, no refresh token and no way for Starcaster to revoke
 * anything at the provider's end — the client pastes an app password and
 * deletes it themselves when they are done. An interface drawn only from
 * Facebook's OAuth flow would have quietly assumed all four of those, and the
 * first platform to break the assumption would have broken the interface with
 * it. So it is the second implementation rather than the fifth.
 *
 * The request code is lib/blueskyClient.js's, reused rather than copied: the
 * session call there already carries the 401 message that tells a client to
 * drop the leading @ and mint a fresh app password, which is the single most
 * common way this connection fails.
 */

const blueskyClient = require('../../blueskyClient');
const contract = require('../contract');

const PROVIDER = 'bluesky';
const DEFAULT_SERVICE_URL = 'https://bsky.social';

function safeText(value) {
  return String(value || '').trim();
}

function normalizeIdentifier(value) {
  return safeText(value).replace(/^@+/, '');
}

/**
 * The credential this adapter stores is the APP PASSWORD, not the session JWT.
 *
 * A Bluesky access JWT lasts a couple of hours; the app password lasts until
 * the client deletes it. Storing the JWT would give a connection that verified
 * green the moment it was made and was dead by the next morning — the exact
 * shape of failure slice 6's amber card exists to catch, arriving before slice
 * 6 does. So `accessToken` here is the app password, and every call below mints
 * a fresh session from it.
 */
function credsFrom(input = {}) {
  return {
    identifier: normalizeIdentifier(input.identifier || input.accountLabel || input.accountId),
    appPassword: safeText(input.appPassword || input.accessToken),
    serviceUrl: (safeText(input.serviceUrl) || DEFAULT_SERVICE_URL).replace(/\/+$/, ''),
  };
}

function missingCredentials() {
  return contract.fail(400, 'Bluesky needs a handle and an app password. '
    + 'Create one at Bluesky > Settings > App Passwords — never the account password.');
}

function toAccount(session, creds) {
  const handle = safeText(session?.data?.handle) || creds.identifier;
  return {
    id: safeText(session?.did),
    label: handle,
    avatarUrl: '',
    // The durable credential, so a caller stores the same thing for every
    // provider without knowing that Bluesky's happens to be a password.
    accessToken: creds.appPassword,
    raw: {
      did: safeText(session?.did),
      handle,
      serviceUrl: creds.serviceUrl,
    },
  };
}

/** One session, or the envelope explaining why not. */
async function openSession(creds) {
  if (!creds.identifier || !creds.appPassword) return missingCredentials();
  const session = await blueskyClient.createSession(creds);
  if (!session.ok) return contract.normalize(session, 502);
  return { ok: true, status: session.status || 200, data: session, session };
}

// ---------------------------------------------------------------------------
// The six.
// ---------------------------------------------------------------------------

/**
 * There is no browser step. Refusing in the envelope rather than not existing is
 * the whole reason `authorizeUrl` is in the contract for an app-password
 * provider: slice 4 reads `authKind` to decide between a Connect button and a
 * small form, and a caller that guesses wrong gets a sentence it can show
 * instead of a TypeError.
 */
function authorizeUrl() {
  return contract.notSupported(
    PROVIDER,
    'authorizeUrl',
    'it is connected with an app password rather than a browser sign-in, so there is no URL to send anyone to'
  );
}

async function exchange(input = {}) {
  const creds = credsFrom(input);
  const opened = await openSession(creds);
  if (!opened.ok) return opened;
  return contract.ok(200, { accounts: [toAccount(opened.session, creds)] });
}

/** One app password is one account. The array is the contract's shape, not a promise of more. */
async function listAccounts(input = {}) {
  const creds = credsFrom(input);
  const opened = await openSession(creds);
  if (!opened.ok) return opened;
  return contract.ok(200, { accounts: [toAccount(opened.session, creds)] });
}

/**
 * Refreshing IS opening a new session — the app password does not age, and the
 * JWT minted from it is never stored. Answers ok with the credential unchanged
 * so a sweep over every provider needs no special case.
 */
async function refresh(input = {}) {
  const creds = credsFrom(input);
  const opened = await openSession(creds);
  if (!opened.ok) return opened;
  return contract.ok(200, {
    refreshed: true,
    accessToken: creds.appPassword,
    reason: 'A Bluesky app password does not expire; a fresh session is minted from it on every call.',
  });
}

async function verify(input = {}) {
  const creds = credsFrom(input);
  const opened = await openSession(creds);
  if (!opened.ok) return opened;
  const account = toAccount(opened.session, creds);
  const expectedId = safeText(input.accountId);
  if (expectedId && account.id && expectedId !== account.id) {
    return contract.fail(409, `This app password now signs in as ${account.label}, not the account it was saved for. `
      + 'Connect it again to update which account Starcaster posts to.');
  }
  return contract.ok(200, { valid: true, accountId: account.id, accountLabel: account.label });
}

/**
 * Nothing to call. Bluesky has no endpoint that lets a third party retire its
 * own app password, so an honest revoke says so and leaves the deletion of the
 * stored row — the part that actually stops Starcaster posting — to the caller.
 * Reporting `revokedAtProvider: true` here would be a claim with nothing behind
 * it, which is the failure mode this codebase keeps paying for.
 */
async function revoke(input = {}) {
  const creds = credsFrom(input);
  if (!creds.appPassword) return missingCredentials();
  return contract.ok(200, {
    revokedAtProvider: false,
    reason: 'Bluesky has no way for Starcaster to retire an app password. The stored credential is removed here, '
      + 'and the client can delete the app password itself at Bluesky > Settings > App Passwords.',
  });
}

module.exports = {
  provider: PROVIDER,
  authKind: 'app_password',
  DEFAULT_SERVICE_URL,
  isConfigured: () => true,

  authorizeUrl,
  exchange,
  listAccounts,
  refresh,
  verify,
  revoke,
};
