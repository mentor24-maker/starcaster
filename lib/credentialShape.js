'use strict';

/**
 * Catch bad credential values at save time, before they become a 401 next week.
 *
 * Everything here targets a failure mode that actually happened rather than a
 * theoretical one. The 2026-07-29 X incident is the archetype: a valid-looking
 * value produced an authentication error whose message blamed the wrong cause,
 * and an hour went into a token that turned out to be fine. The cheapest place
 * to catch that class of problem is the moment the value is pasted.
 *
 * Two severities, and the distinction is deliberate:
 *
 *   error   — unambiguous. A newline inside a secret, a value wrapped in
 *             quotes, an app-only Bearer token in an OAuth 1.0a field. These
 *             block the save, because no legitimate value looks like this.
 *   warning — a heuristic. "Anthropic keys usually start with sk-ant-." These
 *             never block. Providers change their formats, and refusing to
 *             save a valid key because our pattern is out of date would be a
 *             worse bug than the one being prevented.
 *
 * Strict whitespace rules apply to SECRET fields only. Plenty of non-secret
 * fields legitimately contain spaces — Reddit's user_agent, Google Drive's
 * folder names, an account display name.
 */

/** Known key prefixes, as warnings only. */
const PREFIX_HINTS = {
  anthropic: { api_key: { prefix: 'sk-ant-', label: 'Anthropic keys usually start with "sk-ant-"' } },
  openai: { api_key: { prefix: 'sk-', label: 'OpenAI keys usually start with "sk-"' } },
  resend: { api_key: { prefix: 're_', label: 'Resend keys usually start with "re_"' } },
  gemini: { api_key: { prefix: 'AIza', label: 'Google API keys usually start with "AIza"' } },
  youtube: { api_key: { prefix: 'AIza', label: 'Google API keys usually start with "AIza"' } },
  google_custom_search: { api_key: { prefix: 'AIza', label: 'Google API keys usually start with "AIza"' } },
};

/** Roughly how long a value should be, as warnings only. */
const LENGTH_HINTS = {
  x: {
    api_key: { min: 20, max: 30, label: 'an X API key is normally about 25 characters' },
    api_secret: { min: 40, max: 60, label: 'an X API secret is normally about 50 characters' },
    access_token: { min: 40, max: 60, label: 'an X access token is normally about 50 characters' },
    access_token_secret: { min: 40, max: 50, label: 'an X access token secret is normally about 45 characters' },
  },
};

function text(value) {
  return String(value == null ? '' : value);
}

function err(message) {
  return { severity: 'error', message };
}

function warn(message) {
  return { severity: 'warning', message };
}

/**
 * Problems with one value. Returns [] when it looks fine.
 *
 * @param {object} input
 * @param {string} input.provider
 * @param {string} input.field     field key, e.g. 'api_key'
 * @param {string} input.value
 * @param {boolean} input.isSecret whether the schema marks this field secret
 */
