'use strict';

/**
 * One vocabulary for credential failures, shared by every provider client.
 *
 * The problem this solves: each client used to write its own prose, and that
 * prose hard-coded a single cause. `xClient` appended "do not put an app-only
 * Bearer token in Access Token" to *every* X failure — including revoked
 * tokens, clock skew, and suspended apps. A message that confidently names the
 * wrong cause is worse than a bare status code, because it sends the reader
 * somewhere useless with full authority. That cost an hour on 2026-07-29.
 *
 * So: a client's job is to classify (which CODE, plus an optional
 * provider-specific line about the fix). This module's job is to assemble the
 * sentence the operator reads, and to add the environmental caveats no client
 * should have to remember — above all the Vercel redeploy trap.
 *
 * Usage from a client:
 *
 *   const { CODES, describeCredentialFailure } = require('./credentialErrors');
 *   return {
 *     ok: false,
 *     code: CODES.REJECTED,
 *     error: describeCredentialFailure({
 *       provider: 'x',
 *       code: CODES.REJECTED,
 *       detail: 'Unauthorized',
 *       fix: 'Regenerate the Access Token and Secret in the X developer portal.',
 *     }),
 *   };
 */

const { getProviderCredentialDiagnostics } = require('./apiSettings');

/**
 * What went wrong, in terms an operator can act on. Deliberately small — if a
 * new code does not change what the operator should DO, it does not belong here.
 */
const CODES = {
  /** Nothing (or not everything) was ever entered. */
  MISSING: 'missing',
  /** A value is present but visibly wrong: whitespace, quotes, truncation, wrong field. */
  MALFORMED: 'malformed',
  /** Well-formed values the provider refused. Tokens revoked, keys mismatched, wrong app. */
  REJECTED: 'rejected',
  /** Authenticated, but this token is not allowed to do this. Read-only, missing scope. */
  INSUFFICIENT_SCOPE: 'insufficient_scope',
  /** Throttled. Not a credential problem at all — retry later. */
  RATE_LIMITED: 'rate_limited',
  /** The app or account is disabled at the provider's end. Nothing to fix here. */
  SUSPENDED: 'suspended',
  /** The provider could not be reached. Network, DNS, outage. */
  UNREACHABLE: 'unreachable',
  /** Signed requests failed because this machine's clock is too far off. */
  CLOCK_SKEW: 'clock_skew',
};

/** Lead sentence per code. Says what happened, never guesses why. */
const HEADLINES = {
  [CODES.MISSING]: 'credentials are incomplete — one or more required values are not set.',
  [CODES.MALFORMED]: 'a credential value looks malformed.',
  [CODES.REJECTED]: 'the credentials were rejected.',
  [CODES.INSUFFICIENT_SCOPE]: 'the credentials authenticated but lack permission for this action.',
  [CODES.RATE_LIMITED]: 'the request was rate limited — this is not a credential problem.',
  [CODES.SUSPENDED]: 'the app or account is suspended at the provider.',
  [CODES.UNREACHABLE]: 'the provider could not be reached.',
  [CODES.CLOCK_SKEW]: "signed requests are failing because this server's clock is too far off.",
};

/**
 * Vercel bakes environment variables into a deployment when it is built, so
 * editing one in the dashboard does NOT affect the deployment already serving
 * traffic. This is the single most useful sentence in the system: it is
 * invisible, it applies to every provider, and it produced a bug that looked
 * exactly like a revoked token.
 *
 * Only worth saying when the value actually came from an env var, so it is
 * derived from real per-field source data rather than pasted everywhere.
 */
const REDEPLOY_NOTE =
  'This value comes from an environment variable. If you changed it recently, '
  + 'redeploy — dashboard edits do not reach the running deployment until you do.';

const SETTINGS_OVERRIDE_NOTE =
  'Note: a value saved in Settings > APIs is overriding the environment variable '
  + 'for this field, so editing the env var alone will change nothing.';

