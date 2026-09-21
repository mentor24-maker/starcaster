'use strict';

/**
 * Does `.vercelignore` actually exclude a given path?
 *
 * WHY THIS IS NOT A GREP. The guard Studio 7/8 needs is "`workers/` does not
 * reach the Vercel build", and the obvious check — does the file contain the
 * word `workers` — passes on `# workers/ used to be ignored here`, on
 * `!workers/studio/daemon.js`, and on `my-workers/`. All three are the file
 * having stopped working while still reading as though it had not, which is
 * the exact shape the ticket's second guard exists to catch.
 *
 * So the rules are PARSED and EVALUATED against real paths, in order, with the
 * last matching rule winning — the gitignore semantics Vercel implements.
 *
 * AND A PATTERN THIS CANNOT UNDERSTAND IS NOT A PATTERN THAT DOES NOT MATCH.
 * `matches()` answers `null` for anything outside the subset below, and the
 * caller turns that into CANNOT TELL rather than a pass (DOCTRINE 3.11). A
 * narrow matcher that admits its limits is safe; a wide one that guesses is
 * how a gate reports green over a hole.
 *
 * The supported subset, which is everything this repo's ignore file uses:
 *   comments (`#`) and blank lines
 *   a plain path or path prefix:            workers        workers/
 *   an anchored one:                        /workers/
 *   `*` and `?` inside a single segment:    *.log          api/*.js
 *   a trailing `**`:                        workers/**
 *   negation:                               !workers/keep.js
 */

/** One parsed rule, or `{ understood: false }` for a pattern outside the subset. */
function parseRule(rawLine) {
  const line = String(rawLine == null ? '' : rawLine).replace(/\r$/, '');
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null; // not a rule at all

  let body = trimmed;
  let negated = false;
  if (body.startsWith('!')) {
    negated = true;
    body = body.slice(1);
  }

  // A `**` anywhere but at the very end, or a `[` character class, is outside
  // this matcher's subset. Saying so is the whole point of this module.
  if (/\*\*/.test(body.replace(/\/\*\*$/, '')) || /[[\]{}]/.test(body)) {
    return { understood: false, pattern: trimmed, why: 'uses a glob feature this matcher does not implement' };
  }

  let dirOnly = false;
  if (body.endsWith('/**')) {
    // `workers/**` means everything under workers/, which for our purposes is
    // the same set of FILES as `workers/`.
    body = body.slice(0, -3);
    dirOnly = true;
  }
  if (body.endsWith('/')) {
    body = body.slice(0, -1);
    dirOnly = true;
  }
  const anchored = body.startsWith('/');
  if (anchored) body = body.slice(1);
  if (!body) return { understood: false, pattern: trimmed, why: 'is empty once its slashes are removed' };

  return { understood: true, pattern: trimmed, negated, dirOnly, anchored, body };
}

/** A single pattern segment (no slashes) as a regular expression. */
function segmentToRegExp(segment) {
  const source = segment
    .split('')
    .map((ch) => {
      if (ch === '*') return '[^/]*';
      if (ch === '?') return '[^/]';
      return ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${source}$`);
}

/** Does one understood rule match this path? */
function ruleMatches(rule, filePath) {
  const parts = String(filePath).split('/').filter(Boolean);
  const pattern = rule.body.split('/').filter(Boolean);

  // An unanchored single-segment pattern matches at any depth, exactly as
  // gitignore does: `*.log` catches `lib/x.log`. A pattern containing a slash
  // is anchored to the root whether or not it was written with a leading one.
  const starts = rule.anchored || rule.body.includes('/') ? [0] : parts.map((_, i) => i);

  for (const start of starts) {
    if (start + pattern.length > parts.length) continue;
    let ok = true;
    for (let i = 0; i < pattern.length; i += 1) {
      if (!segmentToRegExp(pattern[i]).test(parts[start + i])) { ok = false; break; }
    }
    if (!ok) continue;
    // `dirOnly` means the pattern names a FOLDER, so the path has to continue
    // past it. `workers/` does not exclude a file literally called `workers`.
    if (rule.dirOnly && start + pattern.length >= parts.length) continue;
    return true;
  }
  return false;
}

/**
 * Is `filePath` excluded by these ignore rules?
 *
 * Returns `true` (excluded), `false` (kept), or **`null`** — meaning a rule
 * this matcher does not understand could change the answer, so no answer is
 * claimed. `null` is not `false`.
 */
function matches(ignoreText, filePath) {
  const lines = String(ignoreText == null ? '' : ignoreText).split('\n');
  let verdict = false;
  for (const line of lines) {
    const rule = parseRule(line);
    if (!rule) continue;
    if (!rule.understood) return null;
    if (ruleMatches(rule, filePath)) verdict = !rule.negated;
  }
  return verdict;
}

/** Every pattern in the file this matcher could not read, with why. */
function unreadableRules(ignoreText) {
  return String(ignoreText == null ? '' : ignoreText)
    .split('\n')
    .map(parseRule)
    .filter((r) => r && !r.understood);
}

module.exports = { matches, parseRule, ruleMatches, segmentToRegExp, unreadableRules };
