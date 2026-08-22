#!/usr/bin/env node
'use strict';

/**
 * scripts/check_model_ids.cjs — fail on AI model ids the provider has retired.
 *
 * A retired model id does not fail loudly. The provider 404s that one call, a
 * fallback ladder moves to the next entry, and the feature keeps working on a
 * shrinking set of live models until the last one goes dark. On 2026-08-16 four
 * features — Reddit, Bluesky and YouTube reply suggestions, and Messaging
 * content suggestions — were each carrying a four-entry ladder in which three
 * ids had been dead since February and April. Nothing looked broken, because
 * the single surviving id happened to sit first in every ladder. One of the
 * dead ones was also the hardcoded default used whenever ANTHROPIC_MODEL is
 * unset.
 *
 * This is a SEPARATE script, and a separate BLOCKING CI step, on purpose.
 * `check_conventions.cjs --all` runs with continue-on-error in CI because of
 * pre-existing button-in-<th> violations, so a rule folded into it is advisory
 * and can never turn the build red — the same decay `check:ui` was split out to
 * escape. It is required here from check_conventions too, which is fine because
 * pre-commit DOES block.
 *
 *   npm run check:models      # repo-wide, blocking (CI + by hand)
 *   node scripts/check_model_ids.cjs --all
 *
 * Keep RETIRED append-only: add an id the day retirement is announced, never
 * remove one. An id here is not a style preference — it is a dead endpoint.
 */

const fs = require('fs');
const { execSync } = require('child_process');

const SELF = 'scripts/check_model_ids.cjs';

// [id, why it is dead, what to use instead]
const RETIRED = [
  ['claude-3-7-sonnet-20250219', 'retired 2026-02-19', 'claude-sonnet-5'],
  ['claude-3-5-haiku-20241022', 'retired 2026-02-19', 'claude-haiku-4-5'],
  ['claude-3-haiku-20240307', 'retired 2026-04-19', 'claude-haiku-4-5'],
  ['claude-3-opus-20240229', 'retired 2026-01-05', 'claude-opus-5'],
  ['claude-3-5-sonnet-20241022', 'retired 2025-10-28', 'claude-sonnet-5'],
  ['claude-3-5-sonnet-20240620', 'retired 2025-10-28', 'claude-sonnet-5'],
  ['claude-3-sonnet-20240229', 'retired 2025-07-21', 'claude-sonnet-5'],
  ['claude-2.1', 'retired 2025-07-21', 'claude-sonnet-5'],
  ['claude-2.0', 'retired 2025-07-21', 'claude-sonnet-5'],
  ['claude-sonnet-4-20250514', 'deprecated, past its 2026-06-15 date', 'claude-sonnet-5'],
  ['claude-opus-4-20250514', 'deprecated, past its 2026-06-15 date', 'claude-opus-5'],
  ['claude-opus-4-1-20250805', 'deprecated, retires 2026-08-05', 'claude-opus-5'],
];

const GLOBS = "'lib/*.js' 'lib/**/*.js' 'routes/*.js' 'scripts/*.js' 'scripts/**/*.js' 'api/*.js' 'components/**/*.ts' 'components/**/*.tsx'";

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function message(id, why, replacement, where) {
  return (
    `Retired AI model id "${id}" in ${where} — ${why}. Use "${replacement}".\n` +
    `    Model ids carry no date suffix: "${replacement}" is the complete name.\n` +
    `    If this id is genuinely still served, update the list in ${SELF}.`
  );
}

/**
 * @param {{ all?: boolean }} opts
 * @returns {{ failures: string[], notes: string[] }}
 */
function run(opts = {}) {
  const failures = [];
  const notes = [];

  if (opts.all) {
    const files = sh(`git ls-files ${GLOBS}`)
      .split('\n').map((s) => s.trim()).filter(Boolean)
      // archive/ is a deliberate historical record — see archive/*/README.md.
      .filter((f) => f !== SELF && !f.startsWith('archive/'));
    let scanned = 0;
    for (const file of files) {
      let content;
      try {
        content = fs.readFileSync(file, 'utf8');
      } catch {
        // Listed by git but unreadable right now (deleted mid-run, bad symlink).
        // Say so rather than counting it as clean — a sweep that cannot read a
        // file has not checked it (docs/DOCTRINE.md 3.11).
        notes.push(`could not read ${file} — NOT checked`);
        continue;
      }
      scanned += 1;
      for (const [id, why, replacement] of RETIRED) {
        if (content.includes(id)) failures.push(message(id, why, replacement, file));
      }
    }
    notes.push(`model ids: scanned ${scanned} file(s) for ${RETIRED.length} retired id(s)`);
    return { failures, notes };
  }

  // Staged mode: scan the FULL staged content of each changed file, not just
  // its added lines. Added-lines-only looked right and silently did not work:
  // a retired id that already existed in HEAD and merely moved within the file
  // shows up in the diff as unchanged context, so the scan skipped the exact
  // case this check exists for. Untouched files are still never scanned, so an
  // unrelated commit is not blocked by legacy code elsewhere.
  const staged = sh('git diff --cached --name-only --diff-filter=ACMR')
    .split('\n').map((s) => s.trim()).filter(Boolean)
    .filter((f) => f !== SELF && !f.startsWith('archive/'))
    .filter((f) => /^(lib|routes|scripts|api|components)\//.test(f))
    .filter((f) => /\.(js|cjs|mjs|ts|tsx)$/.test(f));

  for (const file of staged) {
    let content;
    try {
      // The staged blob, not the working tree — that is what is being committed.
      content = sh(`git show :"${file}"`);
    } catch {
      notes.push(`could not read staged ${file} — NOT checked`);
      continue;
    }
    for (const [id, why, replacement] of RETIRED) {
      if (content.includes(id)) failures.push(message(id, why, replacement, `${file} (staged)`));
    }
  }
  return { failures, notes };
}

module.exports = { run, RETIRED };

if (require.main === module) {
  const { failures, notes } = run({ all: process.argv.includes('--all') });
  for (const note of notes) console.log(`[check:models] ${note}`);
  if (failures.length) {
    console.error('\n[check:models] Blocked — retired AI model id(s) found:\n');
    for (const f of failures) console.error(`  ✗ ${f}\n`);
    process.exit(1);
  }
  console.log('[check:models] OK — no retired model ids.');
}
