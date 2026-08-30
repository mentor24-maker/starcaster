'use strict';

/**
 * project_connections — a tenant's own OAuth grants, one row per project +
 * provider + account, with the tokens encrypted at rest.
 *
 * Table: docs/SQL/project_connections_setup.sql. Connections 1 of 7 (86bbpz1d0).
 * Nothing calls this yet: slice 2 brings the adapters, slice 3 the resolver that
 * prefers a project's own grant over the global keys in Vercel.
 *
 * Every function returns the `{ ok, status, data }` envelope, never a bare row
 * (DOCTRINE 5.10): `connection.status` read off the envelope is the HTTP status,
 * so a connected account reads back as status "200".
 *
 * Two rules this file exists to keep, both of which have already cost this
 * codebase real production data:
 *
 *   1. A write that cannot be tenant-stamped does not happen. lib/projectScope.js
 *      stamps project_id and owner_user_id only if the table has BOTH columns,
 *      and silently stamps NEITHER otherwise (CLAUDE.md landmine 12). Here that
 *      would file an OAuth token under no project at all, so saveConnection
 *      checks the stamp landed BEFORE it sends the insert.
 *   2. A token that cannot be decrypted is an error, not an empty string.
 *      lib/projectSocialCredentialsStore.js reads a failed decrypt as '' and
 *      reports success; the caller then posts nothing and blames the provider.
 */

const { sbQuery, tableConfig } = require('./supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow, scopedPatchRow } = require('./projectScope');
const { resolveLimit } = require('./storeLimit');
const { readField, unknownKeyError, timestampOrError } = require('./storeInput');
const { encryptSecret, decryptSecret } = require('./channelsCipher');

/**
 * The connection lifecycle. It lives here rather than in a check constraint
 * because slice 6 adds the refresh/verify states and the amber card, and every
 * added state would otherwise be a schema migration. Extend the array; no SQL.
 *
 *   connected  the grant works, as far as anyone last checked
 *   expiring   still works, but expires_at is close enough to act on
 *   expired    the token is past expires_at and has not been refreshed
 *   revoked    the client took the permission away at the provider's end
 *   error      the last call failed for a reason last_error records
 */
const CONNECTION_STATUSES = ['connected', 'expiring', 'expired', 'revoked', 'error'];

const MAX_LABEL_LENGTH = 300;
const MAX_URL_LENGTH = 2000;
const MAX_ERROR_LENGTH = 2000;
/** A provider access token; the longest in the wild are Meta's, well under this. */
const MAX_TOKEN_LENGTH = 8000;

/** Every field saveConnection accepts. Anything else is a 400 naming it. */
const CONNECTION_FIELDS = [
  'provider', 'accountId', 'accountLabel', 'accountAvatarUrl', 'scopes', 'status',
  'expiresAt', 'connectedByUserId', 'lastVerifiedAt', 'lastError',
  'accessToken', 'refreshToken',
];

function table() {
  return tableConfig().projectConnections;
}

function safeText(value, max = 2000) {
  return String(value === 0 || value ? value : '').trim().slice(0, max);
}

/**
 * The scopes column, whichever shape it arrives in.
 *
 * Postgres hands back a parsed array; the SQL-backed test fake hands back the
 * literal default `'[]'` as a string, because that is what the column default
 * says. Reading only one of the two would work in exactly one of the two
 * places, which is the kind of disagreement this codebase keeps paying for.
 */
function readScopes(value) {
  if (Array.isArray(value)) return value.map((scope) => safeText(scope, 200)).filter(Boolean);
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed.map((scope) => safeText(scope, 200)).filter(Boolean) : [];
    } catch {
      // A bare comma-separated list is what every provider's own docs print,
      // so a caller pasting one gets what they meant rather than an empty array.
      return text.split(',').map((scope) => safeText(scope, 200)).filter(Boolean);
    }
  }
  return [];
}

/**
 * The scopes a CALLER supplied, or a 400 saying what is wrong with them.
 *
 * Refused rather than coerced, unlike the reader above: a caller handing
 * `scopes: { read: true }` means something, and storing `[]` for it would
 * record "this grant has no permissions" — a statement about the connection
 * that is both false and unremarkable-looking on the card.
 */
function scopesOrError(value, field) {
  if (value === undefined || value === null || value === '') return { ok: true, value: [] };
  if (Array.isArray(value) || typeof value === 'string') {
    return { ok: true, value: readScopes(value) };
  }
  return { ok: false, status: 400, error: `${field} must be an array of scope names, or a comma-separated string` };
}