function inspectValue({ provider = '', field = '', value = '', isSecret = false } = {}) {
  const raw = text(value);
  const problems = [];
  if (!raw) return problems;

  const trimmed = raw.trim();
  const prov = String(provider || '').toLowerCase();
  const key = String(field || '').toLowerCase();

  // ── Unambiguous problems, for any field ─────────────────────────────────

  if (/^["'].*["']$/.test(trimmed) && trimmed.length > 1) {
    problems.push(err(
      'This value is wrapped in quotes. That usually means it was copied from a .env file — '
      + 'paste the value itself, without the surrounding quotes.'
    ));
  }

  if (/[\r\n]/.test(raw)) {
    problems.push(err(
      'This value contains a line break, which no provider accepts. It usually comes from '
      + 'copying a wrapped line — re-copy it as a single line.'
    ));
  }

  if (raw !== trimmed) {
    // Leading/trailing whitespace is stripped on save, so this is informational
    // rather than blocking — but worth saying, because an invisible trailing
    // space in a Vercel dashboard field is not stripped and does cause 401s.
    problems.push(warn(
      'This value had spaces around it, which have been removed. If you also pasted it into '
      + 'Vercel, check there for a trailing space — the dashboard keeps it.'
    ));
  }

  // ── Secret-only rules ───────────────────────────────────────────────────
  // Non-secret fields legitimately contain spaces (Reddit user_agent, Drive
  // folder names, display names), so these must not apply to them.

  if (isSecret) {
    // Spaces and tabs only — a line break has its own, more specific message
    // above, and reporting both for one newline is just noise.
    if (/[ \t]/.test(trimmed)) {
      problems.push(err(
        'This secret contains a space. Secrets never do — the paste probably picked up '
        + 'surrounding text, or the value is truncated.'
      ));
    }
    if (/^\*+$/.test(trimmed) || /^[.•]+$/.test(trimmed)) {
      problems.push(err(
        'This looks like a masked placeholder rather than a real value. Copy the actual '
        + 'secret from the provider.'
      ));
    }
    if (trimmed.includes('...')) {
      problems.push(err(
        'This value contains "...", which usually means a shortened preview was copied '
        + 'instead of the full secret.'
      ));
    }
  }

  // ── The mistake the old X error message kept guessing at ────────────────
  // An app-only Bearer token in an OAuth 1.0a token field. Now a real check at
  // the point of entry, instead of advice bolted onto every later failure.

  if (prov === 'x' && key === 'access_token' && /^AAAA/.test(trimmed)) {
    problems.push(err(
      'This is an app-only Bearer token, not an OAuth 1.0a access token. StarCaster posts as '
      + 'a user, so it needs the Access Token and Access Token Secret pair generated under '
      + 'your app\'s User authentication settings.'
    ));
  }

  if (prov === 'x' && key === 'access_token' && trimmed && !trimmed.includes('-')) {
    problems.push(warn(
      'An X access token normally looks like 1234567890-AbCd... — a numeric account id, a '
      + 'dash, then the token. This one has no dash.'
    ));
  }

  // ── Provider-specific format hints, all warnings ────────────────────────

  const prefixHint = PREFIX_HINTS[prov] && PREFIX_HINTS[prov][key];
  if (prefixHint && !trimmed.startsWith(prefixHint.prefix)) {
    problems.push(warn(`${prefixHint.label}; this one does not. Double-check it was copied in full.`));
  }

  const lengthHint = LENGTH_HINTS[prov] && LENGTH_HINTS[prov][key];
  if (lengthHint && (trimmed.length < lengthHint.min || trimmed.length > lengthHint.max)) {
    problems.push(warn(
      `This is ${trimmed.length} characters, but ${lengthHint.label}. A short value usually means a truncated paste.`
    ));
  }

  if (prov === 'supabase' && key === 'url' && !/^https:\/\//i.test(trimmed)) {
    problems.push(err('The Supabase URL must start with https:// — paste the full project URL.'));
  }

  if (prov === 'supabase' && key === 'service_role_key' && trimmed.split('.').length !== 3) {
    problems.push(warn(
      'A Supabase service role key is a JWT with three dot-separated parts. This one is not, '
      + 'so it may be the wrong field or a partial copy.'
    ));
  }

  if (prov === 'telegram' && key === 'bot_token' && !/^\d+:[\w-]+$/.test(trimmed)) {
    problems.push(warn('A Telegram bot token looks like 123456789:AA... — digits, a colon, then the token.'));
  }

  if (prov === 'bluesky' && key === 'identifier' && trimmed.startsWith('@')) {
    problems.push(err('Leave off the leading @ — Bluesky expects the bare handle, e.g. name.bsky.social.'));
  }

  // When something is definitely wrong, say only that. Format hints layered on
  // top are noise and often consequences of the same mistake — a quoted key
  // fails the "starts with sk-ant-" test *because* of the quotes.
  const errors = problems.filter((p) => p.severity === 'error');
  return errors.length ? errors : problems;
}

/**
 * Inspect a whole set of values against a provider schema.
 *
 * @returns {{ok: boolean, errors: Array, warnings: Array}} `ok` is false only
 * when something unambiguous is wrong; warnings never block.
 */
function inspectProviderValues(provider, values, schemaFields) {
  const errors = [];
  const warnings = [];
  const fields = Array.isArray(schemaFields) ? schemaFields : [];
  const byKey = new Map(fields.map((f) => [f.key, f]));

  for (const [key, value] of Object.entries(values || {})) {
    const field = byKey.get(key) || null;
    const problems = inspectValue({
      provider,
      field: key,
      value,
      isSecret: Boolean(field && field.secret),
    });
    for (const problem of problems) {
      const label = (field && field.label) || key;
      const entry = { field: key, label, message: problem.message };
      if (problem.severity === 'error') errors.push(entry);
      else warnings.push(entry);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

module.exports = {
  inspectValue,
  inspectProviderValues,
};
