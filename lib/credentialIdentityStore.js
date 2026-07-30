'use strict';

/**
 * Remembers which account each provider last authenticated as, so a silent
 * change of identity gets reported instead of passing quietly.
 *
 * Phase 2 made every verifier say "authenticated as @who". With nothing to
 * compare against, though, a token that starts pointing somewhere else still
 * reads as a clean pass — and on a multi-tenant platform, posting as the wrong
 * account is a real failure. This store is the memory that makes "@other, not
 * @dachristensen" possible.
 *
 * Table: public.app_credential_identities (docs/SQL/credential_identities.sql).
 *
 * IMPORTANT: every function here degrades to a no-op rather than throwing when
 * the table is absent or Supabase is unreachable. The code ships before the
 * migration is applied, and a missing drift check must never break the
 * verification it decorates — a credential test that errors out because a
 * bookkeeping table is missing would be a worse bug than the one this prevents.
 *
 * Stores no secret material: only the account label and id the provider itself
 * returns.
 */

const crypto = require('crypto');
const { sbQuery } = require('./supabase');

const TABLE = 'app_credential_identities';

function safeText(value) {
  return String(value == null ? '' : value).trim();
}

/** Deterministic row id, so an upsert cannot create duplicates for a pair. */
function rowId(projectId, provider) {
  return crypto
    .createHash('sha1')
    .update(`${safeText(projectId)}::${safeText(provider).toLowerCase()}`)
    .digest('hex');
}

/**
 * True when a failure means "this feature is not installed" rather than
 * "something broke". PostgREST answers an unknown table with 404 and code
 * 42P01; either way there is nothing to report and nothing to fix at runtime.
 */
function isMissingTable(result) {
  const status = Number(result?.status || 0) || 0;
  const text = safeText(result?.error).toLowerCase();
  return status === 404
    || text.includes('42p01')
    || text.includes('does not exist')
    || text.includes('could not find the table');
}

/** The identity we last saw, or null if unknown / unavailable. */
async function getKnownIdentity({ projectId, provider }) {
  const pid = safeText(projectId);
  const prov = safeText(provider).toLowerCase();
  if (!pid || !prov) return null;

  let result;
  try {
    result = await sbQuery({
      method: 'GET',
      table: TABLE,
      query: `select=identity_label,identity_id,first_seen_at,last_verified_at`
        + `&project_id=eq.${encodeURIComponent(pid)}`
        + `&provider=eq.${encodeURIComponent(prov)}&limit=1`,
    });
  } catch (_) {
    return null;
  }
  if (!result || !result.ok) return null;
  const row = Array.isArray(result.data) ? (result.data[0] || null) : null;
  if (!row) return null;
  return {
    label: safeText(row.identity_label),
    id: safeText(row.identity_id),
    firstSeenAt: safeText(row.first_seen_at) || null,
    lastVerifiedAt: safeText(row.last_verified_at) || null,
  };
}

/**
 * Record the identity a successful check just reported, and say whether it
 * changed.
 *
 * Returns { changed, previous, tracked }. `tracked` is false when the drift
 * feature is unavailable (migration not applied, Supabase down, no project
 * scope) — callers must not present `changed: false` from an untracked check as
 * evidence that nothing changed.
 */
async function recordVerifiedIdentity({ projectId, provider, identity }) {
  const pid = safeText(projectId);
  const prov = safeText(provider).toLowerCase();
  const label = safeText(identity?.label);
  const id = safeText(identity?.id);

  // Nothing to remember: providers with plain API keys report no identity, and
  // inventing one would create phantom drift on every check.
  if (!pid || !prov || (!label && !id)) {
    return { changed: false, previous: null, tracked: false };
  }

  const previous = await getKnownIdentity({ projectId: pid, provider: prov });
  const nowIso = new Date().toISOString();

  // Compare on id when both sides have one — a display name can change while
  // the account stays the same (a renamed Page), which is not drift. Fall back
  // to the label when there is no id.
  let changed = false;
  if (previous) {
    changed = (previous.id && id)
      ? previous.id !== id
      : safeText(previous.label).toLowerCase() !== label.toLowerCase();
  }

  let result;
  try {
    result = await sbQuery({
      method: 'POST',
      table: TABLE,
      // Upsert on the unique (project_id, provider) index.
      query: 'on_conflict=project_id,provider',
      body: {
        id: rowId(pid, prov),
        project_id: pid,
        provider: prov,
        identity_label: label,
        identity_id: id,
        // Reset first_seen_at when the account actually changed; this row now
        // describes a different identity.
        first_seen_at: (!previous || changed) ? nowIso : (previous.firstSeenAt || nowIso),
        last_verified_at: nowIso,
      },
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
  } catch (_) {
    return { changed: false, previous, tracked: false };
  }

  if (!result || !result.ok) {
    // Either way we did not record anything, so this check is not tracked. A
    // missing table is the expected case until the migration is applied and is
    // not worth surfacing to the operator; other failures are equally silent
    // here by design, since drift bookkeeping must never break verification.
    return { changed: false, previous, tracked: false };
  }

  return { changed, previous, tracked: true };
}

/**
 * One sentence for the operator when the account changed under them. Empty
 * string when there is nothing worth saying, so callers can append blindly.
 */
function describeIdentityChange({ changed, previous }, currentLabel) {
  if (!changed || !previous) return '';
  const before = safeText(previous.label) || safeText(previous.id) || 'a different account';
  const after = safeText(currentLabel) || 'a different account';
  if (before === after) return '';
  return `Heads up: these credentials previously authenticated as ${before} and now authenticate as ${after}. `
    + 'If that was not deliberate, posts will go to the wrong account.';
}

module.exports = {
  TABLE,
  getKnownIdentity,
  recordVerifiedIdentity,
  describeIdentityChange,
  isMissingTable,
};