/**
 * A row as the rest of the app may see it — WITHOUT either token.
 *
 * The secrets are added by getConnection alone, and only when it could actually
 * decrypt them. Everything that lists connections (the screen in slice 4) gets
 * this shape, so no code path that merely renders a card is ever holding a
 * token it could log, template or hand to a browser.
 */
function rowToConnection(row) {
  if (!row) return null;
  return {
    projectId: safeText(row.project_id, 120),
    ownerUserId: safeText(row.owner_user_id, 120),
    provider: safeText(row.provider, 60),
    accountId: safeText(row.account_id, 200),
    accountLabel: safeText(row.account_label, MAX_LABEL_LENGTH),
    accountAvatarUrl: safeText(row.account_avatar_url, MAX_URL_LENGTH),
    scopes: readScopes(row.scopes),
    status: safeText(row.status, 40) || 'connected',
    expiresAt: row.expires_at || '',
    connectedByUserId: safeText(row.connected_by_user_id, 120),
    lastVerifiedAt: row.last_verified_at || '',
    lastError: safeText(row.last_error, MAX_ERROR_LENGTH),
    keyVersion: safeText(row.key_version, 40),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    hasAccessToken: Boolean(safeText(row.access_token_enc, MAX_TOKEN_LENGTH)),
    hasRefreshToken: Boolean(safeText(row.refresh_token_enc, MAX_TOKEN_LENGTH)),
  };
}

/**
 * One stored token, decrypted — or the reason it could not be, as a failure.
 *
 * A row whose three ciphertext columns are all empty is a connection that never
 * had that token (a refresh token from a provider that does not issue one), and
 * that is an empty string, not an error. A row that HAS ciphertext and cannot
 * be read is an error: the encryption key is missing or has been rotated, and
 * answering '' there is how a caller ends up posting with no credential and
 * reading the provider's 401 as the client's fault.
 */
function readToken(row, prefix) {
  const enc = safeText(row?.[`${prefix}_enc`], MAX_TOKEN_LENGTH);
  const iv = safeText(row?.[`${prefix}_iv`], 200);
  const tag = safeText(row?.[`${prefix}_tag`], 200);
  if (!enc && !iv && !tag) return { ok: true, value: '' };
  if (!enc || !iv || !tag) {
    return {
      ok: false,
      status: 500,
      error: `The stored ${prefix.replace('_', ' ')} is incomplete — it cannot be decrypted`,
    };
  }
  const res = decryptSecret({ password_enc: enc, password_iv: iv, password_tag: tag });
  if (!res.ok) return { ok: false, status: 500, error: res.error };
  return { ok: true, value: safeText(res.data?.plaintext, MAX_TOKEN_LENGTH) };
}

/** The three ciphertext columns for one token, or the cipher's own failure. */
function encryptToken(plaintext, prefix) {
  const text = safeText(plaintext, MAX_TOKEN_LENGTH);
  if (!text) return { ok: true, columns: { [`${prefix}_enc`]: '', [`${prefix}_iv`]: '', [`${prefix}_tag`]: '' } };
  const enc = encryptSecret(text);
  // encryptSecret fails when CHANNELS_ENCRYPTION_KEY is missing or malformed —
  // which is the live state of this deployment's key today (it was blanked
  // after the 2026-07-13 exposure and the rotation was never finished). The
  // whole point of surfacing it is that the alternative is writing '' into
  // access_token_enc and calling the connection saved.
  if (!enc.ok) return { ok: false, status: 500, error: enc.error };
  return {
    ok: true,
    columns: {
      [`${prefix}_enc`]: enc.data.password_enc,
      [`${prefix}_iv`]: enc.data.password_iv,
      [`${prefix}_tag`]: enc.data.password_tag,
    },
    keyVersion: enc.data.key_version,
  };
}

/** The (provider, accountId) half of the key, or a 400 naming what is missing. */
function readKey(input) {
  const provider = safeText(input?.provider ?? input?.Provider, 60).toLowerCase();
  const accountId = safeText(input?.accountId ?? input?.account_id, 200);
  if (!provider) return { ok: false, status: 400, error: 'provider is required' };
  if (!accountId) return { ok: false, status: 400, error: 'accountId is required' };
  return { ok: true, provider, accountId };
}

/**
 * The half of the primary key a caller names. The project half is added by
 * scopedIdQuery, which is also what makes it impossible to forget.
 */
function keyFilter(provider, accountId) {
  return `provider=eq.${encodeURIComponent(provider)}`
    + `&account_id=eq.${encodeURIComponent(accountId)}`;
}