/**
 * Which caveats apply, based on where the values actually resolved from.
 * Never throws and never inspects secret values — only per-field source labels.
 */
function environmentNotes(provider) {
  const notes = [];
  if (!provider) return notes;
  let diag = null;
  try {
    diag = getProviderCredentialDiagnostics(provider);
  } catch (_) {
    return notes;
  }
  if (!diag || !diag.ok) return notes;

  const sources = diag.sources || {};
  const envAvailable = diag.envAvailable || {};
  const fields = Object.keys(sources);
  const anyFromEnv = fields.some((f) => sources[f] === 'env');
  const shadowedEnv = fields.some((f) => sources[f] === 'file' && envAvailable[f]);

  if (anyFromEnv) notes.push(REDEPLOY_NOTE);
  if (shadowedEnv) notes.push(SETTINGS_OVERRIDE_NOTE);
  return notes;
}

/** Which env var names / Settings fields are actually unset. Answers "what do I fill in?" */
function missingFieldSummary(provider) {
  if (!provider) return '';
  let diag = null;
  try {
    diag = getProviderCredentialDiagnostics(provider);
  } catch (_) {
    return '';
  }
  if (!diag || !diag.ok) return '';
  const sources = diag.sources || {};
  const envKeys = diag.envKeys || {};
  const missing = Object.keys(sources)
    .filter((f) => sources[f] === 'missing')
    .map((f) => (envKeys[f] ? `${f} (env: ${envKeys[f]})` : f));
  if (!missing.length) return '';
  return `Not set: ${missing.join(', ')}.`;
}

/**
 * Assemble the operator-facing message.
 *
 * @param {object} input
 * @param {string} input.code      one of CODES
 * @param {string} [input.provider] provider key, e.g. 'x' — enables source-aware notes
 * @param {string} [input.detail]   raw text from the provider, kept verbatim
 * @param {string} [input.fix]      provider-specific instruction for THIS cause
 * @param {string[]} [input.extra]  additional sentences
 * @returns {string}
 */
function describeCredentialFailure(input = {}) {
  const code = String(input.code || CODES.REJECTED);
  const provider = String(input.provider || '').trim();
  const label = provider ? provider.toUpperCase() : 'Provider';
  const parts = [`${label}: ${HEADLINES[code] || HEADLINES[CODES.REJECTED]}`];

  const detail = String(input.detail || '').trim();
  if (detail) parts.push(`Provider said: ${detail}.`);

  const fix = String(input.fix || '').trim();
  if (fix) parts.push(fix);

  if (code === CODES.MISSING) {
    const summary = missingFieldSummary(provider);
    if (summary) parts.push(summary);
  }

  // Environmental caveats only matter when the values could be right but not in
  // effect. For MISSING there is nothing to be stale, and for RATE_LIMITED /
  // UNREACHABLE the credentials are not implicated at all.
  if (code !== CODES.MISSING && code !== CODES.RATE_LIMITED && code !== CODES.UNREACHABLE) {
    parts.push(...environmentNotes(provider));
  }

  for (const line of Array.isArray(input.extra) ? input.extra : []) {
    const text = String(line || '').trim();
    if (text) parts.push(text);
  }

  return parts.join(' ');
}

/** Map an HTTP status to a code, for providers with no richer signal. */
function codeFromHttpStatus(status) {
  const n = Number(status || 0) || 0;
  if (n === 401) return CODES.REJECTED;
  if (n === 403) return CODES.INSUFFICIENT_SCOPE;
  if (n === 429) return CODES.RATE_LIMITED;
  if (n === 404) return CODES.REJECTED;
  if (n >= 500) return CODES.UNREACHABLE;
  return CODES.REJECTED;
}

module.exports = {
  CODES,
  HEADLINES,
  REDEPLOY_NOTE,
  SETTINGS_OVERRIDE_NOTE,
  describeCredentialFailure,
  environmentNotes,
  missingFieldSummary,
  codeFromHttpStatus,
};