/**
 * Save one grant: insert it, or update the one already there.
 *
 * Deliberately NOT a PostgREST upsert. An upsert is one round trip and would be
 * the obvious choice, but `Prefer: resolution=merge-duplicates` is a behaviour
 * no test here can exercise, and an untested write path into a token vault is
 * the thing this slice is least able to afford. Insert-then-patch-on-conflict
 * is the same outcome — including under a race, where the loser of the insert
 * patches instead of erroring — and every branch of it is reachable in a test.
 */
async function saveConnection(input, scope = null) {
  const unknown = unknownKeyError(input, CONNECTION_FIELDS);
  if (unknown) return unknown;

  const key = readKey(input);
  if (!key.ok) return key;

  const projectId = safeText(scope?.projectId || scope?.project_id, 120);
  if (!projectId) {
    return { ok: false, status: 400, error: 'A project scope is required to save a connection' };
  }

  const status = safeText(readField(input, 'status').value, 40) || 'connected';
  if (!CONNECTION_STATUSES.includes(status)) {
    return { ok: false, status: 400, error: `status must be one of ${CONNECTION_STATUSES.join(', ')}` };
  }

  const suppliedScopes = readField(input, 'scopes');
  if (!suppliedScopes.ok) return suppliedScopes;
  const grantedScopes = scopesOrError(suppliedScopes.value, 'scopes');
  if (!grantedScopes.ok) return grantedScopes;

  const suppliedExpiry = readField(input, 'expiresAt');
  if (!suppliedExpiry.ok) return suppliedExpiry;
  const expiresAt = timestampOrError(suppliedExpiry.value, 'expiresAt');
  if (!expiresAt.ok) return expiresAt;

  const suppliedVerified = readField(input, 'lastVerifiedAt');
  if (!suppliedVerified.ok) return suppliedVerified;
  const lastVerifiedAt = timestampOrError(suppliedVerified.value, 'lastVerifiedAt');
  if (!lastVerifiedAt.ok) return lastVerifiedAt;

  const accessToken = readField(input, 'accessToken');
  if (!accessToken.ok) return accessToken;
  const refreshToken = readField(input, 'refreshToken');
  if (!refreshToken.ok) return refreshToken;

  const access = encryptToken(accessToken.value, 'access_token');
  if (!access.ok) return access;
  const refresh = encryptToken(refreshToken.value, 'refresh_token');
  if (!refresh.ok) return refresh;

  const now = new Date().toISOString();
  const fields = {
    provider: key.provider,
    account_id: key.accountId,
    account_label: safeText(readField(input, 'accountLabel').value, MAX_LABEL_LENGTH),
    account_avatar_url: safeText(readField(input, 'accountAvatarUrl').value, MAX_URL_LENGTH),
    scopes: grantedScopes.value,
    status,
    expires_at: expiresAt.value,
    connected_by_user_id: safeText(readField(input, 'connectedByUserId').value, 120)
      || safeText(scope?.userId || scope?.user_id, 120)
      || null,
    last_verified_at: lastVerifiedAt.value,
    last_error: safeText(readField(input, 'lastError').value, MAX_ERROR_LENGTH),
    ...access.columns,
    ...refresh.columns,
    key_version: access.keyVersion || refresh.keyVersion || 'v1',
    updated_at: now,
  };

  const row = await scopedInsertRow(table(), fields, scope);
  // BEFORE the insert, not after it. If the table is missing either tenant
  // column, projectScope's probe fails and scopedInsertRow returns the row
  // unstamped — the insert would then succeed and file an OAuth token under no
  // project at all. Checking afterwards would only tell us that had happened.
  if (!safeText(row.project_id, 120)) {
    return {
      ok: false,
      status: 500,
      error: 'Refusing to save: the connection could not be stamped with a project. '
        + `Check that ${table()} has BOTH project_id and owner_user_id `
        + '(docs/SQL/project_connections_setup.sql has not been applied, or is out of date).',
    };
  }

  const created = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [{ ...row, created_at: now }],
  });

  if (created.ok) {
    const stored = Array.isArray(created.data) ? created.data[0] : created.data;
    if (!stored) {
      return { ok: false, status: 500, error: 'The connection was written but nothing came back to confirm it' };
    }
    return { ok: true, status: 201, data: rowToConnection(stored) };
  }

  // 409 is this row already existing — the same grant re-authorised, which is
  // the ordinary case, not a failure. Anything else is a real error and is
  // returned as itself rather than retried as an update.
  if (created.status !== 409) return created;

  const patch = await scopedPatchRow(table(), row, scope);
  delete patch.project_id;
  delete patch.provider;
  delete patch.account_id;
  const query = await scopedIdQuery(
    table(),
    `${keyFilter(key.provider, key.accountId)}&select=*`,
    scope
  );
  const updated = await sbQuery({
    method: 'PATCH',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
    body: patch,
  });
  if (!updated.ok) return updated;
  const stored = Array.isArray(updated.data) ? updated.data[0] : updated.data;
  // A 200 with no row back means the scope filter excluded it: the same
  // provider and account exist under a DIFFERENT project. That is a conflict,
  // not an empty success, and it must not read as one.
  if (!stored) {
    return {
      ok: false,
      status: 409,
      error: 'That account is already connected to a different project',
    };
  }
  return { ok: true, status: 200, data: rowToConnection(stored) };
}

/**
 * One connection, with its tokens decrypted.
 *
 * This is the only function that returns a secret. If the ciphertext is there
 * and cannot be read, it fails rather than handing back a blank token — see
 * readToken.
 */
async function getConnection(input, scope = null) {
  const key = readKey(input);
  if (!key.ok) return key;
  const projectId = safeText(scope?.projectId || scope?.project_id, 120);
  if (!projectId) {
    return { ok: false, status: 400, error: 'A project scope is required to read a connection' };
  }

  const query = await scopedIdQuery(
    table(),
    `${keyFilter(key.provider, key.accountId)}&select=*&limit=1`,
    scope
  );
  const res = await sbQuery({ method: 'GET', table: table(), query });
  if (!res.ok) return res;
  const found = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!found) return { ok: false, status: 404, error: 'Connection not found' };

  const access = readToken(found, 'access_token');
  if (!access.ok) return access;
  const refresh = readToken(found, 'refresh_token');
  if (!refresh.ok) return refresh;

  return {
    ok: true,
    status: 200,
    data: { ...rowToConnection(found), accessToken: access.value, refreshToken: refresh.value },
  };
}

/**
 * Every connection this project has, newest first, WITHOUT the tokens.
 *
 * Limit FIRST, scope second (DOCTRINE 5.10) — `listConnections(scope)` would
 * otherwise read the scope as a limit and hand back every project's grants,
 * which here is every client's tokens.
 */
async function listConnections(limit = 200, scope = null) {
  const bounded = resolveLimit(limit);
  if (!bounded.ok) return { ok: false, status: 400, error: bounded.error };
  const projectId = safeText(scope?.projectId || scope?.project_id, 120);
  if (!projectId) {
    return { ok: false, status: 400, error: 'A project scope is required to list connections' };
  }
  const query = await scopedListQuery(
    table(),
    `select=*&order=updated_at.desc,created_at.desc&limit=${bounded.limit}`,
    scope
  );
  const res = await sbQuery({ method: 'GET', table: table(), query });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 200,
    data: Array.isArray(res.data) ? res.data.map(rowToConnection) : [],
  };
}

/**
 * Forget one grant. Scoped, so a project can only delete its own — deleting on
 * (provider, account_id) alone would let any project disconnect any other's.
 *
 * Note what this does NOT do: it does not tell the provider. Revoking at the
 * provider's end is slice 6, and until it lands, removing the row means this
 * app forgets the token while the permission stays granted at Meta or X.
 */
async function deleteConnection(input, scope = null) {
  const key = readKey(input);
  if (!key.ok) return key;
  const projectId = safeText(scope?.projectId || scope?.project_id, 120);
  if (!projectId) {
    return { ok: false, status: 400, error: 'A project scope is required to delete a connection' };
  }
  const query = await scopedIdQuery(
    table(),
    `${keyFilter(key.provider, key.accountId)}&select=*`,
    scope
  );
  // The representation is asked for so the answer can be about what was
  // actually removed. Without it PostgREST answers 204 with an empty body, and
  // a delete that matched NOTHING — because the row belongs to another project,
  // or was already gone — is indistinguishable from one that worked. "Removed"
  // is exactly the kind of claim that must not be made on no evidence.
  const res = await sbQuery({
    method: 'DELETE',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return res;
  const removed = Array.isArray(res.data) ? res.data : [res.data].filter(Boolean);
  if (!removed.length) return { ok: false, status: 404, error: 'Connection not found' };
  return {
    ok: true,
    status: 200,
    data: { deleted: true, provider: key.provider, accountId: key.accountId },
  };
}

module.exports = {
  CONNECTION_STATUSES,
  CONNECTION_FIELDS,
  MAX_TOKEN_LENGTH,
  // Exported so a test can pin these directly rather than inferring them from
  // a whole round trip: what counts as a scope list, and what a stored token
  // does when the key is gone.
  readScopes,
  scopesOrError,
  readToken,
  encryptToken,
  rowToConnection,
  saveConnection,
  getConnection,
  listConnections,
  deleteConnection,
};
